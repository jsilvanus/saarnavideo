import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, context: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await context.params;
  try {
    const source = await prisma.source.findUnique({ where: { id: sourceId }, select: { id: true } });
    if (!source) return NextResponse.json({ error: "Source not found" }, { status: 404 });

    const [active, pendingRuns] = await Promise.all([
      prisma.transcriptSegment.findMany({ where: { sourceId, isActive: true }, orderBy: { startSeconds: "asc" } }),
      prisma.transcriptionRun.findMany({
        where: { sourceId, status: "PENDING" },
        orderBy: { createdAt: "desc" },
        include: { segments: { orderBy: { startSeconds: "asc" } } },
      }),
    ]);

    return NextResponse.json({
      active,
      pendingRuns: pendingRuns.map((run) => ({
        id: run.id,
        origin: run.origin,
        language: run.language,
        rangeStartSeconds: run.rangeStartSeconds,
        rangeEndSeconds: run.rangeEndSeconds,
        status: run.status,
        createdAt: run.createdAt,
        error: run.error,
        segments: run.segments,
      })),
    });
  } catch (error) {
    console.error("Captions lookup error:", error);
    return NextResponse.json({ error: "Failed to load captions" }, { status: 500 });
  }
}
