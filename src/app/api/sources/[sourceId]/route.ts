import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request, context: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await context.params;
  const source = await prisma.source.findUnique({ where: { id: sourceId } });
  if (!source || source.type !== "UPLOAD" || !source.storagePath) return NextResponse.json({ error: "Uploaded source not found" }, { status: 404 });
  const size = (await stat(source.storagePath)).size;
  const range = request.headers.get("range");
  const headers = new Headers({ "Content-Type": source.mimeType || "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=60" });
  const stream = (start?: number, end?: number) => Readable.toWeb(createReadStream(source.storagePath!, start === undefined ? undefined : { start, end })) as ReadableStream;
  if (!range) { headers.set("Content-Length", String(size)); return new Response(stream(), { status: 200, headers }); }
  const match = /^bytes=(\d+)-(\d*)$/.exec(range); if (!match) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  const start = Number(match[1]); const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (start >= size || requestedEnd < start) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  const end = Math.min(requestedEnd, size - 1); headers.set("Content-Length", String(end - start + 1)); headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  return new Response(stream(start, end), { status: 206, headers });
}
