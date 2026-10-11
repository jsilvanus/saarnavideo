import { describe, expect, it } from "vitest";
import type { Section } from "@/domain/sections";
import { applySectionChange, neighbourRow, timelineRows } from "./sequence-timeline";

const section = (over: Partial<Section> & { id: string }): Section => ({
  label: over.id, scope: "SOURCE", sourceId: "s1", origin: "MANUAL", ...over,
} as Section);

const sections: Section[] = [
  section({ id: "a", startSeconds: 0, endSeconds: 60 }),
  section({ id: "b", startSeconds: 60, endSeconds: 120 }),
  section({ id: "a1", parentId: "a", startSeconds: 10, endSeconds: 20 }),
  section({ id: "a2", parentId: "a", startSeconds: 30, endSeconds: 40 }),
  section({ id: "other", sourceId: "s2", startSeconds: 0, endSeconds: 10 }),
  section({ id: "unplaced" }),
];

describe("timelineRows", () => {
  it("lists each top-level sequence followed by its nested ones, for one source", () => {
    expect(timelineRows(sections, "s1").map(row => `${row.depth}:${row.section.id}`)).toEqual(["0:a", "1:a1", "1:a2", "0:b"]);
  });
});

describe("applySectionChange", () => {
  it("moves a sequence's end and rejects a range shorter than the minimum", () => {
    const moved = applySectionChange(sections, "b", { endSeconds: 150 }, 300);
    expect("sections" in moved && moved.sections.find(s => s.id === "b")?.endSeconds).toBe(150);
    expect(applySectionChange(sections, "b", { startSeconds: 119.8 }, 300)).toEqual({ error: "endAfterStart" });
  });

  it("refuses times outside the source", () => {
    expect(applySectionChange(sections, "b", { endSeconds: 301 }, 300)).toEqual({ error: "outsideSource" });
    expect(applySectionChange(sections, "b", { startSeconds: -1 }, 300)).toEqual({ error: "outsideSource" });
  });

  it("keeps a nested sequence inside its parent", () => {
    expect(applySectionChange(sections, "a1", { endSeconds: 70 }, 300)).toEqual({ error: "outsideSource" });
  });

  it("refuses to shrink a parent so a nested sequence disappears, and clamps nested ones otherwise", () => {
    expect(applySectionChange(sections, "a", { endSeconds: 25 }, 300)).toEqual({ error: "nestedTooShort" });
    const shrunk = applySectionChange(sections, "a", { endSeconds: 35 }, 300);
    expect("sections" in shrunk && shrunk.sections.find(s => s.id === "a2")?.endSeconds).toBe(35);
  });

  it("renames and recolours without moving", () => {
    const result = applySectionChange(sections, "b", { label: "  Saarna ", color: "#123456" }, 300);
    expect("sections" in result && result.sections.find(s => s.id === "b")).toMatchObject({ label: "Saarna", color: "#123456", startSeconds: 60 });
    expect(applySectionChange(sections, "b", { label: "  " }, 300)).toEqual({ error: "emptyLabel" });
  });
});

describe("neighbourRow", () => {
  it("steps through rows and wraps", () => {
    const rows = timelineRows(sections, "s1");
    expect(neighbourRow(rows, "b", 1)?.section.id).toBe("a");
    expect(neighbourRow(rows, "a", -1)?.section.id).toBe("b");
  });
});
