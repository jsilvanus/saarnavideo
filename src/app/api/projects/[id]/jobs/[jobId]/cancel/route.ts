import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(_request: Request, context: { params: Promise<{ id: string; jobId: string }> }) {
  const { id, jobId } = await context.params;

  try {
    const job = await prisma.generationJob.findFirst({ where: { id: jobId, projectId: id } });
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (!["QUEUED", "ACQUIRING_SOURCE", "PROCESSING", "RENDERING"].includes(job.status)) {
      return NextResponse.json(
        { error: `Cannot cancel job in status ${job.status}. Only queued or running jobs can be cancelled.` },
        { status: 400 }
      );
    }

    const updated = await prisma.generationJob.update({
      where: { id: job.id },
      data: { cancellationRequested: true, status: "CANCELLATION_REQUESTED" },
      select: { id: true, status: true, cancellationRequested: true },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Job cancellation error:", error);
    return NextResponse.json({ error: "Failed to cancel job" }, { status: 500 });
  }
}
