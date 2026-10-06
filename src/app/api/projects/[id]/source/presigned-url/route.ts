import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generatePresignedUploadUrl, generateS3SourceKey } from "@/app/api/_lib/s3";
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

  // Validate inputs
  if (typeof fileName !== "string" || !fileName.trim()) {
    return jsonError("fileName is required", 400);
  }
  if (typeof contentType !== "string" || !contentType.trim()) {
    return jsonError("contentType is required", 400);
  }
  if (typeof sizeBytes !== "number" || sizeBytes <= 0) {
    return jsonError("sizeBytes must be a positive number", 400);
  }

  // Check file size against limit
  const maxUploadBytes = parseInt(process.env.MAX_UPLOAD_BYTES || "53687091200", 10);
  if (sizeBytes > maxUploadBytes) {
    return jsonError(
      `File too large. Max: ${maxUploadBytes / 1e9}GB, Requested: ${sizeBytes / 1e9}GB`,
      413
    );
  }

  // Create source record in PENDING status
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

  // Generate presigned URL
  let uploadUrl: string;
  const s3Key = generateS3SourceKey(projectId, source.id, fileName);
  try {
    const bucket = process.env.MEDIA_S3_BUCKET;
    if (!bucket) {
      throw new Error("S3 not configured");
    }
    uploadUrl = await generatePresignedUploadUrl(bucket, s3Key, contentType, 3600);
  } catch (err) {
    console.error("Failed to generate presigned URL:", err);
    // Clean up the pending source if presigned URL fails
    await prisma.source.delete({ where: { id: source.id } });
    return jsonError("Could not generate upload URL", 500);
  }

  return NextResponse.json(
    {
      uploadUrl,
      sourceId: source.id,
      s3Key,
      projectId,
    },
    { status: 200 }
  );
}
