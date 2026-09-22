import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type PatchBody = { text?: string; startSeconds?: number; endSeconds?: number };

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const segment = await prisma.transcriptSegment.findUnique({ where: { id } });
    if (!segment || !segment.isActive) return NextResponse.json({ error: "Active transcript segment not found" }, { status: 404 });

    const body = (await request.json().catch(() => ({}))) as PatchBody;
    const startSeconds = body.startSeconds ?? segment.startSeconds;
    const endSeconds = body.endSeconds ?? segment.endSeconds;
    if (!(endSeconds > startSeconds)) {
      return NextResponse.json({ error: "endSeconds must be greater than startSeconds" }, { status: 400 });
    }

    const updated = await prisma.transcriptSegment.update({
      where: { id },
      data: { ...(body.text !== undefined ? { text: body.text } : {}), startSeconds, endSeconds },
    });
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Update transcript segment error:", error);
    return NextResponse.json({ error: "Could not update transcript segment" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const segment = await prisma.transcriptSegment.findUnique({ where: { id } });
    if (!segment) return NextResponse.json({ error: "Transcript segment not found" }, { status: 404 });
    await prisma.transcriptSegment.delete({ where: { id } });
    return NextResponse.json({ id });
  } catch (error) {
    console.error("Delete transcript segment error:", error);
    return NextResponse.json({ error: "Could not delete transcript segment" }, { status: 500 });
  }
}
