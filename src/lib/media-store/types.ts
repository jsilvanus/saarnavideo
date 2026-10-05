import type { Readable } from "node:stream";

export type ByteRange = { start: number; end?: number };

export type PutMeta = { mimeType?: string };

/** Minimal object-storage operations the S3 backend needs; the AWS SDK implementation lives in aws-client.ts. */
export interface ObjectClient {
  head(bucket: string, key: string): Promise<{ size: number } | null>;
  get(bucket: string, key: string, range?: ByteRange): Promise<Readable>;
  put(bucket: string, key: string, body: Readable | Buffer, meta: PutMeta): Promise<void>;
  delete(bucket: string, key: string): Promise<void>;
}

/**
 * Where media files live. A stored reference is a plain absolute path (local disk, how every existing row looks)
 * or `s3://bucket/key`. Reads and deletes follow the reference; writes go to the configured default backend.
 */
export interface MediaStore {
  /** Backend that new files are written to. */
  readonly mode: "local" | "s3";
  put(key: string, body: Readable | Buffer, meta?: PutMeta): Promise<string>;
  /** Stores a local file. The source file is left where it is; the caller removes it when it was a temp file. */
  putFile(key: string, localPath: string, meta?: PutMeta): Promise<string>;
  /** Like putFile, but consumes the source: local storage renames it into place, S3 uploads it and deletes the source. */
  moveFile(key: string, localPath: string, meta?: PutMeta): Promise<string>;
  stat(ref: string): Promise<{ size: number } | null>;
  exists(ref: string): Promise<boolean>;
  stream(ref: string, range?: ByteRange): Promise<Readable>;
  /** Deletes the file; a missing file is not an error. */
  remove(ref: string): Promise<void>;
  /** A path on local disk that ffmpeg/ffprobe/yt-dlp can read. Local refs return themselves; S3 refs are downloaded into `workDir`. */
  materialize(ref: string, workDir: string): Promise<string>;
}
