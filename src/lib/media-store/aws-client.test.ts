import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMediaStoreFromEnv } from "./index";
import { startFakeS3 } from "./fake-s3-server";

let server: Awaited<ReturnType<typeof startFakeS3>>;
beforeAll(async () => { server = await startFakeS3(); });
afterAll(async () => { await server.close(); });

async function readAll(stream: Readable) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString();
}

describe("AWS SDK object client against a fake S3 server", () => {
  it("stores, ranges, stats and removes objects through the media store", async () => {
    const store = await createMediaStoreFromEnv({ MEDIA_STORAGE: "s3", MEDIA_S3_BUCKET: "bucket", MEDIA_S3_PREFIX: "media", MEDIA_S3_ENDPOINT: server.url, AWS_ACCESS_KEY_ID: "k", AWS_SECRET_ACCESS_KEY: "s", MEDIA_ROOT: "/tmp/unused" });
    const ref = await store.put("sources/p1/a.txt", Buffer.from("0123456789"), { mimeType: "text/plain" });
    expect(ref).toBe("s3://bucket/media/sources/p1/a.txt");
    expect(server.objects.get("bucket/media/sources/p1/a.txt")?.toString()).toBe("0123456789");
    expect(await store.stat(ref)).toEqual({ size: 10 });
    expect(await readAll(await store.stream(ref))).toBe("0123456789");
    expect(await readAll(await store.stream(ref, { start: 2, end: 4 }))).toBe("234");
    const streamed = await store.put("assets/library/x.bin", Readable.from(["ab", "cd"]));
    expect(await readAll(await store.stream(streamed))).toBe("abcd");
    expect(await store.stat("s3://bucket/media/missing")).toBeNull();
    await store.remove(ref);
    expect(await store.exists(ref)).toBe(false);
  });
});
