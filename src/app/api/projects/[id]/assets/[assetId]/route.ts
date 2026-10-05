import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assetFileResponse } from "@/app/api/_lib/assets";
import { jsonError } from "@/app/api/_lib/http";
import { findAssetUsage } from "@/domain/asset-usage";

export async function GET(request: Request, context: { params: Promise<{ id: string; assetId: string }> }) {
  const { id, assetId } = await context.params;
  const asset = await prisma.asset.findFirst({ where: { id: assetId, projects: { some: { id } } } });
  if (!asset?.storagePath) return jsonError("Asset not found", 404);
  return assetFileResponse(asset, request);
}

export async function POST(_request: Request, context: { params: Promise<{ id: string; assetId: string }> }) {
  try {
    const { id, assetId } = await context.params;
    const [project, asset] = await Promise.all([prisma.project.findUnique({ where: { id } }), prisma.asset.findUnique({ where: { id: assetId } })]);
    if (!project) return jsonError("Project not found", 404);
    if (!asset) return jsonError("Asset not found", 404);
    await prisma.asset.update({ where: { id: assetId }, data: { projects: { connect: { id } } } });
    return NextResponse.json({ ok: true, assetId, projectId: id });
  } catch (error) { console.error("Asset attach error:", error); return jsonError("Failed to attach asset", 500); }
}

/**
 * Unlinks the asset from the project. The library asset and its file are never deleted here (that is
 * `DELETE /api/assets/[id]`). Answers 409 with `usage` when the project's definition still refers to the asset,
 * unless `?force=1`.
 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string; assetId: string }> }) {
  try {
    const { id, assetId } = await context.params;
    const asset = await prisma.asset.findFirst({ where: { id: assetId, projects: { some: { id } } }, select: { id: true, assetKey: true } });
    if (!asset) return jsonError("Asset not found", 404);
    if (new URL(request.url).searchParams.get("force") !== "1") {
      const project = await prisma.project.findUnique({ where: { id }, select: { definition: true } });
      const usage = findAssetUsage(project?.definition, asset);
      if (usage.length) return NextResponse.json({ error: `"${asset.assetKey}" is used by ${usage.join(", ")}.`, usage }, { status: 409 });
    }
    await prisma.asset.update({ where: { id: assetId }, data: { projects: { disconnect: { id } } } });
    return new Response(null, { status: 204 });
  } catch (error) { console.error("Asset unlink error:", error); return jsonError("Failed to remove asset from project", 500); }
}
