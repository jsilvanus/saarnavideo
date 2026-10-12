import os from "node:os";
import { acquireLease, type LeaseDb } from "@/lib/lease";

/** Live workers are leases named `worker:<host>:<workerId>`, renewed with the heartbeat. */
export const WORKER_LEASE_TTL_MS = 90_000;
const PREFIX = "worker:";

export type RegistryDb = LeaseDb & {
  lease: LeaseDb["lease"] & {
    findMany(args: { where: Record<string, unknown> }): Promise<Array<{ name: string }>>;
  };
};

export const workerLeaseName = (workerId: string, host = os.hostname()) => `${PREFIX}${host}:${workerId}`;

/** Marks this worker as alive (creates or renews its lease). */
export function registerWorker(db: RegistryDb, workerId: string, now = new Date(), host = os.hostname()) {
  return acquireLease(db, workerLeaseName(workerId, host), workerId, WORKER_LEASE_TTL_MS, now);
}

/** Hosts of the workers that are alive now, own host included. */
export async function liveWorkerHosts(db: RegistryDb, now = new Date()): Promise<string[]> {
  const rows = await db.lease.findMany({ where: { name: { startsWith: PREFIX }, expiresAt: { gt: now } } });
  return [...new Set(rows.map(row => row.name.slice(PREFIX.length).split(":")[0]))].sort();
}

/** Forgets workers that stopped renewing more than an hour ago, so the table does not grow. */
export function pruneWorkers(db: RegistryDb, now = new Date()) {
  return db.lease.deleteMany({ where: { name: { startsWith: PREFIX }, expiresAt: { lt: new Date(now.getTime() - 60 * 60_000) } } });
}

/**
 * A warning when local media storage is used while workers run on more than one host: each host would see
 * only its own disk. Null when storage is S3 or all live workers share one host (a shared network volume
 * is possible, so this is a warning and never a refusal).
 */
export function localStorageHostWarning(hosts: string[], storage: string | undefined): string | null {
  if ((storage ?? "local") !== "local" || hosts.length < 2) return null;
  return `MEDIA_STORAGE=local but workers are running on ${hosts.length} hosts (${hosts.join(", ")}). Each host only sees its own MEDIA_ROOT; use S3 (MEDIA_STORAGE=s3) or make sure MEDIA_ROOT is the same shared volume everywhere.`;
}
