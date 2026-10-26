/**
 * Colour palettes offered in the graphics editor.
 *
 * `church` is the palette of the Evangelical Lutheran Church of Finland's graphic guidelines
 * (Graafinen ohjeistus 2019, chapter 4 "Värit", evl.fi): the church's general colour is green, each use picks one
 * main colour and uses the others as accents. The guideline was renewed in 2024 with an accessible palette; its
 * values were not found online, so replace or extend this table when they are at hand.
 *
 * `liturgical` are the colours of the church year (white, green, violet, red, black) written with the church's own
 * green, red and purple where the palette has one. Which colour belongs to which Sunday is church-year data, not
 * part of this table.
 */
export type PaletteColor = { name: string; hex: string };
export type Palette = { key: "church" | "liturgical" | "neutral"; name: string; colors: PaletteColor[] };

export const PALETTES: Palette[] = [
  {
    key: "church",
    name: "Kirkon värit",
    colors: [
      { name: "Vihreä", hex: "#00a94f" },
      { name: "Punainen", hex: "#ef453d" },
      { name: "Oranssi", hex: "#f78e00" },
      { name: "Keltainen", hex: "#ffd600" },
      { name: "Lime", hex: "#93b93b" },
      { name: "Sininen", hex: "#0085cf" },
      { name: "Purppura", hex: "#a9489b" },
      { name: "Tumma purppura", hex: "#823f8d" },
    ],
  },
  {
    key: "liturgical",
    name: "Liturgiset värit",
    colors: [
      { name: "Valkoinen", hex: "#ffffff" },
      { name: "Vihreä", hex: "#00a94f" },
      { name: "Violetti", hex: "#823f8d" },
      { name: "Punainen", hex: "#ef453d" },
      { name: "Musta", hex: "#000000" },
    ],
  },
  {
    key: "neutral",
    name: "Mustavalkoinen",
    colors: [
      { name: "Valkoinen", hex: "#ffffff" },
      { name: "Vaaleanharmaa", hex: "#d1d5db" },
      { name: "Keskiharmaa", hex: "#6b7280" },
      { name: "Tummanharmaa", hex: "#1f2937" },
      { name: "Musta", hex: "#000000" },
    ],
  },
];

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `#abc` and `#aabbcc` as lower-case `#rrggbb`; undefined for anything else (names, rgba, empty). */
export function normalizeHex(value: string | undefined): string | undefined {
  const v = value?.trim();
  if (!v || !HEX.test(v)) return undefined;
  const h = v.slice(1).toLowerCase();
  return h.length === 3 ? `#${[...h].map(c => c + c).join("")}` : `#${h}`;
}

/** The palette colour with this value, if any (compared as normalised hex). */
export function findPaletteColor(value: string | undefined, palettes: Palette[] = PALETTES): PaletteColor | undefined {
  const hex = normalizeHex(value);
  if (!hex) return undefined;
  for (const palette of palettes) {
    const found = palette.colors.find(c => c.hex === hex);
    if (found) return found;
  }
  return undefined;
}
