import { normalizeHex } from "@/domain/palettes";

/** Layer style key that holds the colour map of an SVG image layer, as JSON: `{"#000000":"#00a94f"}`. */
export const SVG_RECOLOR_STYLE_KEY = "svg-recolor";

export const MAX_SVG_BYTES = 2 * 1024 * 1024;

export type SvgCheck = { ok: true; svg: string; width: number; height: number } | { ok: false; reason: string };

const FORBIDDEN: Array<[RegExp, string]> = [
  [/<\s*script/i, "script elements"],
  [/<\s*foreignObject/i, "foreignObject"],
  [/<\s*(iframe|embed|object|audio|video)\b/i, "embedded content"],
  [/<!\s*ENTITY/i, "entity declarations"],
  [/\son[a-z]+\s*=/i, "event handler attributes"],
  [/javascript\s*:/i, "javascript: links"],
];

/** Parses a length such as `120`, `120px` or `12.5`; undefined for percentages, other units and junk. */
function pixels(value: string | undefined): number | undefined {
  const match = value?.trim().match(/^(\d+(?:\.\d+)?)(?:px)?$/i);
  return match ? Number(match[1]) : undefined;
}

/**
 * Checks an uploaded SVG for the library: it must be a plain `<svg>` with a known size and nothing that runs or
 * fetches (scripts, foreignObject, event handlers, entities, links to anything but `#id` or inline data images). Returns
 * the text unchanged; this is a check, not a rewrite, so what is stored is what the user uploaded.
 */
export function checkSvg(text: string): SvgCheck {
  if (Buffer.byteLength(text) > MAX_SVG_BYTES) return { ok: false, reason: "SVG is too large" };
  const root = text.match(/<svg\b([^>]*)>/i);
  if (!root) return { ok: false, reason: "Not an SVG file" };
  for (const [pattern, what] of FORBIDDEN) if (pattern.test(text)) return { ok: false, reason: `SVG contains ${what}, which is not allowed` };
  for (const match of text.matchAll(/(?:xlink:)?href\s*=\s*["']([^"']*)["']/gi)) {
    const target = match[1].trim();
    if (!target.startsWith("#") && !/^data:image\/(png|jpeg|webp|gif);base64,/i.test(target)) return { ok: false, reason: "SVG links to something outside the file, which is not allowed" };
  }
  if (/url\(\s*["']?\s*(?!#)[^)]/i.test(text.replace(/url\(\s*["']?\s*data:image\/[^)]*\)/gi, ""))) return { ok: false, reason: "SVG refers to something outside the file, which is not allowed" };
  const attrs = root[1];
  const read = (name: string) => attrs.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1];
  let width = pixels(read("width"));
  let height = pixels(read("height"));
  const box = read("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if ((width === undefined || height === undefined) && box?.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0) {
    if (width === undefined && height === undefined) { width = box[2]; height = box[3]; }
    else if (width === undefined) width = (height as number) * (box[2] / box[3]);
    else height = width * (box[3] / box[2]);
  }
  if (!width || !height || width <= 0 || height <= 0) return { ok: false, reason: "SVG needs a viewBox or a width and a height" };
  return { ok: true, svg: text, width: Math.round(width), height: Math.round(height) };
}

const hex = normalizeHex;

const COLOR_PATTERN = /(#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b)/g;

/** The distinct hex colours used in `fill`, `stroke`, `stop-color` and `style` values, in order of first use. */
export function svgColors(svg: string): string[] {
  const found: string[] = [];
  const add = (value: string) => { const normal = hex(value); if (normal && !found.includes(normal)) found.push(normal); };
  for (const match of svg.matchAll(/\b(?:fill|stroke|stop-color|flood-color)\s*[=:]\s*["']?\s*(#[0-9a-fA-F]{3,6})\b/g)) add(match[1]);
  // Named black is what an SVG without a fill paints with, so it is offered when nothing else says what the colour is.
  if (!found.length && /<(path|rect|circle|ellipse|polygon|polyline|line|text)\b/i.test(svg)) found.push("#000000");
  return found;
}

/** Replaces colours in paint values (`fill`, `stroke`, `stop-color`, `flood-color`) by the map's targets; other text stays as written. */
export function recolorSvg(svg: string, map: Record<string, string>): string {
  const lookup = new Map<string, string>();
  for (const [from, to] of Object.entries(map)) { const a = hex(from), b = hex(to); if (a && b) lookup.set(a, b); }
  if (!lookup.size) return svg;
  const swap = (value: string) => value.replace(COLOR_PATTERN, color => lookup.get(hex(color) ?? "") ?? color);
  let out = svg.replace(/(\b(?:fill|stroke|stop-color|flood-color)\s*=\s*["']\s*)(#[0-9a-fA-F]{3,6})(\s*["'])/g, (_m, a, color, c) => `${a}${swap(color)}${c}`);
  out = out.replace(/(\b(?:fill|stroke|stop-color|flood-color)\s*:\s*)(#[0-9a-fA-F]{3,6})\b/g, (_m, a, color) => `${a}${swap(color)}`);
  // An SVG whose only colour is the implicit black: paint it by a fill on the root so the map still has an effect.
  const black = lookup.get("#000000");
  if (black && !svgColors(svg).some(color => color !== "#000000") && !/\bfill\s*[=:]/i.test(svg)) out = out.replace(/<svg\b/i, `<svg fill="${black}"`);
  return out;
}

/** Reads a layer's colour map from its style; empty when missing or invalid. */
export function layerRecolor(style: Record<string, unknown> | undefined): Record<string, string> {
  const raw = style?.[SVG_RECOLOR_STYLE_KEY];
  if (typeof raw !== "string" || !raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [from, to] of Object.entries(parsed as Record<string, unknown>)) { const a = hex(from), b = typeof to === "string" ? hex(to) : undefined; if (a && b && a !== b) out[a] = b; }
    return out;
  } catch { return {}; }
}
