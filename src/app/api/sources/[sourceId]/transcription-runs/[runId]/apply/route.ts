import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findPendingRun } from "@/app/api/_lib/transcription";
import { applyRunWithStrategy, type ApplyStrategy } from "@/lib/transcriptionRuns";
import { jsonError } from "@/app/api/_lib/http";

export async function POST(request: Request, context: { params: Promise<{ sourceId: string; runId: string }> }) {
  const { sourceId, runId } = await context.params;
  try {
    const body = (await request.json().catch(() => ({}))) as { strategy?: string };
    if (body.strategy !== "replace_overlap" && body.strategy !== "append") {
      return jsonError("strategy must be 'replace_overlap' or 'append'", 400);
    }
    const strategy = body.strategy as ApplyStrategy;

    const run = await findPendingRun(sourceId, runId);
    if (run instanceof Response) return run;

    const outcome = await prisma.$transaction((tx) => applyRunWithStrategy(tx, run, strategy));
    if (!outcome.ok) {
      return NextResponse.json({ error: "Applying this run would silently overwrite active segments", conflicts: outcome.conflicts }, { status: 409 });
    }

    const active = await prisma.transcriptSegment.findMany({ where: { sourceId, isActive: true }, orderBy: { startSeconds: "asc" } });
    return NextResponse.json({ active });
  } catch (error) {
    console.error("Apply transcription run error:", error);
    return jsonError(error instanceof Error ? error.message : "Could not apply transcription run", 500);
  }
}
