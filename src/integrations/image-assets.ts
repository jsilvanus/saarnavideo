import { readFile } from "node:fs/promises";
import type { AssetType } from "@prisma/client";

/**
 * Image asset constraints for video rendering.
 */
export interface ImageAssetConstraints {
  maxFileSizeBytes: number;
  maxWidth: number;
  maxHeight: number;
  minWidth: number;
  minHeight: number;
  allowedMimeTypes: Set<string>;
}

export const DEFAULT_IMAGE_CONSTRAINTS: ImageAssetConstraints = {
  maxFileSizeBytes: 10 * 1024 * 1024, // 10 MB
  maxWidth: 4096,
  maxHeight: 2160,
  minWidth: 100,
  minHeight: 100,
  allowedMimeTypes: new Set(["image/png", "image/jpeg", "image/webp"]),
};

/**
 * Image metadata extracted from file.
 */
export interface ImageMetadata {
  width: number;
  height: number;
  hasAlpha: boolean;
  mimeType: string;
  format: "png" | "jpeg" | "webp";
}

/**
 * Image validation result.
 */
export interface ImageValidation {
  valid: boolean;
  reason?: string;
  metadata?: ImageMetadata;
}

/**
 * Detect image format and extract metadata from binary data.
 * Checks file signatures (magic bytes) to reliably identify format.
 */
export function detectImageMetadata(data: Buffer, mimeType: string): ImageMetadata | null {
  try {
    // PNG: 89 50 4E 47
    if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
      const metadata = parsePNG(data);
      if (metadata) return { ...metadata, mimeType: "image/png", format: "png" };
    }

    // JPEG: FF D8 FF
    if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
      const metadata = parseJPEG(data);
      if (metadata) return { ...metadata, mimeType: "image/jpeg", format: "jpeg" };
    }

    // WebP: RIFF ... WEBP
    if (
      data.length >= 12 &&
      data[0] === 0x52 &&
      data[1] === 0x49 &&
      data[2] === 0x46 &&
      data[3] === 0x46 &&
      data[8] === 0x57 &&
      data[9] === 0x45 &&
      data[10] === 0x42 &&
      data[11] === 0x50
    ) {
      const metadata = parseWebP(data);
      if (metadata) return { ...metadata, mimeType: "image/webp", format: "webp" };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Parse PNG header for dimensions and IHDR chunk.
 * PNG structure: signature (8) + IHDR chunk with width/height at offset 16-24
 */
function parsePNG(data: Buffer): Omit<ImageMetadata, "mimeType" | "format"> | null {
  try {
    if (data.length < 24) return null;

    // IHDR is first chunk after signature (8 bytes)
    // Chunk format: length (4) + type (4) + data + CRC (4)
    const width = data.readUInt32BE(16);
    const height = data.readUInt32BE(20);

    // Detect alpha channel:
    // Color type at offset 25
    // 2=RGB, 3=indexed, 4=grayscale+alpha, 6=RGBA
    const colorType = data[25];
    const hasAlpha = colorType === 4 || colorType === 6;

    return { width, height, hasAlpha };
  } catch {
    return null;
  }
}

/**
 * Parse JPEG dimensions from SOF (Start Of Frame) marker.
 * JPEG markers: FF D9 = EOI, FF D8 = SOI, FF C0/C2 = SOF
 */
function parseJPEG(data: Buffer): Omit<ImageMetadata, "mimeType" | "format"> | null {
  try {
    let offset = 2; // Skip SOI marker (FF D8)
    while (offset < data.length - 8) {
      // Look for marker
      if (data[offset] !== 0xff) {
        offset++;
        continue;
      }

      const marker = data[offset + 1];

      // SOF markers: C0 (baseline), C1, C2 (progressive)
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        // Height at offset+5, width at offset+7
        if (offset + 9 > data.length) return null;
        const height = data.readUInt16BE(offset + 5);
        const width = data.readUInt16BE(offset + 7);
        return { width, height, hasAlpha: false }; // JPEG never has alpha
      }

      // Skip this segment: length is 2 bytes after marker
      if (offset + 4 > data.length) break;
      const segmentLength = data.readUInt16BE(offset + 2);
      offset += segmentLength + 2;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Parse WebP dimensions from VP8/VP8L/VP8X chunk.
 * WebP format: RIFF header + WEBP signature + VP8/VP8L/VP8X chunk
 */
function parseWebP(data: Buffer): Omit<ImageMetadata, "mimeType" | "format"> | null {
  try {
    if (data.length < 30) return null;

    let offset = 12; // Skip RIFF + size + WEBP
    while (offset + 8 <= data.length) {
      const chunkFourCC = data.slice(offset, offset + 4).toString("ascii");
      const chunkSize = data.readUInt32LE(offset + 4);

      if (chunkFourCC === "VP8X") {
        // Extended format with features at offset+8
        const flags = data[offset + 8];
        const hasAlpha = (flags & 0x10) !== 0;

        // Canvas width/height: 24-bit values at offset+12 and +15 (little-endian)
        const width = (data.readUInt32LE(offset + 12) & 0xffffff) + 1;
        const height = (data.readUInt32LE(offset + 15) & 0xffffff) + 1;
        return { width, height, hasAlpha };
      }

      if (chunkFourCC === "VP8 ") {
        // Lossy format: dimensions in bitstream
        // Frame header starts at offset+10, use simple heuristic
        if (offset + 30 > data.length) return null;
        const width = data.readUInt16LE(offset + 12) & 0x3fff;
        const height = data.readUInt16LE(offset + 14) & 0x3fff;
        return { width: width + 1, height: height + 1, hasAlpha: false };
      }

      if (chunkFourCC === "VP8L") {
        // Lossless format: width/height in first 8 bytes of chunk data
        if (offset + 12 > data.length) return null;
        const bits = data.readUInt32LE(offset + 8);
        const width = ((bits & 0x3fff) + 1) || 1;
        const height = (((bits >> 14) & 0x3fff) + 1) || 1;

        // Lossless WebP may have alpha
        const hasAlpha = (bits >> 28) & 0x1;
        return { width, height, hasAlpha: !!hasAlpha };
      }

      offset += chunkSize + 8;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Validate an image file for use in video composition.
 */
export function validateImageFile(
  buffer: Buffer,
  mimeType: string,
  constraints: Partial<ImageAssetConstraints> = {}
): ImageValidation {
  const limits = { ...DEFAULT_IMAGE_CONSTRAINTS, ...constraints };

  // Check MIME type
  if (!limits.allowedMimeTypes.has(mimeType)) {
    return {
      valid: false,
      reason: `Image type ${mimeType} not supported. Allowed: PNG, JPEG, WebP`,
    };
  }

  // Check file size
  if (buffer.length > limits.maxFileSizeBytes) {
    return {
      valid: false,
      reason: `Image size ${formatBytes(buffer.length)} exceeds maximum ${formatBytes(limits.maxFileSizeBytes)}`,
    };
  }

  // Detect metadata
  const metadata = detectImageMetadata(buffer, mimeType);
  if (!metadata) {
    return {
      valid: false,
      reason: "Unable to parse image format or invalid image data",
    };
  }

  // Check dimensions
  if (metadata.width < limits.minWidth || metadata.height < limits.minHeight) {
    return {
      valid: false,
      reason: `Image dimensions ${metadata.width}x${metadata.height} below minimum ${limits.minWidth}x${limits.minHeight}`,
    };
  }

  if (metadata.width > limits.maxWidth || metadata.height > limits.maxHeight) {
    return {
      valid: false,
      reason: `Image dimensions ${metadata.width}x${metadata.height} exceed maximum ${limits.maxWidth}x${limits.maxHeight}`,
    };
  }

  return { valid: true, metadata };
}

/**
 * Format bytes to human-readable string (KB, MB, GB).
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = (bytes / Math.pow(k, i)).toFixed(2).replace(/\.?0+$/, "");
  return `${value} ${sizes[i]}`;
}

/**
 * Sanitize asset key for safe filesystem use.
 * Allows alphanumeric, hyphen, underscore.
 */
export function sanitizeAssetKey(key: string): string {
  return key.replace(/[^a-z0-9_-]/gi, "_").slice(0, 64);
}

/**
 * Get file extension from MIME type.
 */
export function getExtensionFromMimeType(mimeType: string): string {
  const ext = mimeType.split("/")[1];
  if (!ext || ext === "octet-stream") return "bin";
  if (ext === "jpeg") return "jpg";
  return ext;
}

/**
 * Validate asset key format.
 */
export function validateAssetKey(key: string): { valid: boolean; reason?: string } {
  if (!key || key.length === 0) {
    return { valid: false, reason: "Asset key cannot be empty" };
  }
  if (key.length > 64) {
    return { valid: false, reason: "Asset key cannot exceed 64 characters" };
  }
  if (!/^[a-z0-9_-]+$/i.test(key)) {
    return { valid: false, reason: "Asset key must contain only alphanumeric characters, hyphens, and underscores" };
  }
  return { valid: true };
}

/**
 * Validate asset type.
 */
export function validateAssetType(type: string): { valid: boolean; reason?: string } {
  const validTypes: AssetType[] = ["OVERLAY", "BACKGROUND", "LOGO", "FONT"];
  if (!validTypes.includes(type as AssetType)) {
    return { valid: false, reason: `Asset type must be one of: ${validTypes.join(", ")}` };
  }
  return { valid: true };
}
