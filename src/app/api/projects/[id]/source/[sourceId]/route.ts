import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 5 * 1024 * 1024 * 1024);

function parseDurationMs(value: FormDataEntryValue | null): number | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const duration = Number(value);
  return Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : undefined;
}

export async function PUT(request: Request, context: { params: Promise<{ id: string; sourceId: string }> }) {
  const { id, sourceId } = await context.params;
  const source = await prisma.source.findFirst({ where: { id: sourceId, type: "UPLOAD", projects: { some: { id } } } });
  if (!source) return NextResponse.json({ error: "Pending upload source not found" }, { status: 404 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "A file is required" }, { status: 400 });
  if (file.size <= 0) return NextResponse.json({ error: "File is empty" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "File is too large" }, { status: 413 });

  const durationMs = parseDurationMs(form.get("durationMs"));
  const root = process.env.MEDIA_ROOT ?? "/data/media";
  const directory = path.join(root, "sources", id);
  await mkdir(directory, { recursive: true });
  const safeName = path.basename(file.name).replace(/[^a-zA-Z0-9._-]/g, "_") || "source";
  const storagePath = path.join(directory, `${Date.now()}-${safeName}`);
  await writeFile(storagePath, Buffer.from(await file.arrayBuffer()));

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
  if (!source) return NextResponse.json({ error: "Source not found" }, { status: 404 });
  const body = await request.json() as { durationMs?: number };
  if (!Number.isFinite(body.durationMs) || (body.durationMs ?? -1) < 0) return NextResponse.json({ error: "durationMs must be a non-negative number" }, { status: 400 });
  const durationMs = Math.round(body.durationMs!);
  const updated = await prisma.source.update({ where: { id: sourceId }, data: { durationMs, referenceDurationMs: source.referenceDurationMs ?? durationMs } });
  return NextResponse.json({ id: updated.id, durationMs: updated.durationMs, referenceDurationMs: updated.referenceDurationMs });
}

export async function GET(request: Request, context: { params: Promise<{ id: string; sourceId: string }> }) {
  const { id, sourceId } = await context.params;
  const source = await prisma.source.findFirst({ where: { id: sourceId, projects: { some: { id } } } });
  if (!source || source.type !== "UPLOAD" || !source.storagePath || source.status !== "AVAILABLE") return NextResponse.json({ error: "Uploaded source not found" }, { status: 404 });
  const info = await stat(source.storagePath); const size = info.size; const range = request.headers.get("range");
  const headers = new Headers({ "Content-Type": source.mimeType || "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=60" });
  const stream = (start?: number, end?: number) => Readable.toWeb(createReadStream(source.storagePath!, start === undefined ? undefined : { start, end })) as ReadableStream;
  if (!range) { headers.set("Content-Length", String(size)); return new Response(stream(), { status: 200, headers }); }
  const match = /^bytes=(\d+)-(\d*)$/.exec(range); if (!match) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  const start = Number(match[1]); const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (start >= size || requestedEnd < start) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  const end = Math.min(requestedEnd, size - 1); headers.set("Content-Length", String(end - start + 1)); headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  return new Response(stream(start, end), { status: 206, headers });
}
