import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
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
});
