import path from "node:path";
import { createHash } from "node:crypto";
import { isS3Ref, parseRef, type MediaStore } from "@/lib/media-store";

type Row = { id: string; storagePath: string | null };
type Model = { findMany(args: { select: { id: true; storagePath: true; projectId?: true } }): Promise<Array<Row & { projectId?: string }>>; updateMany(args: { where: { storagePath: string }; data: { storagePath: string } }): Promise<{ count: number }> };

/** The slice of the Prisma client the migration uses (so tests and the script share one code path). */
export type MigrationDb = { source: Model; asset: Model; output: Model };

export type MigrateOptions = {
  db: MigrationDb;
  /** Reads existing files (any reference kind) and writes to the target backend. */
  store: MediaStore;
  mediaRoot: string;
  /** Move to this backend: references of the other kind are migrated. */
  to: "s3" | "local";
  /** Only migrate references this accepts (default: all). */
  include?: (ref: string) => boolean;
  dryRun?: boolean;
  /** Remove the old file after the new copy is verified and the rows point at it. */
  deleteOld?: boolean;
  log?: (message: string) => void;
};

export type MigrateReport = { migrated: number; skipped: number; missing: string[]; failed: Array<{ ref: string; error: string }>; rowsUpdated: number; bytes: number };

const KEY_PATTERN = /(?:^|\/)((?:sources|assets\/library|outputs)\/.+)$/;

/** Storage key for a file: the part of its path under sources/, assets/library/ or outputs/; outputs sitting loose in the media root go to outputs/<project>/. */
export function keyForRef(ref: string, mediaRoot: string, projectId?: string): string {
  const parsed = parseRef(ref);
  const location = parsed.kind === "s3" ? parsed.key : parsed.path;
  const known = KEY_PATTERN.exec(location);
  if (known) return known[1];
  const base = path.basename(location);
  if (parsed.kind === "local" && path.dirname(parsed.path) === path.resolve(mediaRoot) && projectId) return `outputs/${projectId}/${base}`;
  return `imported/${createHash("sha1").update(location).digest("hex").slice(0, 12)}/${base}`;
}

/**
 * Copies every media file of the other storage kind to the target backend and repoints the database rows. A row is
 * switched only after the new copy exists with the same size, so a failure or a crash leaves every row valid.
 * Files shared by several rows (duplicated projects, deduplicated assets) are copied once. Safe to run again.
 */
export async function migrateMedia(options: MigrateOptions): Promise<MigrateReport> {
  const { db, store, mediaRoot, to, include = () => true, dryRun = false, deleteOld = false, log = () => {} } = options;
  const report: MigrateReport = { migrated: 0, skipped: 0, missing: [], failed: [], rowsUpdated: 0, bytes: 0 };
  const refs = new Map<string, { projectId?: string }>();
  for (const model of [db.source, db.asset, db.output]) {
    for (const row of await model.findMany({ select: { id: true, storagePath: true, ...(model === db.output ? { projectId: true as const } : {}) } })) {
      if (row.storagePath && !refs.has(row.storagePath)) refs.set(row.storagePath, { projectId: row.projectId });
    }
  }
  for (const [ref, info] of refs) {
    if (!include(ref) || isS3Ref(ref) === (to === "s3")) { report.skipped++; continue; }
    const size = await store.stat(ref);
    if (!size) { report.missing.push(ref); log(`missing: ${ref}`); continue; }
    const key = keyForRef(ref, mediaRoot, info.projectId);
    if (dryRun) { report.migrated++; report.bytes += size.size; log(`would move ${ref} -> ${key} (${size.size} bytes)`); continue; }
    try {
      const target = await store.put(key, await store.stream(ref));
      const copied = await store.stat(target);
      if (!copied || copied.size !== size.size) throw new Error(`size mismatch after copy (${copied?.size ?? "missing"} != ${size.size})`);
      for (const model of [db.source, db.asset, db.output]) report.rowsUpdated += (await model.updateMany({ where: { storagePath: ref }, data: { storagePath: target } })).count;
      if (deleteOld) await store.remove(ref);
      report.migrated++; report.bytes += size.size;
      log(`moved ${ref} -> ${target}`);
    } catch (error) {
      report.failed.push({ ref, error: error instanceof Error ? error.message : String(error) });
      log(`failed: ${ref}: ${error instanceof Error ? error.message : error}`);
    }
  }
  return report;
}
