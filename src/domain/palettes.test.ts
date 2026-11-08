import { describe, expect, it } from "vitest";
import { findPaletteColor, normalizeHex, PALETTES } from "./palettes";

describe("palettes", () => {
  it("holds the eight colours of the church guideline", () => {
    expect(PALETTES.find(p => p.key === "church")?.colors.map(c => c.hex)).toEqual(
      ["#00a94f", "#ef453d", "#f78e00", "#ffd600", "#93b93b", "#0085cf", "#a9489b", "#823f8d"]);
  });
  it("holds the 2024 accessible palette: eight groups of four shades, main colours from the guideline", () => {
    const colors = PALETTES.find(p => p.key === "church2024")?.colors ?? [];
    expect(colors).toHaveLength(32);
    for (const [name, hex] of [["Sininen", "#1d36c6"], ["Keltainen", "#ffde00"], ["Oranssi", "#ff8429"], ["Purppura", "#942e75"], ["Punainen", "#eb0f3b"], ["Vihreä", "#028342"], ["Lime", "#93b93b"], ["Kulta", "#7f6a3d"]]) {
      expect(colors.find(c => c.name === name)?.hex).toBe(hex);
    }
  });
  it("normalises hex values", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex(" #00A94F ")).toBe("#00a94f");
    expect(normalizeHex("rgba(0,0,0,0.5)")).toBeUndefined();
    expect(normalizeHex(undefined)).toBeUndefined();
  });
  it("finds a palette colour by value", () => {
    expect(findPaletteColor("#028342")?.name).toBe("Vihreä");
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
