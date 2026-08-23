import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { validateImageFile, validateSvgFile, sanitizeAssetKey, validateAssetKey, validateAssetType, getExtensionFromMimeType } from "@/integrations/image-assets";

const MAX_ASSET_SIZE = Number(process.env.MAX_ASSET_SIZE_BYTES ?? 10 * 1024 * 1024);
const MEDIA_ROOT = process.env.MEDIA_ROOT ?? "/data/media";
const assetMetadataSchema = z.object({ assetKey: z.string().min(1).max(64), type: z.enum(["OVERLAY", "BACKGROUND", "LOGO", "FONT"]) });

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
    const isSvg = mimeType === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");
    const buffer = Buffer.from(await file.arrayBuffer());
    let width: number | null = null;
    let height: number | null = null;
    let hasAlpha = false;
    if (isSvg) {
      const validation = validateSvgFile(buffer, MAX_ASSET_SIZE);
      if (!validation.valid) return NextResponse.json({ error: validation.reason ?? "Invalid SVG" }, { status: 400 });
    } else {
      if (!["image/png", "image/jpeg", "image/webp"].includes(mimeType)) return NextResponse.json({ error: "File must be SVG, PNG, JPEG, or WebP" }, { status: 400 });
      const validation = validateImageFile(buffer, mimeType);
      if (!validation.valid || !validation.metadata) return NextResponse.json({ error: validation.reason ?? "Unable to extract image metadata" }, { status: 400 });
      width = validation.metadata.width; height = validation.metadata.height; hasAlpha = validation.metadata.hasAlpha;
    }

    const existing = await prisma.asset.findFirst({ where: { assetKey: metadata.data.assetKey, projects: { some: { id } } } });
    const ext = getExtensionFromMimeType(isSvg ? "image/svg+xml" : mimeType);
    const assetsDir = path.join(MEDIA_ROOT, "assets", existing?.id ?? id);
    await mkdir(assetsDir, { recursive: true });
    const storagePath = path.join(assetsDir, `${sanitizeAssetKey(metadata.data.assetKey)}-${Date.now()}.${ext}`);
    await writeFile(storagePath, buffer);

    const asset = existing
      ? await prisma.asset.update({ where: { id: existing.id }, data: { storagePath, mimeType: isSvg ? "image/svg+xml" : mimeType, width, height, hasAlpha, sizeBytes: BigInt(buffer.length), updatedAt: new Date() } })
      : await prisma.asset.create({ data: { assetKey: metadata.data.assetKey, type: metadata.data.type, storagePath, mimeType: isSvg ? "image/svg+xml" : mimeType, width, height, hasAlpha, sizeBytes: BigInt(buffer.length), projects: { connect: { id } } } });
    return NextResponse.json({ id: asset.id, assetKey: asset.assetKey, type: asset.type, mimeType: asset.mimeType, width: asset.width, height: asset.height, sizeBytes: asset.sizeBytes.toString(), hasAlpha: asset.hasAlpha }, { status: 201 });
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
    const assets = await prisma.asset.findMany({ where: { projects: { some: { id } } }, select: { id: true, assetKey: true, type: true, mimeType: true, width: true, height: true, hasAlpha: true, sizeBytes: true, createdAt: true }, orderBy: { createdAt: "desc" } });
    return NextResponse.json({ assets: assets.map((asset) => ({ ...asset, sizeBytes: asset.sizeBytes.toString(), createdAt: asset.createdAt.toISOString() })) });
  } catch (error) {
    console.error("Asset list error:", error);
    return NextResponse.json({ error: "Failed to list assets" }, { status: 500 });
  }
}
