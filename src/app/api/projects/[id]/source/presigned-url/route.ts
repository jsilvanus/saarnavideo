import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  abortMultipartUpload,
  completeMultipartUpload,
  createMultipartUploadSession,
  generateMultipartPartUrl,
  generatePresignedUploadUrl,
  generateS3SourceKey,
} from "@/app/api/_lib/s3";
import { jsonError } from "@/app/api/_lib/http";

/**
 * POST /api/projects/[id]/source/presigned-url
 * 
 * Request a presigned URL for direct S3 upload.
 * The client can then PUT the file directly to S3, bypassing the Node.js server.
 * 
 * Request body: { fileName: string, contentType: string, sizeBytes: number }
 * Response: { uploadUrl: string, sourceId: string, s3Key: string }
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await context.params;

  // Verify project exists
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) return jsonError("Project not found", 404);

  // Parse request
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const { fileName, contentType, sizeBytes } = body as {
    fileName?: unknown;
    contentType?: unknown;
    sizeBytes?: unknown;
  };

  if (typeof fileName !== "string" || !fileName.trim()) {
    return jsonError("fileName is required", 400);
  }
  if (typeof contentType !== "string" || !contentType.trim()) {
    return jsonError("contentType is required", 400);
  }
  if (typeof sizeBytes !== "number" || sizeBytes <= 0) {
    return jsonError("sizeBytes must be a positive number", 400);
  }

  const maxUploadBytes = parseInt(process.env.MAX_UPLOAD_BYTES || "53687091200", 10);
  if (sizeBytes > maxUploadBytes) {
    return jsonError(
      `File too large. Max: ${maxUploadBytes / 1e9}GB, Requested: ${sizeBytes / 1e9}GB`,
      413,
    );
  }

  const source = await prisma.source.create({
    data: {
      type: "UPLOAD",
      status: "PENDING",
      originalName: fileName.trim(),
      sizeBytes,
      mimeType: contentType.trim(),
      projects: { connect: { id: projectId } },
    },
  });

  let uploadUrl: string;
  const s3Key = generateS3SourceKey(projectId, source.id, fileName);
  try {
    const bucket = process.env.MEDIA_S3_BUCKET;
    if (!bucket) throw new Error("S3 not configured");
    uploadUrl = await generatePresignedUploadUrl(bucket, s3Key, contentType, 3600);
  } catch (err) {
    console.error("Failed to generate presigned URL:", err);
    await prisma.source.delete({ where: { id: source.id } });
    return jsonError("Could not generate upload URL", 500);
  }

  const multipartThreshold = Number(process.env.S3_MULTIPART_THRESHOLD_BYTES ?? 8 * 1024 * 1024);
  const canUseMultipart = sizeBytes > multipartThreshold;

  let multipart: { uploadId: string; createUrl: string } | undefined;
  if (canUseMultipart) {
    try {
      multipart = await createMultipartUploadSession(process.env.MEDIA_S3_BUCKET!, s3Key, contentType, 3600);
    } catch (err) {
      console.error("Failed to initialize multipart upload:", err);
      multipart = undefined;
    }
  }

  return NextResponse.json(
    {
      uploadUrl,
      sourceId: source.id,
      s3Key,
      projectId,
      multipart: multipart ? { uploadId: multipart.uploadId, createUrl: multipart.createUrl } : null,
      multipartEnabled: Boolean(multipart),
      chunkSizeBytes: multipart ? Number(process.env.S3_MULTIPART_CHUNK_BYTES ?? 5 * 1024 * 1024) : null,
    },
    { status: 200 },
  );
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await context.params;
  const body = await request.json().catch(() => null) as {
    sourceId?: string;
    s3Key?: string;
    uploadId?: string;
    partNumber?: number;
    etag?: string;
    action?: "complete" | "abort";
    parts?: Array<{ ETag: string; PartNumber: number }>;
  } | null;

  if (!body?.sourceId || !body?.s3Key) return jsonError("sourceId and s3Key are required", 400);

  const source = await prisma.source.findUnique({ where: { id: body.sourceId }, include: { projects: { where: { id: projectId }, select: { id: true } } } });
  if (!source || source.projects.length === 0) return jsonError("Source not found", 404);

  const bucket = process.env.MEDIA_S3_BUCKET;
  if (!bucket) return jsonError("S3 not configured", 500);

  if (body.action === "abort" && body.uploadId) {
    await abortMultipartUpload(bucket, body.s3Key, body.uploadId);
    return NextResponse.json({ ok: true, aborted: true });
  }

  if (body.action === "complete" && body.uploadId && Array.isArray(body.parts)) {
    await completeMultipartUpload(bucket, body.s3Key, body.uploadId, body.parts);
    return NextResponse.json({ ok: true, completed: true });
  }

  if (typeof body.partNumber === "number" && body.partNumber > 0 && body.uploadId) {
    const partUrl = await generateMultipartPartUrl(bucket, body.s3Key, body.uploadId, body.partNumber, 3600);
    return NextResponse.json({ ok: true, partUrl, uploadId: body.uploadId });
  }

  return jsonError("Unsupported multipart request", 400);
}

