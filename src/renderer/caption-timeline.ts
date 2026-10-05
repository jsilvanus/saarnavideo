import type { TimelineItem } from "@/domain/project";
import { layoutTimeline } from "@/domain/timeline";
import type { CaptionSegment } from "@/lib/captions";


/** Cues shorter than this after clipping are noise from float rounding at clip edges and are dropped. */
const MIN_CUE_SECONDS = 0.001;

/**
 * Maps each source's active transcript segments onto the rendered video's
 * timeline. For every source-clip: keep the segments overlapping the clip's
 * source range, clip them to it and shift them to the clip's output start.
 * A source used by several clips contributes to each of them; slates and
 * standalone voiceovers take time but carry no cues. Result is sorted by start time and never overlaps: mov_text tracks
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
