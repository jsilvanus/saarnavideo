import { describe, expect, it } from "vitest";
import {
  detectImageMetadata,
  validateImageFile,
  sanitizeAssetKey,
  validateAssetKey,
  validateAssetType,
  formatBytes,
  getExtensionFromMimeType,
  DEFAULT_IMAGE_CONSTRAINTS,
} from "./image-assets";

describe("Image Asset Utilities", () => {
  // PNG test data: valid 1x1 red PNG
  const pngData = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
    0x00, 0x00, 0x00, 0x0d, // IHDR chunk length (13 bytes)
    0x49, 0x48, 0x44, 0x52, // IHDR
    0x00, 0x00, 0x00, 0x01, // width: 1
    0x00, 0x00, 0x00, 0x01, // height: 1
    0x08, 0x06, // 8-bit RGBA
    0x00, 0x00, 0x00,
  ]);

  // Simple JPEG data (minimal valid JPEG with SOF)
  const jpegData = Buffer.from([
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x10, // APP0 marker
    0x4a, 0x46, 0x49, 0x46, 0x00, // JFIF signature
    0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // JFIF data
    0xff, 0xc0, // SOF0 (baseline)
    0x00, 0x11, // SOF segment length
    0x08, // 8-bit precision
    0x00, 0x64, // height: 100
    0x00, 0x64, // width: 100
    0x03, // 3 components (YCbCr)
    0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, // Component data
  ]);

  describe("detectImageMetadata", () => {
    it("detects PNG format with correct dimensions", () => {
      const metadata = detectImageMetadata(pngData, "image/png");
      expect(metadata).toBeDefined();
      expect(metadata?.format).toBe("png");
      expect(metadata?.width).toBe(1);
      expect(metadata?.height).toBe(1);
      expect(metadata?.hasAlpha).toBe(true); // RGBA
    });

    it("detects JPEG format with correct dimensions", () => {
      const metadata = detectImageMetadata(jpegData, "image/jpeg");
      expect(metadata).toBeDefined();
      expect(metadata?.format).toBe("jpeg");
      expect(metadata?.width).toBe(100);
      expect(metadata?.height).toBe(100);
      expect(metadata?.hasAlpha).toBe(false);
    });

    it("rejects invalid data", () => {
      const invalidData = Buffer.from([0x00, 0x00, 0x00, 0x00]);
      const metadata = detectImageMetadata(invalidData, "image/png");
      expect(metadata).toBeNull();
    });

    it("returns null for unsupported formats", () => {
      const bmpData = Buffer.from([0x42, 0x4d]); // BMP signature
      const metadata = detectImageMetadata(bmpData, "image/bmp");
      expect(metadata).toBeNull();
    });
  });

  describe("validateImageFile", () => {
    it("validates correct JPEG file", () => {
      const result = validateImageFile(jpegData, "image/jpeg");
      expect(result.valid).toBe(true);
      expect(result.metadata).toBeDefined();
    });

    it("rejects unsupported MIME type", () => {
      const result = validateImageFile(Buffer.from("test"), "image/bmp");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("not supported");
    });

    it("rejects oversized file", () => {
      const largeBuffer = Buffer.alloc(DEFAULT_IMAGE_CONSTRAINTS.maxFileSizeBytes + 1);
      const result = validateImageFile(largeBuffer, "image/png");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("exceeds maximum");
    });

    it("rejects invalid image data", () => {
      const invalidData = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG signature but incomplete
      const result = validateImageFile(invalidData, "image/png");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Unable to parse");
    });

    it("rejects dimensions below minimum", () => {
      // Create a minimal PNG with small dimensions
      const tinyData = Buffer.alloc(24);
      tinyData[0] = 0x89;
      tinyData[1] = 0x50;
      tinyData[2] = 0x4e;
      tinyData[3] = 0x47;
      tinyData[16] = 0x00;
      tinyData[17] = 0x00;
      tinyData[18] = 0x00;
      tinyData[19] = 0x01; // width: 1
      tinyData[20] = 0x00;
      tinyData[21] = 0x00;
      tinyData[22] = 0x00;
      tinyData[23] = 0x01; // height: 1
      tinyData[25] = 0x06; // RGBA

      const result = validateImageFile(tinyData, "image/png");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("below minimum");
    });

    it("respects custom constraints", () => {
      const result = validateImageFile(pngData, "image/png", {
        maxFileSizeBytes: 1, // 1 byte max
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("exceeds maximum");
    });
  });

  describe("sanitizeAssetKey", () => {
    it("allows valid alphanumeric keys", () => {
      expect(sanitizeAssetKey("logo")).toBe("logo");
      expect(sanitizeAssetKey("Gospel_Overlay")).toBe("Gospel_Overlay");
      expect(sanitizeAssetKey("bg-image-1")).toBe("bg-image-1");
    });

    it("removes invalid characters", () => {
      expect(sanitizeAssetKey("logo@church")).toBe("logo_church");
      expect(sanitizeAssetKey("Gospel/Text")).toBe("Gospel_Text");
      expect(sanitizeAssetKey("my image!")).toBe("my_image_");
    });

    it("limits length to 64 characters", () => {
      const long = "a".repeat(100);
      const result = sanitizeAssetKey(long);
      expect(result.length).toBe(64);
    });
  });

  describe("validateAssetKey", () => {
    it("accepts valid keys", () => {
      expect(validateAssetKey("logo").valid).toBe(true);
      expect(validateAssetKey("Gospel_Overlay").valid).toBe(true);
      expect(validateAssetKey("bg-image-1").valid).toBe(true);
    });

    it("rejects empty key", () => {
      const result = validateAssetKey("");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("cannot be empty");
    });

    it("rejects keys exceeding 64 characters", () => {
      const result = validateAssetKey("a".repeat(65));
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("exceed 64 characters");
    });

    it("rejects keys with invalid characters", () => {
      const result = validateAssetKey("logo@church");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("alphanumeric");
    });
  });

  describe("validateAssetType", () => {
    it("accepts valid asset types", () => {
      expect(validateAssetType("OVERLAY").valid).toBe(true);
      expect(validateAssetType("BACKGROUND").valid).toBe(true);
      expect(validateAssetType("LOGO").valid).toBe(true);
      expect(validateAssetType("FONT").valid).toBe(true);
    });

    it("rejects invalid asset types", () => {
      const result = validateAssetType("INVALID");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("must be one of");
    });
  });

  describe("formatBytes", () => {
    it("formats zero bytes", () => {
      expect(formatBytes(0)).toBe("0 B");
    });

    it("formats bytes", () => {
      expect(formatBytes(512)).toBe("512 B");
    });

    it("formats kilobytes", () => {
      expect(formatBytes(1024)).toBe("1 KB");
      expect(formatBytes(2048)).toBe("2 KB");
    });

    it("formats megabytes", () => {
      expect(formatBytes(1024 * 1024)).toBe("1 MB");
      expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
    });

    it("formats gigabytes", () => {
      expect(formatBytes(1024 * 1024 * 1024)).toBe("1 GB");
    });

    it("removes trailing zeros", () => {
      expect(formatBytes(1536)).toBe("1.5 KB");
      expect(formatBytes(1572864)).toBe("1.5 MB");
    });
  });

  describe("getExtensionFromMimeType", () => {
    it("extracts extension from PNG", () => {
      expect(getExtensionFromMimeType("image/png")).toBe("png");
    });

    it("extracts extension from JPEG", () => {
      expect(getExtensionFromMimeType("image/jpeg")).toBe("jpg");
    });

    it("extracts extension from WebP", () => {
      expect(getExtensionFromMimeType("image/webp")).toBe("webp");
    });

    it("returns bin for unknown types", () => {
      expect(getExtensionFromMimeType("application/octet-stream")).toBe("bin");
    });
  });
});

describe("PNG Metadata Detection", () => {
  it("detects PNG with alpha channel (RGBA)", () => {
    const pngRGBA = Buffer.alloc(26);
    pngRGBA[0] = 0x89;
    pngRGBA[1] = 0x50;
    pngRGBA[2] = 0x4e;
    pngRGBA[3] = 0x47;
    // IHDR chunk
    pngRGBA.writeUInt32BE(1, 16); // width
    pngRGBA.writeUInt32BE(1, 20); // height
    pngRGBA[25] = 0x06; // RGBA
    
    const metadata = detectImageMetadata(pngRGBA, "image/png");
    expect(metadata?.hasAlpha).toBe(true);
  });

  it("detects PNG without alpha channel (RGB)", () => {
    const pngRGB = Buffer.alloc(26);
    pngRGB[0] = 0x89;
    pngRGB[1] = 0x50;
    pngRGB[2] = 0x4e;
    pngRGB[3] = 0x47;
    // IHDR chunk
    pngRGB.writeUInt32BE(1, 16); // width
    pngRGB.writeUInt32BE(1, 20); // height
    pngRGB[25] = 0x02; // RGB
    
    const metadata = detectImageMetadata(pngRGB, "image/png");
    expect(metadata?.hasAlpha).toBe(false);
  });
});
