import { layoutTimeline } from "@/domain/timeline";
import type { FeedOverlayItem, ProjectDefinition, TimelineItem } from "@/domain/project";

/**
 * Sources that came from one imported live stream form a feed group: the same broadcast recorded as clean (no graphics),
 * program (as aired) and dsk (graphics only). Each file's t = 0 lies `syncOffsetMs` after the clean feed's t = 0, so a
 * moment at `s` seconds in file A is at `s + (offsetA - offsetB) / 1000` seconds in file B.
 */
export type FeedSource = { id: string; feedRole: "CLEAN" | "PROGRAM" | "DSK" | "ISO" | null; feedGroupId: string | null; syncOffsetMs: number | null };

/** Seconds to add to a time in `from` to get the same moment in `to`; null when the two are not in one feed group. */
export function feedDeltaSeconds(from: FeedSource | undefined, to: FeedSource | undefined): number | null {
  if (!from || !to || !from.feedGroupId || from.feedGroupId !== to.feedGroupId) return null;
  return ((from.syncOffsetMs ?? 0) - (to.syncOffsetMs ?? 0)) / 1000;
}

const MIN_CLIP = 0.05;

/** A range moved by `delta` seconds and kept inside the file (>= 0, at least MIN_CLIP long). */
export function shiftRange(startSeconds: number, endSeconds: number, delta: number, maxSeconds?: number): { startSeconds: number; endSeconds: number } {
  let start = Math.max(0, startSeconds + delta);
  let end = endSeconds + delta;
  if (maxSeconds !== undefined) end = Math.min(end, maxSeconds);
  if (end - start < MIN_CLIP) end = start + MIN_CLIP;
  start = Math.round(start * 1000) / 1000;
  end = Math.round(end * 1000) / 1000;
  return { startSeconds: start, endSeconds: end };
}

/**
 * Moves sections, their segments and the clips cut from them from one source to another, shifting every time by `delta`
 * seconds (the offset between the two recordings). `sectionIds` limits the move to those sections and the clips that
 * match their range; without it the whole source moves, clips included.
 */
export function moveToSource(definition: ProjectDefinition, fromId: string, toId: string, delta: number, options: { sectionIds?: Set<string>; toDurationSeconds?: number } = {}): ProjectDefinition {
  const { sectionIds, toDurationSeconds } = options;
  const moved = (definition.sections ?? []).filter((section) => section.sourceId === fromId && (!sectionIds || sectionIds.has(section.id)));
  const movedIds = new Set(moved.map((section) => section.id));
  const cutFrom = (item: TimelineItem) => item.type === "source-clip" && item.sourceId === fromId
    && (!sectionIds || moved.some((section) => section.startSeconds === item.startSeconds && section.endSeconds === item.endSeconds));
  const shift = <T extends { startSeconds?: number; endSeconds?: number }>(value: T): T =>
    value.startSeconds === undefined || value.endSeconds === undefined ? value : { ...value, ...shiftRange(value.startSeconds, value.endSeconds, delta, toDurationSeconds) };
  const overlays = (item: TimelineItem): TimelineItem => {
    // Graphics anchored to a moved section follow it (their times are in the section's source seconds).
    if (item.type === "overlay" && item.sectionId && movedIds.has(item.sectionId)) return shift(item);
    return item;
  };
  return {
    ...definition,
    sections: (definition.sections ?? []).map((section) => (movedIds.has(section.id) ? { ...shift(section), sourceId: toId } : section)),
    semanticSegments: definition.semanticSegments.map((segment) => (movedIds.has(segment.id) ? { ...shift(segment), sourceId: toId } : segment)),
    composition: { ...definition.composition, items: definition.composition.items.map((item) => (cutFrom(item) ? { ...shift(item), sourceId: toId } as TimelineItem : overlays(item))) },
  };
}

/**
 * One `feed-overlay` per source clip of the anchor (clean) source, laying the DSK recording over the same moments. Existing
 * overlays of that DSK source are replaced. Clips of other sources get none. Times: the clip at `s..e` in the clean file
 * is at `s + delta .. e + delta` in the DSK file.
 */
export function withFeedOverlays(definition: ProjectDefinition, anchor: FeedSource, dsk: FeedSource, dskDurationSeconds?: number): ProjectDefinition {
  const delta = feedDeltaSeconds(anchor, dsk);
  if (delta === null) throw new Error("The DSK recording and the clean recording are not from the same import");
  const items = definition.composition.items.filter((item) => !(item.type === "feed-overlay" && item.sourceId === dsk.id));
  const added: FeedOverlayItem[] = [];
  for (const slot of layoutTimeline(items)) {
    const clip = slot.item;
    if (clip.type !== "source-clip" || clip.sourceId !== anchor.id) continue;
    const from = clip.startSeconds + delta;
    // Part of the clip may fall before the DSK recording began (or after it ended): nothing to show there.
    const skip = Math.max(0, -from);
    const available = dskDurationSeconds === undefined ? Infinity : Math.max(0, dskDurationSeconds - Math.max(0, from));
    const length = Math.min(slot.duration - skip, available);
    if (length < MIN_CLIP) continue;
    added.push({ type: "feed-overlay", sourceId: dsk.id, sourceStartSeconds: Math.round(Math.max(0, from) * 1000) / 1000, startSeconds: Math.round((slot.outputStart + skip) * 1000) / 1000, endSeconds: Math.round((slot.outputStart + skip + length) * 1000) / 1000, anchorSourceId: anchor.id, anchorStartSeconds: clip.startSeconds + skip, opacity: 1 });
  }
  return { ...definition, composition: { ...definition.composition, items: [...items, ...added] } };
}

/** The project's feed overlays for one DSK source. */
export function feedOverlaysOf(definition: ProjectDefinition, dskSourceId: string): FeedOverlayItem[] {
  return definition.composition.items.filter((item): item is FeedOverlayItem => item.type === "feed-overlay" && item.sourceId === dskSourceId);
}

/** Cue times moved from the clean timeline into a file that starts `offsetMs` later; cues that end before the file starts are dropped. */
export function shiftCues<T extends { startSeconds: number; endSeconds: number }>(cues: T[], offsetMs: number): T[] {
  const shift = offsetMs / 1000;
  const out: T[] = [];
  for (const cue of cues) {
    const end = cue.endSeconds - shift;
    if (end <= 0) continue;
    out.push({ ...cue, startSeconds: Math.max(0, Math.round((cue.startSeconds - shift) * 1000) / 1000), endSeconds: Math.round(end * 1000) / 1000 });
  }
  return out;
}

/**
 * Removes the output stretch `from..to` from the feed overlays of one DSK source (a wrong lower third, a graphic left up too
 * long). An overlay that spans the stretch is split in two; the DSK recording keeps its own time, so the second half
 * continues where the recording was, not where the first half stopped.
 */
export function cutOutFeedOverlays(definition: ProjectDefinition, dskSourceId: string, from: number, to: number): ProjectDefinition {
  if (!(to > from)) return definition;
  const items: TimelineItem[] = [];
  for (const item of definition.composition.items) {
    if (item.type !== "feed-overlay" || item.sourceId !== dskSourceId || item.endSeconds <= from || item.startSeconds >= to) { items.push(item); continue; }
    const round = (value: number) => Math.round(value * 1000) / 1000;
    if (item.startSeconds < from - MIN_CLIP) items.push({ ...item, endSeconds: round(from) });
    if (item.endSeconds > to + MIN_CLIP) {
      const skipped = Math.max(0, to - item.startSeconds);
      items.push({ ...item, startSeconds: round(to), sourceStartSeconds: round(item.sourceStartSeconds + skipped), ...(item.anchorStartSeconds !== undefined ? { anchorStartSeconds: round(item.anchorStartSeconds + skipped) } : {}) });
    }
  }
  return { ...definition, composition: { ...definition.composition, items } };
}

/** Removes every feed overlay of one DSK source. */
export function withoutFeedOverlays(definition: ProjectDefinition, dskSourceId: string): ProjectDefinition {
  return { ...definition, composition: { ...definition.composition, items: definition.composition.items.filter((item) => !(item.type === "feed-overlay" && item.sourceId === dskSourceId)) } };
}
