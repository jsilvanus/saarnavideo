import { describe, expect, it } from "vitest";
import { findPaletteColor, normalizeHex, PALETTES } from "./palettes";

describe("palettes", () => {
  it("holds the eight colours of the church guideline", () => {
    expect(PALETTES.find(p => p.key === "church")?.colors.map(c => c.hex)).toEqual(
      ["#00a94f", "#ef453d", "#f78e00", "#ffd600", "#93b93b", "#0085cf", "#a9489b", "#823f8d"]);
  });
  it("normalises hex values", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex(" #00A94F ")).toBe("#00a94f");
    expect(normalizeHex("rgba(0,0,0,0.5)")).toBeUndefined();
    expect(normalizeHex(undefined)).toBeUndefined();
  });
  it("finds a palette colour by value", () => {
    expect(findPaletteColor("#00A94F")?.name).toBe("Vihreä");
    expect(findPaletteColor("#123456")).toBeUndefined();
  });
  it("uses valid unique hex values", () => {
    for (const p of PALETTES) {
      const hexes = p.colors.map(c => normalizeHex(c.hex));
      expect(hexes.every(Boolean)).toBe(true);
      expect(new Set(hexes).size).toBe(hexes.length);
    }
  });
});
