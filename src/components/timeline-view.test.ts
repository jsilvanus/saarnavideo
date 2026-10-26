import { describe, expect, it } from "vitest";
import type { TimelineItem } from "@/domain/project";
import { buildBlocks } from "./TimelineView";

describe("timeline view blocks", () => {
  it("puts picture, graphics and audio on the output timeline the renderer uses", () => {
    const items = [
      { type: "slate", mode: "standalone", graphicId: "g", template: "rich", durationSeconds: 5, data: {} },
      { type: "source-clip", sourceId: "a", startSeconds: 10, endSeconds: 40 },
      { type: "source-clip", sourceId: "b", startSeconds: 0, endSeconds: 60, transitionIn: { type: "crossfade", durationSeconds: 1 } },
      { type: "overlay", graphicId: "g", template: "rich", kind: "text", startSeconds: 36, endSeconds: 46, opacity: 1, data: {} },
      { type: "audio-clip", assetId: "vo", mode: "mix", startSeconds: 0, endSeconds: 8, atSeconds: 5 },
    ] as unknown as TimelineItem[];
    const sections = [{ id: "s", label: "Saarna", scope: "SOURCE", sourceId: "b", startSeconds: 0, endSeconds: 60, origin: "MANUAL" }] as never;
    const { blocks, total } = buildBlocks(items, [{ id: "g", name: "Alkukuva" }] as never, sections, [{ id: "a", originalName: "a.mp4" }, { id: "b", originalName: "b.mp4" }], [{ id: "vo", assetKey: "spiikki" }]);
    expect(total).toBe(94);
    expect(blocks.filter((b) => b.lane === "video").map((b) => [b.label, b.start, b.end])).toEqual([["Alkukuva", 0, 5], ["Leike", 5, 35], ["Saarna", 34, 94]]);
    expect(blocks.find((b) => b.lane === "graphics")).toMatchObject({ start: 36, end: 46, label: "Alkukuva" });
    expect(blocks.find((b) => b.lane === "audio")).toMatchObject({ start: 5, end: 13, label: "spiikki" });
  });

  it("marks overlays and overlay slates as editable, with the clip they must stay in, and leaves feed overlays read-only", () => {
    const items = [
      { type: "source-clip", sourceId: "a", startSeconds: 10, endSeconds: 40 },
      { type: "source-clip", sourceId: "b", startSeconds: 100, endSeconds: 160 },
      { type: "overlay", graphicId: "g", template: "rich", kind: "text", sectionId: "s", startSeconds: 102, endSeconds: 108, opacity: 1, data: {} },
      { type: "overlay", graphicId: "g", template: "rich", kind: "text", startSeconds: 2, endSeconds: 4, opacity: 1, data: {} },
      { type: "slate", mode: "overlay", graphicId: "g", template: "rich", startSeconds: 50, endSeconds: 55, data: {} },
      { type: "feed-overlay", sourceId: "dsk", sourceStartSeconds: 0, startSeconds: 0, endSeconds: 10, anchorSourceId: "a", anchorStartSeconds: 10 },
    ] as unknown as TimelineItem[];
    const sections = [{ id: "s", label: "Saarna", scope: "SOURCE", sourceId: "b", startSeconds: 100, endSeconds: 160, origin: "MANUAL" }] as never;
    const { blocks } = buildBlocks(items, [{ id: "g", name: "G" }] as never, sections, [{ id: "a" }, { id: "b" }], []);
    const graphics = blocks.filter((b) => b.lane === "graphics");
    expect(graphics.find((b) => b.itemIndex === 2)).toMatchObject({ editable: true, start: 32, end: 38, bounds: { start: 30, end: 90 } });
    expect(graphics.find((b) => b.itemIndex === 3)).toMatchObject({ editable: true, bounds: { start: 0, end: 90 } });
    expect(graphics.find((b) => b.itemIndex === 4)).toMatchObject({ editable: true, bounds: { start: 0, end: 90 } });
    expect(graphics.find((b) => b.key === "feed-5")?.editable).toBeUndefined();
  });

  it("puts composition sections with a range on the sequences lane", () => {
    const items = [{ type: "source-clip", sourceId: "a", startSeconds: 0, endSeconds: 60 }] as unknown as TimelineItem[];
    const sections = [
      { id: "c1", label: "Alku", scope: "COMPOSITION", startSeconds: 5, endSeconds: 20, origin: "MANUAL" },
      { id: "c2", label: "Ei rajaa", scope: "COMPOSITION", origin: "MANUAL" },
      { id: "s1", label: "Lähde", scope: "SOURCE", sourceId: "a", startSeconds: 0, endSeconds: 60, origin: "MANUAL" },
    ] as never;
    const { blocks } = buildBlocks(items, [], sections, [{ id: "a" }], []);
    const seq = blocks.filter((b) => b.lane === "sequences");
    expect(seq).toHaveLength(1);
    expect(seq[0]).toMatchObject({ sectionId: "c1", start: 5, end: 20, editable: true, label: "Alku" });
  });

  it("lets the length of a standalone slate be edited, not its start", () => {
    const items = [{ type: "source-clip", sourceId: "a", startSeconds: 0, endSeconds: 20 }, { type: "slate", mode: "standalone", durationSeconds: 5, transitionIn: { type: "crossfade", durationSeconds: 1 }, data: {} }] as unknown as TimelineItem[];
    const { blocks } = buildBlocks(items, [], [], [{ id: "a" }], []);
    expect(blocks.find((b) => b.itemIndex === 1)).toMatchObject({ lane: "video", editable: true, lengthOnly: true, crossfade: 1, start: 19, end: 24 });
  });
});
