import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { migrateProjectDefinition } from "@/domain/project";
import { parseGraphicPackage } from "@/domain/graphic-package";

const MEDIA_ROOT = process.env.MEDIA_ROOT ?? "/data/media";
const MAX_ASSET_SIZE = Number(process.env.MAX_ASSET_SIZE_BYTES ?? 10 * 1024 * 1024);

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
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  try {
    const pkg = parseGraphicPackage(await request.json());
    const idMap = new Map<string, string>();
    const assetIds: string[] = [];
    const unresolved: string[] = [];

    for (const item of pkg.assets) {
      let asset = await prisma.asset.findFirst({ where: { contentHash: item.contentHash, mimeType: item.mimeType } });

      if (pkg.assetMode === "referenced") {
        if (!asset) unresolved.push(item.assetKey);
        else {
          idMap.set(item.sourceAssetId, asset.id);
          idMap.set(item.assetKey, asset.id);
          assetIds.push(asset.id);
        }
        continue;
      }

      const data = Buffer.from(item.dataBase64, "base64");
      if (data.length > MAX_ASSET_SIZE) return NextResponse.json({ error: `Asset ${item.assetKey} is too large` }, { status: 413 });
      const actualHash = createHash("sha256").update(data).digest("hex");
      if (actualHash !== item.contentHash) return NextResponse.json({ error: `Asset hash mismatch: ${item.assetKey}` }, { status: 400 });
      if (!asset) {
        const ext = item.mimeType === "image/png" ? "png" : item.mimeType === "image/webp" ? "webp" : item.mimeType === "image/jpeg" ? "jpg" : "bin";
        const dir = path.join(MEDIA_ROOT, "assets", "library");
        await mkdir(dir, { recursive: true });
        const storagePath = path.join(dir, `${item.contentHash}.${ext}`);
        await writeFile(storagePath, data, { flag: "wx" }).catch((error) => { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; });
        asset = await prisma.asset.create({ data: { assetKey: item.assetKey, type: "OVERLAY", storagePath, mimeType: item.mimeType, width: item.width, height: item.height, hasAlpha: item.hasAlpha, sizeBytes: BigInt(data.length), contentHash: item.contentHash, expiresAt: null } });
      }
      idMap.set(item.sourceAssetId, asset.id);
      idMap.set(item.assetKey, asset.id);
      assetIds.push(asset.id);
    }

    if (unresolved.length) {
      return NextResponse.json({ error: "Referenced package requires assets that are not in this asset library", unresolvedAssets: unresolved }, { status: 409 });
    }

    const definition = migrateProjectDefinition(project.definition);
    const imported = replaceAssetReferences({ ...pkg.graphic, id: crypto.randomUUID() }, idMap) as typeof pkg.graphic;
    const nextDefinition = { ...definition, graphics: [...definition.graphics, imported] };
    await prisma.project.update({ where: { id }, data: { definition: nextDefinition, assets: { connect: Array.from(new Set(assetIds)).map((assetId) => ({ id: assetId })) } } });
    return NextResponse.json({ graphic: imported, assetIds: Array.from(new Set(assetIds)), assetMode: pkg.assetMode }, { status: 201 });
  } catch (error) {
    console.error("Graphic import failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid graphic package" }, { status: 400 });
  }
}
