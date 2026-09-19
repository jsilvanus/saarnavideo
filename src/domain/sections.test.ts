import { describe, expect, it } from "vitest";
import { createSectionsFromLines, getChildSections, getRootSections } from "@/domain/sections";

describe("semantic sections", () => {
  it("creates a flat list with evenly distributed positions", () => {
    const sections = createSectionsFromLines(["Opening", "Sermon", "Closing"], "SOURCE", {
      sourceId: "source-1",
      startSeconds: 0,
      endSeconds: 90,
    });
    expect(sections.map(section => section.label)).toEqual(["Opening", "Sermon", "Closing"]);
    expect(sections.map(section => [section.startSeconds, section.endSeconds])).toEqual([
      [0, 30],
      [30, 60],
      [60, 90],
    ]);
  });

  it("allows a semantic section without a timestamp", () => {
    const sections = createSectionsFromLines(["Sermon"], "SOURCE", { sourceId: "source-1" });
    expect(sections[0].startSeconds).toBeUndefined();
    expect(sections[0].endSeconds).toBeUndefined();
  });

  it("supports nested sections without changing the flat creation primitive", () => {
    const root = createSectionsFromLines(["Sermon"], "SOURCE", { sourceId: "source-1", startSeconds: 0, endSeconds: 60 })[0];
    const children = createSectionsFromLines(["Bible Study", "Our Life", "Future"], "SOURCE", {
      sourceId: "source-1",
      startSeconds: root.startSeconds,
      endSeconds: root.endSeconds,
    }).map(section => ({ ...section, parentId: root.id }));
    const all = [root, ...children];
    expect(getRootSections(all, "SOURCE")).toHaveLength(1);
    expect(getChildSections(all, root.id).map(section => section.label)).toEqual(["Bible Study", "Our Life", "Future"]);
  });

  it("can represent composition sections independently of source sections", () => {
    const sections = createSectionsFromLines(["Introduction", "Sermon"], "COMPOSITION", { startSeconds: 0, endSeconds: 40 });
    expect(sections.every(section => section.scope === "COMPOSITION")).toBe(true);
    expect(sections.every(section => section.sourceId === undefined)).toBe(true);
  });
});
