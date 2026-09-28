import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/app/api/_lib/http";

type PatchBody = { text?: string; startSeconds?: number; endSeconds?: number };

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const segment = await prisma.transcriptSegment.findUnique({ where: { id } });
    if (!segment || !segment.isActive) return jsonError("Active transcript segment not found", 404);

    const body = (await request.json().catch(() => ({}))) as PatchBody;
    const startSeconds = body.startSeconds ?? segment.startSeconds;
    const endSeconds = body.endSeconds ?? segment.endSeconds;
    if (!(endSeconds > startSeconds)) {
      return jsonError("endSeconds must be greater than startSeconds", 400);
    }

    const updated = await prisma.transcriptSegment.update({
      where: { id },
      data: { ...(body.text !== undefined ? { text: body.text } : {}), startSeconds, endSeconds },
    });
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Update transcript segment error:", error);
    return jsonError("Could not update transcript segment", 500);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const segment = await prisma.transcriptSegment.findUnique({ where: { id } });
    if (!segment) return jsonError("Transcript segment not found", 404);
    await prisma.transcriptSegment.delete({ where: { id } });
    return NextResponse.json({ id });
  } catch (error) {
    console.error("Delete transcript segment error:", error);
    return jsonError("Could not delete transcript segment", 500);
  }
}
