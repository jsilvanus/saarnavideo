import { z } from "zod";

/**
 * How a source picture is fitted into the output frame.
 * - "fill": scale to cover the frame and cut the overflow (centre crop). Default.
 * - "fit": scale to sit inside the frame; the rest is filled with the background colour or a blurred copy of the picture.
 * - "custom": crop a chosen rectangle of the source (normalised 0..1) and scale it to cover the frame.
 */
export const cropRectSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().gt(0).max(1),
  h: z.number().gt(0).max(1),
}).refine((rect) => rect.x + rect.w <= 1.0001 && rect.y + rect.h <= 1.0001, "Crop rectangle must lie inside the picture");

export const reframeSchema = z.object({
  mode: z.enum(["fill", "fit", "custom"]).default("fill"),
  crop: cropRectSchema.optional(),
  /** Bars of a "fit" picture: the template background colour or a blurred, enlarged copy of the picture. */
  fitBackground: z.enum(["color", "blur"]).default("blur"),
}).refine((value) => value.mode !== "custom" || !!value.crop, "Custom reframing needs a crop rectangle");

export type CropRect = z.infer<typeof cropRectSchema>;
export type Reframe = z.infer<typeof reframeSchema>;

export const DEFAULT_REFRAME: Reframe = { mode: "fill", fitBackground: "blur" };

type SectionLike = { sourceId?: string; startSeconds?: number; endSeconds?: number; reframe?: Reframe };
type ClipLike = { sourceId: string; startSeconds: number; endSeconds: number; reframe?: Reframe };

/** Section the clip was made from: same source and the clip range lies inside the section range. */
export function sectionForClip<S extends SectionLike>(clip: ClipLike, sections: S[] | undefined): S | undefined {
  const tolerance = 0.001;
  return sections?.find((section) => section.sourceId === clip.sourceId && section.startSeconds !== undefined && section.endSeconds !== undefined
    && clip.startSeconds >= section.startSeconds - tolerance && clip.endSeconds <= section.endSeconds + tolerance);
}

/** Clip setting wins over its section, which wins over the project default, which wins over plain "fill". */
export function resolveReframe(clip: ClipLike, sections: SectionLike[] | undefined, projectDefault?: Reframe): Reframe {
  return clip.reframe ?? sectionForClip(clip, sections)?.reframe ?? projectDefault ?? DEFAULT_REFRAME;
}

/** Largest crop rectangle with the output aspect that fits the source, centred on (cx, cy) (normalised) and clamped inside the picture. */
export function cropForAspect(sourceWidth: number, sourceHeight: number, outputWidth: number, outputHeight: number, centre: { x: number; y: number } = { x: 0.5, y: 0.5 }, zoom = 1): CropRect {
  const sourceAspect = sourceWidth / sourceHeight;
  const outputAspect = outputWidth / outputHeight;
  let w = 1, h = 1;
  if (outputAspect < sourceAspect) w = outputAspect / sourceAspect;
  else h = sourceAspect / outputAspect;
  const z = Math.min(Math.max(zoom, 1), 8);
  w /= z; h /= z;
  const x = Math.min(Math.max(centre.x - w / 2, 0), 1 - w);
  const y = Math.min(Math.max(centre.y - h / 2, 0), 1 - h);
  return { x, y, w, h };
}

/** Moves a crop rectangle by a normalised delta, keeping it inside the picture. */
export function moveCrop(crop: CropRect, dx: number, dy: number): CropRect {
  return { ...crop, x: Math.min(Math.max(crop.x + dx, 0), 1 - crop.w), y: Math.min(Math.max(crop.y + dy, 0), 1 - crop.h) };
}

/** Aspect (width / height) of a normalised crop over a source of the given pixel size. */
export function cropAspect(crop: CropRect, sourceWidth: number, sourceHeight: number): number {
  return (crop.w * sourceWidth) / (crop.h * sourceHeight);
}
