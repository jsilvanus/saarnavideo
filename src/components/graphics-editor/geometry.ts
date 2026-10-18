import type { CSSProperties } from "react";
import { GRID } from "./constants";
import { boxFromFrame, type Box, type FrameLayout } from "@/domain/frame-layout";
import type { Layer } from "./types";

export function anchor(handle: string, l: { width: number; height: number }) {
  const w = l.width, h = l.height;
  return {
    left: handle.includes("e") ? w : handle.includes("w") ? 0 : w / 2,
    top: handle.includes("s") ? h : handle.includes("n") ? 0 : h / 2,
  };
}

export function resizeLayer(handle: string, start: { x: number; y: number; width: number; height: number }, dx: number, dy: number, round = true) {
  let { x, y, width, height } = start;
  if (handle.includes("e")) width += dx;
  if (handle.includes("w")) { x += dx; width -= dx; }
  if (handle.includes("s")) height += dy;
  if (handle.includes("n")) { y += dy; height -= dy; }
  const r = (n: number) => (round ? Math.round(n) : n);
  return { x: r(x), y: r(y), width: Math.max(20, r(width)), height: Math.max(20, r(height)) };
}

export function snap(v: number) { return Math.round(v / GRID) * GRID; }

/**
 * The wrapper of a layer in the editor's frame space (output pixels): `display` is the layer's box after the
 * design -> frame mapping (src/domain/frame-layout.ts), so what is drawn here is what the renderer draws.
 */
export function layerFrameStyle(l: Layer, display: { x: number; y: number; width: number; height: number }, selected: boolean): CSSProperties {
  return {
    position: "absolute", left: display.x, top: display.y, width: display.width, height: display.height,
    boxSizing: "border-box", userSelect: "none", cursor: "move", outline: selected ? "calc(3px * var(--ge-inv, 1)) solid #38bdf8" : undefined,
    animation: l.animation || undefined, transform: l.rotation ? `rotate(${l.rotation}deg)` : undefined,
    zIndex: selected ? 30 : undefined,
  };
}

/**
 * The layer's own look at design size, scaled into its wrapper by the uniform size factor `k` (so fonts, padding,
 * strokes and shadows scale together, as in the render).
 */
export function layerContentStyle(l: Layer, k: number): CSSProperties {
  const style = l.style ?? {};
  const css: CSSProperties = {};
  // "max-lines" and "vertical-align" configure caption layers; they are not CSS for the preview box.
  for (const [key, value] of Object.entries(style)) if (key !== "max-lines" && key !== "vertical-align") (css as Record<string, unknown>)[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  return {
    position: "absolute", left: 0, top: 0, width: l.width, height: l.height, transformOrigin: "0 0", transform: k === 1 ? undefined : `scale(${k})`,
    boxSizing: "border-box",
    ...(l.type === "caption" ? { border: "2px dashed rgba(255,255,255,.55)", lineHeight: 1.2 } : {}),
    ...css,
  };
}

/** Rounds to a multiple of `step`. */
export function snapTo(v: number, step: number) { return Math.round(v / step) * step; }

export function parsePx(value: unknown, fallback = 0) {
  const n = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : fallback;
}

export function styleValue(l: Layer, key: string, fallback = "") { return String(l.style?.[key] ?? fallback); }

/** Flex alignment of a caption layer's sample text inside its box, from text-align / vertical-align. */
export function captionAlignment(l: Layer): { justifyContent: string; alignItems: string; textAlign: "left" | "center" | "right" } {
  const align = String(l.style?.["text-align"] ?? "center");
  const vertical = String(l.style?.["vertical-align"] ?? "bottom");
  return {
    justifyContent: align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center",
    alignItems: vertical === "top" ? "flex-start" : vertical === "middle" ? "center" : "flex-end",
    textAlign: align === "left" || align === "right" ? align : "center",
  };
}

const toDesign = (box: Box, layout: FrameLayout): Box => {
  const b = boxFromFrame(box, layout);
  return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
};

/** A layer dragged by (dx, dy) frame pixels from `display` (its box in the frame); returns its new design position. Snaps to the frame's grid when asked. */
export function moveInFrame(display: Box, dx: number, dy: number, layout: FrameLayout, snapToGrid: boolean): { x: number; y: number } {
  let x = display.x + dx, y = display.y + dy;
  if (snapToGrid) { x = snapTo(x, GRID * layout.k); y = snapTo(y, GRID * layout.k); }
  const b = toDesign({ ...display, x, y }, layout);
  return { x: b.x, y: b.y };
}

/** A layer resized by dragging `handle` by (dx, dy) frame pixels from `display`; returns its new design box. */
export function resizeInFrame(handle: string, display: Box, dx: number, dy: number, layout: FrameLayout, aspectLock: boolean): Box {
  // Not rounded in frame pixels: the design values are rounded once, after the inverse mapping.
  const r = resizeLayer(handle, display, dx, dy, false);
  if (aspectLock && display.width && display.height) {
    const ratio = display.width / display.height;
    if (["e", "w"].includes(handle)) r.height = Math.max(20, r.width / ratio);
    else if (["n", "s"].includes(handle)) r.width = Math.max(20, r.height * ratio);
  }
  return toDesign(r, layout);
}
