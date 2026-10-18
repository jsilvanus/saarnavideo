import type { ProjectDefinition, TimelineItem } from "@/domain/project";
import { layoutTimeline } from "@/domain/timeline";

type Range = { startSeconds: number; endSeconds: number };
type SectionLike = { id: string; scope?: string; sourceId?: string; startSeconds?: number; endSeconds?: number };
type SectionSources = { sections?: SectionLike[]; semanticSegments?: SectionLike[] };

/** The sections an overlay's `sectionId` can name, chosen the same way as in CompositionEditor. */
function anchorSections({ sections, semanticSegments }: SectionSources): SectionLike[] {
  return sections?.filter((section) => section.scope === "SOURCE" && section.startSeconds !== undefined && section.endSeconds !== undefined) ?? semanticSegments ?? [];
}

/** The base-timeline slot of the source clip an anchored overlay follows (same choice as the renderer), or undefined. */
function anchorSlot(overlay: TimelineItem & Range & { sectionId?: string }, items: TimelineItem[], sources: SectionSources) {
  if (!overlay.sectionId) return undefined;
  const section = anchorSections(sources).find((candidate) => candidate.id === overlay.sectionId);
  if (!section) return undefined;
  const clips = layoutTimeline(items).filter((slot) => slot.item.type === "source-clip" && slot.item.sourceId === section.sourceId);
  const slot = clips.find(({ item }) => item.startSeconds === section.startSeconds && item.endSeconds === section.endSeconds)
    ?? clips.find(({ item }) => item.type === "source-clip" && overlay.startSeconds >= item.startSeconds && overlay.startSeconds < item.endSeconds);
  return slot && slot.item.type === "source-clip" ? { outputStart: slot.outputStart, duration: slot.duration, clipStart: slot.item.startSeconds } : undefined;
}

/**
 * Output-timeline range of an overlay. An overlay placed inside a section in the composition editor carries `sectionId`
 * and times in that section's **source** seconds; it follows the source clip cut from the section (same source and
 * range, else the first clip of that source that contains its start), so it stays on the same words when sections are
 * reordered, and it is cut to that clip. Overlays without `sectionId` are already in output seconds. Returns undefined
 * when the section or its clip is gone, or nothing of the overlay is left inside the clip.
 */
export function overlayOutputRange(overlay: TimelineItem & Range & { sectionId?: string }, items: TimelineItem[], sources: SectionSources): Range | undefined {
  if (!overlay.sectionId) return { startSeconds: overlay.startSeconds, endSeconds: overlay.endSeconds };
  const slot = anchorSlot(overlay, items, sources);
  if (!slot) return undefined;
  const toOutput = (seconds: number) => Math.min(slot.outputStart + slot.duration, Math.max(slot.outputStart, slot.outputStart + seconds - slot.clipStart));
  const startSeconds = toOutput(overlay.startSeconds), endSeconds = toOutput(overlay.endSeconds);
  return endSeconds > startSeconds ? { startSeconds, endSeconds } : undefined;
}

/** Output seconds an overlay may occupy: its clip when it follows a section, else undefined (the whole timeline). */
export function overlayOutputBounds(overlay: TimelineItem & Range & { sectionId?: string }, items: TimelineItem[], sources: SectionSources): Range | undefined {
  const slot = anchorSlot(overlay, items, sources);
  return slot ? { startSeconds: slot.outputStart, endSeconds: slot.outputStart + slot.duration } : undefined;
}

const toMillis = (seconds: number) => Math.round(seconds * 1000) / 1000;

/**
 * Inverse of `overlayOutputRange`: what to store on the overlay so that it lands on `output` (output-timeline seconds).
 * An overlay with `sectionId` stores **source** seconds of its section (output minus the clip's output start plus the
 * clip's source start, cut to the clip); one without stores output seconds as they are. Undefined when the overlay
 * follows a section whose clip is gone, or the range is empty after cutting it to the clip.
 */
export function overlayStoredRange(overlay: TimelineItem & Range & { sectionId?: string }, output: Range, items: TimelineItem[], sources: SectionSources): Range | undefined {
  if (!overlay.sectionId) return output.endSeconds > output.startSeconds ? { startSeconds: toMillis(output.startSeconds), endSeconds: toMillis(output.endSeconds) } : undefined;
  const slot = anchorSlot(overlay, items, sources);
  if (!slot) return undefined;
  const cut = (seconds: number) => Math.min(slot.outputStart + slot.duration, Math.max(slot.outputStart, seconds));
  const toSource = (seconds: number) => toMillis(cut(seconds) - slot.outputStart + slot.clipStart);
  const startSeconds = toSource(output.startSeconds), endSeconds = toSource(output.endSeconds);
  return endSeconds > startSeconds ? { startSeconds, endSeconds } : undefined;
}

/** Puts section-anchored overlays on the output timeline (what the renderer reads); unplaceable ones are left out. */
export function anchorSectionOverlays(definition: ProjectDefinition): ProjectDefinition {
  const items = definition.composition.items;
  if (!items.some((item) => item.type === "overlay" && item.sectionId)) return definition;
  const placed = items.flatMap((item) => {
    if (item.type !== "overlay" || !item.sectionId) return [item];
    const range = overlayOutputRange(item, items, definition);
    return range ? [{ ...item, ...range }] : [];
  });
  return { ...definition, composition: { ...definition.composition, items: placed } };
}
