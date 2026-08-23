import { describe, expect, it } from "vitest";
import { detectImageMetadata, validateImageFile, validateSvgFile, sanitizeAssetKey, validateAssetKey, validateAssetType, formatBytes, getExtensionFromMimeType, DEFAULT_IMAGE_CONSTRAINTS } from "./image-assets";

describe("SVG asset validation", () => {
  it("accepts a basic SVG", () => expect(validateSvgFile(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100"/></svg>')).valid).toBe(true));
  it("rejects executable SVG content", () => {
    expect(validateSvgFile(Buffer.from('<svg><script>alert(1)</script></svg>')).valid).toBe(false);
    expect(validateSvgFile(Buffer.from('<svg><rect onclick="alert(1)"/></svg>')).valid).toBe(false);
    expect(validateSvgFile(Buffer.from('<svg><image href="https://evil.example/a"/></svg>')).valid).toBe(false);
  });
});

describe("Image Asset Utilities", () => {
  const pngData = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0x0d,0x49,0x48,0x44,0x52,0,0,0,1,0,0,0,1,8,6,0,0,0]);
  const jpegData = Buffer.from([0xff,0xd8,0xff,0xe0,0,0x10,0x4a,0x46,0x49,0x46,0,1,1,0,0,1,0,1,0,0,0xff,0xc0,0,0x11,8,0,0x64,0,0x64,3,1,0x11,0,2,0x11,1,3,0x11,1]);
  describe("detectImageMetadata", () => {
    it("detects PNG", () => { const m = detectImageMetadata(pngData, "image/png"); expect(m?.format).toBe("png"); expect(m?.width).toBe(1); expect(m?.height).toBe(1); expect(m?.hasAlpha).toBe(true); });
    it("detects JPEG", () => { const m = detectImageMetadata(jpegData, "image/jpeg"); expect(m?.format).toBe("jpeg"); expect(m?.width).toBe(100); expect(m?.height).toBe(100); expect(m?.hasAlpha).toBe(false); });
    it("rejects invalid data", () => expect(detectImageMetadata(Buffer.from([0,0,0,0]), "image/png")).toBeNull());
  });
  describe("validateImageFile", () => {
    it("validates JPEG", () => expect(validateImageFile(jpegData, "image/jpeg").valid).toBe(true));
    it("rejects unsupported MIME", () => expect(validateImageFile(Buffer.from("test"), "image/bmp").valid).toBe(false));
    it("rejects oversized files", () => expect(validateImageFile(Buffer.alloc(DEFAULT_IMAGE_CONSTRAINTS.maxFileSizeBytes + 1), "image/png").valid).toBe(false));
    it("rejects invalid image data", () => expect(validateImageFile(Buffer.from([0x89,0x50,0x4e,0x47]), "image/png").valid).toBe(false));
  });
  describe("asset helpers", () => {
    it("sanitizes keys", () => expect(sanitizeAssetKey("logo@church")).toBe("logo_church"));
    it("validates keys", () => { expect(validateAssetKey("logo").valid).toBe(true); expect(validateAssetKey("logo@church").valid).toBe(false); });
    it("validates types", () => { expect(validateAssetType("LOGO").valid).toBe(true); expect(validateAssetType("INVALID").valid).toBe(false); });
    it("formats bytes", () => { expect(formatBytes(0)).toBe("0 B"); expect(formatBytes(1024)).toBe("1 KB"); expect(formatBytes(1024 * 1024)).toBe("1 MB"); });
    it("gets SVG extension", () => expect(getExtensionFromMimeType("image/svg+xml")).toBe("svg"));
  });
});
