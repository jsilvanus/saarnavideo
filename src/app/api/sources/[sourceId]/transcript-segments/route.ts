import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Body = { startSeconds?: number; endSeconds?: number; text?: string };

export async function POST(request: Request, context: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await context.params;
  try {
    const source = await prisma.source.findUnique({ where: { id: sourceId }, select: { id: true } });
    if (!source) return NextResponse.json({ error: "Source not found" }, { status: 404 });

    const body = (await request.json().catch(() => ({}))) as Body;
    if (typeof body.startSeconds !== "number" || typeof body.endSeconds !== "number" || typeof body.text !== "string") {
      return NextResponse.json({ error: "startSeconds, endSeconds and text are required" }, { status: 400 });
    }
    if (!(body.endSeconds > body.startSeconds)) {
      return NextResponse.json({ error: "endSeconds must be greater than startSeconds" }, { status: 400 });
    }

    const segment = await prisma.transcriptSegment.create({
      data: { sourceId, runId: null, isActive: true, startSeconds: body.startSeconds, endSeconds: body.endSeconds, text: body.text },
    });
    return NextResponse.json(segment, { status: 201 });
  } catch (error) {
    console.error("Insert transcript segment error:", error);
    return NextResponse.json({ error: "Could not insert transcript segment" }, { status: 500 });
  }
}
