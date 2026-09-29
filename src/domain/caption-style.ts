import type { Graphic, GraphicLayer } from "@/domain/graphics";

/**
 * Caption styles are ordinary graphics that contain a layer of type "caption".
 * The layer is a placeholder text box: its position/size (in the graphic's own
 * coordinate space, 1920x1080 by default) is the area burned-in captions are
 * laid out in, and its `style` map carries the look. Recognised style keys
 * (all optional, CSS-like like every other layer):
 *
 *   font-family, font-size ("56px"), font-weight ("700"/"bold"), color,
 *   text-align (left|center|right), vertical-align (top|middle|bottom),
 *   background (box colour behind the text, any CSS colour incl. rgba()),
 *   padding (px, box padding around the text),
 *   text-shadow ("0 2px 4px #000": second number = shadow depth),
 *   -webkit-text-stroke ("2px #000": outline; ignored when a background box is set),
 *   max-lines (integer), opacity (0..1, multiplies text and box).
 */
export const CAPTION_LAYER_TYPE = "caption" as const;
export const CAPTION_SAMPLE_TEXT = "Esimerkkiteksti";
export const DEFAULT_CAPTION_FONT = "DejaVu Sans";

export type CaptionStyle = {
  /** Caption box in output-video pixels. */
  x: number; y: number; width: number; height: number;
  fontFamily: string;
  /** Font size in output-video pixels (CSS px of the graphic scaled to the video). */
  fontSize: number;
  bold: boolean;
  color: RGBA;
  align: "left" | "center" | "right";
  vertical: "top" | "middle" | "bottom";
  /** Background box behind the text; null = none. */
  box: RGBA | null;
  padding: number;
  outline: { width: number; color: RGBA } | null;
  shadow: { depth: number; color: RGBA } | null;
  maxLines: number;
};

export type RGBA = { r: number; g: number; b: number; /** 0..1 */ a: number };

export function isCaptionLayer(layer: Pick<GraphicLayer, "type">): boolean {
  return layer.type === CAPTION_LAYER_TYPE;
}

/** The first caption layer of a graphic, if it is a caption style. */
export function findCaptionLayer(graphic: Pick<Graphic, "layers"> | undefined | null): GraphicLayer | undefined {
  return graphic?.layers.find(isCaptionLayer);
}

export function isCaptionStyleGraphic(graphic: Pick<Graphic, "layers">): boolean {
  return !!findCaptionLayer(graphic);
}

/** Layer for a fresh caption style: bottom-centre, white text, semi-transparent black box. */
export function createCaptionLayer(id = "caption"): GraphicLayer {
  return {
    id, type: CAPTION_LAYER_TYPE, x: 160, y: 820, width: 1600, height: 200, rotation: 0, text: CAPTION_SAMPLE_TEXT,
    style: {
      "font-family": DEFAULT_CAPTION_FONT, "font-size": "56px", "font-weight": "700", color: "#ffffff",
      "text-align": "center", "vertical-align": "bottom", background: "rgba(0,0,0,0.6)", padding: "12px",
      "max-lines": 2,
    },
  };
}

/** Built-in style used when the user has not made one. */
export const DEFAULT_CAPTION_LAYER: GraphicLayer = createCaptionLayer("default-caption");

export function createCaptionGraphic(id: string, name: string, width = 1920, height = 1080): Graphic {
  return { id, name, width, height, backgroundColor: "transparent", layers: [createCaptionLayer()] };
}

const NAMED_COLORS: Record<string, string> = {
  white: "#ffffff", black: "#000000", red: "#ff0000", green: "#008000", lime: "#00ff00", blue: "#0000ff", yellow: "#ffff00",
  cyan: "#00ffff", magenta: "#ff00ff", orange: "#ffa500", gray: "#808080", grey: "#808080",
};

/** Parses #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() and a few colour names; undefined when not understood ("transparent" = alpha 0). */
export function parseColor(input: unknown): RGBA | undefined {
  if (typeof input !== "string") return undefined;
  const value = input.trim().toLowerCase();
  if (!value) return undefined;
  if (value === "transparent" || value === "none") return { r: 0, g: 0, b: 0, a: 0 };
  const named = NAMED_COLORS[value];
  const hex = /^#([0-9a-f]{3,8})$/.exec(named ?? value);
  if (hex) {
    let digits = hex[1];
    if (digits.length === 3 || digits.length === 4) digits = digits.split("").map((c) => c + c).join("");
    if (digits.length !== 6 && digits.length !== 8) return undefined;
    return { r: parseInt(digits.slice(0, 2), 16), g: parseInt(digits.slice(2, 4), 16), b: parseInt(digits.slice(4, 6), 16), a: digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1 };
  }
  const fn = /^rgba?\(([^)]*)\)$/.exec(value);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean).map((part) => (part.endsWith("%") ? Number.parseFloat(part) / 100 : Number(part)));
    if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) return undefined;
    const alpha = parts[3] === undefined || !Number.isFinite(parts[3]) ? 1 : Math.min(1, Math.max(0, parts[3]));
    const channel = (n: number) => Math.min(255, Math.max(0, Math.round(n)));
    return { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]), a: alpha };
  }
  return undefined;
}

function px(value: unknown, fallback: number): number {
  const n = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : fallback;
}

/** First font-family entry, unquoted; generic families map to the bundled default. */
export function primaryFontFamily(value: unknown): string {
  const first = String(value ?? "").split(",")[0].trim().replace(/^["']|["']$/g, "");
  if (!first || /^(sans-serif|serif|monospace|system-ui|default)$/i.test(first)) return DEFAULT_CAPTION_FONT;
  return first;
}

/**
 * Resolves the caption layer of a caption-style graphic (or the built-in
 * default when `graphic` is missing / has no caption layer) into a style in
 * output-video pixels: coordinates and sizes are scaled by videoWidth /
 * graphic.width, so previews (which downscale after burning) stay consistent.
 */
export function captionStyleFromGraphic(graphic: Pick<Graphic, "layers" | "width" | "height"> | undefined | null, videoWidth: number, videoHeight: number): CaptionStyle {
  const own = findCaptionLayer(graphic);
  const layer = own ?? DEFAULT_CAPTION_LAYER;
  const gw = own ? graphic!.width : 1920;
  const gh = own ? graphic!.height : 1080;
  const sx = videoWidth / gw;
  const sy = videoHeight / gh;
  const s = sx; // uniform scale for sizes; positions use sx/sy so the box tracks the frame
  const style = layer.style ?? {};
  const opacity = Math.min(1, Math.max(0, px(style.opacity, 1)));
  const withOpacity = (color: RGBA): RGBA => ({ ...color, a: color.a * opacity });

  const width = Math.max(1, Math.round(layer.width * sx));
  const height = Math.max(1, Math.round(layer.height * sy));
  const x = Math.min(Math.max(0, Math.round(layer.x * sx)), videoWidth - 1);
  const y = Math.min(Math.max(0, Math.round(layer.y * sy)), videoHeight - 1);

  const box = style.background !== undefined ? parseColor(style.background) : undefined;
  const stroke = /^\s*([\d.]+)px\s+(.+)$/.exec(String(style["-webkit-text-stroke"] ?? ""));
  const strokeColor = stroke ? parseColor(stroke[2]) : undefined;
  const shadowParts = String(style["text-shadow"] ?? "").trim().split(/\s+(?![^(]*\))/);
  const shadowDepth = shadowParts.length >= 2 ? Math.abs(px(shadowParts[1], 0)) : 0;
  const shadowColor = parseColor(shadowParts.slice(3).join(" ")) ?? { r: 0, g: 0, b: 0, a: 1 };
  const align = String(style["text-align"] ?? "center");
  const vertical = String(style["vertical-align"] ?? "bottom");
  const weight = String(style["font-weight"] ?? "700");

  return {
    x, y, width, height,
    fontFamily: primaryFontFamily(style["font-family"]),
    fontSize: Math.max(4, px(style["font-size"], 56) * s),
    bold: weight === "bold" || Number(weight) >= 600,
    color: withOpacity(parseColor(style.color) ?? { r: 255, g: 255, b: 255, a: 1 }),
    align: align === "left" || align === "right" ? align : "center",
    vertical: vertical === "top" || vertical === "middle" ? vertical : "bottom",
    box: box && box.a > 0 ? withOpacity(box) : null,
    padding: Math.max(0, px(style.padding, 12) * s),
    outline: stroke && Number.parseFloat(stroke[1]) > 0 ? { width: Number.parseFloat(stroke[1]) * s, color: withOpacity(strokeColor ?? { r: 0, g: 0, b: 0, a: 1 }) } : null,
    shadow: shadowDepth > 0 ? { depth: shadowDepth * s, color: withOpacity(shadowColor) } : null,
    maxLines: Math.max(1, Math.min(6, Math.round(px(style["max-lines"], 2)))),
  };
}
