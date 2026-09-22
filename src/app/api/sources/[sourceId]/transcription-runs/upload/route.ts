import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseVtt } from "@/lib/captions";
import { createTranscriptionRun, serializeRun } from "@/lib/transcriptionRuns";

function parseOptionalNumber(value: FormDataEntryValue | null): number | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function POST(request: Request, context: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await context.params;
  try {
    const source = await prisma.source.findUnique({ where: { id: sourceId } });
    if (!source) return NextResponse.json({ error: "Source not found" }, { status: 404 });

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "A .vtt file is required" }, { status: 400 });
    const language = form.get("language");
    if (typeof language !== "string" || !language.trim()) return NextResponse.json({ error: "language is required" }, { status: 400 });

    const text = await file.text();
    let parsed: ReturnType<typeof parseVtt>;
    try {
      parsed = parseVtt(text);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid VTT file" }, { status: 400 });
    }
    if (!parsed.length) return NextResponse.json({ error: "VTT file has no cues" }, { status: 400 });

    const durationSeconds = source.durationMs != null ? source.durationMs / 1000 : undefined;
    const rangeStartSeconds = parseOptionalNumber(form.get("rangeStartSeconds")) ?? 0;
    const rangeEndSeconds = parseOptionalNumber(form.get("rangeEndSeconds")) ?? durationSeconds;
    if (rangeEndSeconds === undefined) {
      return NextResponse.json({ error: "rangeEndSeconds is required when the source duration is unknown" }, { status: 400 });
    }
    if (rangeStartSeconds < 0 || rangeEndSeconds <= rangeStartSeconds) {
      return NextResponse.json({ error: "rangeEndSeconds must be greater than rangeStartSeconds, and rangeStartSeconds must be non-negative" }, { status: 400 });
    }

    const run = await createTranscriptionRun({
      sourceId,
      origin: "UPLOAD",
      language: language.trim(),
      rangeStartSeconds,
      rangeEndSeconds,
      segments: parsed,
    });

    return NextResponse.json(serializeRun(run), { status: 201 });
  } catch (error) {
    console.error("Transcription upload error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not import VTT file" }, { status: 500 });
  }
}
