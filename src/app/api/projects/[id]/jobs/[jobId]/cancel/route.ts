import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/app/api/_lib/http";

const CANCELLABLE_STATUSES = ["QUEUED", "RUNNING"] as const;

export async function POST(_request: Request, context: { params: Promise<{ id: string; jobId: string }> }) {
  const { id, jobId } = await context.params;

  try {
    const job = await prisma.mediaJob.findFirst({ where: { id: jobId, projectId: id } });
    if (!job) {
      return jsonError("Job not found", 404);
    }

    if (!CANCELLABLE_STATUSES.includes(job.status as (typeof CANCELLABLE_STATUSES)[number])) {
      return jsonError(`Cannot cancel job in status ${job.status}. Only queued or running jobs can be cancelled.`, 400);
    }

    const updated = await prisma.mediaJob.update({
      where: { id: job.id },
      data: { cancelRequested: true },
      select: { id: true, status: true, cancelRequested: true },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Job cancellation error:", error);
    return jsonError("Failed to cancel job", 500);
  }
}
