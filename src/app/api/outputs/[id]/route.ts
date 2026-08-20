import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const output = await prisma.output.findUnique({ where: { id } });
  if (!output) return NextResponse.json({ error: "Output not found" }, { status: 404 });
  if (output.expiresAt && output.expiresAt < new Date()) {
    return NextResponse.json({ error: "Output expired" }, { status: 410 });
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
    return NextResponse.json({ error: "Output file is unavailable" }, { status: 404 });
  }
}
