import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/app/api/_lib/http";
import { requeue } from "@/lib/lcyt-import";

/** Queues a failed import again; what already arrived is kept. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const row = await prisma.import.findUnique({ where: { id } });
  if (!row || !row.projectId) return jsonError("Import not found", 404);
  if (row.status !== "FAILED") return jsonError("Only a failed import can be retried", 409);
  if (!row.manifest) return jsonError("The delivered manifest is gone; send the broadcast from LCYT again", 409);
  return NextResponse.json(await requeue(row.id, row.projectId, null), { status: 202 });
}
