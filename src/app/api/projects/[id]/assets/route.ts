import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getExtensionFromMimeType } from "@/integrations/image-assets";
import { checkAssetKeyAndType, isAudioUpload, readAudioUpload, readImageUpload, storeAudioAsset, storeLibraryFile } from "@/app/api/_lib/assets";
import { jsonError } from "@/app/api/_lib/http";

const assetMetadataSchema = z.object({ assetKey: z.string().min(1).max(64), type: z.enum(["OVERLAY", "BACKGROUND", "LOGO", "FONT", "AUDIO"]) });

function serializeAsset(asset: { id: string; assetKey: string; type: string; mimeType: string; width: number | null; height: number | null; hasAlpha: boolean; durationMs?: number | null; sizeBytes: bigint; contentHash: string | null; createdAt?: Date }) {
  return { id: asset.id, assetKey: asset.assetKey, type: asset.type, mimeType: asset.mimeType, width: asset.width, height: asset.height, hasAlpha: asset.hasAlpha, durationMs: asset.durationMs ?? null, sizeBytes: asset.sizeBytes.toString(), contentHash: asset.contentHash, ...(asset.createdAt ? { createdAt: asset.createdAt.toISOString() } : {}) };
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) return jsonError("Project not found", 404);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return jsonError("A file is required", 400);
    const audioFile = isAudioUpload(file);
    const metadata = assetMetadataSchema.safeParse({ assetKey: form.get("assetKey"), type: audioFile ? "AUDIO" : form.get("type") });
    if (!metadata.success) return jsonError(metadata.error.issues[0]?.message ?? "Invalid metadata", 400);
    if (metadata.data.type === "AUDIO" && !audioFile) return jsonError("Type AUDIO needs an audio file", 400);
    const invalid = checkAssetKeyAndType(metadata.data.assetKey, metadata.data.type);
    if (invalid) return invalid;
    if (audioFile) {
      const audio = await readAudioUpload(file);
      if (audio instanceof Response) return audio;
      const known = await prisma.asset.findFirst({ where: { contentHash: audio.contentHash, mimeType: audio.mimeType, type: "AUDIO" } });
      if (known) {
        await prisma.asset.update({ where: { id: known.id }, data: { projects: { connect: { id } }, expiresAt: null } });
        return NextResponse.json(serializeAsset(known), { status: 200 });
      }
      const stored = await storeAudioAsset(audio);
      if (stored instanceof Response) return stored;
      const created = await prisma.asset.create({ data: { assetKey: metadata.data.assetKey, type: "AUDIO", storagePath: stored.storagePath, mimeType: audio.mimeType, durationMs: stored.durationMs, sizeBytes: BigInt(audio.buffer.length), contentHash: audio.contentHash, expiresAt: null, projects: { connect: { id } } } });
      return NextResponse.json(serializeAsset(created), { status: 201 });
    }
    const upload = await readImageUpload(file);
    if (upload instanceof Response) return upload;
    const { buffer, mimeType, metadata: image, contentHash } = upload;

    // Reuse an existing library asset with identical bytes. Only the project relation is new.
    const existing = await prisma.asset.findFirst({ where: { contentHash, mimeType, type: metadata.data.type } });
    if (existing) {
      await prisma.asset.update({ where: { id: existing.id }, data: { projects: { connect: { id } }, expiresAt: null } });
      return NextResponse.json(serializeAsset(existing), { status: 200 });
    }

    const storagePath = await storeLibraryFile(buffer, contentHash, getExtensionFromMimeType(mimeType));
    const asset = await prisma.asset.create({ data: { assetKey: metadata.data.assetKey, type: metadata.data.type, storagePath, mimeType, width: image.width, height: image.height, hasAlpha: image.hasAlpha, sizeBytes: BigInt(buffer.length), contentHash, expiresAt: null, projects: { connect: { id } } } });
    return NextResponse.json(serializeAsset(asset), { status: 201 });
  } catch (error) {
    console.error("Asset upload error:", error);
    return jsonError("Asset upload failed", 500);
  }
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) return jsonError("Project not found", 404);
    const assets = await prisma.asset.findMany({ where: { projects: { some: { id } } }, select: { id: true, assetKey: true, type: true, mimeType: true, width: true, height: true, hasAlpha: true, durationMs: true, sizeBytes: true, contentHash: true, createdAt: true }, orderBy: { createdAt: "desc" } });
    return NextResponse.json({ assets: assets.map(serializeAsset) });
  } catch (error) {
    console.error("Asset list error:", error);
    return jsonError("Failed to list assets", 500);
  }
}
