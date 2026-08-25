import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { validateImageFile, validateAssetKey, validateAssetType, getExtensionFromMimeType } from "@/integrations/image-assets";

const MAX_ASSET_SIZE = Number(process.env.MAX_ASSET_SIZE_BYTES ?? 10 * 1024 * 1024);
const MEDIA_ROOT = process.env.MEDIA_ROOT ?? "/data/media";
const metadataSchema = z.object({ assetKey: z.string().trim().min(1).max(64), type: z.enum(["OVERLAY", "BACKGROUND", "LOGO", "FONT"]), folderId: z.string().nullable().optional() });

function serialize(asset: any) {
  return { id: asset.id, assetKey: asset.assetKey, type: asset.type, mimeType: asset.mimeType, width: asset.width, height: asset.height, hasAlpha: asset.hasAlpha, sizeBytes: asset.sizeBytes.toString(), contentHash: asset.contentHash, folderId: asset.folderId ?? null, projectCount: asset.projects?.length ?? 0, createdAt: asset.createdAt?.toISOString?.() };
}

export async function GET() {
  const [assets, folders] = await Promise.all([
    prisma.asset.findMany({ select: { id: true, assetKey: true, type: true, mimeType: true, width: true, height: true, hasAlpha: true, sizeBytes: true, contentHash: true, folderId: true, createdAt: true, projects: { select: { id: true } } }, orderBy: { createdAt: "desc" } }),
    prisma.assetFolder.findMany({ select: { id: true, name: true, parentId: true }, orderBy: [{ parentId: "asc" }, { name: "asc" }] }),
  ]);
  return NextResponse.json({ assets: assets.map(serialize), folders });
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "A file is required" }, { status: 400 });
    const metadata = metadataSchema.safeParse({ assetKey: form.get("assetKey"), type: form.get("type"), folderId: form.get("folderId") || null });
    if (!metadata.success) return NextResponse.json({ error: metadata.error.issues[0]?.message ?? "Invalid metadata" }, { status: 400 });
    const keyValidation = validateAssetKey(metadata.data.assetKey);
    if (!keyValidation.valid) return NextResponse.json({ error: keyValidation.reason }, { status: 400 });
    const typeValidation = validateAssetType(metadata.data.type);
    if (!typeValidation.valid) return NextResponse.json({ error: typeValidation.reason }, { status: 400 });
    if (metadata.data.folderId && !(await prisma.assetFolder.findUnique({ where: { id: metadata.data.folderId } }))) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    if (file.size > MAX_ASSET_SIZE) return NextResponse.json({ error: "Asset is too large" }, { status: 413 });
    const mimeType = file.type || "application/octet-stream";
    if (!["image/png", "image/jpeg", "image/webp"].includes(mimeType)) return NextResponse.json({ error: "File must be PNG, JPEG, or WebP" }, { status: 400 });
    const buffer = Buffer.from(await file.arrayBuffer());
    const validation = validateImageFile(buffer, mimeType);
    if (!validation.valid || !validation.metadata) return NextResponse.json({ error: validation.reason ?? "Unable to extract image metadata" }, { status: 400 });
    const contentHash = createHash("sha256").update(buffer).digest("hex");
    const existing = await prisma.asset.findFirst({ where: { contentHash, mimeType, type: metadata.data.type } });
    if (existing) {
      const updated = await prisma.asset.update({ where: { id: existing.id }, data: { folderId: metadata.data.folderId ?? existing.folderId, expiresAt: null } });
      return NextResponse.json(serialize(updated));
    }
    const assetsDir = path.join(MEDIA_ROOT, "assets", "library");
    await mkdir(assetsDir, { recursive: true });
    const storagePath = path.join(assetsDir, `${contentHash}.${getExtensionFromMimeType(mimeType)}`);
    await writeFile(storagePath, buffer, { flag: "wx" }).catch(async error => { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; });
    const asset = await prisma.asset.create({ data: { assetKey: metadata.data.assetKey, type: metadata.data.type, storagePath, mimeType, width: validation.metadata.width, height: validation.metadata.height, hasAlpha: validation.metadata.hasAlpha, sizeBytes: BigInt(buffer.length), contentHash, folderId: metadata.data.folderId ?? null, expiresAt: null } });
    return NextResponse.json(serialize(asset), { status: 201 });
  } catch (error) {
    console.error("Asset library upload error:", error);
    return NextResponse.json({ error: "Asset upload failed" }, { status: 500 });
  }
}
