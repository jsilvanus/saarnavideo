import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/app/api/_lib/http";

/** Deletes a saved template. Projects made from it keep their copy. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const deleted = await prisma.userTemplate.deleteMany({ where: { id } });
  if (deleted.count === 0) return jsonError("Template not found", 404);
  return NextResponse.json({ ok: true });
}
