import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Body = { language?: string; rangeStartSeconds?: number; rangeEndSeconds?: number };

export async function POST(request: Request, context: { params: Promise<{ id: string; sourceId: string }> }) {
  const { id, sourceId } = await context.params;
  try {
    const source = await prisma.source.findFirst({ where: { id: sourceId, projects: { some: { id } } } });
    if (!source) return NextResponse.json({ error: "Source not found" }, { status: 404 });

    const body = (await request.json().catch(() => ({}))) as Body;
    if (typeof body.language !== "string" || !body.language.trim()) {
      return NextResponse.json({ error: "language is required" }, { status: 400 });
    }

    const durationSeconds = source.durationMs != null ? source.durationMs / 1000 : undefined;
    const hasExplicitRange = body.rangeStartSeconds !== undefined || body.rangeEndSeconds !== undefined;
    let rangeStartSeconds: number;
    let rangeEndSeconds: number;
    if (hasExplicitRange) {
      if (typeof body.rangeStartSeconds !== "number" || typeof body.rangeEndSeconds !== "number") {
        return NextResponse.json({ error: "rangeStartSeconds and rangeEndSeconds must both be provided together" }, { status: 400 });
      }
      rangeStartSeconds = body.rangeStartSeconds;
      rangeEndSeconds = body.rangeEndSeconds;
    } else {
      if (durationSeconds === undefined) {
        return NextResponse.json({ error: "Source duration is unknown; provide rangeStartSeconds and rangeEndSeconds explicitly" }, { status: 400 });
      }
      rangeStartSeconds = 0;
      rangeEndSeconds = durationSeconds;
    }
    if (rangeStartSeconds < 0 || rangeEndSeconds <= rangeStartSeconds) {
      return NextResponse.json({ error: "rangeEndSeconds must be greater than rangeStartSeconds, and rangeStartSeconds must be non-negative" }, { status: 400 });
    }

    // If the source is a YouTube source with no storagePath yet, chain a DOWNLOAD job first - same pattern as generate/route.ts.
    let dependencyId: string | undefined;
    if (source.type === "YOUTUBE" && !source.storagePath) {
      const download = await prisma.mediaJob.create({ data: { projectId: id, sourceId: source.id, type: "DOWNLOAD", priority: 100, parameters: { sourceId: source.id } }, select: { id: true } });
      dependencyId = download.id;
    }

    const job = await prisma.mediaJob.create({
      data: {
        projectId: id,
        sourceId: source.id,
        type: "TRANSCRIBE",
        priority: 70,
        dependsOnJobId: dependencyId,
        parameters: { rangeStartSeconds, rangeEndSeconds, language: body.language.trim() },
      },
      select: { id: true, type: true, status: true, progress: true },
    });

    return NextResponse.json(job, { status: 202 });
  } catch (error) {
    console.error("Transcription job queue error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not queue transcription job" }, { status: 500 });
  }
}
