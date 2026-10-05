import { createHash } from "node:crypto";
import { mkdir, readdir, rm, stat, utimes } from "node:fs/promises";
import path from "node:path";
import { isS3Ref, type MediaStore } from "@/lib/media-store";

/**
 * Files one job reads and writes. With local storage everything stays where it is (inputs are read in place, outputs
 * are written straight to their final path under MEDIA_ROOT), so behaviour is unchanged. With S3 storage inputs are
 * downloaded into a size-capped cache and outputs are written to a per-job scratch directory and then uploaded.
 */
export type JobFiles = {
  /** Directory for files this job creates (MEDIA_ROOT itself for local storage). */
  readonly scratchDir: string;
  /** A real local path for a stored reference (downloads and caches S3 files). */
  local(ref: string): Promise<string>;
  /** Puts a finished local file into the store under `key` and returns its reference (a no-op for local storage). */
  finalize(localPath: string, key: string, mimeType: string): Promise<string>;
  /** Removes the job's scratch directory (S3 storage only). */
  cleanup(): Promise<void>;
};

export type JobFilesOptions = { store: MediaStore; mediaRoot: string; jobId: string; cacheMaxBytes?: number };

const DEFAULT_CACHE_MAX_BYTES = 20 * 1024 ** 3;

export async function openJobFiles({ store, mediaRoot, jobId, cacheMaxBytes = DEFAULT_CACHE_MAX_BYTES }: JobFilesOptions): Promise<JobFiles> {
  const s3 = store.mode === "s3";
  const scratchDir = s3 ? path.join(mediaRoot, "work", jobId) : mediaRoot;
  await mkdir(scratchDir, { recursive: true });
  const cacheDir = path.join(mediaRoot, "cache");
  return {
    scratchDir,
    async local(ref) {
      if (!isS3Ref(ref)) return ref;
      const info = await store.stat(ref);
      if (!info) throw new Error(`Media file not found: ${ref}`);
      const dir = path.join(cacheDir, createHash("sha1").update(ref).digest("hex"));
      const cached = await store.materializeCached(ref, dir, info.size);
      await utimes(cached, new Date(), new Date()).catch(() => undefined);
      void pruneCache(cacheDir, cacheMaxBytes, cached);
      return cached;
    },
    async finalize(localPath, key, mimeType) {
      return s3 ? store.moveFile(key, localPath, { mimeType }) : localPath;
    },
    async cleanup() {
      if (s3) await rm(scratchDir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

/** Deletes the least recently used cached files until the cache is under `maxBytes`; never touches `keep`. */
export async function pruneCache(cacheDir: string, maxBytes: number, keep?: string): Promise<void> {
  try {
    const entries: Array<{ file: string; size: number; used: number }> = [];
    for (const dir of await readdir(cacheDir)) {
      for (const name of await readdir(path.join(cacheDir, dir)).catch(() => [])) {
        if (name.endsWith(".part")) continue;
        const file = path.join(cacheDir, dir, name);
        const info = await stat(file).catch(() => null);
        if (info?.isFile()) entries.push({ file, size: info.size, used: info.mtimeMs });
      }
    }
    let total = entries.reduce((sum, entry) => sum + entry.size, 0);
    for (const entry of entries.sort((a, b) => a.used - b.used)) {
      if (total <= maxBytes) break;
      if (entry.file === keep) continue;
      await rm(entry.file, { force: true });
      total -= entry.size;
    }
  } catch { /* the cache is an optimisation; pruning problems never fail a job */ }
}
