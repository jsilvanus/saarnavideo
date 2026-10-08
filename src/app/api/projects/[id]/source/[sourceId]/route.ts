import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getMediaStore, s3Ref } from "@/lib/media-store";
import { abortMultipartUpload } from "@/app/api/_lib/s3";
import { sourceUploadFile, parseDurationMs, rangedFileResponse, removeStoredFile, saveSourceFile } from "@/app/api/_lib/files";
import { jsonError } from "@/app/api/_lib/http";
import { parseSourceUploadSession } from "@/domain/source-upload";

export async function PUT(request: Request, context: { params: Promise<{ id: string; sourceId: string }> }) {
  const { id, sourceId } = await context.params;
  const source = await prisma.source.findFirst({ where: { id: sourceId, type: "UPLOAD", projects: { some: { id } } } });
  if (!source) return jsonError("Pending upload source not found", 404);
  const form = await request.formData();
  const file = sourceUploadFile(form.get("file"));
  if (file instanceof Response) return file;

  const durationMs = parseDurationMs(form.get("durationMs"));
  const storagePath = await saveSourceFile(id, file);

  const updated = await prisma.source.update({
    where: { id: sourceId },
    data: {
      status: "AVAILABLE",
      originalName: file.name,
      storagePath,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      ...(durationMs !== undefined ? { durationMs, referenceDurationMs: source.referenceDurationMs ?? durationMs } : {}),
    },
  });

  const warning = durationMs !== undefined && source.referenceDurationMs !== null && durationMs !== source.referenceDurationMs
    ? { referenceDurationMs: source.referenceDurationMs, actualDurationMs: durationMs, shorter: durationMs < source.referenceDurationMs }
    : null;

  return NextResponse.json({
    id: updated.id,
    status: updated.status,
    originalName: updated.originalName,
    sizeBytes: updated.sizeBytes?.toString(),
    durationMs: updated.durationMs,
    referenceDurationMs: updated.referenceDurationMs,
    durationWarning: warning,
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string; sourceId: string }> }) {
  const { id, sourceId } = await context.params;
  const source = await prisma.source.findFirst({ where: { id: sourceId, type: "UPLOAD", projects: { some: { id } } } });
  if (!source) return jsonError("Source not found", 404);
  const body = await request.json() as { durationMs?: number };
  if (!Number.isFinite(body.durationMs) || (body.durationMs ?? -1) < 0) return jsonError("durationMs must be a non-negative number", 400);
  const durationMs = Math.round(body.durationMs!);
  const updated = await prisma.source.update({ where: { id: sourceId }, data: { durationMs, referenceDurationMs: source.referenceDurationMs ?? durationMs } });
  return NextResponse.json({ id: updated.id, durationMs: updated.durationMs, referenceDurationMs: updated.referenceDurationMs });
}

export async function GET(request: Request, context: { params: Promise<{ id: string; sourceId: string }> }) {
  const { id, sourceId } = await context.params;
  const source = await prisma.source.findFirst({ where: { id: sourceId, projects: { some: { id } } } });
  if (!source || source.type !== "UPLOAD" || !source.storagePath || source.status !== "AVAILABLE") return jsonError("Uploaded source not found", 404);
  return rangedFileResponse(request, source.storagePath, source.mimeType);
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; sourceId: string }> }) {
  const { id: projectId, sourceId } = await context.params;
  const source = await prisma.source.findFirst({
    where: { id: sourceId, projects: { some: { id: projectId } } },
    select: {
      id: true,
      type: true,
      status: true,
      storagePath: true,
      uploadSession: true,
    },
  });
  if (!source) return jsonError("Source not found", 404);

  await prisma.project.update({
    where: { id: projectId },
    data: { sources: { disconnect: { id: sourceId } } },
  });

  const remainingProjectLinks = await prisma.project.count({
    where: { sources: { some: { id: sourceId } } },
  });
  if (remainingProjectLinks > 0) return new Response(null, { status: 204 });

  const uploadSession = parseSourceUploadSession(source.uploadSession);
  const bucket = process.env.MEDIA_S3_BUCKET;
  if (bucket && source.type === "UPLOAD" && uploadSession?.s3Key) {
    if (uploadSession.multipart?.uploadId) {
      await abortMultipartUpload(bucket, uploadSession.s3Key, uploadSession.multipart.uploadId).catch(() => undefined);
    }
    await (await getMediaStore()).remove(s3Ref(bucket, uploadSession.s3Key)).catch(() => undefined);
  }

  if (source.storagePath) {
    const otherReferences = await prisma.source.count({ where: { storagePath: source.storagePath, NOT: { id: sourceId } } });
    if (otherReferences === 0) await removeStoredFile(source.storagePath).catch(() => undefined);
  }

  await prisma.source.delete({ where: { id: sourceId } }).catch(() => undefined);
  return new Response(null, { status: 204 });
}
