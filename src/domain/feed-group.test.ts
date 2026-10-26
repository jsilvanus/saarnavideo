import { describe, expect, it } from "vitest";
import { createProjectDefinition, type ProjectDefinition } from "@/domain/project";
import { cutOutFeedOverlays, feedDeltaSeconds, feedOverlaysOf, moveToSource, shiftCues, shiftRange, withFeedOverlays, withoutFeedOverlays, type FeedSource } from "@/domain/feed-group";
import { remapSourceIds } from "@/domain/source-ids";

const clean: FeedSource = { id: "clean", feedRole: "CLEAN", feedGroupId: "g", syncOffsetMs: 0 };
const program: FeedSource = { id: "program", feedRole: "PROGRAM", feedGroupId: "g", syncOffsetMs: 1500 };
const dsk: FeedSource = { id: "dsk", feedRole: "DSK", feedGroupId: "g", syncOffsetMs: 1500 };
const other: FeedSource = { id: "other", feedRole: null, feedGroupId: null, syncOffsetMs: null };

function project(sourceId = "clean"): ProjectDefinition {
  return createProjectDefinition({
    template: { key: "basic", width: 1920, height: 1080, fps: 30, backgroundColor: "black", textColor: "white" },
    semanticSegments: [{ id: "a", label: "A", sourceId, startSeconds: 10, endSeconds: 30 }, { id: "b", label: "B", sourceId, startSeconds: 30, endSeconds: 60 }],
    sections: [{ id: "a", label: "A", scope: "SOURCE", sourceId, startSeconds: 10, endSeconds: 30, origin: "MANUAL" }, { id: "b", label: "B", scope: "SOURCE", sourceId, startSeconds: 30, endSeconds: 60, origin: "MANUAL" }],
    composition: { sourceStartSeconds: 10, sourceEndSeconds: 60, items: [{ type: "source-clip", sourceId, startSeconds: 10, endSeconds: 30 }, { type: "source-clip", sourceId, startSeconds: 30, endSeconds: 60 }] },
  });
}

describe("feed offsets", () => {
  it("converts between files of one import and refuses strangers", () => {
    expect(feedDeltaSeconds(clean, program)).toBe(-1.5); // 10 s in clean is 8.5 s in program
    expect(feedDeltaSeconds(program, clean)).toBe(1.5);
    expect(feedDeltaSeconds(clean, other)).toBeNull();
    expect(feedDeltaSeconds(clean, { ...program, feedGroupId: "other" })).toBeNull();
  });

  it("keeps a moved range inside the file", () => {
    expect(shiftRange(1, 5, -1.5)).toEqual({ startSeconds: 0, endSeconds: 3.5 });
    expect(shiftRange(10, 20, 0, 15)).toEqual({ startSeconds: 10, endSeconds: 15 });
    expect(shiftRange(0, 0.01, 0).endSeconds).toBeGreaterThan(0.04);
  });

  it("moves cues onto a file that starts later, dropping those before it", () => {
    const cues = [{ startSeconds: 0, endSeconds: 1, text: "gone" }, { startSeconds: 1, endSeconds: 3, text: "cut" }, { startSeconds: 4, endSeconds: 5, text: "kept" }];
    expect(shiftCues(cues, 2000)).toEqual([{ startSeconds: 0, endSeconds: 1, text: "cut" }, { startSeconds: 2, endSeconds: 3, text: "kept" }]);
    expect(shiftCues(cues, 0)).toEqual(cues);
  });
});

describe("swapping the feed", () => {
  it("moves sections, segments and clips to the other recording, shifted by the offset", () => {
    const moved = moveToSource(project(), "clean", "program", -1.5);
    expect(moved.composition.items).toEqual([{ type: "source-clip", sourceId: "program", startSeconds: 8.5, endSeconds: 28.5 }, { type: "source-clip", sourceId: "program", startSeconds: 28.5, endSeconds: 58.5 }]);
    expect(moved.sections?.map((s) => [s.sourceId, s.startSeconds, s.endSeconds])).toEqual([["program", 8.5, 28.5], ["program", 28.5, 58.5]]);
    expect(moved.semanticSegments.map((s) => [s.sourceId, s.startSeconds])).toEqual([["program", 8.5], ["program", 28.5]]);
  });

  it("moves only the chosen sections and the clips cut from them", () => {
    const moved = moveToSource(project(), "clean", "program", -1.5, { sectionIds: new Set(["b"]) });
    expect(moved.composition.items.map((i) => i.type === "source-clip" && [i.sourceId, i.startSeconds])).toEqual([["clean", 10], ["program", 28.5]]);
  });

  it("clips the end to the length of the other file", () => {
    const moved = moveToSource(project(), "clean", "program", 0, { toDurationSeconds: 45 });
    expect(moved.composition.items.map((i) => i.type === "source-clip" && i.endSeconds)).toEqual([30, 45]);
  });
});

describe("graphics laid over the clean picture", () => {
  it("makes one stretch per clean clip, on the output timeline and in the graphics recording's own time", () => {
    const withGraphics = withFeedOverlays(project(), clean, dsk);
    expect(feedOverlaysOf(withGraphics, "dsk")).toEqual([
      { type: "feed-overlay", sourceId: "dsk", sourceStartSeconds: 8.5, startSeconds: 0, endSeconds: 20, anchorSourceId: "clean", anchorStartSeconds: 10, opacity: 1 },
      { type: "feed-overlay", sourceId: "dsk", sourceStartSeconds: 28.5, startSeconds: 20, endSeconds: 50, anchorSourceId: "clean", anchorStartSeconds: 30, opacity: 1 },
    ]);
  });

  it("starts later when the clip begins before the graphics recording, and stops where the recording ends", () => {
    const early = project();
    early.composition.items[0] = { type: "source-clip", sourceId: "clean", startSeconds: 0, endSeconds: 10 };
    // The graphics file starts 1.5 s after the clean one and is 20 s long: the first 1.5 s have none, and the second clip (28.5 s on) is past its end.
    const result = feedOverlaysOf(withFeedOverlays(early, clean, dsk, 20), "dsk");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ sourceStartSeconds: 0, startSeconds: 1.5, endSeconds: 10, anchorStartSeconds: 1.5 });
  });

  it("replaces earlier stretches, ignores clips of other sources, and is removed in one go", () => {
    const twice = withFeedOverlays(withFeedOverlays(project(), clean, dsk), clean, dsk);
    expect(feedOverlaysOf(twice, "dsk")).toHaveLength(2);
    expect(feedOverlaysOf(withFeedOverlays(project("program"), clean, dsk), "dsk")).toHaveLength(0);
    expect(feedOverlaysOf(withoutFeedOverlays(twice, "dsk"), "dsk")).toHaveLength(0);
    expect(() => withFeedOverlays(project(), clean, { ...dsk, feedGroupId: "x" })).toThrow(/same import/);
  });

  it("cuts a stretch out of the graphics, splitting an overlay and keeping the recording's own time", () => {
    const cut = cutOutFeedOverlays(withFeedOverlays(project(), clean, dsk), "dsk", 5, 25);
    expect(feedOverlaysOf(cut, "dsk")).toEqual([
      { type: "feed-overlay", sourceId: "dsk", sourceStartSeconds: 8.5, startSeconds: 0, endSeconds: 5, anchorSourceId: "clean", anchorStartSeconds: 10, opacity: 1 },
      { type: "feed-overlay", sourceId: "dsk", sourceStartSeconds: 28.5 + 5, startSeconds: 25, endSeconds: 50, anchorSourceId: "clean", anchorStartSeconds: 35, opacity: 1 },
    ]);
    expect(cutOutFeedOverlays(withFeedOverlays(project(), clean, dsk), "dsk", 25, 5)).toEqual(withFeedOverlays(project(), clean, dsk));
  });

  it("follows the source ids when a project is duplicated", () => {
    const remapped = remapSourceIds(withFeedOverlays(project(), clean, dsk), new Map([["clean", "c2"], ["dsk", "d2"]]));
    const overlay = feedOverlaysOf(remapped, "d2")[0];
    expect(overlay.anchorSourceId).toBe("c2");
    expect(remapped.composition.items.filter((i) => i.type === "source-clip").every((i) => i.type === "source-clip" && i.sourceId === "c2")).toBe(true);
  });
});
