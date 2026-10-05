import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMediaStore, createMediaStoreFromEnv, isS3Ref, parseRef } from "./index";
import { createMemoryObjectClient } from "./memory-client";
import type { MediaStore } from "./types";

async function readAll(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString();
}

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), "media-store-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("refs", () => {
  it("tells local paths from s3 uris", () => {
    expect(parseRef("/data/media/a.mp4")).toEqual({ kind: "local", path: "/data/media/a.mp4" });
    expect(parseRef("s3://bucket/media/a/b.mp4")).toEqual({ kind: "s3", bucket: "bucket", key: "media/a/b.mp4" });
    expect(isS3Ref("s3://b/k")).toBe(true);
    expect(() => parseRef("relative/path")).toThrow();
    expect(() => parseRef("s3://bucket")).toThrow();
  });
});

const backends: Array<[string, () => { store: MediaStore; isRef: (ref: string) => boolean }]> = [
  ["local", () => ({ store: createMediaStore({ mode: "local", root: path.join(dir, "root") }), isRef: ref => ref.startsWith(path.join(dir, "root")) })],
  ["s3", () => ({ store: createMediaStore({ mode: "s3", root: path.join(dir, "root"), s3: { client: createMemoryObjectClient().client, bucket: "b", prefix: "media" } }), isRef: ref => ref.startsWith("s3://b/media/") })],
];

describe.each(backends)("%s backend contract", (_name, make) => {
  it("puts, stats, streams (with ranges) and removes", async () => {
    const { store, isRef } = make();
    const ref = await store.put("sources/p1/a.txt", Buffer.from("0123456789"), { mimeType: "text/plain" });
    expect(isRef(ref)).toBe(true);
    expect(await store.stat(ref)).toEqual({ size: 10 });
    expect(await readAll(await store.stream(ref))).toBe("0123456789");
    expect(await readAll(await store.stream(ref, { start: 2, end: 4 }))).toBe("234");
    expect(await readAll(await store.stream(ref, { start: 7 }))).toBe("789");
    await store.remove(ref);
    expect(await store.exists(ref)).toBe(false);
    await store.remove(ref); // missing file is not an error
  });

  it("puts a stream and a local file, and materializes to a real file", async () => {
    const { store } = make();
    const streamRef = await store.put("assets/library/x.bin", Readable.from(["ab", "cd"]));
    expect(await readAll(await store.stream(streamRef))).toBe("abcd");
    const source = path.join(dir, "upload.tmp");
    await writeFile(source, "from file");
    const fileRef = await store.putFile("outputs/p1/j1.mp4", source, { mimeType: "video/mp4" });
    const local = await store.materialize(fileRef, path.join(dir, "work"));
    expect(await readFile(local, "utf8")).toBe("from file");
    expect((await stat(source)).isFile()).toBe(true);
  });

  it("rejects keys that escape the root", async () => {
    const { store } = make();
    await expect(store.put("../evil", Buffer.from("x"))).rejects.toThrow(/Invalid storage key/);
    await expect(store.put("/abs", Buffer.from("x"))).rejects.toThrow(/Invalid storage key/);
  });
});

describe("mixed references", () => {
  it("reads old local paths while writing to s3", async () => {
    const root = path.join(dir, "root");
    const store = createMediaStore({ mode: "s3", root, s3: { client: createMemoryObjectClient().client, bucket: "b" } });
    const legacy = path.join(dir, "legacy.mp4");
    await writeFile(legacy, "old");
    expect(await readAll(await store.stream(legacy))).toBe("old");
    expect(await store.materialize(legacy, path.join(dir, "work"))).toBe(legacy);
    await store.remove(legacy);
    expect(await store.exists(legacy)).toBe(false);
  });

  it("fails clearly on an s3 reference when s3 is not configured", async () => {
    const store = createMediaStore({ mode: "local", root: path.join(dir, "root") });
    await expect(store.stat("s3://b/k")).rejects.toThrow(/S3 is not configured/);
  });
});

describe("createMediaStoreFromEnv", () => {
  it("defaults to local without loading S3", async () => {
    const store = await createMediaStoreFromEnv({ MEDIA_ROOT: dir });
    expect(store.mode).toBe("local");
  });
  it("refuses s3 mode without a bucket or credentials instead of falling back", async () => {
    await expect(createMediaStoreFromEnv({ MEDIA_STORAGE: "s3", MEDIA_ROOT: dir })).rejects.toThrow(/MEDIA_S3_BUCKET/);
    await expect(createMediaStoreFromEnv({ MEDIA_STORAGE: "s3", MEDIA_S3_BUCKET: "b", MEDIA_ROOT: dir })).rejects.toThrow(/AWS_ACCESS_KEY_ID/);
    await expect(createMediaStoreFromEnv({ MEDIA_STORAGE: "nfs", MEDIA_ROOT: dir })).rejects.toThrow(/local" or "s3/);
  });
  it("builds the s3 store from env", async () => {
    const store = await createMediaStoreFromEnv({ MEDIA_STORAGE: "s3", MEDIA_S3_BUCKET: "b", AWS_ACCESS_KEY_ID: "k", AWS_SECRET_ACCESS_KEY: "s", MEDIA_S3_ENDPOINT: "http://127.0.0.1:9", MEDIA_ROOT: dir });
    expect(store.mode).toBe("s3");
  });
});
