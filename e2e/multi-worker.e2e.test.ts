import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, inject, it } from "vitest";
import { api, createProject, setComposition, uploadSource, waitForJob } from "./helpers";

// Needs two worker processes on the one database: `E2E_WORKERS=2 npm run test:e2e:workers`. Skipped with one worker.
const workers = inject("workers");
const prisma = new PrismaClient({ datasourceUrl: inject("databaseUrl") });
afterAll(() => prisma.$disconnect());

describe.skipIf(workers < 2)("several workers on one database", () => {
  it("runs every queued render exactly once and spreads the jobs over both workers", async () => {
    const count = 6;
    const jobs = await Promise.all(
      Array.from({ length: count }, async (_, index) => {
        const project = await createProject(`Two workers ${index}`);
        const green = await uploadSource(project.id, "green.mp4");
        await setComposition(project.id, [{ type: "source-clip", sourceId: green.id, startSeconds: 0, endSeconds: 5 }], 5);
        return { projectId: project.id };
      }),
    );
    // Queue them all at once so both workers have candidates at the same time.
    const queued = await Promise.all(jobs.map(async ({ projectId }) => ({ projectId, job: await api<{ id: string }>(`/api/projects/${projectId}/generate`, { method: "POST", json: {} }) })));
    const finished = await Promise.all(queued.map(({ projectId, job }) => waitForJob(projectId, job.id)));
    expect(finished.map((job) => job.status)).toEqual(Array(count).fill("COMPLETED"));

    // One VIDEO output per job: a job claimed twice would have produced two.
    for (const { projectId, job } of queued) {
      const outputs = await prisma.output.findMany({ where: { projectId, jobId: job.id, type: "VIDEO" } });
      expect(outputs).toHaveLength(1);
    }
    // Both workers took part (each worker runs one job at a time and a render takes seconds).
    const claimed = await prisma.mediaJob.findMany({ where: { id: { in: queued.map(({ job }) => job.id) } }, select: { workerId: true } });
    const byWorker = new Set(claimed.map((row) => row.workerId));
    byWorker.delete(null);
    expect(byWorker.size).toBe(2);
  });
});
