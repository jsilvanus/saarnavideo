import type { ProjectDefinition } from "@/domain/project";
import { captionOptionsSchema, type CaptionOptions } from "@/domain/captions";
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

/** Output-timeline cues plus their SRT and VTT renderings. */
export function buildCaptionFiles(definition: ProjectDefinition, segmentsBySource: ReadonlyMap<string, readonly CaptionSegment[]>) {
  const cues = mapCaptionsToTimeline(definition.composition.items, segmentsBySource);
  return { cues, srt: formatSrt(cues), vtt: formatVtt(cues) };
}
