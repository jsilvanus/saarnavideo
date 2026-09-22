import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { formatVtt } from "@/lib/captions";

function captionsFilename(source: { originalName: string | null; youtubeVideoId: string | null; id: string }, extension: string): string {
  const base = source.originalName?.replace(/\.[^.]+$/, "") || source.youtubeVideoId || source.id;
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, "_") || "captions";
  return `${safe}.${extension}`;
}

export async function GET(_request: Request, context: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await context.params;
  const source = await prisma.source.findUnique({ where: { id: sourceId }, select: { id: true, originalName: true, youtubeVideoId: true } });
  if (!source) return NextResponse.json({ error: "Source not found" }, { status: 404 });
  const segments = await prisma.transcriptSegment.findMany({ where: { sourceId, isActive: true }, orderBy: { startSeconds: "asc" } });
  const body = formatVtt(segments);
  const filename = captionsFilename(source, "vtt");
  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "text/vtt; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"` },
  });
}
