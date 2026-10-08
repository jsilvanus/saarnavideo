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
import {
  completedUploadBytes,
  parseSourceUploadSession,
  upsertMultipartUploadPart,
  type SourceUploadSession,
} from "@/domain/source-upload";

const MULTIPART_THRESHOLD_BYTES = Number(process.env.S3_MULTIPART_THRESHOLD_BYTES ?? 8 * 1024 * 1024);
const MULTIPART_CHUNK_BYTES = Math.max(5 * 1024 * 1024, Number(process.env.S3_MULTIPART_CHUNK_BYTES ?? 5 * 1024 * 1024));

async function findPendingUploadSource(projectId: string, sourceId: string) {
  const source = await prisma.source.findUnique({
    where: { id: sourceId },
    include: { projects: { where: { id: projectId }, select: { id: true } } },
  });
  if (!source || source.projects.length === 0) return null;
  if (source.type !== "UPLOAD") return "not-upload";
  if (source.status !== "PENDING") return "not-pending";
  return source;
}

async function loadBucket() {
  const bucket = process.env.MEDIA_S3_BUCKET;
  if (!bucket) throw new Error("S3 not configured");
  return bucket;
}

function finalizeResponse(session: SourceUploadSession) {
  return {
    multipart: session.multipart ? { uploadId: session.multipart.uploadId, completed: session.multipart.completed } : null,
    multipartEnabled: Boolean(session.multipart),
    chunkSizeBytes: session.multipart?.chunkSizeBytes ?? null,
    completedBytes: completedUploadBytes(session),
    completedParts: session.multipart?.parts ?? [],
  };
}

/**
 * POST /api/projects/[id]/source/presigned-url
 *
 * Creates or resumes a direct-to-S3 upload session for a source.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await context.params;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) return jsonError("Project not found", 404);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const {
    fileName,
    contentType,
    sizeBytes,
    sourceId,
  } = body as {
    fileName?: unknown;
    contentType?: unknown;
    sizeBytes?: unknown;
    sourceId?: unknown;
  };

  if (typeof fileName !== "string" || !fileName.trim()) return jsonError("fileName is required", 400);
  if (typeof contentType !== "string" || !contentType.trim()) return jsonError("contentType is required", 400);
  if (typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return jsonError("sizeBytes must be a positive number", 400);
  }
  if (sourceId !== undefined && typeof sourceId !== "string") return jsonError("sourceId must be a string", 400);

  const maxUploadBytes = parseInt(process.env.MAX_UPLOAD_BYTES || "53687091200", 10);
  if (sizeBytes > maxUploadBytes) {
    return jsonError(`File too large. Max: ${maxUploadBytes / 1e9}GB, Requested: ${sizeBytes / 1e9}GB`, 413);
  }

  const trimmedName = fileName.trim();
  const trimmedType = contentType.trim();
  const wantsMultipart = sizeBytes > MULTIPART_THRESHOLD_BYTES;

  const existingSource = typeof sourceId === "string" ? await findPendingUploadSource(projectId, sourceId) : null;
  if (existingSource === "not-upload") return jsonError("Source is not an uploaded file", 409);
  if (existingSource === "not-pending") return jsonError("Source upload is already finalized", 409);
  if (sourceId && !existingSource) return jsonError("Source not found", 404);

  const source = existingSource || await prisma.source.create({
    data: {
      type: "UPLOAD",
      status: "PENDING",
      originalName: trimmedName,
      sizeBytes,
      mimeType: trimmedType,
      projects: { connect: { id: projectId } },
    },
  });

  const currentSession = parseSourceUploadSession(source.uploadSession);
  const currentMultipart = currentSession?.multipart;
  const metadataMismatch = currentSession
    && (currentSession.fileName !== trimmedName || currentSession.contentType !== trimmedType || currentSession.sizeBytes !== sizeBytes);
  if (metadataMismatch && (currentMultipart?.parts.length || currentMultipart?.completed)) {
    return jsonError("Selected file does not match the upload already in progress", 409);
  }

  let uploadSession = currentSession;
  if (!uploadSession || metadataMismatch || Boolean(uploadSession.multipart) !== wantsMultipart) {
    uploadSession = undefined;
  }

  const s3Key = uploadSession?.s3Key ?? generateS3SourceKey(projectId, source.id, trimmedName);

  try {
    const bucket = await loadBucket();
    if (!uploadSession) {
      uploadSession = {
        s3Key,
        fileName: trimmedName,
        contentType: trimmedType,
        sizeBytes,
        ...(wantsMultipart
          ? {
              multipart: {
                uploadId: (await createMultipartUploadSession(bucket, s3Key, trimmedType)).uploadId,
                chunkSizeBytes: MULTIPART_CHUNK_BYTES,
                completed: false,
                parts: [],
              },
            }
          : {}),
      };
    }
    const uploadUrl = await generatePresignedUploadUrl(bucket, uploadSession.s3Key, trimmedType, 3600);
    await prisma.source.update({
      where: { id: source.id },
      data: {
        originalName: trimmedName,
        sizeBytes,
        mimeType: trimmedType,
        uploadSession,
      },
    });
    return NextResponse.json({
      uploadUrl,
      sourceId: source.id,
      s3Key: uploadSession.s3Key,
      projectId,
      ...finalizeResponse(uploadSession),
    });
  } catch (err) {
    console.error("Failed to initialize direct upload:", err);
    if (!existingSource) await prisma.source.delete({ where: { id: source.id } }).catch(() => undefined);
    return jsonError("Could not generate upload URL", 500);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await context.params;
  const body = await request.json().catch(() => null) as {
    sourceId?: string;
    uploadId?: string;
    partNumber?: number;
    etag?: string;
    sizeBytes?: number;
    action?: "part-complete" | "complete" | "abort";
    parts?: Array<{ ETag: string; PartNumber: number }>;
  } | null;

  if (!body?.sourceId) return jsonError("sourceId is required", 400);

  const source = await findPendingUploadSource(projectId, body.sourceId);
  if (!source || source === "not-upload" || source === "not-pending") return jsonError("Source not found", 404);

  const uploadSession = parseSourceUploadSession(source.uploadSession);
  if (!uploadSession) return jsonError("Upload session not found", 409);
  const bucket = process.env.MEDIA_S3_BUCKET;
  if (!bucket) return jsonError("S3 not configured", 500);

  const multipart = uploadSession.multipart;
  if ((body.action || typeof body.partNumber === "number") && !multipart) {
    return jsonError("Upload does not use multipart", 409);
  }
  if (multipart && body.uploadId && body.uploadId !== multipart.uploadId) {
    return jsonError("Upload session mismatch", 409);
  }

  if (body.action === "abort") {
    await abortMultipartUpload(bucket, uploadSession.s3Key, multipart!.uploadId);
    await prisma.source.update({ where: { id: source.id }, data: { uploadSession: null } });
    return NextResponse.json({ ok: true, aborted: true });
  }

  if (body.action === "part-complete") {
    if (typeof body.partNumber !== "number" || body.partNumber <= 0) return jsonError("partNumber must be a positive number", 400);
    if (typeof body.etag !== "string" || !body.etag.trim()) return jsonError("etag is required", 400);
    if (typeof body.sizeBytes !== "number" || body.sizeBytes < 0) return jsonError("sizeBytes must be a non-negative number", 400);
    const nextSession = {
      ...uploadSession,
      multipart: {
        ...multipart!,
        parts: upsertMultipartUploadPart(multipart!.parts, {
          partNumber: body.partNumber,
          etag: body.etag.trim(),
          sizeBytes: body.sizeBytes,
        }),
      },
    } satisfies SourceUploadSession;
    await prisma.source.update({ where: { id: source.id }, data: { uploadSession: nextSession } });
    return NextResponse.json({ ok: true, completedBytes: completedUploadBytes(nextSession), completedParts: nextSession.multipart?.parts ?? [] });
  }

  if (body.action === "complete") {
    const parts = body.parts?.length
      ? body.parts
      : multipart!.parts.map((part) => ({ ETag: part.etag, PartNumber: part.partNumber }));
    if (!parts.length) return jsonError("No uploaded parts recorded", 409);
    await completeMultipartUpload(bucket, uploadSession.s3Key, multipart!.uploadId, parts);
    const nextSession = {
      ...uploadSession,
      multipart: {
        ...multipart!,
        completed: true,
      },
    } satisfies SourceUploadSession;
    await prisma.source.update({ where: { id: source.id }, data: { uploadSession: nextSession } });
    return NextResponse.json({ ok: true, completed: true, completedBytes: completedUploadBytes(nextSession) });
  }

  if (typeof body.partNumber === "number" && body.partNumber > 0) {
    const partUrl = await generateMultipartPartUrl(bucket, uploadSession.s3Key, multipart!.uploadId, body.partNumber, 3600);
    return NextResponse.json({ ok: true, partUrl, uploadId: multipart!.uploadId });
  }

  return jsonError("Unsupported multipart request", 400);
}
