import { describe, expect, it } from "vitest";
import type { Section } from "@/domain/sections";
import { createSectionsFromLines } from "@/domain/sections";
import { applySectionChange, checkNewSequence, defaultNewRange, descendantIds, moveSequence, neighbourRow, removeWithDescendants, timelineRows, unplacedRows } from "./sequence-timeline";

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

describe("a sequence typed by name on a source of unknown length (regression)", () => {
  // The name-only creator placed sections evenly over the source's duration; with no duration they got no range,
  // timelineRows left them out and the sequence never reached the timeline.
  const typed = createSectionsFromLines(["Saarna"], "SOURCE", { sourceId: "s1" });

  it("has no range, so the timeline cannot draw it", () => {
    expect(typed[0].startSeconds).toBeUndefined();
    expect(timelineRows(typed, "s1")).toEqual([]);
  });

  it("is still listed as a sequence without a range", () => {
    expect(unplacedRows(typed, "s1").map(row => row.section.label)).toEqual(["Saarna"]);
    expect(unplacedRows(typed, "s2")).toEqual([]);
    expect(unplacedRows(sections, "s1").map(row => row.section.id)).toEqual(["unplaced"]);
  });

  it("gets a ten second range from the first edge that is set", () => {
    const start = applySectionChange(typed, typed[0].id, { startSeconds: 42 }, 300);
    expect("sections" in start && [start.sections[0].startSeconds, start.sections[0].endSeconds]).toEqual([42, 52]);
    const end = applySectionChange(typed, typed[0].id, { endSeconds: 5 }, 300);
    expect("sections" in end && [end.sections[0].startSeconds, end.sections[0].endSeconds]).toEqual([0, 5]);
    const clamped = applySectionChange(typed, typed[0].id, { startSeconds: 296 }, 300);
    expect("sections" in clamped && clamped.sections[0].endSeconds).toBe(300);
  });
});

describe("defaultNewRange", () => {
  it("starts at the playhead and runs ten seconds", () => {
    expect(defaultNewRange(12.34)).toEqual({ start: 12.3, end: 22.3 });
  });
  it("stays inside the source and the parent, shifting back near the end", () => {
    expect(defaultNewRange(95, { durationSeconds: 100 })).toEqual({ start: 90, end: 100 });
    expect(defaultNewRange(5, { parent: { startSeconds: 10, endSeconds: 40 } })).toEqual({ start: 10, end: 20 });
    expect(defaultNewRange(35, { parent: { startSeconds: 10, endSeconds: 40 } })).toEqual({ start: 30, end: 40 });
  });
  it("keeps a short parent whole", () => {
    expect(defaultNewRange(0, { parent: { startSeconds: 10, endSeconds: 14 } })).toEqual({ start: 10, end: 14 });
  });
});

describe("checkNewSequence", () => {
  it("accepts a good range and trims the name", () => {
    expect(checkNewSequence(sections, { label: "  Psalmi ", start: 1.04, end: 9 }, 300)).toEqual({ ok: true, label: "Psalmi", start: 1, end: 9 });
  });
  it("refuses an empty name, a too short range and times outside the source or parent", () => {
    expect(checkNewSequence(sections, { label: " ", start: 0, end: 5 })).toEqual({ error: "emptyLabel" });
    expect(checkNewSequence(sections, { label: "x", start: 5, end: 5.2 })).toEqual({ error: "endAfterStart" });
    expect(checkNewSequence(sections, { label: "x", start: 290, end: 310 }, 300)).toEqual({ error: "outsideSource" });
    expect(checkNewSequence(sections, { label: "x", start: 50, end: 70, parentId: "a" })).toEqual({ error: "outsideSource" });
    expect(checkNewSequence(sections, { label: "x", start: 50, end: 55, parentId: "a" })).toMatchObject({ ok: true });
  });
  it("does not need a known duration", () => {
    expect(checkNewSequence([], { label: "x", start: 500, end: 600 })).toMatchObject({ ok: true });
  });
});

describe("nesting at any depth", () => {
  const deep: Section[] = [
    section({ id: "a", startSeconds: 0, endSeconds: 100 }),
    section({ id: "a1", parentId: "a", startSeconds: 10, endSeconds: 50 }),
    section({ id: "a1x", parentId: "a1", startSeconds: 20, endSeconds: 30 }),
    section({ id: "b", startSeconds: 100, endSeconds: 120 }),
  ];
  it("lists grandchildren under their parent with their depth", () => {
    expect(timelineRows(deep, "s1").map(row => `${row.depth}:${row.section.id}`)).toEqual(["0:a", "1:a1", "2:a1x", "0:b"]);
  });
  it("finds and removes everything below a section", () => {
    expect([...descendantIds(deep, "a")].sort()).toEqual(["a1", "a1x"]);
    expect(removeWithDescendants(deep, "a1").map(s => s.id)).toEqual(["a", "b"]);
  });
  it("clamps grandchildren when a middle sequence shrinks, and refuses when one would vanish", () => {
    const shrunk = applySectionChange(deep, "a1", { endSeconds: 25 }, 300);
    expect("sections" in shrunk && shrunk.sections.find(s => s.id === "a1x")).toMatchObject({ startSeconds: 20, endSeconds: 25 });
    expect(applySectionChange(deep, "a1", { endSeconds: 20.2 }, 300)).toEqual({ error: "nestedTooShort" });
  });
  it("moves a sequence with its children, or alone when they still fit", () => {
    const withKids = moveSequence(deep, "a1", 10, 300, true);
    expect("sections" in withKids && withKids.sections.filter(s => s.id.startsWith("a1")).map(s => s.startSeconds)).toEqual([20, 30]);
    const alone = moveSequence(deep, "a1x", 5, 300, false);
    expect("sections" in alone && alone.sections.find(s => s.id === "a1x")?.startSeconds).toBe(25);
    expect(moveSequence(deep, "a1", 30, 300, false)).toEqual({ error: "nestedTooShort" });
  });
  it("keeps a moved sequence inside its parent", () => {
    const result = moveSequence(deep, "a1", 500, 300, true);
    expect("sections" in result && result.sections.find(s => s.id === "a1")).toMatchObject({ startSeconds: 60, endSeconds: 100 });
  });
});
