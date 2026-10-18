import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST } from "./route";

describe("POST /api/projects/:id/source (YouTube)", () => {
  let projectId: string;

  beforeEach(async () => {
    projectId = (await prisma.project.create({ data: { title: "Source route test", definition: {} } })).id;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  });

  async function addYouTube(youtubeUrl: string) {
    return POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ youtubeUrl }), headers: { "Content-Type": "application/json" } }), {
      params: Promise.resolve({ id: projectId }),
    });
  }

  it("names the source after the video title from oEmbed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ title: "Jumalanpalvelus" }), { status: 200 })));
    const response = await addYouTube("https://www.youtube.com/watch?v=abc123");
    expect(response.status).toBe(201);
    const body = await response.json() as { id: string; originalName: string | null };
    expect(body.originalName).toBe("Jumalanpalvelus");
    const row = await prisma.source.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.originalName).toBe("Jumalanpalvelus");
    expect(row.youtubeUrl).toBe("https://www.youtube.com/watch?v=abc123");
  });

  it("still adds the source when the title cannot be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const response = await addYouTube("https://youtu.be/def456");
    expect(response.status).toBe(201);
    const body = await response.json() as { id: string; originalName: string | null };
    expect(body.originalName).toBeNull();
    const row = await prisma.source.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.originalName).toBeNull();
  });
});
