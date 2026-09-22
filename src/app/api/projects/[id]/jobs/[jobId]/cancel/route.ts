import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const CANCELLABLE_STATUSES = ["QUEUED", "RUNNING"] as const;

export async function POST(_request: Request, context: { params: Promise<{ id: string; jobId: string }> }) {
  const { id, jobId } = await context.params;

  try {
    const job = await prisma.mediaJob.findFirst({ where: { id: jobId, projectId: id } });
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (!CANCELLABLE_STATUSES.includes(job.status as (typeof CANCELLABLE_STATUSES)[number])) {
      return NextResponse.json(
        { error: `Cannot cancel job in status ${job.status}. Only queued or running jobs can be cancelled.` },
        { status: 400 }
      );
    }

    const updated = await prisma.mediaJob.update({
      where: { id: job.id },
      data: { cancelRequested: true },
      select: { id: true, status: true, cancelRequested: true },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Job cancellation error:", error);
    return NextResponse.json({ error: "Failed to cancel job" }, { status: 500 });
  }
}
