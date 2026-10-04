import type { ProjectDefinition } from "@/domain/project";
import { captionOptionsSchema, type CaptionOptions } from "@/domain/captions";
import { captionStyleFromGraphic, findCaptionLayer, type CaptionStyle } from "@/domain/caption-style";
import { buildAss, wrapCuesForStyle } from "@/renderer/ass";
import { formatSrt, formatVtt, type CaptionSegment } from "@/lib/captions";
import { mapCaptionsToTimeline } from "@/renderer/caption-timeline";

/** Reads the `captions` entry the generate route stored in MediaJob.parameters; anything invalid means no captions. */
export function readCaptionOptions(parameters: unknown): CaptionOptions {
  const raw = parameters && typeof parameters === "object" ? (parameters as { captions?: unknown }).captions : undefined;
  const parsed = captionOptionsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : { mode: "none" };
}

/** Ids of the sources whose clips appear on the timeline. */
export function clipSourceIds(definition: ProjectDefinition): string[] {
  return Array.from(new Set(definition.composition.items.flatMap((item) => (item.type === "source-clip" ? [item.sourceId] : []))));
}

/** Output-timeline cues of the composition (what burned captions need). */
export function buildCaptionCues(definition: ProjectDefinition, segmentsBySource: ReadonlyMap<string, readonly CaptionSegment[]>) {
  return mapCaptionsToTimeline(definition.composition.items, segmentsBySource);
}

/** The cues plus their SRT and VTT renderings (what soft captions need; burn-only renders skip the formatting). */
export function buildCaptionFiles(definition: ProjectDefinition, segmentsBySource: ReadonlyMap<string, readonly CaptionSegment[]>) {
  const cues = buildCaptionCues(definition, segmentsBySource);
  return { cues, srt: formatSrt(cues), vtt: formatVtt(cues) };
}

/** Resolves the caption style graphic named in the options; `warning` is set when it was named but unusable and the default applies. */
export function resolveCaptionStyle(definition: ProjectDefinition, styleGraphicId: string | undefined): { style: CaptionStyle; warning?: string } {
  const width = definition.template?.width ?? 1920;
  const height = definition.template?.height ?? 1080;
  const graphic = styleGraphicId ? definition.graphics.find((item) => item.id === styleGraphicId) : undefined;
  if (styleGraphicId && (!graphic || !findCaptionLayer(graphic))) {
    return { style: captionStyleFromGraphic(undefined, width, height), warning: `Caption style graphic ${styleGraphicId} is missing or has no caption layer; using the built-in default style` };
  }
  return { style: captionStyleFromGraphic(graphic, width, height) };
}

/** ASS document for burned-in captions of the output-timeline cues. */
export function buildBurnedCaptionAss(definition: ProjectDefinition, cues: Parameters<typeof wrapCuesForStyle>[0], options: CaptionOptions, fontName?: string) {
  const { style, warning } = resolveCaptionStyle(definition, options.styleGraphicId);
  const wrapped = wrapCuesForStyle(cues, style);
  const ass = buildAss(wrapped, style, { width: definition.template?.width ?? 1920, height: definition.template?.height ?? 1080, fontName });
  return { ass, style, warning, lines: wrapped.length };
}
