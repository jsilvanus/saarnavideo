import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getExtensionFromMimeType } from "@/integrations/image-assets";
import { checkAssetKeyAndType, findOrCreateAudioAsset, isAudioUpload, readAudioUpload, readImageUpload, storeLibraryFile, withReuse } from "@/app/api/_lib/assets";
import { jsonError } from "@/app/api/_lib/http";

const metadataSchema = z.object({ assetKey: z.string().trim().min(1).max(64), type: z.enum(["OVERLAY", "BACKGROUND", "LOGO", "FONT", "AUDIO"]).default("OVERLAY"), folderId: z.string().nullable().optional() });

function serialize(asset: any) { return { id: asset.id, assetKey: asset.assetKey, type: asset.type, mimeType: asset.mimeType, width: asset.width, height: asset.height, hasAlpha: asset.hasAlpha, durationMs: asset.durationMs ?? null, sizeBytes: asset.sizeBytes.toString(), contentHash: asset.contentHash, folderId: asset.folderId ?? null, projectCount: asset.projects?.length ?? 0, createdAt: asset.createdAt?.toISOString?.() }; }

export async function GET() {
  const [assets, folders] = await Promise.all([
    prisma.asset.findMany({ select: { id: true, assetKey: true, type: true, mimeType: true, width: true, height: true, hasAlpha: true, durationMs: true, sizeBytes: true, contentHash: true, folderId: true, createdAt: true, projects: { select: { id: true } } }, orderBy: { createdAt: "desc" } }),
    prisma.assetFolder.findMany({ select: { id: true, name: true, parentId: true }, orderBy: [{ parentId: "asc" }, { name: "asc" }] }),
  ]);
  return NextResponse.json({ assets: assets.map(serialize), folders });
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return jsonError("A file is required", 400);
    const audioFile = isAudioUpload(file);
    const metadata = metadataSchema.safeParse({ assetKey: form.get("assetKey"), type: audioFile ? "AUDIO" : form.get("type") || undefined, folderId: form.get("folderId") || null });
    if (!metadata.success) return jsonError(metadata.error.issues[0]?.message ?? "Invalid metadata", 400);
    if (metadata.data.type === "AUDIO" && !audioFile) return jsonError("Type AUDIO needs an audio file", 400);
    const invalid = checkAssetKeyAndType(metadata.data.assetKey, metadata.data.type);
    if (invalid) return invalid;
    if (metadata.data.folderId && !(await prisma.assetFolder.findUnique({ where: { id: metadata.data.folderId } }))) return jsonError("Folder not found", 404);
    if (audioFile) {
      const upload = await readAudioUpload(file);
      if (upload instanceof Response) return upload;
      const result = await findOrCreateAudioAsset(upload, { assetKey: metadata.data.assetKey, folderId: metadata.data.folderId });
      if (result instanceof Response) return result;
      return NextResponse.json(withReuse(serialize(result.asset), result.created, metadata.data.assetKey), { status: result.created ? 201 : 200 });
    }
    const upload = await readImageUpload(file);
    if (upload instanceof Response) return upload;
    const { buffer, mimeType, metadata: image, contentHash } = upload;
    const existing = await prisma.asset.findFirst({ where: { contentHash, mimeType } });
    if (existing) { const updated = await prisma.asset.update({ where: { id: existing.id }, data: { folderId: metadata.data.folderId ?? existing.folderId, expiresAt: null } }); return NextResponse.json(withReuse(serialize(updated), false, metadata.data.assetKey)); }
    const storagePath = await storeLibraryFile(buffer, contentHash, getExtensionFromMimeType(mimeType));
    const asset = await prisma.asset.create({ data: { assetKey: metadata.data.assetKey, type: metadata.data.type, storagePath, mimeType, width: image.width, height: image.height, hasAlpha: image.hasAlpha, sizeBytes: BigInt(buffer.length), contentHash, folderId: metadata.data.folderId ?? null, expiresAt: null } });
    return NextResponse.json(serialize(asset), { status: 201 });
  } catch (error) { console.error("Asset library upload error:", error); return jsonError("Asset upload failed", 500); }
}
