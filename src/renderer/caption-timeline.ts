import type { TimelineItem } from "@/domain/project";
import { transitionDuration } from "@/renderer/ffmpeg";
import type { CaptionSegment } from "@/lib/captions";

type SourceClipItem = Extract<TimelineItem, { type: "source-clip" }>;
type SlateItem = Extract<TimelineItem, { type: "slate" }>;

/** Cues shorter than this after clipping are noise from float rounding at clip edges and are dropped. */
const MIN_CUE_SECONDS = 0.001;

/** One entry of the output timeline, in the order the renderer concatenates them. */
export type TimelineSlot = { item: SourceClipItem | SlateItem; outputStart: number; duration: number };

/**
 * Lays the base items (source clips and standalone slates; overlay slates and
 * overlays do not take timeline time) out on the output timeline exactly like
 * buildCompositionRenderPlan: a crossfade pulls the next item back by the
 * transition length, every other transition (cut, fade) simply concatenates.
 */
export function layoutTimeline(items: TimelineItem[]): TimelineSlot[] {
  const base = items.filter((item): item is SourceClipItem | SlateItem => item.type === "source-clip" || (item.type === "slate" && item.mode !== "overlay"));
  const slots: TimelineSlot[] = [];
  let total = 0;
  base.forEach((item, index) => {
    const duration = item.type === "slate" ? item.durationSeconds : item.endSeconds - item.startSeconds;
    if (index === 0) {
      slots.push({ item, outputStart: 0, duration });
      total = duration;
      return;
    }
    const d = transitionDuration(item.transitionIn, Math.min(total, duration));
    const overlap = item.transitionIn?.type === "crossfade" ? d : 0;
    slots.push({ item, outputStart: total - overlap, duration });
    total += duration - overlap;
  });
  return slots;
}

/** Total output length of the composition in seconds. */
export function timelineDuration(items: TimelineItem[]): number {
  return layoutTimeline(items).reduce((end, slot) => Math.max(end, slot.outputStart + slot.duration), 0);
}

/**
 * Maps each source's active transcript segments onto the rendered video's
 * timeline. For every source-clip: keep the segments overlapping the clip's
 * source range, clip them to it and shift them to the clip's output start.
 * A source used by several clips contributes to each of them; slates carry no
 * cues. Result is sorted by start time and never overlaps: mov_text tracks
 * (and most players) show one cue at a time, so during a crossfade, where the
 * outgoing clip's late cues collide with the incoming clip's early ones, a cue
 * is cut short where the next one starts (and dropped if nothing is left).
 */
export function mapCaptionsToTimeline(items: TimelineItem[], segmentsBySource: ReadonlyMap<string, readonly CaptionSegment[]>): CaptionSegment[] {
  const cues: CaptionSegment[] = [];
  for (const { item, outputStart } of layoutTimeline(items)) {
    if (item.type !== "source-clip") continue;
    for (const segment of segmentsBySource.get(item.sourceId) ?? []) {
      const start = Math.max(segment.startSeconds, item.startSeconds);
      const end = Math.min(segment.endSeconds, item.endSeconds);
      if (end - start < MIN_CUE_SECONDS) continue;
      cues.push({ startSeconds: outputStart + (start - item.startSeconds), endSeconds: outputStart + (end - item.startSeconds), text: segment.text });
    }
  }
  cues.sort((a, b) => a.startSeconds - b.startSeconds || a.endSeconds - b.endSeconds);
  const result: CaptionSegment[] = [];
  for (const cue of cues) {
    const previous = result[result.length - 1];
    if (previous && previous.endSeconds > cue.startSeconds) {
      previous.endSeconds = cue.startSeconds;
      if (previous.endSeconds - previous.startSeconds < MIN_CUE_SECONDS) result.pop();
    }
    result.push(cue);
  }
  return result;
}
