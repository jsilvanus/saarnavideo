import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/app/api/_lib/http";

type Body = { startSeconds?: number; endSeconds?: number; text?: string };

export async function POST(request: Request, context: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await context.params;
  try {
    const source = await prisma.source.findUnique({ where: { id: sourceId }, select: { id: true } });
    if (!source) return jsonError("Source not found", 404);

    const body = (await request.json().catch(() => ({}))) as Body;
    if (typeof body.startSeconds !== "number" || typeof body.endSeconds !== "number" || typeof body.text !== "string") {
      return jsonError("startSeconds, endSeconds and text are required", 400);
    }
    if (!(body.endSeconds > body.startSeconds)) {
      return jsonError("endSeconds must be greater than startSeconds", 400);
    }

    const segment = await prisma.transcriptSegment.create({
      data: { sourceId, runId: null, isActive: true, startSeconds: body.startSeconds, endSeconds: body.endSeconds, text: body.text },
    });
    return NextResponse.json(segment, { status: 201 });
  } catch (error) {
    console.error("Insert transcript segment error:", error);
    return jsonError("Could not insert transcript segment", 500);
  }
}
