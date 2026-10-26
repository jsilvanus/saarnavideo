import { DESIGN_CANVAS } from "@/domain/output-presets";

/**
 * How graphics authored on the design canvas (1920x1080, `DESIGN_CANVAS`) are laid out in an output frame of any size
 * and aspect ratio. One rule, used by the renderer, the caption style and the graphics editor so they agree:
 *
 * - **Sizes** (width, height, font size, padding, ...) scale uniformly by `k = min(sx, sy)`, where `sx`/`sy` are
 *   output / design along each axis. Shapes keep their proportions, text stays in proportion to its box.
 * - **Positions** keep the relative place of the layer's *centre* on each axis: a layer centred 89 % down the design
 *   canvas is centred 89 % down the frame. (With one scale per axis this is exactly the old behaviour for the centre.)
 *   **Edge anchoring:** a layer that hugs an edge of the design (within `EDGE_ZONE` of the axis) hugs the same edge of
 *   the frame at the same distance times `k`, so a lower third stays at the bottom of a vertical frame. The pull to the
 *   edge fades out quadratically towards the middle, and a layer that sits in the middle (equal gaps) stays centred.
 *
 * At the design size, or any size with the design's aspect ratio, `sx === sy === k` and a layer is simply scaled by
 * `k`; 1920x1080 is not touched at all.
 */
export type FrameLayout = {
  /** Output frame in pixels. */
  width: number;
  height: number;
  /** Output / design along each axis. */
  sx: number;
  sy: number;
  /** Uniform size factor, the smaller of sx and sy. */
  k: number;
};

export type Box = { x: number; y: number; width: number; height: number };

export function frameLayout(output: { width: number; height: number }, canvas: { width: number; height: number } = DESIGN_CANVAS): FrameLayout {
  const sx = output.width / canvas.width;
  const sy = output.height / canvas.height;
  return { width: output.width, height: output.height, sx, sy, k: Math.min(sx, sy) };
}

/** Share of an axis (from each edge) in which a layer counts as hugging that edge. */
const EDGE_ZONE = 0.25;
/** Gap difference (share of the axis) below which a layer counts as centred, not anchored to either edge. */
const CENTRE_BAND = 0.1;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * One axis: design position and length -> frame position and length (length scales by k).
 * Without `designLength` the centre keeps its relative place. With it, a layer near an edge keeps that edge too.
 */
export function mapAxis(position: number, length: number, s: number, k: number, designLength?: number): { position: number; length: number } {
  // When s === k the second term is exactly 0, so same-aspect frames get the plain `position * s`.
  const proportional = position * s + (length / 2) * (s - k);
  if (designLength === undefined || s === k) return { position: proportional, length: length * k };
  const before = position;
  const after = designLength - position - length;
  const near = clamp01(Math.min(before, after) / (EDGE_ZONE * designLength));
  const decided = clamp01(Math.abs(before - after) / (CENTRE_BAND * designLength));
  const weight = (1 - near * near) * decided;
  const edge = before <= after ? before * k : designLength * s - after * k - length * k;
  return { position: proportional + (edge - proportional) * weight, length: length * k };
}

/** Inverse of `mapAxis` (numeric when edge anchoring applies). */
export function unmapAxis(position: number, length: number, s: number, k: number, designLength?: number): { position: number; length: number } {
  const designBoxLength = length / k;
  if (designLength === undefined || s === k) return { position: (position - (designBoxLength / 2) * (s - k)) / s, length: designBoxLength };
  let low = -designLength;
  let high = designLength * 2;
  for (let step = 0; step < 60; step++) {
    const mid = (low + high) / 2;
    if (mapAxis(mid, designBoxLength, s, k, designLength).position < position) low = mid;
    else high = mid;
  }
  return { position: (low + high) / 2, length: designBoxLength };
}

/** Design-canvas box -> output-frame box (what the renderer draws and what the editor shows). */
export function boxToFrame(box: Box, layout: FrameLayout): Box {
  const h = mapAxis(box.x, box.width, layout.sx, layout.k, DESIGN_CANVAS.width);
  const v = mapAxis(box.y, box.height, layout.sy, layout.k, DESIGN_CANVAS.height);
  return { x: h.position, y: v.position, width: h.length, height: v.length };
}

/** Output-frame box -> design-canvas box (what the editor stores after a drag). */
export function boxFromFrame(box: Box, layout: FrameLayout): Box {
  const h = unmapAxis(box.x, box.width, layout.sx, layout.k, DESIGN_CANVAS.width);
  const v = unmapAxis(box.y, box.height, layout.sy, layout.k, DESIGN_CANVAS.height);
  return { x: h.position, y: v.position, width: h.length, height: v.length };
}
