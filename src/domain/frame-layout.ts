import { DESIGN_CANVAS } from "@/domain/output-presets";

/**
 * How graphics authored on the design canvas (1920x1080, `DESIGN_CANVAS`) are laid out in an output frame of any size
 * and aspect ratio. One rule, used by the renderer, the caption style and the graphics editor so they agree:
 *
 * - **Sizes** (width, height, font size, padding, ...) scale uniformly by `k = min(sx, sy)`, where `sx`/`sy` are
 *   output / design along each axis. Shapes keep their proportions, text stays in proportion to its box.
 * - **Positions** keep the relative place of the layer's *centre* on each axis: a layer centred 89 % down the design
 *   canvas is centred 89 % down the frame. (With one scale per axis this is exactly the old behaviour for the centre.)
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

/** One axis: design position and length -> frame position and length (centre keeps its relative place, length scales by k). */
export function mapAxis(position: number, length: number, s: number, k: number): { position: number; length: number } {
  // When s === k the second term is exactly 0, so same-aspect frames get the plain `position * s`.
  return { position: position * s + (length / 2) * (s - k), length: length * k };
}

/** Inverse of `mapAxis`. */
export function unmapAxis(position: number, length: number, s: number, k: number): { position: number; length: number } {
  const designLength = length / k;
  return { position: (position - (designLength / 2) * (s - k)) / s, length: designLength };
}

/** Design-canvas box -> output-frame box (what the renderer draws and what the editor shows). */
export function boxToFrame(box: Box, layout: FrameLayout): Box {
  const h = mapAxis(box.x, box.width, layout.sx, layout.k);
  const v = mapAxis(box.y, box.height, layout.sy, layout.k);
  return { x: h.position, y: v.position, width: h.length, height: v.length };
}

/** Output-frame box -> design-canvas box (what the editor stores after a drag). */
export function boxFromFrame(box: Box, layout: FrameLayout): Box {
  const h = unmapAxis(box.x, box.width, layout.sx, layout.k);
  const v = unmapAxis(box.y, box.height, layout.sy, layout.k);
  return { x: h.position, y: v.position, width: h.length, height: v.length };
}
