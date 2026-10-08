import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getMediaStore, s3Ref } from "@/lib/media-store";
import { jsonError } from "@/app/api/_lib/http";
import { parseSourceUploadSession } from "@/domain/source-upload";

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

  const uploadSession = parseSourceUploadSession(source.uploadSession);
  if (!uploadSession) return jsonError("Source upload session not found", 409);

  const bucket = process.env.MEDIA_S3_BUCKET;
  if (!bucket) return jsonError("S3 not configured", 500);

  const storagePath = s3Ref(bucket, uploadSession.s3Key);
  const info = await (await getMediaStore()).stat(storagePath).catch(() => null);
  if (!info) return jsonError("Uploaded file not found", 409);
  if (source.sizeBytes && info.size !== Number(source.sizeBytes)) {
    return jsonError("Uploaded file size does not match the source metadata", 409);
  }

  const updated = await prisma.source.update({
    where: { id: sourceId },
    data: {
      status: "AVAILABLE",
      storagePath,
      sizeBytes: BigInt(info.size),
      mimeType: source.mimeType ?? uploadSession.contentType,
      uploadSession: Prisma.DbNull,
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
