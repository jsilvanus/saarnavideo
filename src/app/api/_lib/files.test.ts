import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMediaStore, setMediaStore } from "@/lib/media-store";
import { createMemoryObjectClient } from "@/lib/media-store/memory-client";
import { rangedFileResponse, readStoredFile, removeStoredFile, saveSourceFile } from "./files";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), "files-")); });
afterEach(async () => { setMediaStore(undefined); await rm(dir, { recursive: true, force: true }); });

const request = (range?: string) => new Request("http://x/file", { headers: range ? { range } : {} });

describe.each(["local", "s3"] as const)("served from %s storage", (mode) => {
  async function stored() {
    const store = createMediaStore({ mode, root: path.join(dir, "root"), s3: { client: createMemoryObjectClient().client, bucket: "b" } });
    setMediaStore(store);
    return store.put("sources/p/a.mp4", Buffer.from("0123456789"), { mimeType: "video/mp4" });
  }

  it("answers full and ranged requests", async () => {
    const ref = await stored();
    const full = await rangedFileResponse(request(), ref, "video/mp4");
    expect(full.status).toBe(200);
    expect(full.headers.get("content-length")).toBe("10");
    expect(await full.text()).toBe("0123456789");
    const part = await rangedFileResponse(request("bytes=2-4"), ref, "video/mp4");
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 2-4/10");
    expect(await part.text()).toBe("234");
    expect((await rangedFileResponse(request("bytes=50-"), ref, "video/mp4")).status).toBe(416);
  });

  it("reads and removes stored files", async () => {
    const ref = await stored();
    expect((await readStoredFile(ref)).toString()).toBe("0123456789");
    await removeStoredFile(ref);
    await expect(rangedFileResponse(request(), ref, "video/mp4")).rejects.toThrow();
    await removeStoredFile(ref);
  });
});

it("still serves an old local path while the store writes to s3", async () => {
  const legacy = path.join(dir, "old.mp4");
  await writeFile(legacy, "legacy");
  setMediaStore(createMediaStore({ mode: "s3", root: dir, s3: { client: createMemoryObjectClient().client, bucket: "b" } }));
  expect(await (await rangedFileResponse(request(), legacy, "video/mp4")).text()).toBe("legacy");
});

describe.each(["local", "s3"] as const)("saveSourceFile with %s storage", (mode) => {
  it("streams the upload into the store", async () => {
    const client = createMemoryObjectClient();
    setMediaStore(createMediaStore({ mode, root: path.join(dir, "root"), s3: { client: client.client, bucket: "b" } }));
    const ref = await saveSourceFile("p1", new File(["sermon bytes"], "My Sermon.mp4", { type: "video/mp4" }));
    expect(ref).toMatch(mode === "s3" ? /^s3:\/\/b\/sources\/p1\/\d+-My_Sermon\.mp4$/ : /sources\/p1\/\d+-My_Sermon\.mp4$/);
    expect((await readStoredFile(ref)).toString()).toBe("sermon bytes");
  });
});
