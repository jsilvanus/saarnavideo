import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(_request: Request, context: { params: Promise<{ sourceId: string; runId: string }> }) {
  const { sourceId, runId } = await context.params;
  try {
    const run = await prisma.transcriptionRun.findFirst({ where: { id: runId, sourceId } });
    if (!run) return NextResponse.json({ error: "Transcription run not found" }, { status: 404 });
    if (run.status !== "PENDING") return NextResponse.json({ error: `Run is already ${run.status.toLowerCase()}` }, { status: 409 });

    const updated = await prisma.transcriptionRun.update({ where: { id: runId }, data: { status: "DISCARDED" }, select: { id: true, status: true } });
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Discard transcription run error:", error);
    return NextResponse.json({ error: "Could not discard transcription run" }, { status: 500 });
  }
}
