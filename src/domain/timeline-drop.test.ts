import { describe, expect, it } from "vitest";
import type { TimelineItem } from "@/domain/project";
import type { Section } from "@/domain/sections";
import { dropOnTimeline, laneAccepts } from "./timeline-drop";

const clip = (sourceId: string, startSeconds: number, endSeconds: number) => ({ type: "source-clip", sourceId, startSeconds, endSeconds }) as unknown as TimelineItem;
const items = [clip("a", 10, 40), clip("b", 100, 160)];
const sections = [
  { id: "sa", label: "A", scope: "SOURCE", sourceId: "a", startSeconds: 10, endSeconds: 40, origin: "MANUAL" },
  { id: "sb", label: "B", scope: "SOURCE", sourceId: "b", startSeconds: 100, endSeconds: 160, origin: "MANUAL" },
] as Section[];
const base = { graphics: [{ id: "g", name: "G" }] as never, sections, audioAssets: [{ id: "vo", durationMs: 8000 }] };
const types = (list: TimelineItem[] | undefined) => list?.map(item => item.type);

describe("dropOnTimeline", () => {
  it("makes a graphic on the video lane a slate before the item under the pointer, or at the end", () => {
    expect(types(dropOnTimeline(items, { ...base, payload: { kind: "graphic", id: "g" }, lane: "video", time: 5 }))).toEqual(["slate", "source-clip", "source-clip"]);
    expect(types(dropOnTimeline(items, { ...base, payload: { kind: "graphic", id: "g" }, lane: "video", time: 40 }))).toEqual(["source-clip", "slate", "source-clip"]);
    expect(types(dropOnTimeline(items, { ...base, payload: { kind: "graphic", id: "g" }, lane: "video", time: 500 }))).toEqual(["source-clip", "source-clip", "slate"]);
  });

  it("makes the black screen a slate without a graphic, on the video lane only", () => {
    const next = dropOnTimeline(items, { ...base, payload: { kind: "black", id: "black" }, lane: "video", time: 5 });
    expect(next?.[0]).toMatchObject({ type: "slate", mode: "standalone", durationSeconds: 5 });
    expect((next?.[0] as { graphicId?: string }).graphicId).toBeUndefined();
    expect(dropOnTimeline(items, { ...base, payload: { kind: "black", id: "black" }, lane: "graphics", time: 5 })).toBeUndefined();
    expect(laneAccepts("black", "video")).toBe(true);
    expect(laneAccepts("black", "audio")).toBe(false);
  });
  it("makes a graphic on the graphics lane an overlay anchored to the section under it, in source seconds", () => {
    const next = dropOnTimeline(items, { ...base, payload: { kind: "graphic", id: "g" }, lane: "graphics", time: 40 })!;
    expect(next.at(-1)).toMatchObject({ type: "overlay", sectionId: "sb", startSeconds: 110, endSeconds: 115 });
  });

  it("cuts an anchored overlay to its clip and keeps a plain one in output seconds", () => {
    const near = dropOnTimeline(items, { ...base, payload: { kind: "graphic", id: "g" }, lane: "graphics", time: 28 })!;
    expect(near.at(-1)).toMatchObject({ sectionId: "sa", startSeconds: 38, endSeconds: 40 });
    const plain = dropOnTimeline(items, { ...base, sections: [], payload: { kind: "graphic", id: "g" }, lane: "graphics", time: 10 })!;
    expect(plain.at(-1)).toMatchObject({ type: "overlay", startSeconds: 10, endSeconds: 15 });
    expect((plain.at(-1) as { sectionId?: string }).sectionId).toBeUndefined();
  });

  it("mixes audio in from the pointer and makes audio on the video lane a standalone section", () => {
    const mix = dropOnTimeline(items, { ...base, payload: { kind: "audio", id: "vo" }, lane: "audio", time: 12.3456 })!;
    expect(mix.at(-1)).toMatchObject({ type: "audio-clip", mode: "mix", atSeconds: 12.346, startSeconds: 0, endSeconds: 8, duckSourceVolume: 0.25 });
    const section = dropOnTimeline(items, { ...base, payload: { kind: "audio", id: "vo" }, lane: "video", time: 0 })!;
    expect(section[0]).toMatchObject({ type: "audio-clip", mode: "standalone", endSeconds: 8 });
  });

  it("ignores unknown resources, empty timelines for overlays and mixes, and the wrong lane", () => {
    expect(dropOnTimeline(items, { ...base, payload: { kind: "graphic", id: "nope" }, lane: "video", time: 0 })).toBeUndefined();
    expect(dropOnTimeline([], { ...base, payload: { kind: "graphic", id: "g" }, lane: "graphics", time: 0 })).toBeUndefined();
    expect(dropOnTimeline(items, { ...base, payload: { kind: "graphic", id: "g" }, lane: "audio", time: 0 })).toBeUndefined();
    expect(laneAccepts("graphic", "audio")).toBe(false);
    expect(laneAccepts("audio", "graphics")).toBe(false);
    expect(laneAccepts("audio", "video")).toBe(true);
  });
});
