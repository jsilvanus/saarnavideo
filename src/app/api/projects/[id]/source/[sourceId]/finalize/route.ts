import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/app/api/_lib/http";

/**
 * POST /api/projects/[id]/source/[sourceId]/finalize
 * 
 * After uploading directly to S3 via presigned URL, finalize the source record.
 * Sets status from PENDING to AVAILABLE.
 * 
 * Request body: { durationMs?: number }
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; sourceId: string }> }
) {
  const { id: projectId, sourceId } = await context.params;

  // Find the source
  const source = await prisma.source.findUnique({
    where: { id: sourceId },
    include: { projects: { where: { id: projectId }, select: { id: true } } },
  });

  if (!source) return jsonError("Source not found", 404);
  if (source.projects.length === 0) {
    return jsonError("Source does not belong to this project", 403);
  }

  // Parse optional metadata
  let durationMs: number | undefined;
  try {
    const body = await request.json() as { durationMs?: unknown };
    if (typeof body.durationMs === "number" && body.durationMs > 0) {
      durationMs = body.durationMs;
    }
  } catch {
    // No body is OK
  }

  // Update source status to AVAILABLE
  const updated = await prisma.source.update({
    where: { id: sourceId },
    data: {
      status: "AVAILABLE",
      ...(durationMs !== undefined ? { durationMs, referenceDurationMs: durationMs } : {}),
    },
  });

  return NextResponse.json(
    {
      id: updated.id,
      type: updated.type,
      status: updated.status,
      originalName: updated.originalName,
      sizeBytes: updated.sizeBytes?.toString(),
      durationMs: updated.durationMs,
    },
    { status: 200 }
  );
}
