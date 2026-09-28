import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findPendingRun } from "@/app/api/_lib/transcription";
import { jsonError } from "@/app/api/_lib/http";

export async function POST(_request: Request, context: { params: Promise<{ sourceId: string; runId: string }> }) {
  const { sourceId, runId } = await context.params;
  try {
    const run = await findPendingRun(sourceId, runId);
    if (run instanceof Response) return run;

    const updated = await prisma.transcriptionRun.update({ where: { id: runId }, data: { status: "DISCARDED" }, select: { id: true, status: true } });
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Discard transcription run error:", error);
    return jsonError("Could not discard transcription run", 500);
  }
}
