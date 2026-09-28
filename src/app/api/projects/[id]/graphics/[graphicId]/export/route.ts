import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { migrateProjectDefinition } from "@/domain/project";
import { createGraphicPackage } from "@/domain/graphic-package";
import { jsonError } from "@/app/api/_lib/http";

function referencedAssets<T extends { id: string; assetKey: string }>(graphic: unknown, assets: T[]) {
  const values = JSON.stringify(graphic);
  return assets.filter((asset) => values.includes(asset.id) || values.includes(asset.assetKey));
}

export async function GET(request: Request, context: { params: Promise<{ id: string; graphicId: string }> }) {
  const { id, graphicId } = await context.params;
  const project = await prisma.project.findUnique({ where: { id }, include: { assets: true } });
  if (!project) return jsonError("Project not found", 404);
  const definition = migrateProjectDefinition(project.definition, project.assets[0]?.id);
  const graphic = definition.graphics.find((item) => item.id === graphicId);
  if (!graphic) return jsonError("Graphic not found", 404);

  const assetMode = new URL(request.url).searchParams.get("assetMode") === "referenced" ? "referenced" : "embedded";
  const assets = [];
  for (const asset of referencedAssets(graphic, project.assets)) {
    if (!asset.contentHash) return jsonError(`Asset has no content hash: ${asset.assetKey}`, 409);
    const entry = { sourceAssetId: asset.id, contentHash: asset.contentHash, assetKey: asset.assetKey, mimeType: asset.mimeType, width: asset.width, height: asset.height, hasAlpha: asset.hasAlpha };
    if (assetMode === "referenced") {
      assets.push(entry);
      continue;
    }
    try {
      const data = await readFile(asset.storagePath);
      assets.push({ ...entry, dataBase64: data.toString("base64") });
    } catch {
      return jsonError(`Asset file is unavailable: ${asset.assetKey}`, 409);
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
