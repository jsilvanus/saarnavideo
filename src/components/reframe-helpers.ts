import { cropForAspect, moveCrop, type CropRect, type Reframe } from "@/domain/reframe";

/** Editor choices for a reframe setting; "default" means "no setting here" (inherit). */
export type ReframeChoice = "default" | "fill" | "custom" | "fit-blur" | "fit-color";

export function choiceOf(reframe: Reframe | undefined): ReframeChoice {
  if (!reframe) return "default";
  if (reframe.mode === "custom") return "custom";
  if (reframe.mode === "fit") return reframe.fitBackground === "color" ? "fit-color" : "fit-blur";
  return "fill";
}

/** Builds the value stored on the section/clip; undefined = delete the property. */
export function reframeFromChoice(choice: ReframeChoice, crop: CropRect | undefined): Reframe | undefined {
  switch (choice) {
    case "default": return undefined;
    case "fill": return { mode: "fill", fitBackground: "blur" };
    case "custom": return crop ? { mode: "custom", crop, fitBackground: "blur" } : { mode: "fill", fitBackground: "blur" };
    case "fit-blur": return { mode: "fit", fitBackground: "blur" };
    case "fit-color": return { mode: "fit", fitBackground: "color" };
  }
}

/** Small badge text for cards with a non-default reframe. */
export function reframeBadge(reframe: Reframe | undefined): string | undefined {
  if (!reframe) return undefined;
  return reframe.mode === "custom" ? "crop" : reframe.mode === "fit" ? "fit" : "fill";
}

/** Pointer movement in pixels over the preview box becomes a normalised delta of the source picture. */
export function pixelsToNormalised(dxPx: number, dyPx: number, boxWidthPx: number, boxHeightPx: number): { dx: number; dy: number } {
  if (!(boxWidthPx > 0) || !(boxHeightPx > 0)) return { dx: 0, dy: 0 };
  return { dx: dxPx / boxWidthPx, dy: dyPx / boxHeightPx };
}

/** Drags a crop rectangle from where it started by a pixel delta, clamped inside the picture. */
export function dragCrop(start: CropRect, dxPx: number, dyPx: number, boxWidthPx: number, boxHeightPx: number): CropRect {
  const { dx, dy } = pixelsToNormalised(dxPx, dyPx, boxWidthPx, boxHeightPx);
  return moveCrop(start, dx, dy);
}

export function cropCentre(crop: CropRect): { x: number; y: number } {
  return { x: crop.x + crop.w / 2, y: crop.y + crop.h / 2 };
}

/** Zoom of a crop relative to the largest crop of the output aspect (1 = whole picture height/width). */
export function zoomOf(crop: CropRect, sw: number, sh: number, ow: number, oh: number): number {
  const full = cropForAspect(sw, sh, ow, oh);
  return Math.min(4, Math.max(1, full.w / crop.w));
}

/** Same centre, new zoom (1..4), still the output aspect and inside the picture. */
export function withZoom(crop: CropRect, zoom: number, sw: number, sh: number, ow: number, oh: number): CropRect {
  return cropForAspect(sw, sh, ow, oh, cropCentre(crop), Math.min(4, Math.max(1, zoom)));
}
