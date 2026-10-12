import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { claimJob } from "./index";
import { heartbeat, recoverStaleJobs, type RecoveryDb } from "./job-recovery";

const db = prisma as unknown as RecoveryDb;
let projectId: string;
const NOW = new Date("2026-10-05T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

beforeEach(async () => { projectId = (await prisma.project.create({ data: { title: "Recovery test", definition: {} } })).id; });
afterEach(async () => { await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined); });

const job = (data: Record<string, unknown>) => prisma.mediaJob.create({ data: { projectId, status: "RUNNING", type: "VIDEO", startedAt: ago(10 * 60_000), ...data } as never });
const reload = (id: string) => prisma.mediaJob.findUniqueOrThrow({ where: { id } });

describe("job recovery", () => {
  it("leaves jobs with a fresh heartbeat alone", async () => {
    const running = await job({ workerId: "w1", heartbeatAt: ago(10_000) });
    expect(await recoverStaleJobs(db, "w2", NOW)).toMatchObject({ resume: [] });
    expect((await reload(running.id)).status).toBe("RUNNING");
  });

  it("fails stale renders and takes over stale transcriptions that already have an auditor job", async () => {
    const render = await job({ workerId: "w1", heartbeatAt: ago(5 * 60_000) });
    const noAuditor = await job({ type: "TRANSCRIBE", workerId: "w1", heartbeatAt: ago(5 * 60_000), parameters: { language: "fi" } });
    const transcription = await job({ type: "TRANSCRIBE", workerId: "w1", heartbeatAt: ago(5 * 60_000), parameters: { auditorJobId: "a1" } });
    const legacy = await job({ type: "TRANSCRIBE", parameters: { auditorJobId: "a2" } }); // from before heartbeats: judged by startedAt
    const result = await recoverStaleJobs(db, "w2", NOW);
    expect(result.resume.map(item => item.id).sort()).toEqual([transcription.id, legacy.id].sort());
    expect((await reload(render.id)).status).toBe("FAILED");
    expect((await reload(noAuditor.id)).status).toBe("FAILED");
    expect(await reload(transcription.id)).toMatchObject({ status: "RUNNING", workerId: "w2" });
  });

  it("lets only one worker take over a job", async () => {
    await job({ type: "TRANSCRIBE", workerId: "w1", heartbeatAt: ago(5 * 60_000), parameters: { auditorJobId: "a1" } });
    const [first, second] = await Promise.all([recoverStaleJobs(db, "w2", NOW), recoverStaleJobs(db, "w3", NOW)]);
    expect(first.resume.length + second.resume.length).toBe(1);
  });

  it("heartbeat refreshes only the worker's own running jobs", async () => {
    const mine = await job({ workerId: "w1", heartbeatAt: ago(60_000) });
    const other = await job({ workerId: "w2", heartbeatAt: ago(60_000) });
    await heartbeat(db, "w1", NOW);
    expect((await reload(mine.id)).heartbeatAt).toEqual(NOW);
    expect((await reload(other.id)).heartbeatAt).toEqual(ago(60_000));
  });

  it("fails queued jobs when their dependency job is missing", async () => {
    // Create a dependent job, but then manually delete its dependency to simulate a corrupted database state
    const dependency = await prisma.mediaJob.create({
      data: { projectId, status: "COMPLETED", type: "DOWNLOAD", completedAt: new Date(), message: "done" },
    });
    const dependent = await prisma.mediaJob.create({
      data: { projectId, status: "QUEUED", type: "TRANSCRIBE", dependsOnJobId: dependency.id, priority: 1, parameters: { language: "fi", rangeStartSeconds: 0, rangeEndSeconds: 1 } },
    });

    // Set dependsOnJobId to a non-existent ID to simulate data corruption, with the foreign key check off.
    // SQLite: PRAGMA. PostgreSQL (CI): SET LOCAL inside one transaction, so the pooled connection is the same for both statements.
    const corrupt = `UPDATE "MediaJob" SET "dependsOnJobId" = 'missing-dependency-id' WHERE id = '${dependent.id}';`;
    if ((process.env.DATABASE_URL ?? "").startsWith("postgres")) {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica;");
        await tx.$executeRawUnsafe(corrupt);
      });
    } else {
      await prisma.$executeRawUnsafe('PRAGMA foreign_keys = OFF;');
      try {
        await prisma.$executeRawUnsafe(corrupt);
      } finally {
        await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON;');
      }
    }
    
    // After a second query, this job should fail because the dependency doesn't exist
    const claimed = await claimJob();
    expect(claimed).toBeNull();
    const failed = await reload(dependent.id);
    expect(failed.status).toBe("FAILED");
    expect(failed.error).toBe("Dependency job not found");
  });
});

// Claiming lives in this file because the tests share one database file with the other DB tests: a claim in another
// file would take jobs queued here, so everything that claims runs sequentially.
const queue = (type: string, count: number) => Promise.all(Array.from({ length: count }, (_, index) => prisma.mediaJob.create({ data: { projectId, type: type as never, createdAt: new Date(Date.now() + index) } })));
const count = (type: string, status: string) => prisma.mediaJob.count({ where: { projectId, type: type as never, status: status as never } });

describe("claimJob with several workers", () => {
  it("never hands the same job to two workers", async () => {
    await queue("VIDEO", 6);
    const claims = await Promise.all(Array.from({ length: 6 }, (_, index) => claimJob({ workerId: `w${index}`, limits: {} })));
    const ids = claims.filter(Boolean).map(job => job!.id);
    expect(ids.length).toBe(6);
    expect(new Set(ids).size).toBe(6);
  });

  it("keeps a limited type within its limit even when workers race", async () => {
    await queue("TRANSCRIBE", 5);
    const claims = await Promise.all(Array.from({ length: 5 }, (_, index) => claimJob({ workerId: `w${index}`, limits: { TRANSCRIBE: 2 } })));
    expect(claims.filter(Boolean).length).toBeLessThanOrEqual(2);
    expect(await count("TRANSCRIBE", "RUNNING")).toBeLessThanOrEqual(2);
    expect(await count("TRANSCRIBE", "RUNNING") + await count("TRANSCRIBE", "QUEUED")).toBe(5);
  });

  it("claims other types while a limited type is full", async () => {
    await queue("TRANSCRIBE", 3);
    await queue("VIDEO", 1);
    const limits = { TRANSCRIBE: 1 };
    expect((await claimJob({ workerId: "w1", limits }))?.type).toBe("TRANSCRIBE");
    expect((await claimJob({ workerId: "w2", limits }))?.type).toBe("VIDEO");
    expect(await claimJob({ workerId: "w3", limits })).toBeNull();
    expect(await count("TRANSCRIBE", "QUEUED")).toBe(2);
  });

  it("frees a place when a limited job finishes", async () => {
    await queue("TRANSCRIBE", 2);
    const limits = { TRANSCRIBE: 1 };
    const first = await claimJob({ workerId: "w1", limits });
    expect(await claimJob({ workerId: "w2", limits })).toBeNull();
    await prisma.mediaJob.update({ where: { id: first!.id }, data: { status: "COMPLETED" } });
    expect(await claimJob({ workerId: "w2", limits })).not.toBeNull();
  });
});
