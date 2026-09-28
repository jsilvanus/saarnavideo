import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/app/api/_lib/http";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const output = await prisma.output.findUnique({ where: { id } });
  if (!output) return jsonError("Output not found", 404);
  if (output.expiresAt && output.expiresAt < new Date()) {
    return jsonError("Output expired", 410);
  }

  try {
    const info = await stat(output.storagePath);
    const stream = Readable.toWeb(createReadStream(output.storagePath)) as ReadableStream;
    return new NextResponse(stream, {
      headers: {
        "Content-Type": output.mimeType,
        "Content-Length": String(info.size),
        "Content-Disposition": `attachment; filename="saarnavideo-${output.type.toLowerCase()}.${output.type === "VIDEO" ? "mp4" : "jpg"}"`,
      },
    });
  } catch {
    return jsonError("Output file is unavailable", 404);
  }
}
