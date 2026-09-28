import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sourceUploadFile, parseDurationMs, rangedFileResponse, saveSourceFile } from "@/app/api/_lib/files";
import { jsonError } from "@/app/api/_lib/http";

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
