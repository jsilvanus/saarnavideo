import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  try {
    const job = await prisma.generationJob.findUnique({ where: { id } });
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Can only cancel jobs that are queued or running
    if (!["QUEUED", "ACQUIRING_SOURCE", "PROCESSING", "RENDERING"].includes(job.status)) {
      return NextResponse.json(
        {
          error: `Cannot cancel job in status ${job.status}. Only queued or running jobs can be cancelled.`,
        },
        { status: 400 }
      );
    }

    const updated = await prisma.generationJob.update({
      where: { id },
      data: {
        cancellationRequested: true,
        status: "CANCELLATION_REQUESTED",
      },
      select: { id: true, status: true, cancellationRequested: true },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Job cancellation error:", error);
    return NextResponse.json({ error: "Failed to cancel job" }, { status: 500 });
  }
}
