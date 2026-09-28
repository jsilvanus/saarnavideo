import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateAssetKey, validateAssetType, validateImageFile, type ImageMetadata } from "@/integrations/image-assets";
import { jsonError } from "./http";
import { mediaRoot } from "./files";

export const MAX_ASSET_SIZE = Number(process.env.MAX_ASSET_SIZE_BYTES ?? 10 * 1024 * 1024);
const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

export function sha256(data: Buffer) {
  return createHash("sha256").update(data).digest("hex");
}

/** Serves a stored asset file inline, or 404 when the file is gone. */
export async function assetFileResponse(asset: { storagePath: string; mimeType: string }) {
  try {
    const info = await stat(asset.storagePath);
    return new Response(createReadStream(asset.storagePath) as unknown as ReadableStream, { headers: { "Content-Type": asset.mimeType, "Content-Length": String(info.size), "Cache-Control": "private, max-age=3600" } });
  } catch {
    return jsonError("Asset file unavailable", 404);
  }
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
