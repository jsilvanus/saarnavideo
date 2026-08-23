import type { CSSProperties } from "react";
import { GRID } from "./constants";
import type { Layer } from "./types";

export function anchor(handle: string, l: Layer) {
  const w = l.width, h = l.height;
  return {
    left: handle.includes("e") ? w : handle.includes("w") ? 0 : w / 2,
    top: handle.includes("s") ? h : handle.includes("n") ? 0 : h / 2,
  };
}

export function resizeLayer(handle: string, start: Layer, dx: number, dy: number) {
  let { x, y, width, height } = start;
  if (handle.includes("e")) width += dx;
  if (handle.includes("w")) { x += dx; width -= dx; }
  if (handle.includes("s")) height += dy;
  if (handle.includes("n")) { y += dy; height -= dy; }
  return { x: Math.round(x), y: Math.round(y), width: Math.max(20, Math.round(width)), height: Math.max(20, Math.round(height)) };
}

export function snap(v: number) { return Math.round(v / GRID) * GRID; }

export function layerStyle(l: Layer, selected: boolean): CSSProperties {
  const style = l.style ?? {};
  const css: CSSProperties = {};
  for (const [key, value] of Object.entries(style)) (css as Record<string, unknown>)[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  return {
    position: "absolute", left: l.x, top: l.y, width: l.width, height: l.height,
    boxSizing: "border-box", userSelect: "none", cursor: "move", outline: selected ? "3px solid #38bdf8" : undefined,
    animation: l.animation || undefined, transform: l.rotation ? `rotate(${l.rotation}deg)` : undefined,
    ...css,
  };
}

export function parsePx(value: unknown, fallback = 0) {
  const n = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : fallback;
}

export function styleValue(l: Layer, key: string, fallback = "") { return String(l.style?.[key] ?? fallback); }
