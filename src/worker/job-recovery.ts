/** The slice of the Prisma client the recovery helpers use. */
export type RecoveryDb = {
  mediaJob: {
    findMany(args: { where: Record<string, unknown> }): Promise<Array<{ id: string; type: string; parameters: unknown }>>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  };
};

export const HEARTBEAT_MS = 15_000;
export const STALE_AFTER_MS = 90_000;

/** A RUNNING job whose worker stopped refreshing its heartbeat (jobs from before heartbeats count by their start time). */
export function staleRunningWhere(now: Date, staleAfterMs = STALE_AFTER_MS): Record<string, unknown> {
  const threshold = new Date(now.getTime() - staleAfterMs);
  return { status: "RUNNING", OR: [{ heartbeatAt: { lt: threshold } }, { heartbeatAt: null, startedAt: { lt: threshold } }] };
}

export function heartbeat(db: RecoveryDb, workerId: string, now = new Date()) {
  return db.mediaJob.updateMany({ where: { status: "RUNNING", workerId }, data: { heartbeatAt: now } });
}

function hasAuditorJob(parameters: unknown): boolean {
  return Boolean(parameters && typeof parameters === "object" && typeof (parameters as Record<string, unknown>).auditorJobId === "string");
}

/**
 * Jobs left RUNNING by a worker that died: a TRANSCRIBE job that already has an auditor job is taken over (the claim is one
 * atomic update, so only one worker resumes it); every other stale job is failed, because a half-finished render cannot be resumed.
 */
export async function recoverStaleJobs(db: RecoveryDb, workerId: string, now = new Date(), staleAfterMs = STALE_AFTER_MS): Promise<{ resume: Array<{ id: string }>; failed: number }> {
  const stale = await db.mediaJob.findMany({ where: staleRunningWhere(now, staleAfterMs) });
  const resume: Array<{ id: string }> = [];
  let failed = 0;
  for (const job of stale) {
    const resumable = job.type === "TRANSCRIBE" && hasAuditorJob(job.parameters);
    const claim = await db.mediaJob.updateMany({
      where: { id: job.id, ...staleRunningWhere(now, staleAfterMs) },
      data: resumable ? { workerId, heartbeatAt: now } : { status: "FAILED", phase: "FAILED", error: "The worker running this job stopped before it finished", message: "The worker running this job stopped before it finished", completedAt: now },
    });
    if (claim.count !== 1) continue;
    if (resumable) resume.push({ id: job.id }); else failed++;
  }
  return { resume, failed };
}
