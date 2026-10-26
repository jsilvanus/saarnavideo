import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/app/api/_lib/http";

/** Queues the download of a YouTube source's video now (the DOWNLOAD job the generate and transcription routes also queue when needed). */
export async function POST(_request: Request, context: { params: Promise<{ id: string; sourceId: string }> }) {
  const { id, sourceId } = await context.params;
  try {
    const source = await prisma.source.findFirst({ where: { id: sourceId, projects: { some: { id } } } });
    if (!source) return jsonError("Source not found", 404);
    if (source.type !== "YOUTUBE") return jsonError("Only YouTube sources are downloaded", 400);
    if (source.storagePath) return jsonError("The source is already downloaded", 409);
    const active = await prisma.mediaJob.findFirst({ where: { sourceId: source.id, type: "DOWNLOAD", status: { in: ["QUEUED", "RUNNING"] } }, select: { id: true } });
    if (active) return jsonError("A download of this source is already queued or running", 409);

    const job = await prisma.mediaJob.create({
      data: { projectId: id, sourceId: source.id, type: "DOWNLOAD", priority: 100, parameters: { sourceId: source.id } },
      select: { id: true, type: true, status: true, progress: true },
    });
    return NextResponse.json(job, { status: 202 });
  } catch (error) {
    console.error("Download job queue error:", error);
    return jsonError(error instanceof Error ? error.message : "Could not queue download job", 500);
  }
}
