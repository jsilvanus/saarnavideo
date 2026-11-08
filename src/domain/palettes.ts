/**
 * Colour palettes offered in the graphics editor.
 *
 * `church2024` is the accessible palette of the Evangelical Lutheran Church of Finland's renewed guidelines
 * ("Värit ja saavutettavuus", Colours_EVL.pdf, evl.fi/plus, December 2024): eight colour groups based on the liturgical
 * colours, each with a dark shade, the main colour ("paletin pääväri"), a light and a lightest shade, chosen so the
 * suggested pairings reach WCAG AA (most AAA). Black and white are the yellow and gold groups' extremes.
 *
 * `church` is the older palette (Graafinen ohjeistus 2019, chapter 4 "Värit"), kept so graphics made with it still
 * show their colour names.
 *
 * `liturgical` are the colours of the church year (white, green, violet, red, black) written with the main colours of
 * the 2024 palette. Which colour belongs to which Sunday is church-year data, not
 * part of this table.
 */
export type PaletteColor = { name: string; hex: string };
export type Palette = { key: "church2024" | "church" | "liturgical" | "neutral"; name: string; colors: PaletteColor[] };

export const PALETTES: Palette[] = [
  {
    key: "church2024",
    name: "Kirkon värit 2024",
    colors: [
      { name: "Sininen tumma", hex: "#112077" },
      { name: "Sininen", hex: "#1d36c6" },
      { name: "Sininen vaalea", hex: "#4daae6" },
      { name: "Sininen vaalein", hex: "#e5f3fa" },
      { name: "Musta", hex: "#000000" },
      { name: "Keltainen", hex: "#ffde00" },
      { name: "Keltainen vaalea", hex: "#fff299" },
      { name: "Keltainen vaalein", hex: "#fffada" },
      { name: "Oranssi tumma", hex: "#c24700" },
      { name: "Oranssi", hex: "#ff8429" },
      { name: "Oranssi vaalea", hex: "#ffa766" },
      { name: "Oranssi vaalein", hex: "#fff9f2" },
      { name: "Purppura tumma", hex: "#601c4d" },
      { name: "Purppura", hex: "#942e75" },
      { name: "Purppura vaalea", hex: "#eeb6dd" },
      { name: "Purppura vaalein", hex: "#ffece4" },
      { name: "Punainen tumma", hex: "#9a0a27" },
      { name: "Punainen", hex: "#eb0f3b" },
      { name: "Punainen vaalea", hex: "#f9b2c0" },
      { name: "Punainen vaalein", hex: "#ffedf7" },
      { name: "Vihreä tumma", hex: "#005e2c" },
      { name: "Vihreä", hex: "#028342" },
      { name: "Vihreä vaalea", hex: "#b4dec7" },
      { name: "Vihreä vaalein", hex: "#e9f5ee" },
      { name: "Lime tummin", hex: "#004718" },
      { name: "Lime tumma", hex: "#3f841f" },
      { name: "Lime", hex: "#93b93b" },
      { name: "Lime vaalea", hex: "#f4f8eb" },
      { name: "Kulta tumma", hex: "#554728" },
      { name: "Kulta", hex: "#7f6a3d" },
      { name: "Kulta vaalea", hex: "#f3eee7" },
      { name: "Valkoinen", hex: "#ffffff" },
    ],
  },
  {
    key: "church",
    name: "Kirkon värit 2019",
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
      { name: "Vihreä", hex: "#028342" },
      { name: "Violetti", hex: "#942e75" },
      { name: "Punainen", hex: "#eb0f3b" },
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
