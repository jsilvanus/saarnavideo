import { rm } from "node:fs/promises";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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

    await prisma.asset.update({
      where: { id: assetId },
      data: { projects: { disconnect: { id } } },
    });

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
