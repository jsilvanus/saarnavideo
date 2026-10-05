import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { assertSafeKey, s3Ref } from "./refs";
import type { ByteRange, ObjectClient, PutMeta } from "./types";

export class S3Backend {
  constructor(readonly client: ObjectClient, readonly bucket: string, readonly prefix: string) {}

  keyFor(key: string): string {
    assertSafeKey(key);
    return this.prefix ? `${this.prefix}/${key}` : key;
  }

  async put(key: string, body: Readable | Buffer, meta: PutMeta): Promise<string> {
    const fullKey = this.keyFor(key);
    await this.client.put(this.bucket, fullKey, body, meta);
    return s3Ref(this.bucket, fullKey);
  }

  putFile(key: string, localPath: string, meta: PutMeta): Promise<string> {
    return this.put(key, createReadStream(localPath), meta);
  }

  stat(bucket: string, key: string) {
    return this.client.head(bucket, key);
  }

  stream(bucket: string, key: string, range?: ByteRange) {
    return this.client.get(bucket, key, range);
  }

  remove(bucket: string, key: string) {
    return this.client.delete(bucket, key);
  }

  async download(bucket: string, key: string, target: string): Promise<void> {
    await mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.${Date.now()}.part`;
    try {
      await pipeline(await this.client.get(bucket, key), createWriteStream(temp));
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}
