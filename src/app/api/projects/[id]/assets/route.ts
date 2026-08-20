import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { validateImageFile, sanitizeAssetKey, validateAssetKey, validateAssetType, getExtensionFromMimeType } from "@/integrations/image-assets";

const MAX_ASSET_SIZE = Number(process.env.MAX_ASSET_SIZE_BYTES ?? 10 * 1024 * 1024);
const MEDIA_ROOT = process.env.MEDIA_ROOT ?? "/data/media";

// Schema for asset upload metadata
const assetMetadataSchema = z.object({
  assetKey: z.string().min(1).max(64),
  type: z.enum(["OVERLAY", "BACKGROUND", "LOGO", "FONT"]),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;

    // Verify project exists
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "A file is required" }, { status: 400 });
    }

    // Parse and validate metadata
    let metadata;
    try {
      metadata = assetMetadataSchema.parse({
        assetKey: form.get("assetKey"),
        type: form.get("type"),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid metadata" }, { status: 400 });
      }
      throw error;
    }

    // Validate asset key
    const keyValidation = validateAssetKey(metadata.assetKey);
    if (!keyValidation.valid) {
      return NextResponse.json({ error: keyValidation.reason }, { status: 400 });
    }

    // Validate asset type
    const typeValidation = validateAssetType(metadata.type);
    if (!typeValidation.valid) {
      return NextResponse.json({ error: typeValidation.reason }, { status: 400 });
    }

    // Check file size
    if (file.size > MAX_ASSET_SIZE) {
      return NextResponse.json(
        { error: `File size ${(file.size / 1024 / 1024).toFixed(2)}MB exceeds maximum ${(MAX_ASSET_SIZE / 1024 / 1024).toFixed(2)}MB` },
        { status: 413 }
      );
    }

    // Check MIME type
    const mimeType = file.type || "application/octet-stream";
    if (!["image/png", "image/jpeg", "image/webp"].includes(mimeType)) {
      return NextResponse.json(
        { error: "File must be PNG, JPEG, or WebP" },
        { status: 400 }
      );
    }

    // Read and validate image
    const buffer = Buffer.from(await file.arrayBuffer());
    const imageValidation = validateImageFile(buffer, mimeType);
    if (!imageValidation.valid) {
      return NextResponse.json({ error: imageValidation.reason }, { status: 400 });
    }

    if (!imageValidation.metadata) {
      return NextResponse.json({ error: "Unable to extract image metadata" }, { status: 400 });
    }

    // Check for duplicate asset key in project
    const existing = await prisma.asset.findUnique({
      where: { projectId_assetKey: { projectId: id, assetKey: metadata.assetKey } },
    });

    // Store file
    const assetsDir = path.join(MEDIA_ROOT, "assets", id);
    await mkdir(assetsDir, { recursive: true });

    const ext = getExtensionFromMimeType(mimeType);
    const timestamp = Date.now();
    const safeName = `${metadata.assetKey}-${timestamp}.${ext}`;
    const storagePath = path.join(assetsDir, safeName);

    await writeFile(storagePath, buffer);

    // Create or update asset record
    const asset = existing
      ? await prisma.asset.update({
          where: { id: existing.id },
          data: {
            storagePath,
            mimeType,
            width: imageValidation.metadata.width,
            height: imageValidation.metadata.height,
            hasAlpha: imageValidation.metadata.hasAlpha,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            updatedAt: new Date(),
          },
        })
      : await prisma.asset.create({
          data: {
            projectId: id,
            assetKey: metadata.assetKey,
            type: metadata.type,
            storagePath,
            mimeType,
            width: imageValidation.metadata.width,
            height: imageValidation.metadata.height,
            hasAlpha: imageValidation.metadata.hasAlpha,
            sizeBytes: BigInt(buffer.length),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        });

    return NextResponse.json(
      {
        id: asset.id,
        assetKey: asset.assetKey,
        type: asset.type,
        mimeType: asset.mimeType,
        width: asset.width,
        height: asset.height,
        sizeBytes: asset.sizeBytes.toString(),
        hasAlpha: asset.hasAlpha,
        createdAt: asset.createdAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Asset upload error:", error);
    return NextResponse.json({ error: "Asset upload failed" }, { status: 500 });
  }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;

    // Verify project exists
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const assets = await prisma.asset.findMany({
      where: { projectId: id },
      select: {
        id: true,
        assetKey: true,
        type: true,
        mimeType: true,
        width: true,
        height: true,
        hasAlpha: true,
        sizeBytes: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      assets: assets.map((asset) => ({
        ...asset,
        sizeBytes: asset.sizeBytes.toString(),
        createdAt: asset.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Asset list error:", error);
    return NextResponse.json({ error: "Failed to list assets" }, { status: 500 });
  }
}
