import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const asset = await prisma.asset.findUnique({ where: { id } });
  if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  try {
    const info = await stat(asset.storagePath);
    return new Response(createReadStream(asset.storagePath) as unknown as ReadableStream, { headers: { "Content-Type": asset.mimeType, "Content-Length": String(info.size), "Cache-Control": "private, max-age=3600" } });
  } catch {
    return NextResponse.json({ error: "Asset file unavailable" }, { status: 404 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const asset = await prisma.asset.findUnique({ where: { id } });
    if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    const body = await request.json() as { folderId?: string | null; assetKey?: string };
    if (body.folderId) {
      const folder = await prisma.assetFolder.findUnique({ where: { id: body.folderId } });
      if (!folder) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }
    const updated = await prisma.asset.update({ where: { id }, data: { ...(body.folderId !== undefined ? { folderId: body.folderId } : {}), ...(body.assetKey !== undefined ? { assetKey: body.assetKey.trim() } : {}) } });
    return NextResponse.json({ id: updated.id, assetKey: updated.assetKey, folderId: updated.folderId });
  } catch (error) {
    console.error("Asset update error:", error);
    return NextResponse.json({ error: "Failed to update asset" }, { status: 500 });
  }
}
