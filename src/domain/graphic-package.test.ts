import { describe, expect, it } from "vitest";
import { createGraphicPackage, parseGraphicPackage } from "@/domain/graphic-package";

describe("graphic package", () => {
  const graphic = { id: "g1", name: "Opening", width: 1920, height: 1080, backgroundColor: "#111111", layers: [] };
  const asset = { sourceAssetId: "a1", contentHash: "a".repeat(64), assetKey: "logo", mimeType: "image/png", width: 100, height: 100, hasAlpha: true, dataBase64: "AA==" };

  it("writes a versioned manifest", () => {
    const pkg = createGraphicPackage(graphic, [asset]);
    expect(pkg.format).toBe("saarnavideo-graphic");
    expect(pkg.version).toBe(1);
  });

  it("rejects unknown package versions", () => {
    expect(() => parseGraphicPackage({ format: "saarnavideo-graphic", version: 2, exportedAt: new Date().toISOString(), graphic, assets: [] })).toThrow();
  });
});
