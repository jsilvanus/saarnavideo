import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { applyRunWithStrategy, type ApplyStrategy } from "@/lib/transcriptionRuns";

export async function POST(request: Request, context: { params: Promise<{ sourceId: string; runId: string }> }) {
  const { sourceId, runId } = await context.params;
  try {
    const body = (await request.json().catch(() => ({}))) as { strategy?: string };
    if (body.strategy !== "replace_overlap" && body.strategy !== "append") {
      return NextResponse.json({ error: "strategy must be 'replace_overlap' or 'append'" }, { status: 400 });
    }
    const strategy = body.strategy as ApplyStrategy;

    const run = await prisma.transcriptionRun.findFirst({ where: { id: runId, sourceId } });
    if (!run) return NextResponse.json({ error: "Transcription run not found" }, { status: 404 });
    if (run.status !== "PENDING") return NextResponse.json({ error: `Run is already ${run.status.toLowerCase()}` }, { status: 409 });

    const outcome = await prisma.$transaction((tx) => applyRunWithStrategy(tx, run, strategy));
    if (!outcome.ok) {
      return NextResponse.json({ error: "Applying this run would silently overwrite active segments", conflicts: outcome.conflicts }, { status: 409 });
    }

    const active = await prisma.transcriptSegment.findMany({ where: { sourceId, isActive: true }, orderBy: { startSeconds: "asc" } });
    return NextResponse.json({ active });
  } catch (error) {
    console.error("Apply transcription run error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not apply transcription run" }, { status: 500 });
  }
}
