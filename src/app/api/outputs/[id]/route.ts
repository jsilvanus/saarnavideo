import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getMediaStore } from "@/lib/media-store";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/app/api/_lib/http";
import { outputExtension } from "@/domain/captions";
import { rangedFileResponse } from "@/app/api/_lib/files";

function downloadName(output: { type: string; mimeType: string; language: string | null }): string {
  const base = output.type.startsWith("CAPTIONS_") ? `saarnavideo-captions${output.language && output.language !== "und" ? `-${output.language}` : ""}` : `saarnavideo-${output.type.toLowerCase()}`;
  const name = output.type === "AUDIO" ? "saarnavideo-podcast" : base;
  return `${name}.${outputExtension(output.type, output.mimeType)}`;
}

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
        "Content-Disposition": `attachment; filename="${downloadName(output)}"`,
      },
    });
  } catch {
    return jsonError("Output file is unavailable", 404);
  }
}
