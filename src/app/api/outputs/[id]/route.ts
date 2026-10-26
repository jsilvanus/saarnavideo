import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getMediaStore } from "@/lib/media-store";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/app/api/_lib/http";
import { attachmentDisposition, normalizeOutputLabel, outputDownloadName } from "@/domain/output-labels";
import { rangedFileResponse } from "@/app/api/_lib/files";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const output = await prisma.output.findUnique({ where: { id } });
  if (!output) return jsonError("Output not found", 404);

  try {
    // Players ask for byte ranges (and `?inline=1` marks a player's first request), so seeking does not restart the download.
    if (request.headers.has("range") || new URL(request.url).searchParams.get("inline") === "1") return await rangedFileResponse(request, output.storagePath, output.mimeType);
    const store = await getMediaStore();
    const info = await store.stat(output.storagePath);
    if (!info) return jsonError("Output file is unavailable", 404);
    const stream = Readable.toWeb(await store.stream(output.storagePath)) as ReadableStream;
    return new NextResponse(stream, {
      headers: {
        "Content-Type": output.mimeType,
        "Content-Length": String(info.size),
        "Content-Disposition": attachmentDisposition(outputDownloadName(output)),
      },
    });
  } catch {
    return jsonError("Output file is unavailable", 404);
  }
}

/** The fields a client shows for an output (no storage path). */
function serialize(output: { id: string; projectId: string; jobId: string | null; type: string; preview: boolean; mimeType: string; language: string | null; label: string | null; sizeBytes: bigint | null; createdAt: Date }) {
  return { id: output.id, projectId: output.projectId, jobId: output.jobId, type: output.type, preview: output.preview, mimeType: output.mimeType, language: output.language, label: output.label, sizeBytes: output.sizeBytes?.toString() ?? null, createdAt: output.createdAt.toISOString() };
}

/** Renames an output: `{ label }` (trimmed, at most 120 characters; an empty string clears it). The label is the download name. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as { label?: unknown } | null;
  if (!body || typeof body !== "object" || !("label" in body)) return jsonError("Send { label }", 400);
  const label = normalizeOutputLabel(body.label);
  if (!label.ok) return jsonError(label.reason, 400);
  const existing = await prisma.output.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return jsonError("Output not found", 404);
  const output = await prisma.output.update({ where: { id }, data: { label: label.label } });
  return NextResponse.json(serialize(output));
}
