import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assetFileResponse } from "@/app/api/_lib/assets";
import { jsonError } from "@/app/api/_lib/http";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const asset = await prisma.asset.findUnique({ where: { id } });
  if (!asset) return jsonError("Asset not found", 404);
  return assetFileResponse(asset, request);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const asset = await prisma.asset.findUnique({ where: { id } });
    if (!asset) return jsonError("Asset not found", 404);
    const body = await request.json() as { folderId?: string | null; assetKey?: string };
    if (body.folderId) {
      const folder = await prisma.assetFolder.findUnique({ where: { id: body.folderId } });
      if (!folder) return jsonError("Folder not found", 404);
    }
    const updated = await prisma.asset.update({ where: { id }, data: { ...(body.folderId !== undefined ? { folderId: body.folderId } : {}), ...(body.assetKey !== undefined ? { assetKey: body.assetKey.trim() } : {}) } });
    return NextResponse.json({ id: updated.id, assetKey: updated.assetKey, folderId: updated.folderId });
  } catch (error) {
    console.error("Asset update error:", error);
    return jsonError("Failed to update asset", 500);
  }
}
