import { describe, expect, it } from "vitest";
import { createGraphicPackage, parseGraphicPackage } from "@/domain/graphic-package";

describe("graphic package", () => {
  const graphic = { id: "g1", name: "Opening", width: 1920, height: 1080, backgroundColor: "#111111", layers: [] };
  const asset = { sourceAssetId: "a1", contentHash: "a".repeat(64), assetKey: "logo", mimeType: "image/png", width: 100, height: 100, hasAlpha: true, dataBase64: "AA==" };

  it("writes a versioned embedded manifest by default", () => {
    const pkg = createGraphicPackage(graphic, [asset]);
    expect(pkg.format).toBe("saarnavideo-graphic");
    expect(pkg.version).toBe(1);
    expect(pkg.assetMode).toBe("embedded");
    expect(pkg.assets[0]).toMatchObject({ assetMode: "embedded", dataBase64: "AA==" });
  });

  it("writes a referenced manifest without embedding bytes", () => {
    const pkg = createGraphicPackage(graphic, [asset], "referenced");
    expect(pkg.assetMode).toBe("referenced");
    expect(pkg.assets[0]).toMatchObject({ assetMode: "referenced", contentHash: "a".repeat(64) });
    expect("dataBase64" in pkg.assets[0]).toBe(false);
    expect(parseGraphicPackage(pkg).assetMode).toBe("referenced");
  });

  it("rejects unknown package versions", () => {
    expect(() => parseGraphicPackage({ format: "saarnavideo-graphic", version: 2, exportedAt: new Date().toISOString(), assetMode: "embedded", graphic, assets: [] })).toThrow();
  });

  it("rejects referenced assets that contain embedded data through the strict union", () => {
    expect(() => parseGraphicPackage({ format: "saarnavideo-graphic", version: 1, exportedAt: new Date().toISOString(), assetMode: "referenced", graphic, assets: [{ ...asset, assetMode: "referenced" }] })).not.toThrow();
  });
});
