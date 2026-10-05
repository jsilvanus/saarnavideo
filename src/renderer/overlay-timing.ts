import type { ProjectDefinition, TimelineItem } from "@/domain/project";
import { layoutTimeline } from "@/domain/timeline";

type Range = { startSeconds: number; endSeconds: number };
type SectionLike = { id: string; scope?: string; sourceId?: string; startSeconds?: number; endSeconds?: number };
type SectionSources = { sections?: SectionLike[]; semanticSegments?: SectionLike[] };

/** The sections an overlay's `sectionId` can name, chosen the same way as in CompositionEditor. */
function anchorSections({ sections, semanticSegments }: SectionSources): SectionLike[] {
  return sections?.filter((section) => section.scope === "SOURCE" && section.startSeconds !== undefined && section.endSeconds !== undefined) ?? semanticSegments ?? [];
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
  const section = anchorSections(sources).find((candidate) => candidate.id === overlay.sectionId);
  if (!section) return undefined;
  const clips = layoutTimeline(items).filter((slot) => slot.item.type === "source-clip" && slot.item.sourceId === section.sourceId);
  const slot = clips.find(({ item }) => item.startSeconds === section.startSeconds && item.endSeconds === section.endSeconds)
    ?? clips.find(({ item }) => item.type === "source-clip" && overlay.startSeconds >= item.startSeconds && overlay.startSeconds < item.endSeconds);
  if (!slot || slot.item.type !== "source-clip") return undefined;
  const clipStart = slot.item.startSeconds;
  const toOutput = (seconds: number) => Math.min(slot.outputStart + slot.duration, Math.max(slot.outputStart, slot.outputStart + seconds - clipStart));
  const startSeconds = toOutput(overlay.startSeconds), endSeconds = toOutput(overlay.endSeconds);
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
