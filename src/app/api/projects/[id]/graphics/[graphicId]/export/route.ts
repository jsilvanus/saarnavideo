import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { migrateProjectDefinition } from "@/domain/project";
import { createGraphicPackage } from "@/domain/graphic-package";

function referencedAssetIds(graphic: any, assets: any[]) {
  const values = JSON.stringify(graphic);
  return assets.filter((asset) => values.includes(asset.id) || values.includes(asset.assetKey)).map((asset) => asset.id);
}

export async function GET(request: Request, context: { params: Promise<{ id: string; graphicId: string }> }) {
  const { id, graphicId } = await context.params;
  const project = await prisma.project.findUnique({ where: { id }, include: { assets: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const definition = migrateProjectDefinition(project.definition, project.assets[0]?.id);
  const graphic = definition.graphics.find((item) => item.id === graphicId);
  if (!graphic) return NextResponse.json({ error: "Graphic not found" }, { status: 404 });

  const assetMode = new URL(request.url).searchParams.get("assetMode") === "referenced" ? "referenced" : "embedded";
  const ids = referencedAssetIds(graphic, project.assets);
  const assets = [];
  for (const asset of project.assets.filter((item) => ids.includes(item.id))) {
    if (!asset.contentHash) return NextResponse.json({ error: `Asset has no content hash: ${asset.assetKey}` }, { status: 409 });
    if (assetMode === "referenced") {
      assets.push({ sourceAssetId: asset.id, contentHash: asset.contentHash, assetKey: asset.assetKey, mimeType: asset.mimeType, width: asset.width, height: asset.height, hasAlpha: asset.hasAlpha });
      continue;
    }
    try {
      const data = await readFile(asset.storagePath);
      assets.push({ sourceAssetId: asset.id, contentHash: asset.contentHash, assetKey: asset.assetKey, mimeType: asset.mimeType, width: asset.width, height: asset.height, hasAlpha: asset.hasAlpha, dataBase64: data.toString("base64") });
    } catch {
      return NextResponse.json({ error: `Asset file is unavailable: ${asset.assetKey}` }, { status: 409 });
    }
  }

  const pkg = createGraphicPackage(graphic, assets, assetMode);
  return new NextResponse(JSON.stringify(pkg, null, 2), {
    headers: {
      "Content-Type": "application/vnd.saarnavideo.graphic+json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${graphic.name.replace(/[^a-z0-9-_]+/gi, "-") || "graphic"}.svgraphic"`,
    },
  });
}
