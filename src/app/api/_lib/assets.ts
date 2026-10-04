import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateAssetKey, validateAssetType, validateImageFile, type ImageMetadata } from "@/integrations/image-assets";
import { MAX_AUDIO_ASSET_SIZE, audioExtension, canonicalAudioType, probeAudioFile } from "@/integrations/audio-assets";
import { prisma } from "@/lib/prisma";
import { jsonError } from "./http";
import { mediaRoot, rangedFileResponse } from "./files";

export const MAX_ASSET_SIZE = Number(process.env.MAX_ASSET_SIZE_BYTES ?? 10 * 1024 * 1024);
const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

export function sha256(data: Buffer) {
  return createHash("sha256").update(data).digest("hex");
}

/** Serves a stored asset file inline (audio with Range support, so players can seek), or 404 when the file is gone. */
export async function assetFileResponse(asset: { storagePath: string; mimeType: string }, request?: Request) {
  try {
    if (request && asset.mimeType.startsWith("audio/")) return await rangedFileResponse(request, asset.storagePath, asset.mimeType);
    const info = await stat(asset.storagePath);
    return new Response(createReadStream(asset.storagePath) as unknown as ReadableStream, { headers: { "Content-Type": asset.mimeType, "Content-Length": String(info.size), "Cache-Control": "private, max-age=3600" } });
  } catch {
    return jsonError("Asset file unavailable", 404);
  }
}

/**
 * Upload responses say when identical bytes were already in the library: the existing asset (and its key) is reused, so
 * `requestedKey` tells the caller that the name it asked for was not applied and overlays must use `assetKey`.
 */
export function withReuse<T extends { assetKey: string }>(asset: T, created: boolean, requestedKey: string) {
  return created ? asset : { ...asset, reused: true, requestedKey: requestedKey !== asset.assetKey ? requestedKey : undefined };
}

/** Runs the shared asset key/type checks; returns an error response or null. */
export function checkAssetKeyAndType(assetKey: string, type: string): Response | null {
  const keyValidation = validateAssetKey(assetKey);
  if (!keyValidation.valid) return jsonError(keyValidation.reason!, 400);
  const typeValidation = validateAssetType(type);
  if (!typeValidation.valid) return jsonError(typeValidation.reason!, 400);
  return null;
}

export type ImageUpload = { buffer: Buffer; mimeType: string; metadata: ImageMetadata; contentHash: string };

/** Size/MIME/content checks for an uploaded image; returns the decoded upload or an error response. */
export async function readImageUpload(file: File): Promise<ImageUpload | Response> {
  if (file.size > MAX_ASSET_SIZE) return jsonError("Asset is too large", 413);
  const mimeType = file.type || "application/octet-stream";
  if (!ALLOWED_IMAGE_TYPES.includes(mimeType)) return jsonError("File must be PNG, JPEG, or WebP", 400);
  const buffer = Buffer.from(await file.arrayBuffer());
  const validation = validateImageFile(buffer, mimeType);
  if (!validation.valid || !validation.metadata) return jsonError(validation.reason ?? "Unable to extract image metadata", 400);
  return { buffer, mimeType, metadata: validation.metadata, contentHash: sha256(buffer) };
}

/** Writes content-addressed bytes into the shared asset library (no-op if already present). */
export async function storeLibraryFile(data: Buffer, contentHash: string, extension: string): Promise<string> {
  const directory = path.join(mediaRoot(), "assets", "library");
  await mkdir(directory, { recursive: true });
  const storagePath = path.join(directory, `${contentHash}.${extension}`);
  await writeFile(storagePath, data, { flag: "wx" }).catch(error => { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; });
  return storagePath;
}

export type AudioUpload = { buffer: Buffer; mimeType: string; contentHash: string };

/** True when the upload is one of the accepted audio formats (by declared MIME type, else by file extension). */
export function isAudioUpload(file: File): boolean {
  return canonicalAudioType(file.type, file.name) !== null;
}

/** Size/type checks for an uploaded audio file; returns the decoded upload or an error response. */
export async function readAudioUpload(file: File): Promise<AudioUpload | Response> {
  const mimeType = canonicalAudioType(file.type, file.name);
  if (!mimeType) return jsonError("Audio must be MP3, M4A, WAV, OGG or WebM", 400);
  if (file.size <= 0) return jsonError("Audio file is empty", 400);
  if (file.size > MAX_AUDIO_ASSET_SIZE) return jsonError("Audio file is too large", 413);
  const buffer = Buffer.from(await file.arrayBuffer());
  return { buffer, mimeType, contentHash: sha256(buffer) };
}

/**
 * Stores an audio upload in the library and probes it with ffprobe. A file that is not decodable audio is removed again
 * and answered with a 400. Call only when no asset with this hash exists (the file could otherwise still be in use).
 */
export async function storeAudioAsset(upload: AudioUpload): Promise<{ storagePath: string; durationMs: number } | Response> {
  const storagePath = await storeLibraryFile(upload.buffer, upload.contentHash, audioExtension(upload.mimeType));
  const probe = await probeAudioFile(storagePath);
  if (!probe) {
    await rm(storagePath, { force: true }).catch(() => undefined);
    return jsonError("The file could not be read as audio", 400);
  }
  return { storagePath, durationMs: probe.durationMs };
}

/**
 * Reuses the library asset with the same audio bytes (moving it to `folderId` / linking `projectId` when given) or stores
 * and probes the upload as a new AUDIO asset. Returns an error response when the file is not decodable audio.
 */
export async function findOrCreateAudioAsset(upload: AudioUpload, options: { assetKey: string; folderId?: string | null; projectId?: string }) {
  const link = options.projectId ? { projects: { connect: { id: options.projectId } } } : {};
  const existing = await prisma.asset.findFirst({ where: { contentHash: upload.contentHash, mimeType: upload.mimeType, type: "AUDIO" } });
  if (existing) {
    const asset = await prisma.asset.update({ where: { id: existing.id }, data: { folderId: options.folderId ?? existing.folderId, expiresAt: null, ...link } });
    return { asset, created: false };
  }
  const stored = await storeAudioAsset(upload);
  if (stored instanceof Response) return stored;
  const asset = await prisma.asset.create({ data: { assetKey: options.assetKey, type: "AUDIO", storagePath: stored.storagePath, mimeType: upload.mimeType, durationMs: stored.durationMs, sizeBytes: BigInt(upload.buffer.length), contentHash: upload.contentHash, folderId: options.folderId ?? null, expiresAt: null, ...link } });
  return { asset, created: true };
}
