import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildTranscriptHtml, buildTranscriptText, selectSegmentsInRange } from "@/lib/transcript-text";
import { jsonError } from "./http";
import { sourceFileBase } from "./captions";

const FORMATS = {
  txt: { contentType: "text/plain; charset=utf-8" },
  html: { contentType: "text/html; charset=utf-8" },
} as const;


function numberParam(params: URLSearchParams, name: string): number | undefined | "invalid" {
  const raw = params.get(name);
  if (raw === null || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : "invalid";
}

/**
 * Plain-text (or minimal HTML) transcript of a source without timings. Query: `start`/`end` in seconds select the
 * segments whose start lies in [start, end); `runId` reads one transcription run (applied or pending) instead of the
 * active track; `title` adds a heading; `lang` overrides the language attribute of the HTML variant;
 * `gap` (seconds) overrides the pause that starts a new paragraph.
 */
export async function transcriptDownload(request: Request, sourceId: string, extension: keyof typeof FORMATS) {
  const params = new URL(request.url).searchParams;
  const start = numberParam(params, "start"), end = numberParam(params, "end"), gap = numberParam(params, "gap");
  if (start === "invalid" || end === "invalid" || gap === "invalid") return jsonError("start, end and gap must be non-negative numbers", 400);
  if (start !== undefined && end !== undefined && end <= start) return jsonError("end must be greater than start", 400);
  const source = await prisma.source.findUnique({ where: { id: sourceId }, select: { id: true, originalName: true, youtubeVideoId: true } });
  if (!source) return jsonError("Source not found", 404);
  const runId = params.get("runId")?.trim() || undefined;
  let language: string | null | undefined = params.get("lang")?.trim() || undefined;
  let segments;
  if (runId) {
    const run = await prisma.transcriptionRun.findFirst({ where: { id: runId, sourceId }, select: { language: true } });
    if (!run) return jsonError("Transcription run not found for this source", 404);
    segments = await prisma.transcriptSegment.findMany({ where: { sourceId, runId }, orderBy: { startSeconds: "asc" } });
    language ??= run.language;
  } else {
    segments = await prisma.transcriptSegment.findMany({ where: { sourceId, isActive: true }, orderBy: { startSeconds: "asc" } });
    if (!language && extension === "html") language = (await prisma.transcriptionRun.findFirst({ where: { sourceId, status: "APPLIED" }, orderBy: { appliedAt: "desc" }, select: { language: true } }))?.language;
  }
  const selected = selectSegmentsInRange(segments, start, end);
  const options = { title: params.get("title")?.slice(0, 300) || undefined, paragraphGapSeconds: gap };
  const body = extension === "html" ? buildTranscriptHtml(selected, { ...options, language }) : buildTranscriptText(selected, options);
  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": FORMATS[extension].contentType, "Content-Disposition": `attachment; filename="${sourceFileBase(source, "transcript")}-transcript.${extension}"`, "Cache-Control": "no-store" },
  });
}
