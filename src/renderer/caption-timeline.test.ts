import { describe, expect, it } from "vitest";
import type { TimelineItem } from "@/domain/project";
import { layoutTimeline, mapCaptionsToTimeline, timelineDuration } from "@/renderer/caption-timeline";

const clip = (sourceId: string, startSeconds: number, endSeconds: number, transitionIn?: Extract<TimelineItem, { type: "source-clip" }>["transitionIn"]): TimelineItem => ({ type: "source-clip", sourceId, startSeconds, endSeconds, transitionIn });
const slate = (durationSeconds: number, extra: Record<string, unknown> = {}) => ({ type: "slate", template: "rich", mode: "standalone", durationSeconds, data: {}, ...extra }) as TimelineItem;
const seg = (startSeconds: number, endSeconds: number, text: string) => ({ startSeconds, endSeconds, text });

describe("mapCaptionsToTimeline", () => {
  it("passes a single untrimmed clip through unchanged", () => {
    const cues = mapCaptionsToTimeline([clip("a", 0, 10)], new Map([["a", [seg(1, 2, "one"), seg(3, 4, "two")]]]));
    expect(cues).toEqual([seg(1, 2, "one"), seg(3, 4, "two")]);
  });

  it("drops cues outside a trimmed clip, clips edge cues and shifts to zero", () => {
    const cues = mapCaptionsToTimeline([clip("a", 10, 20)], new Map([["a", [seg(5, 8, "before"), seg(8, 12, "leading edge"), seg(14, 15, "inside"), seg(19, 25, "trailing edge"), seg(20, 22, "touching end"), seg(30, 31, "after")]]]));
    expect(cues).toEqual([seg(0, 2, "leading edge"), seg(4, 5, "inside"), seg(9, 10, "trailing edge")]);
  });

  it("offsets later clips by earlier clip durations, across sources", () => {
    const cues = mapCaptionsToTimeline([clip("green", 0, 5), clip("red", 2, 7)], new Map([["green", [seg(1, 2, "g")]], ["red", [seg(1, 3, "clipped-left"), seg(4, 6, "r")]]]));
    expect(cues).toEqual([seg(1, 2, "g"), seg(5, 6, "clipped-left"), seg(7, 9, "r")]);
  });

  it("shifts by standalone slate durations and gives slates no cues", () => {
    const items = [slate(3), clip("a", 0, 5), slate(2, { transitionIn: { type: "fade", durationSeconds: 1 } }), clip("a", 5, 10)];
    const cues = mapCaptionsToTimeline(items, new Map([["a", [seg(1, 2, "first"), seg(6, 7, "second")]]]));
    expect(cues).toEqual([seg(4, 5, "first"), seg(11, 12, "second")]);
    expect(timelineDuration(items)).toBe(15);
  });

  it("ignores overlay slates and overlays for timing", () => {
    const items = [clip("a", 0, 5), slate(4, { mode: "overlay", startSeconds: 1, endSeconds: 3 }), { type: "overlay", kind: "text", startSeconds: 0, endSeconds: 2, opacity: 1, template: "rich", data: {} } as TimelineItem, clip("a", 5, 10)];
    expect(mapCaptionsToTimeline(items, new Map([["a", [seg(6, 7, "x")]]]))).toEqual([seg(6, 7, "x")]);
  });

  it("pulls the next clip back by a crossfade and trims cues that collide in the overlap", () => {
    const items = [clip("a", 0, 5), clip("b", 0, 5, { type: "crossfade", durationSeconds: 2 })];
    const cues = mapCaptionsToTimeline(items, new Map([["a", [seg(3.5, 4.8, "late a")]], ["b", [seg(0.5, 1.5, "early b"), seg(3, 4, "b")]]]));
    // b starts at 5 - 2 = 3 on the output timeline.
    // "early b" (3.5-4.5) and "late a" (3.5-4.8) start together: the shorter sorts first and is dropped, "late a" is then kept.
    expect(cues).toEqual([seg(3.5, 4.8, "late a"), seg(6, 7, "b")]);
    expect(timelineDuration(items)).toBe(8);
  });

  it("cuts an earlier cue short where the next cue starts", () => {
    const items = [clip("a", 0, 5), clip("b", 0, 5, { type: "crossfade", durationSeconds: 2 })];
    expect(mapCaptionsToTimeline(items, new Map([["a", [seg(3.5, 5, "a")]], ["b", [seg(0.2, 2.5, "b")]]]))).toEqual([seg(3.2, 3.5, "b"), seg(3.5, 5, "a")]);
  });

  it("limits a crossfade to half the shorter clip, like the renderer", () => {
    const slots = layoutTimeline([clip("a", 0, 5), clip("b", 0, 2, { type: "crossfade", durationSeconds: 4 })]);
    expect(slots[1].outputStart).toBe(4);
  });

  it("chains a crossfade after a slate", () => {
    const slots = layoutTimeline([slate(3), clip("a", 0, 4, { type: "crossfade", durationSeconds: 1 }), clip("a", 4, 6)]);
    expect(slots.map((s) => s.outputStart)).toEqual([0, 2, 6]);
  });

  it("maps a source used by two clips once per clip and drops sub-millisecond slivers", () => {
    const cues = mapCaptionsToTimeline([clip("a", 0, 2), clip("a", 1, 3)], new Map([["a", [seg(1.5, 1.5004, "sliver"), seg(1.5, 2.5, "both")]]]));
    expect(cues).toEqual([seg(1.5, 2, "both"), seg(2.5, 3.5, "both")]);
  });

  it("returns nothing for sources without segments", () => {
    expect(mapCaptionsToTimeline([clip("a", 0, 5)], new Map())).toEqual([]);
  });
});
