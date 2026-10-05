import { baseItemDuration, isBaseItem, type BaseItem, type TimelineItem, type Transition } from "@/domain/project";

/** Length of a transition into an item: cut or none = 0, otherwise capped at half of the shorter side (`duration`). */
export function transitionDuration(transition: Transition | undefined, duration: number): number {
  if (!transition || transition.type === "cut" || transition.durationSeconds <= 0) return 0;
  return Math.min(transition.durationSeconds, duration / 2);
}

/**
 * One base item on the output timeline. `transition` is the effective length of the transition into this item
 * (0 for the first item, cuts and none); `overlap` is how much of it overlaps the previous item, which only a
 * crossfade does (a fade concatenates, so the next item still starts where the previous one ends).
 */
export type TimelineSlot = { item: BaseItem; outputStart: number; duration: number; transition: number; overlap: number };

/**
 * The only place that decides where each base item starts on the output timeline. The video render, the podcast
 * render, soft and burned captions, overlay anchoring, the duration report and the timeline views all use it, so they
 * cannot drift apart. Base items are source clips, standalone slates and standalone audio clips; overlays, overlay
 * slates and mixed audio clips take no time. A crossfade pulls the next item back by the transition length, every
 * other transition (cut, fade) simply concatenates.
 */
export function layoutTimeline(items: TimelineItem[]): TimelineSlot[] {
  const slots: TimelineSlot[] = [];
  let total = 0;
  items.filter(isBaseItem).forEach((item, index) => {
    const duration = baseItemDuration(item);
    if (index === 0) {
      slots.push({ item, outputStart: 0, duration, transition: 0, overlap: 0 });
      total = duration;
      return;
    }
    const transition = transitionDuration(item.transitionIn, Math.min(total, duration));
    const overlap = item.transitionIn?.type === "crossfade" ? transition : 0;
    slots.push({ item, outputStart: total - overlap, duration, transition, overlap });
    total += duration - overlap;
  });
  return slots;
}

/** Total output length of the composition in seconds. */
export function timelineDuration(items: TimelineItem[]): number {
  return layoutTimeline(items).reduce((end, slot) => Math.max(end, slot.outputStart + slot.duration), 0);
}
