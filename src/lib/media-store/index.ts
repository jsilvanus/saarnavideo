import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { LocalBackend } from "./local";
import { parseRef } from "./refs";
import { S3Backend } from "./s3";
import type { ByteRange, MediaStore, ObjectClient, PutMeta } from "./types";

export type { ByteRange, MediaStore, ObjectClient, PutMeta } from "./types";
export { isS3Ref, parseRef, s3Ref } from "./refs";

export type MediaStoreOptions = {
  mode: "local" | "s3";
  /** Local root (MEDIA_ROOT). Also used to read old local references while writing to S3. */
  root: string;
  s3?: { client: ObjectClient; bucket: string; prefix?: string };
};

export function createMediaStore(options: MediaStoreOptions): MediaStore {
  const local = new LocalBackend(options.root);
  const s3 = options.s3 ? new S3Backend(options.s3.client, options.s3.bucket, (options.s3.prefix ?? "").replace(/^\/+|\/+$/g, "")) : null;
  if (options.mode === "s3" && !s3) throw new Error("MEDIA_STORAGE=s3 needs an S3 bucket and client");

  const requireS3 = () => {
    if (!s3) throw new Error("This file is stored in S3 but S3 is not configured (set MEDIA_S3_BUCKET and credentials)");
    return s3;
  };

  const store: MediaStore = {
    mode: options.mode,
    async put(key, body, meta: PutMeta = {}) {
      return options.mode === "s3" ? requireS3().put(key, body, meta) : local.put(key, body);
    },
    async putFile(key, localPath, meta: PutMeta = {}) {
      return options.mode === "s3" ? requireS3().putFile(key, localPath, meta) : local.putFile(key, localPath);
    },
    async moveFile(key, localPath, meta: PutMeta = {}) {
      if (options.mode === "local") return local.moveFile(key, localPath);
      const ref = await requireS3().putFile(key, localPath, meta);
      await rm(localPath, { force: true });
      return ref;
    },
    async stat(ref) {
      const parsed = parseRef(ref);
      return parsed.kind === "local" ? local.stat(parsed.path) : requireS3().stat(parsed.bucket, parsed.key);
    },
    async exists(ref) {
      return (await store.stat(ref)) !== null;
    },
    async stream(ref, range?: ByteRange): Promise<Readable> {
      const parsed = parseRef(ref);
      return parsed.kind === "local" ? local.stream(parsed.path, range) : requireS3().stream(parsed.bucket, parsed.key, range);
    },
    async remove(ref) {
      const parsed = parseRef(ref);
      if (parsed.kind === "local") await local.remove(parsed.path);
      else await requireS3().remove(parsed.bucket, parsed.key);
    },
    async materializeCached(ref, dir, size) {
      const parsed = parseRef(ref);
      if (parsed.kind === "local") return parsed.path;
      const target = path.join(dir, path.basename(parsed.key));
      const existing = await stat(target).then(info => info.size, () => -1);
      if (existing !== size) await requireS3().download(parsed.bucket, parsed.key, target);
      return target;
    },
    async materialize(ref, workDir) {
      const parsed = parseRef(ref);
      if (parsed.kind === "local") return parsed.path;
      await mkdir(workDir, { recursive: true });
      const target = path.join(workDir, `${parsed.key.replace(/[^a-zA-Z0-9._-]/g, "_")}`);
      await requireS3().download(parsed.bucket, parsed.key, target);
      return target;
    },
  };
  return store;
}

/**
 * The store configured by the environment. `MEDIA_STORAGE=local` (default) writes under MEDIA_ROOT; `s3` needs
 * MEDIA_S3_BUCKET plus AWS credentials and fails at startup rather than falling back to local disk.
 */
export async function createMediaStoreFromEnv(env: Record<string, string | undefined> = process.env): Promise<MediaStore> {
  const root = env.MEDIA_ROOT ?? "/data/media";
  const mode = (env.MEDIA_STORAGE ?? "local").toLowerCase();
  if (mode !== "local" && mode !== "s3") throw new Error(`MEDIA_STORAGE must be "local" or "s3", got "${env.MEDIA_STORAGE}"`);
  const hasCredentials = Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY);
  if (mode === "s3") {
    if (!env.MEDIA_S3_BUCKET) throw new Error("MEDIA_STORAGE=s3 needs MEDIA_S3_BUCKET");
    if (!hasCredentials) throw new Error("MEDIA_STORAGE=s3 needs AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY");
  } else if (!env.MEDIA_S3_BUCKET || !hasCredentials) {
    // Local install: S3 is not loaded at all. (With a bucket configured, local mode still reads s3:// rows, e.g. after migrating back.)
    return createMediaStore({ mode, root });
  }
  const { createAwsObjectClient } = await import("./aws-client");
  const client = await createAwsObjectClient({ endpoint: env.MEDIA_S3_ENDPOINT, region: env.AWS_REGION });
  return createMediaStore({ mode: mode as "local" | "s3", root, s3: { client, bucket: env.MEDIA_S3_BUCKET!, prefix: env.MEDIA_S3_PREFIX ?? "media" } });
}

let shared: Promise<MediaStore> | undefined;

/** Process-wide store (app routes and worker). */
export function getMediaStore(): Promise<MediaStore> {
  shared ??= createMediaStoreFromEnv().catch(error => { shared = undefined; throw error; });
  return shared;
}

/** Replaces the process-wide store (tests). Pass `undefined` to go back to the environment. */
export function setMediaStore(store: MediaStore | undefined): void {
  shared = store ? Promise.resolve(store) : undefined;
}
