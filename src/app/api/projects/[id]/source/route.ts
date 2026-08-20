import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { migrateProjectDefinition } from "@/domain/project";

const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 5 * 1024 * 1024 * 1024);

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const project = await prisma.project.findUnique({ where: { id }, include: { sources: { orderBy: { createdAt: "asc" } } } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  return NextResponse.json(project.sources.map((source) => ({
    id: source.id,
    type: source.type,
    originalName: source.originalName,
    youtubeUrl: source.youtubeUrl,
    sizeBytes: source.sizeBytes?.toString(),
    expiresAt: source.expiresAt,
  })));
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const project = await prisma.project.findUnique({ where: { id }, include: { sources: { orderBy: { createdAt: "asc" } } } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "A file is required" }, { status: 400 });
  if (file.size <= 0) return NextResponse.json({ error: "File is empty" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "File is too large" }, { status: 413 });

  const root = process.env.MEDIA_ROOT ?? "/data/media";
  const directory = path.join(root, "sources", id);
  await mkdir(directory, { recursive: true });
  const safeName = path.basename(file.name).replace(/[^a-zA-Z0-9._-]/g, "_") || "source";
  const storagePath = path.join(directory, `${Date.now()}-${safeName}`);
  await writeFile(storagePath, Buffer.from(await file.arrayBuffer()));

  const sourceId = String(form.get("sourceId") ?? "").trim() || crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const existing = project.sources.find((source) => source.id === sourceId);

  const source = existing
    ? await prisma.source.update({
        where: { id: sourceId },
        data: { type: "UPLOAD", originalName: file.name, storagePath, mimeType: file.type || "application/octet-stream", sizeBytes: file.size, expiresAt },
      })
    : await prisma.source.create({
        data: { id: sourceId, projectId: id, type: "UPLOAD", originalName: file.name, storagePath, mimeType: file.type || "application/octet-stream", sizeBytes: file.size, expiresAt },
      });

  const definition = migrateProjectDefinition(project.definition, project.sources[0]?.id ?? source.id);
  const hasSourceClips = definition.composition.items.some((item) => item.type === "source-clip");
  if (!hasSourceClips && definition.semanticSegments.length > 0) {
    const composition = {
      items: definition.semanticSegments.map((segment) => ({
        type: "source-clip" as const,
        sourceId: source.id,
        startSeconds: segment.startSeconds,
        endSeconds: segment.endSeconds,
      })),
    };
    await prisma.project.update({ where: { id }, data: { definition: { ...definition, composition } } });
  }

  return NextResponse.json({ id: source.id, originalName: source.originalName, sizeBytes: source.sizeBytes?.toString(), expiresAt: source.expiresAt }, { status: 201 });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const sourceId = new URL(request.url).searchParams.get("sourceId");
  if (!sourceId) return NextResponse.json({ error: "sourceId is required" }, { status: 400 });

  const project = await prisma.project.findUnique({ where: { id }, include: { sources: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const source = project.sources.find((item) => item.id === sourceId);
  if (!source) return NextResponse.json({ error: "Source not found" }, { status: 404 });

  const definition = migrateProjectDefinition(project.definition, project.sources[0]?.id ?? sourceId);
  const referenced = definition.composition.items.some((item) => item.type === "source-clip" && item.sourceId === sourceId);
  if (referenced) return NextResponse.json({ error: "Source is referenced by the composition" }, { status: 409 });

  if (source.storagePath) await rm(source.storagePath, { force: true }).catch(() => undefined);
  await prisma.source.delete({ where: { id: sourceId } });
  return new Response(null, { status: 204 });
}
