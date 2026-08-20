import { rm } from "node:fs/promises";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; assetId: string }> }
) {
  try {
    const { id, assetId } = await context.params;

    // Verify project exists
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Find and verify asset belongs to project
    const asset = await prisma.asset.findUnique({
      where: { id: assetId },
    });

    if (!asset || asset.projectId !== id) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }

    // Delete file
    if (asset.storagePath) {
      await rm(asset.storagePath, { force: true }).catch(() => {
        // Ignore file deletion errors
      });
    }

    // Delete database record
    await prisma.asset.delete({ where: { id: assetId } });

    return NextResponse.json({}, { status: 204 });
  } catch (error) {
    console.error("Asset deletion error:", error);
    return NextResponse.json({ error: "Failed to delete asset" }, { status: 500 });
  }
}
