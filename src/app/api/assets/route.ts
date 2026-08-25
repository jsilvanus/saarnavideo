import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const assets = await prisma.asset.findMany({
    select: { id: true, assetKey: true, type: true, mimeType: true, width: true, height: true, hasAlpha: true, sizeBytes: true, contentHash: true, createdAt: true, projects: { select: { id: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ assets: assets.map(asset => ({ ...asset, sizeBytes: asset.sizeBytes.toString(), createdAt: asset.createdAt.toISOString(), projectCount: asset.projects.length, projects: undefined })) });
}
