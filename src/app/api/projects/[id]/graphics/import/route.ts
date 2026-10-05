import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { migrateProjectDefinition } from "@/domain/project";
import { parseGraphicPackage } from "@/domain/graphic-package";
import { MAX_ASSET_SIZE, sha256, storeLibraryFile } from "@/app/api/_lib/assets";
import { jsonError } from "@/app/api/_lib/http";

function replaceAssetReferences(value: unknown, idMap: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map((item) => replaceAssetReferences(item, idMap));
  if (!value || typeof value !== "object") {
    if (typeof value !== "string") return value;
    let result = value;
    for (const [from, to] of idMap) {
      result = result.replace(`/api/assets/${from}`, `/api/assets/${to}`).replace(`asset:${from}`, `asset:${to}`);
      if (result === from) result = to;
    }
    return result;
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceAssetReferences(item, idMap)]));
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) return jsonError("Project not found", 404);
  try {
    const pkg = parseGraphicPackage(await request.json());
    const idMap = new Map<string, string>();
    const assetIds: string[] = [];
    const unresolved: string[] = [];

    for (const item of pkg.assets) {
      let asset = await prisma.asset.findFirst({ where: { contentHash: item.contentHash, mimeType: item.mimeType } });

      if (item.assetMode === "referenced") {
        if (!asset) unresolved.push(item.assetKey);
        else {
          idMap.set(item.sourceAssetId, asset.id);
          idMap.set(item.assetKey, asset.id);
          assetIds.push(asset.id);
        }
        continue;
      }

      const data = Buffer.from(item.dataBase64, "base64");
      if (data.length > MAX_ASSET_SIZE) return jsonError(`Asset ${item.assetKey} is too large`, 413);
      if (sha256(data) !== item.contentHash) return jsonError(`Asset hash mismatch: ${item.assetKey}`, 400);
      if (!asset) {
        const ext = item.mimeType === "image/png" ? "png" : item.mimeType === "image/webp" ? "webp" : item.mimeType === "image/jpeg" ? "jpg" : "bin";
        const storagePath = await storeLibraryFile(data, item.contentHash, ext);
        asset = await prisma.asset.create({ data: { assetKey: item.assetKey, type: "OVERLAY", storagePath, mimeType: item.mimeType, width: item.width, height: item.height, hasAlpha: item.hasAlpha, sizeBytes: BigInt(data.length), contentHash: item.contentHash } });
      }
      idMap.set(item.sourceAssetId, asset.id);
      idMap.set(item.assetKey, asset.id);
      assetIds.push(asset.id);
    }

    if (unresolved.length) {
      return jsonError("Referenced package requires assets that are not in this asset library", 409, { unresolvedAssets: unresolved });
    }

    const definition = migrateProjectDefinition(project.definition);
    const imported = replaceAssetReferences({ ...pkg.graphic, id: crypto.randomUUID() }, idMap) as typeof pkg.graphic;
    const nextDefinition = { ...definition, graphics: [...definition.graphics, imported] };
    const uniqueAssetIds = Array.from(new Set(assetIds));
    await prisma.project.update({ where: { id }, data: { definition: nextDefinition, assets: { connect: uniqueAssetIds.map((assetId) => ({ id: assetId })) } } });
    return NextResponse.json({ graphic: imported, assetIds: uniqueAssetIds, assetMode: pkg.assetMode }, { status: 201 });
  } catch (error) {
    console.error("Graphic import failed:", error);
    return jsonError(error instanceof Error ? error.message : "Invalid graphic package", 400);
  }
}
