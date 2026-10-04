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
});
