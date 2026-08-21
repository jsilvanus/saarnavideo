import { createReadStream } from "node:fs";
import { rm } from "node:fs/promises";
import { stat } from "node:fs/promises";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, context: { params: Promise<{ id: string; assetId: string }> }) {
  const { id, assetId } = await context.params;
  const asset = await prisma.asset.findFirst({ where: { id: assetId, projects: { some: { id } } } });
  if (!asset?.storagePath) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  try {
    const info = await stat(asset.storagePath);
    const stream = createReadStream(asset.storagePath);
    return new Response(stream as unknown as ReadableStream, {
      headers: { "Content-Type": asset.mimeType ?? "application/octet-stream", "Content-Length": String(info.size), "Cache-Control": "private, max-age=3600" },
    });
  } catch {
    return NextResponse.json({ error: "Asset file unavailable" }, { status: 404 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; assetId: string }> }
) {
  try {
    const { id, assetId } = await context.params;
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const asset = await prisma.asset.findFirst({
      where: { id: assetId, projects: { some: { id } } },
      include: { projects: { select: { id: true } } },
    });
    if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });

    await prisma.asset.update({ where: { id: assetId }, data: { projects: { disconnect: { id } } } });
    if (asset.projects.length <= 1) {
      if (asset.storagePath) await rm(asset.storagePath, { force: true }).catch(() => undefined);
      await prisma.asset.delete({ where: { id: assetId } });
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Asset deletion error:", error);
    return NextResponse.json({ error: "Failed to delete asset" }, { status: 500 });
  }
}
