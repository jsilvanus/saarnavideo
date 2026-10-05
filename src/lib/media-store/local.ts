import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { assertSafeKey } from "./refs";
import type { ByteRange } from "./types";

export class LocalBackend {
  constructor(readonly root: string) {}

  pathFor(key: string): string {
    assertSafeKey(key);
    return path.join(this.root, key);
  }

  async put(key: string, body: Readable | Buffer): Promise<string> {
    const target = this.pathFor(key);
    await mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.${Date.now()}.part`;
    try {
      await pipeline(body instanceof Buffer ? Readable.from([body]) : body, createWriteStream(temp));
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
    return target;
  }

  async putFile(key: string, localPath: string): Promise<string> {
    const target = this.pathFor(key);
    if (path.resolve(localPath) === path.resolve(target)) return target;
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(localPath, target);
    return target;
  }

  async stat(file: string): Promise<{ size: number } | null> {
    return stat(file).then(info => (info.isFile() ? { size: info.size } : null), () => null);
  }

  stream(file: string, range?: ByteRange): Readable {
    return createReadStream(file, range ? { start: range.start, end: range.end } : undefined);
  }

  async remove(file: string): Promise<void> {
    await rm(file, { force: true });
  }
}
