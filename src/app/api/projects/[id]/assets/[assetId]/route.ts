import { rm } from "node:fs/promises";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assetFileResponse } from "@/app/api/_lib/assets";
import { jsonError } from "@/app/api/_lib/http";

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
    await prisma.asset.update({ where: { id: assetId }, data: { projects: { connect: { id } }, expiresAt: null } });
    return NextResponse.json({ ok: true, assetId, projectId: id });
  } catch (error) { console.error("Asset attach error:", error); return jsonError("Failed to attach asset", 500); }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; assetId: string }> }) {
  try {
    const { id, assetId } = await context.params;
    const asset = await prisma.asset.findFirst({ where: { id: assetId, projects: { some: { id } } }, include: { projects: { select: { id: true } } } });
    if (!asset) return jsonError("Asset not found", 404);
    await prisma.asset.update({ where: { id: assetId }, data: { projects: { disconnect: { id } } } });
    if (asset.projects.length <= 1) { if (asset.storagePath) await rm(asset.storagePath, { force: true }).catch(() => undefined); await prisma.asset.delete({ where: { id: assetId } }); }
    return new Response(null, { status: 204 });
  } catch (error) { console.error("Asset deletion error:", error); return jsonError("Failed to remove asset from project", 500); }
}
