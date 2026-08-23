import type { AssetType } from "@prisma/client";

export interface ImageAssetConstraints { maxFileSizeBytes: number; maxWidth: number; maxHeight: number; minWidth: number; minHeight: number; allowedMimeTypes: Set<string>; }
export const DEFAULT_IMAGE_CONSTRAINTS: ImageAssetConstraints = { maxFileSizeBytes: 10 * 1024 * 1024, maxWidth: 4096, maxHeight: 2160, minWidth: 100, minHeight: 100, allowedMimeTypes: new Set(["image/png", "image/jpeg", "image/webp"]) };
export interface ImageMetadata { width: number; height: number; hasAlpha: boolean; mimeType: string; format: "png" | "jpeg" | "webp"; }
export interface ImageValidation { valid: boolean; reason?: string; metadata?: ImageMetadata; }

export interface SvgValidation { valid: boolean; reason?: string; }
export function validateSvgFile(buffer: Buffer, maxBytes = 10 * 1024 * 1024): SvgValidation {
  if (buffer.length > maxBytes) return { valid: false, reason: "SVG is too large" };
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "").trim();
  if (!text.startsWith("<svg") && !text.startsWith("<?xml")) return { valid: false, reason: "File is not an SVG document" };
  if (!/<svg\b/i.test(text)) return { valid: false, reason: "SVG root element is missing" };
  if (/<\s*script\b/i.test(text) || /<\s*foreignObject\b/i.test(text) || /\son[a-z]+\s*=\s*["']/i.test(text)) return { valid: false, reason: "SVG contains executable content" };
  if (/(?:href|xlink:href)\s*=\s*["']\s*(?:https?:|data:text\/html)/i.test(text)) return { valid: false, reason: "SVG contains an external or executable reference" };
  return { valid: true };
}

export function detectImageMetadata(data: Buffer, mimeType: string): ImageMetadata | null {
  try {
    if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) { const metadata = parsePNG(data); if (metadata) return { ...metadata, mimeType: "image/png", format: "png" }; }
    if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) { const metadata = parseJPEG(data); if (metadata) return { ...metadata, mimeType: "image/jpeg", format: "jpeg" }; }
    if (data.length >= 12 && data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 && data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) { const metadata = parseWebP(data); if (metadata) return { ...metadata, mimeType: "image/webp", format: "webp" }; }
    return null;
  } catch { return null; }
}
function parsePNG(data: Buffer): Omit<ImageMetadata, "mimeType" | "format"> | null { try { if (data.length < 26) return null; const width = data.readUInt32BE(16), height = data.readUInt32BE(20), colorType = data[25]; return { width, height, hasAlpha: colorType === 4 || colorType === 6 }; } catch { return null; } }
function parseJPEG(data: Buffer): Omit<ImageMetadata, "mimeType" | "format"> | null { try { let offset = 2; while (offset < data.length - 8) { if (data[offset] !== 0xff) { offset++; continue; } const marker = data[offset + 1]; if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) return { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7), hasAlpha: false }; const segmentLength = data.readUInt16BE(offset + 2); offset += segmentLength + 2; } return null; } catch { return null; } }
function parseWebP(data: Buffer): Omit<ImageMetadata, "mimeType" | "format"> | null { try { if (data.length < 30) return null; let offset = 12; while (offset + 8 <= data.length) { const chunkFourCC = data.slice(offset, offset + 4).toString("ascii"), chunkSize = data.readUInt32LE(offset + 4); if (chunkFourCC === "VP8X") { const flags = data[offset + 8], width = (data.readUInt32LE(offset + 12) & 0xffffff) + 1, height = (data.readUInt32LE(offset + 15) & 0xffffff) + 1; return { width, height, hasAlpha: !!(flags & 0x10) }; } if (chunkFourCC === "VP8 ") return { width: (data.readUInt16LE(offset + 12) & 0x3fff) + 1, height: (data.readUInt16LE(offset + 14) & 0x3fff) + 1, hasAlpha: false }; if (chunkFourCC === "VP8L") { const bits = data.readUInt32LE(offset + 8); return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, hasAlpha: !!((bits >> 28) & 1) }; } offset += chunkSize + 8; } return null; } catch { return null; } }
export function validateImageFile(buffer: Buffer, mimeType: string, constraints: Partial<ImageAssetConstraints> = {}): ImageValidation { const limits = { ...DEFAULT_IMAGE_CONSTRAINTS, ...constraints }; if (!limits.allowedMimeTypes.has(mimeType)) return { valid: false, reason: `Image type ${mimeType} not supported. Allowed: PNG, JPEG, WebP` }; if (buffer.length > limits.maxFileSizeBytes) return { valid: false, reason: `Image size exceeds maximum` }; const metadata = detectImageMetadata(buffer, mimeType); if (!metadata) return { valid: false, reason: "Unable to parse image format or invalid image data" }; if (metadata.width < limits.minWidth || metadata.height < limits.minHeight) return { valid: false, reason: `Image dimensions ${metadata.width}x${metadata.height} below minimum ${limits.minWidth}x${limits.minHeight}` }; if (metadata.width > limits.maxWidth || metadata.height > limits.maxHeight) return { valid: false, reason: `Image dimensions ${metadata.width}x${metadata.height} exceed maximum ${limits.maxWidth}x${limits.maxHeight}` }; return { valid: true, metadata }; }
export function formatBytes(bytes: number): string { if (bytes === 0) return "0 B"; const k = 1024, sizes = ["B", "KB", "MB", "GB"], i = Math.floor(Math.log(bytes) / Math.log(k)); return `${(bytes / Math.pow(k, i)).toFixed(2).replace(/\.?0+$/, "")} ${sizes[i]}`; }
export function sanitizeAssetKey(key: string): string { return key.replace(/[^a-z0-9_-]/gi, "_").slice(0, 64); }
export function getExtensionFromMimeType(mimeType: string): string { const ext = mimeType.split("/")[1]; if (!ext || ext === "octet-stream") return "bin"; if (ext === "jpeg") return "jpg"; if (ext === "svg+xml") return "svg"; return ext; }
export function validateAssetKey(key: string): { valid: boolean; reason?: string } { if (!key) return { valid: false, reason: "Asset key cannot be empty" }; if (key.length > 64) return { valid: false, reason: "Asset key cannot exceed 64 characters" }; if (!/^[a-z0-9_-]+$/i.test(key)) return { valid: false, reason: "Asset key must contain only alphanumeric characters, hyphens, and underscores" }; return { valid: true }; }
export function validateAssetType(type: string): { valid: boolean; reason?: string } { const validTypes: AssetType[] = ["OVERLAY", "BACKGROUND", "LOGO", "FONT"]; if (!validTypes.includes(type as AssetType)) return { valid: false, reason: `Asset type must be one of: ${validTypes.join(", ")}` }; return { valid: true }; }
