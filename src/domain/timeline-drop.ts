import type { Graphic } from "@/domain/graphics";
import type { Section } from "@/domain/sections";
import type { TimelineItem } from "@/domain/project";
import { layoutTimeline } from "@/domain/timeline";
import { overlayStoredRange } from "@/renderer/overlay-timing";

/** What the resource bin drags: a graphic or a library audio asset. */
export type DropPayload = { kind: "graphic" | "audio"; id: string };
export type DropLane = "video" | "graphics" | "audio";

/** Default length of a graphic dropped on the graphics lane, and of its slate on the video lane (seconds). */
export const DROPPED_GRAPHIC_SECONDS = 5;

type DropContext = {
  payload: DropPayload;
  lane: DropLane;
  /** Output-timeline seconds under the pointer. */
  time: number;
  graphics: Graphic[];
  sections: Section[];
  audioAssets: Array<{ id: string; durationMs?: number | null }>;
};

const ms = (seconds: number) => Math.round(seconds * 1000) / 1000;

/**
 * The composition items after dropping a resource on the output timeline, or undefined when the drop means nothing
 * there. What happens depends on the lane, as in the composition editor:
 * - a graphic on the **video** lane becomes a standalone slate: before the picture item the pointer is on when it is in
 *   that item's left half, after it in the right half (so at the end past the last item);
 * - a graphic on the **graphics** lane becomes an overlay starting at the pointer: anchored to the section of the clip
 *   under it (stored in that section's source seconds, so it follows reordering), else in plain output seconds;
 * - audio on the **audio** lane becomes a voiceover mixed in from the pointer (source audio ducked to 25 %);
 * - audio on the **video** lane becomes a standalone voiceover section, placed like a slate.
 */
export function dropOnTimeline(items: TimelineItem[], { payload, lane, time, graphics, sections, audioAssets }: DropContext): TimelineItem[] | undefined {
  const slots = layoutTimeline(items);
  const total = slots.reduce((end, slot) => Math.max(end, slot.outputStart + slot.duration), 0);
  const at = Math.max(0, time);

  if (payload.kind === "graphic") {
    if (!graphics.some(graphic => graphic.id === payload.id)) return undefined;
    if (lane === "video") return insertBase(items, at, { type: "slate", graphicId: payload.id, template: "rich", mode: "standalone", durationSeconds: DROPPED_GRAPHIC_SECONDS } as unknown as TimelineItem);
    if (lane !== "graphics") return undefined;
    if (total <= 0) return undefined;
    const start = Math.min(at, Math.max(0, total - 0.5));
    const slot = slots.find(candidate => candidate.item.type === "source-clip" && start >= candidate.outputStart && start < candidate.outputStart + candidate.duration);
    const clip = slot?.item.type === "source-clip" ? slot.item : undefined;
    const section = clip && sections.find(candidate => candidate.scope === "SOURCE" && candidate.sourceId === clip.sourceId && candidate.startSeconds === clip.startSeconds && candidate.endSeconds === clip.endSeconds);
    const end = Math.min(start + DROPPED_GRAPHIC_SECONDS, slot && section ? slot.outputStart + slot.duration : total);
    const draft = { type: "overlay", graphicId: payload.id, template: "rich", kind: "text", ...(section ? { sectionId: section.id } : {}), startSeconds: start, endSeconds: end, opacity: 1 } as unknown as TimelineItem & { startSeconds: number; endSeconds: number };
    const stored = overlayStoredRange(draft, { startSeconds: start, endSeconds: end }, items, { sections });
    if (!stored) return undefined;
    return [...items, { ...draft, ...stored } as TimelineItem];
  }

  const asset = audioAssets.find(candidate => candidate.id === payload.id);
  if (!asset) return undefined;
  const length = ms(Math.max(0.1, asset.durationMs ? asset.durationMs / 1000 : 10));
  if (lane === "audio") {
    if (total <= 0) return undefined;
    const mix = { type: "audio-clip", assetId: payload.id, mode: "mix", startSeconds: 0, endSeconds: Math.min(length, Math.max(0.1, ms(total - at))), atSeconds: ms(Math.min(at, total)), volume: 1, duckSourceVolume: 0.25 };
    return [...items, mix as unknown as TimelineItem];
  }
  if (lane === "video") return insertBase(items, at, { type: "audio-clip", assetId: payload.id, mode: "standalone", startSeconds: 0, endSeconds: length, volume: 1 } as unknown as TimelineItem);
  return undefined;
}

/** Inserts a base item before the picture item whose middle lies after `time`, or at the end. */
function insertBase(items: TimelineItem[], time: number, item: TimelineItem): TimelineItem[] {
  const next = [...items];
  const slot = layoutTimeline(items).find(candidate => time < candidate.outputStart + candidate.duration / 2);
  const index = slot ? items.indexOf(slot.item as TimelineItem) : items.length;
  next.splice(index < 0 ? items.length : index, 0, item);
  return next;
}

/** Whether a resource can be dropped on a lane at all (used to show the drop marker only where it means something). */
export function laneAccepts(kind: DropPayload["kind"], lane: DropLane): boolean {
  return kind === "graphic" ? lane !== "audio" : lane !== "graphics";
}
