import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST } from "./route";

// Regression test for the dead-code bug described in
// docs/transcription-editor-contract.md's "Cancellation" section: this route
// used to call prisma.generationJob, a model that does not exist in either
// schema, so it always threw at runtime. It now operates on prisma.mediaJob.
describe("POST /api/projects/:id/jobs/:jobId/cancel", () => {
  let projectId: string;

  beforeEach(async () => {
    const project = await prisma.project.create({ data: { title: "Cancel route test", definition: {} } });
    projectId = project.id;
  });

  afterEach(async () => {
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  });

  async function callCancel(jobId: string) {
    return POST(new Request("http://localhost/api/projects/x/jobs/x/cancel", { method: "POST" }), {
      params: Promise.resolve({ id: projectId, jobId }),
    });
  }

  it("sets cancelRequested on a QUEUED job", async () => {
    const job = await prisma.mediaJob.create({ data: { projectId, type: "TRANSCRIBE", status: "QUEUED" } });
    const response = await callCancel(job.id);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ id: job.id, status: "QUEUED", cancelRequested: true });

    const updated = await prisma.mediaJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(updated.cancelRequested).toBe(true);
  });

  it("sets cancelRequested on a RUNNING job", async () => {
    const job = await prisma.mediaJob.create({ data: { projectId, type: "TRANSCRIBE", status: "RUNNING" } });
    const response = await callCancel(job.id);
    expect(response.status).toBe(200);
    const updated = await prisma.mediaJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(updated.cancelRequested).toBe(true);
  });

  it("refuses to cancel an already-COMPLETED job", async () => {
    const job = await prisma.mediaJob.create({ data: { projectId, type: "TRANSCRIBE", status: "COMPLETED" } });
    const response = await callCancel(job.id);
    expect(response.status).toBe(400);
    const updated = await prisma.mediaJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(updated.cancelRequested).toBe(false);
  });

  it("returns 404 for a job that does not exist", async () => {
    const response = await callCancel("does-not-exist");
    expect(response.status).toBe(404);
  });
});
