import path from "node:path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sourceUploadFile, parseDurationMs, saveSourceFile } from "@/app/api/_lib/files";
import { jsonError } from "@/app/api/_lib/http";
import { extractYouTubeId } from "@/app/api/_lib/youtube";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const project = await prisma.project.findUnique({ where: { id }, select: { id: true } });
  if (!project) return jsonError("Project not found", 404);

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const body = await request.json() as { youtubeUrl?: string; localFileName?: string };
      if (body.localFileName?.trim()) {
        const originalName = path.basename(body.localFileName.trim());
        const source = await prisma.source.create({ data: { type: "UPLOAD", status: "PENDING", originalName, projects: { connect: { id } } } });
        return NextResponse.json({ id: source.id, type: source.type, status: source.status, originalName }, { status: 201 });
      }
      const youtubeUrl = body.youtubeUrl?.trim();
      if (!youtubeUrl) return jsonError("YouTube URL is required", 400);
      const youtubeVideoId = extractYouTubeId(youtubeUrl);
      if (!youtubeVideoId) return jsonError("Unsupported YouTube URL", 400);
      const source = await prisma.source.create({ data: { type: "YOUTUBE", status: "AVAILABLE", youtubeVideoId, youtubeUrl, projects: { connect: { id } } } });
      return NextResponse.json({ id: source.id, type: source.type, status: source.status, youtubeVideoId, youtubeUrl }, { status: 201 });
    } catch {
      return jsonError("Invalid source", 400);
    }
  }

  const form = await request.formData();
  const file = sourceUploadFile(form.get("file"));
  if (file instanceof Response) return file;
  const durationMs = parseDurationMs(form.get("durationMs"));
  const storagePath = await saveSourceFile(id, file);

  const source = await prisma.source.create({
    data: { type: "UPLOAD", status: "AVAILABLE", originalName: file.name, storagePath, mimeType: file.type || "application/octet-stream", sizeBytes: file.size, ...(durationMs !== undefined ? { durationMs, referenceDurationMs: durationMs } : {}), projects: { connect: { id } } },
  });
  return NextResponse.json({ id: source.id, type: source.type, status: source.status, originalName: source.originalName, sizeBytes: source.sizeBytes?.toString(), durationMs: source.durationMs }, { status: 201 });
}
