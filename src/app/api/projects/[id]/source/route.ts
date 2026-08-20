import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { ProjectDefinition } from "@/domain/project";

const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 5 * 1024 * 1024 * 1024);

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const project = await prisma.project.findUnique({ where: { id }, include: { sources: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  return NextResponse.json({ sources: project.sources });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const project = await prisma.project.findUnique({ where: { id }, include: { sources: true } });
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

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const source = await prisma.source.create({
    data: { projectId: id, type: "UPLOAD", originalName: file.name, storagePath, mimeType: file.type || "application/octet-stream", sizeBytes: file.size, expiresAt },
  });

  return NextResponse.json({ id: source.id, originalName: source.originalName, sizeBytes: source.sizeBytes?.toString(), expiresAt: source.expiresAt }, { status: 201 });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const sourceId = new URL(request.url).searchParams.get("sourceId");
  if (!sourceId) return NextResponse.json({ error: "sourceId is required" }, { status: 400 });

  const project = await prisma.project.findUnique({ where: { id }, include: { sources: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const source = project.sources.find((entry) => entry.id === sourceId);
  if (!source) return NextResponse.json({ error: "Source not found" }, { status: 404 });

  const definition = project.definition as unknown as ProjectDefinition;
  const inUse = definition.composition.items.some((item) => item.type === "source-clip" && item.sourceId === sourceId);
  if (inUse) return NextResponse.json({ error: "Source is still referenced by the composition" }, { status: 409 });

  await prisma.source.delete({ where: { id: source.id } });
  return new Response(null, { status: 204 });
}
