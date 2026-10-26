import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST } from "./route";

describe("POST /api/projects/:id/source/:sourceId/download", () => {
  let projectId: string;

  beforeEach(async () => {
    projectId = (await prisma.project.create({ data: { title: "Download route test", definition: {} } })).id;
  });

  afterEach(async () => {
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  });

  async function call(sourceId: string) {
    return POST(new Request("http://localhost/x", { method: "POST" }), { params: Promise.resolve({ id: projectId, sourceId }) });
  }

  it("queues a DOWNLOAD job for a YouTube source without a file, and refuses a second one while it is active", async () => {
    const source = await prisma.source.create({ data: { type: "YOUTUBE", status: "AVAILABLE", youtubeVideoId: "abc", youtubeUrl: "https://youtu.be/abc", projects: { connect: { id: projectId } } } });
    const first = await call(source.id);
    expect(first.status).toBe(202);
    const job = await first.json() as { id: string; type: string };
    expect(job.type).toBe("DOWNLOAD");
    const row = await prisma.mediaJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.sourceId).toBe(source.id);
    expect(row.parameters).toEqual({ sourceId: source.id });

    const second = await call(source.id);
    expect(second.status).toBe(409);
  });

  it("answers 409 when the source is already on the server", async () => {
    const source = await prisma.source.create({ data: { type: "YOUTUBE", status: "AVAILABLE", youtubeVideoId: "def", youtubeUrl: "https://youtu.be/def", storagePath: "/tmp/def.mp4", projects: { connect: { id: projectId } } } });
    expect((await call(source.id)).status).toBe(409);
  });

  it("refuses uploaded sources and sources of other projects", async () => {
    const upload = await prisma.source.create({ data: { type: "UPLOAD", status: "AVAILABLE", storagePath: "/tmp/u.mp4", projects: { connect: { id: projectId } } } });
    expect((await call(upload.id)).status).toBe(400);
    expect((await call("missing-source")).status).toBe(404);
  });
});
