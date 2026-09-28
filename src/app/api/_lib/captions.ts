import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { formatSrt, formatVtt } from "@/lib/captions";
import { jsonError } from "./http";

const FORMATS = {
  srt: { format: formatSrt, contentType: "application/x-subrip; charset=utf-8" },
  vtt: { format: formatVtt, contentType: "text/vtt; charset=utf-8" },
} as const;

function captionsFilename(source: { originalName: string | null; youtubeVideoId: string | null; id: string }, extension: string): string {
  const base = source.originalName?.replace(/\.[^.]+$/, "") || source.youtubeVideoId || source.id;
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, "_") || "captions";
  return `${safe}.${extension}`;
}

/** Downloads a source's active transcript segments as an SRT or VTT attachment. */
export async function captionsDownload(sourceId: string, extension: keyof typeof FORMATS) {
  const source = await prisma.source.findUnique({ where: { id: sourceId }, select: { id: true, originalName: true, youtubeVideoId: true } });
  if (!source) return jsonError("Source not found", 404);
  const segments = await prisma.transcriptSegment.findMany({ where: { sourceId, isActive: true }, orderBy: { startSeconds: "asc" } });
  const { format, contentType } = FORMATS[extension];
  return new NextResponse(format(segments), {
    status: 200,
    headers: { "Content-Type": contentType, "Content-Disposition": `attachment; filename="${captionsFilename(source, extension)}"` },
  });
}
