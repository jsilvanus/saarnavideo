import { STALE_AFTER_MS } from "@/worker/job-recovery";

type Row = { id: string; provider: string; uploadUrl: string | null };
export type PublicationRecoveryDb = {
  publication: {
    findMany(args: { where: Record<string, unknown>; select: Record<string, boolean> }): Promise<Row[]>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  };
};

/** An UPLOADING publication whose worker stopped refreshing its heartbeat (rows from before heartbeats count by creation time). */
export function stalePublicationWhere(now: Date, staleAfterMs = STALE_AFTER_MS): Record<string, unknown> {
  const threshold = new Date(now.getTime() - staleAfterMs);
  return { status: "UPLOADING", OR: [{ heartbeatAt: { lt: threshold } }, { heartbeatAt: null, createdAt: { lt: threshold } }] };
}

export const STOPPED_ERROR = "The worker uploading this publication stopped before it finished";

/**
 * A YouTube publication with a stored upload session goes back to the queue: the next worker asks YouTube how far the
 * upload got and continues (or finds it finished), so the video is never uploaded twice. Anything else is failed:
 * restarting a Facebook upload or a YouTube upload without a session could publish the video twice.
 */
export async function recoverStalePublications(db: PublicationRecoveryDb, now = new Date(), staleAfterMs = STALE_AFTER_MS): Promise<{ requeued: number; failed: number }> {
  const where = stalePublicationWhere(now, staleAfterMs);
  const rows = await db.publication.findMany({ where, select: { id: true, provider: true, uploadUrl: true } });
  let requeued = 0; let failed = 0;
  for (const row of rows) {
    const resumable = row.provider === "YOUTUBE" && Boolean(row.uploadUrl);
    const result = await db.publication.updateMany({ where: { id: row.id, ...where }, data: resumable ? { status: "QUEUED", workerId: null, heartbeatAt: null } : { status: "FAILED", error: STOPPED_ERROR, workerId: null } });
    if (result.count) { if (resumable) requeued++; else failed++; }
  }
  return { requeued, failed };
}
