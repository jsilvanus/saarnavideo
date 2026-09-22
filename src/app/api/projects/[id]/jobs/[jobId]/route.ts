import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, context: { params: Promise<{ id: string; jobId: string }> }) {
  const { id, jobId } = await context.params;
  try {
    const job = await prisma.mediaJob.findFirst({ where: { id: jobId, projectId: id } });
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    return NextResponse.json({
      id: job.id,
      type: job.type,
      status: job.status,
      progress: job.progress,
      phase: job.phase,
      etaSeconds: job.etaSeconds,
      currentMs: job.currentMs !== null ? job.currentMs.toString() : null,
      totalMs: job.totalMs !== null ? job.totalMs.toString() : null,
      error: job.error,
    });
  } catch (error) {
    console.error("Job status lookup error:", error);
    return NextResponse.json({ error: "Failed to load job" }, { status: 500 });
  }
}
