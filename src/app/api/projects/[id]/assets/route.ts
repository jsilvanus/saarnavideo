import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { validateImageFile, sanitizeAssetKey, validateAssetKey, validateAssetType, getExtensionFromMimeType } from "@/integrations/image-assets";

const MAX_ASSET_SIZE = Number(process.env.MAX_ASSET_SIZE_BYTES ?? 10 * 1024 * 1024);
const MEDIA_ROOT = process.env.MEDIA_ROOT ?? "/data/media";
const assetMetadataSchema = z.object({ assetKey: z.string().min(1).max(64), type: z.enum(["OVERLAY", "BACKGROUND", "LOGO", "FONT"]) });

function serializeAsset(asset: { id: string; assetKey: string; type: string; mimeType: string; width: number | null; height: number | null; hasAlpha: boolean; sizeBytes: bigint; contentHash: string | null; createdAt?: Date }) {
  return { id: asset.id, assetKey: asset.assetKey, type: asset.type, mimeType: asset.mimeType, width: asset.width, height: asset.height, hasAlpha: asset.hasAlpha, sizeBytes: asset.sizeBytes.toString(), contentHash: asset.contentHash, ...(asset.createdAt ? { createdAt: asset.createdAt.toISOString() } : {}) };
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "A file is required" }, { status: 400 });
    const metadata = assetMetadataSchema.safeParse({ assetKey: form.get("assetKey"), type: form.get("type") });
    if (!metadata.success) return NextResponse.json({ error: metadata.error.issues[0]?.message ?? "Invalid metadata" }, { status: 400 });
    const keyValidation = validateAssetKey(metadata.data.assetKey);
    if (!keyValidation.valid) return NextResponse.json({ error: keyValidation.reason }, { status: 400 });
    const typeValidation = validateAssetType(metadata.data.type);
    if (!typeValidation.valid) return NextResponse.json({ error: typeValidation.reason }, { status: 400 });
    if (file.size > MAX_ASSET_SIZE) return NextResponse.json({ error: "Asset is too large" }, { status: 413 });
    const mimeType = file.type || "application/octet-stream";
    if (!["image/png", "image/jpeg", "image/webp"].includes(mimeType)) return NextResponse.json({ error: "File must be PNG, JPEG, or WebP" }, { status: 400 });
    const buffer = Buffer.from(await file.arrayBuffer());
    const imageValidation = validateImageFile(buffer, mimeType);
    if (!imageValidation.valid || !imageValidation.metadata) return NextResponse.json({ error: imageValidation.reason ?? "Unable to extract image metadata" }, { status: 400 });
    const contentHash = createHash("sha256").update(buffer).digest("hex");

    // Reuse an existing library asset with identical bytes. Only the project relation is new.
    const existing = await prisma.asset.findFirst({ where: { contentHash, mimeType, type: metadata.data.type } });
    if (existing) {
      await prisma.asset.update({ where: { id: existing.id }, data: { projects: { connect: { id } }, expiresAt: null } });
      return NextResponse.json(serializeAsset(existing), { status: 200 });
    }

    const assetsDir = path.join(MEDIA_ROOT, "assets", "library");
    await mkdir(assetsDir, { recursive: true });
    const ext = getExtensionFromMimeType(mimeType);
    const storagePath = path.join(assetsDir, `${contentHash}.${ext}`);
    await writeFile(storagePath, buffer, { flag: "wx" }).catch(async error => { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; });
    const asset = await prisma.asset.create({ data: { assetKey: metadata.data.assetKey, type: metadata.data.type, storagePath, mimeType, width: imageValidation.metadata.width, height: imageValidation.metadata.height, hasAlpha: imageValidation.metadata.hasAlpha, sizeBytes: BigInt(buffer.length), contentHash, expiresAt: null, projects: { connect: { id } } } });
    return NextResponse.json(serializeAsset(asset), { status: 201 });
  } catch (error) {
    console.error("Asset upload error:", error);
    return NextResponse.json({ error: "Asset upload failed" }, { status: 500 });
  }
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    const assets = await prisma.asset.findMany({ where: { projects: { some: { id } } }, select: { id: true, assetKey: true, type: true, mimeType: true, width: true, height: true, hasAlpha: true, sizeBytes: true, contentHash: true, createdAt: true }, orderBy: { createdAt: "desc" } });
    return NextResponse.json({ assets: assets.map(serializeAsset) });
  } catch (error) {
    console.error("Asset list error:", error);
    return NextResponse.json({ error: "Failed to list assets" }, { status: 500 });
  }
}
