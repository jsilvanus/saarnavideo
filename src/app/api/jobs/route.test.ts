import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { GET } from "./route";

describe("GET /api/jobs", () => {
  let projectId: string;
  const title = `Jobs list test ${Math.random().toString(36).slice(2)}`;

  beforeEach(async () => {
    projectId = (await prisma.project.create({ data: { title, definition: {} } })).id;
  });
  afterEach(async () => {
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  });

  const call = async (query = "") => {
    const response = await GET(new Request(`http://localhost/api/jobs${query}`));
    return { response, body: await response.json() as { jobs: Array<Record<string, unknown>>; counts: { running: number; queued: number } } };
  };
  const mine = (jobs: Array<Record<string, unknown>>) => jobs.filter(job => job.projectId === projectId);

  it("lists queued, running and recently finished jobs of every type with project title and progress", async () => {
    const types = ["VIDEO", "TRANSCRIBE", "DOWNLOAD", "IMPORT", "PODCAST"] as const;
    for (const type of types) await prisma.mediaJob.create({ data: { projectId, type, status: "QUEUED" } });
    await prisma.mediaJob.create({ data: { projectId, type: "TRANSCRIBE", status: "RUNNING", phase: "transcribing", progress: 42, message: "STT: position 2, starts about 14:35", workerId: "w1", startedAt: new Date() } });
    await prisma.mediaJob.create({ data: { projectId, type: "VIDEO", status: "COMPLETED", progress: 100, completedAt: new Date() } });

    const { response, body } = await call();
    expect(response.status).toBe(200);
    const rows = mine(body.jobs);
    expect(rows).toHaveLength(7);
    expect(new Set(rows.map(row => row.type))).toEqual(new Set(types));
    const running = rows.find(row => row.status === "RUNNING")!;
    expect(running).toMatchObject({ projectTitle: title, phase: "transcribing", progress: 42, workerId: "w1", message: "STT: position 2, starts about 14:35" });
    expect(typeof running.createdAt).toBe("string");
    expect(body.counts.queued).toBeGreaterThanOrEqual(5);
    expect(body.counts.running).toBeGreaterThanOrEqual(1);
  });

  it("leaves the finished jobs out with ?active=1 and the old ones out by age", async () => {
    await prisma.mediaJob.create({ data: { projectId, type: "VIDEO", status: "QUEUED" } });
    await prisma.mediaJob.create({ data: { projectId, type: "VIDEO", status: "FAILED", error: "boom" } });
    const old = await prisma.mediaJob.create({ data: { projectId, type: "VIDEO", status: "COMPLETED" } });
    await prisma.$executeRaw`UPDATE "MediaJob" SET "updatedAt" = ${Date.now() - 3 * 3600_000} WHERE "id" = ${old.id}`;

    expect(mine((await call("?active=1")).body.jobs).map(job => job.status)).toEqual(["QUEUED"]);
    expect(mine((await call()).body.jobs).map(job => job.status).sort()).toEqual(["FAILED", "QUEUED"]);
  });
});
