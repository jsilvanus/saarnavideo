import { createReadStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, context: { params: Promise<{ id: string; assetId: string }> }) {
  const { id, assetId } = await context.params;
  const asset = await prisma.asset.findFirst({ where: { id: assetId, projects: { some: { id } } } });
  if (!asset?.storagePath) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  try {
    const info = await stat(asset.storagePath);
    return new Response(createReadStream(asset.storagePath) as unknown as ReadableStream, { headers: { "Content-Type": asset.mimeType, "Content-Length": String(info.size), "Cache-Control": "private, max-age=3600" } });
  } catch { return NextResponse.json({ error: "Asset file unavailable" }, { status: 404 }); }
}

export async function POST(_request: Request, context: { params: Promise<{ id: string; assetId: string }> }) {
  try {
    const { id, assetId } = await context.params;
    const [project, asset] = await Promise.all([prisma.project.findUnique({ where: { id } }), prisma.asset.findUnique({ where: { id: assetId } })]);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    await prisma.asset.update({ where: { id: assetId }, data: { projects: { connect: { id } }, expiresAt: null } });
    return NextResponse.json({ ok: true, assetId, projectId: id });
  } catch (error) { console.error("Asset attach error:", error); return NextResponse.json({ error: "Failed to attach asset" }, { status: 500 }); }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; assetId: string }> }) {
  try {
    const { id, assetId } = await context.params;
    const asset = await prisma.asset.findFirst({ where: { id: assetId, projects: { some: { id } } }, include: { projects: { select: { id: true } } } });
    if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    await prisma.asset.update({ where: { id: assetId }, data: { projects: { disconnect: { id } } } });
    if (asset.projects.length <= 1) { if (asset.storagePath) await rm(asset.storagePath, { force: true }).catch(() => undefined); await prisma.asset.delete({ where: { id: assetId } }); }
    return new Response(null, { status: 204 });
  } catch (error) { console.error("Asset deletion error:", error); return NextResponse.json({ error: "Failed to remove asset from project" }, { status: 500 }); }
}
