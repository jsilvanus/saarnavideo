import type { ProjectDefinition } from "@/domain/project";
import { captionOptionsSchema, type CaptionOptions } from "@/domain/captions";
import { captionStyleFromGraphic, findCaptionLayer, type CaptionStyle } from "@/domain/caption-style";
import { buildAssGroups, wrapCuesForStyle } from "@/renderer/ass";
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

/** Caption style spans of the composition (output seconds), in item order so a later span wins where they overlap. */
export function captionStyleSpans(definition: ProjectDefinition) {
  return definition.composition.items.flatMap((item) => (item.type === "caption-style" ? [item] : []));
}

/**
 * Splits the output cues by caption style: a cue goes to the last span whose range holds its start, else to the default
 * style (the one named in the options, or the built-in). Returns one group per style that has cues, default first.
 */
export function groupCuesByStyle(definition: ProjectDefinition, cues: readonly CaptionSegment[], options: CaptionOptions) {
  const base = resolveCaptionStyle(definition, options.styleGraphicId);
  const warnings = base.warning ? [base.warning] : [];
  const spans = captionStyleSpans(definition);
  const styles = new Map<string, CaptionStyle>();
  for (const span of spans) {
    if (styles.has(span.styleGraphicId)) continue;
    const resolved = resolveCaptionStyle(definition, span.styleGraphicId);
    if (resolved.warning) { warnings.push(resolved.warning); styles.set(span.styleGraphicId, base.style); } else styles.set(span.styleGraphicId, resolved.style);
  }
  const groups = new Map<string, { style: CaptionStyle; cues: CaptionSegment[] }>([["", { style: base.style, cues: [] }]]);
  for (const cue of cues) {
    const span = [...spans].reverse().find((candidate) => cue.startSeconds >= candidate.startSeconds && cue.startSeconds < candidate.endSeconds);
    const key = span?.styleGraphicId ?? "";
    let group = groups.get(key);
    if (!group) { group = { style: styles.get(key) ?? base.style, cues: [] }; groups.set(key, group); }
    group.cues.push(cue);
  }
  return { groups: Array.from(groups.values()).filter((group, index) => index === 0 || group.cues.length), style: base.style, warnings };
}

/** ASS document for burned-in captions of the output-timeline cues, with caption style spans applied. */
export function buildBurnedCaptionAss(definition: ProjectDefinition, cues: Parameters<typeof wrapCuesForStyle>[0], options: CaptionOptions, fontName?: string) {
  const { groups, style, warnings } = groupCuesByStyle(definition, cues, options);
  const wrapped = groups.map((group) => ({ style: group.style, cues: wrapCuesForStyle(group.cues, group.style) }));
  const ass = buildAssGroups(wrapped, { width: definition.template?.width ?? 1920, height: definition.template?.height ?? 1080, fontName });
  return { ass, style, warning: warnings.length ? warnings.join("; ") : undefined, lines: wrapped.reduce((sum, group) => sum + group.cues.length, 0), styles: groups.length };
}
