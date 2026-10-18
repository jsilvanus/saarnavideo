import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST } from "./route";

describe("POST /api/projects/:id/source/:sourceId/transcription-jobs", () => {
  let projectId: string;

  beforeEach(async () => {
    projectId = (await prisma.project.create({ data: { title: "Transcription route test", definition: {} } })).id;
  });

  afterEach(async () => {
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  });

  async function call(sourceId: string, body: Record<string, unknown>) {
    return POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }), {
      params: Promise.resolve({ id: projectId, sourceId }),
    });
  }

  it("queues a whole-source job for a YouTube source whose duration is unknown, behind its DOWNLOAD job", async () => {
    const source = await prisma.source.create({ data: { type: "YOUTUBE", status: "AVAILABLE", youtubeVideoId: "abc", youtubeUrl: "https://youtu.be/abc", projects: { connect: { id: projectId } } } });
    const response = await call(source.id, { language: "fi" });
    expect(response.status).toBe(202);
    const job = await response.json() as { id: string };
    const row = await prisma.mediaJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.type).toBe("TRANSCRIBE");
    expect(row.parameters).toEqual({ language: "fi" });
    const download = await prisma.mediaJob.findUniqueOrThrow({ where: { id: row.dependsOnJobId! } });
    expect(download.type).toBe("DOWNLOAD");
  });

  it("keeps an explicit range for a YouTube source", async () => {
    const source = await prisma.source.create({ data: { type: "YOUTUBE", status: "AVAILABLE", youtubeVideoId: "abc", youtubeUrl: "https://youtu.be/abc", projects: { connect: { id: projectId } } } });
    const response = await call(source.id, { language: "fi", rangeStartSeconds: 10, rangeEndSeconds: 20 });
    expect(response.status).toBe(202);
    const row = await prisma.mediaJob.findUniqueOrThrow({ where: { id: ((await response.json()) as { id: string }).id } });
    expect(row.parameters).toEqual({ language: "fi", rangeStartSeconds: 10, rangeEndSeconds: 20 });
  });

  it("still refuses an upload whose duration is unknown without a range", async () => {
    const source = await prisma.source.create({ data: { type: "UPLOAD", status: "AVAILABLE", storagePath: "/tmp/x.mp4", projects: { connect: { id: projectId } } } });
    const response = await call(source.id, { language: "fi" });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/duration is unknown/);
  });
});
