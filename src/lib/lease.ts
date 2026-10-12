/** The slice of the Prisma client a lease needs. */
export type LeaseDb = {
  lease: {
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
    create(args: { data: { name: string; owner: string; expiresAt: Date } }): Promise<unknown>;
    deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>;
  };
};

/**
 * Takes the named lease for `ttlMs` when it is free, expired or already ours (which renews it).
 * Returns false when another owner holds it. Each step is one conditional write, so of several
 * processes asking at once exactly one gets true; with a single process the answer is always true.
 * Work done under a lease must tolerate running twice if it outlives the TTL.
 */
export async function acquireLease(db: LeaseDb, name: string, owner: string, ttlMs: number, now = new Date()): Promise<boolean> {
  const expiresAt = new Date(now.getTime() + ttlMs);
  const taken = await db.lease.updateMany({ where: { name, OR: [{ owner }, { expiresAt: { lt: now } }] }, data: { owner, expiresAt } });
  if (taken.count === 1) return true;
  try {
    await db.lease.create({ data: { name, owner, expiresAt } });
    return true;
  } catch {
    return false; // another process created the row first (unique name), or holds it
  }
}

/** Gives the lease up early; does nothing when someone else holds it now. */
export async function releaseLease(db: LeaseDb, name: string, owner: string): Promise<void> {
  await db.lease.deleteMany({ where: { name, owner } });
}

/** Runs `work` only when this process gets the lease; returns whether it ran. The lease is released afterwards. */
export async function withLease(db: LeaseDb, name: string, owner: string, ttlMs: number, work: () => Promise<void>): Promise<boolean> {
  if (!(await acquireLease(db, name, owner, ttlMs))) return false;
  try {
    await work();
  } finally {
    await releaseLease(db, name, owner).catch(() => undefined);
  }
  return true;
}
