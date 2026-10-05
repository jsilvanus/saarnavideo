import { Readable } from "node:stream";
import type { ByteRange, ObjectClient } from "./types";

/** In-memory ObjectClient for tests. */
export function createMemoryObjectClient() {
  const objects = new Map<string, Buffer>();
  const id = (bucket: string, key: string) => `${bucket}/${key}`;
  const client: ObjectClient = {
    async head(bucket, key) {
      const data = objects.get(id(bucket, key));
      return data ? { size: data.length } : null;
    },
    async get(bucket, key, range?: ByteRange) {
      const data = objects.get(id(bucket, key));
      if (!data) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
      return Readable.from([range ? data.subarray(range.start, range.end === undefined ? undefined : range.end + 1) : data]);
    },
    async put(bucket, key, body) {
      const chunks: Buffer[] = [];
      if (body instanceof Buffer) chunks.push(body);
      else for await (const chunk of body) chunks.push(Buffer.from(chunk));
      objects.set(id(bucket, key), Buffer.concat(chunks));
    },
    async delete(bucket, key) {
      objects.delete(id(bucket, key));
    },
  };
  return { client, objects };
}
