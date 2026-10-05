import { mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMediaStore } from "@/lib/media-store";
import { createMemoryObjectClient } from "@/lib/media-store/memory-client";
import { openJobFiles, pruneCache } from "./media-io";

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), "media-io-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const s3Store = () => { const memory = createMemoryObjectClient(); return { memory, store: createMediaStore({ mode: "s3", root, s3: { client: memory.client, bucket: "b" } }) }; };

describe("local storage", () => {
  it("reads in place and writes outputs where they are", async () => {
    const files = await openJobFiles({ store: createMediaStore({ mode: "local", root }), mediaRoot: root, jobId: "j1" });
    expect(files.scratchDir).toBe(root);
    expect(await files.local("/some/where.mp4")).toBe("/some/where.mp4");
    const out = path.join(root, "out.mp4");
    await writeFile(out, "video");
    expect(await files.finalize(out, "outputs/p/out.mp4", "video/mp4")).toBe(out);
    await files.cleanup();
    expect(await readFile(out, "utf8")).toBe("video");
  });
});

describe("s3 storage", () => {
  it("downloads inputs once into the cache and uploads outputs from a scratch dir", async () => {
    const { store } = s3Store();
    const ref = await store.put("sources/p/a.mp4", Buffer.from("source bytes"));
    const files = await openJobFiles({ store, mediaRoot: root, jobId: "j1" });
    expect(files.scratchDir).toBe(path.join(root, "work", "j1"));
    const first = await files.local(ref);
    expect(await readFile(first, "utf8")).toBe("source bytes");
    expect(first.startsWith(path.join(root, "cache"))).toBe(true);

    const out = path.join(files.scratchDir, "p-j1.mp4");
    await writeFile(out, "rendered");
    const outRef = await files.finalize(out, "outputs/p/p-j1.mp4", "video/mp4");
    expect(outRef).toBe("s3://b/outputs/p/p-j1.mp4");
    expect(await stat(out).then(() => true, () => false)).toBe(false);
    await files.cleanup();
    expect(await stat(files.scratchDir).then(() => true, () => false)).toBe(false);
  });

  it("reuses a cached download for the same reference", async () => {
    const { store } = s3Store();
    const ref = await store.put("sources/p/a.mp4", Buffer.from("12345"));
    const files = await openJobFiles({ store, mediaRoot: root, jobId: "j1" });
    const first = await files.local(ref);
    await writeFile(first, "ABCDE"); // same size: proves the second call does not download again
    expect(await readFile(await files.local(ref), "utf8")).toBe("ABCDE");
  });

  it("prunes the least recently used cache files", async () => {
    const cache = path.join(root, "cache");
    const { mkdir } = await import("node:fs/promises");
    for (const [name, age] of [["old", 100], ["new", 1]] as const) {
      await mkdir(path.join(cache, name), { recursive: true });
      const file = path.join(cache, name, "f.bin");
      await writeFile(file, Buffer.alloc(10));
      const time = new Date(Date.now() - age * 1000);
      await utimes(file, time, time);
    }
    await pruneCache(cache, 15);
    expect(await readdir(path.join(cache, "old"))).toEqual([]);
    expect(await readdir(path.join(cache, "new"))).toEqual(["f.bin"]);
  });
});
