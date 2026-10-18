import { describe, expect, it } from "vitest";
import { applyTemplateByKey } from "@/domain/templates";
import { chaptersFromFfprobe, hasSourceSections, readChapters, removeSourceSections, replaceWithChapters } from "./youtube-chapters";
import type { ProjectDefinition } from "@/domain/project";

const blank = (): ProjectDefinition => ({
  version: 1, semanticSegments: [], sections: [], graphics: [],
  template: { key: "basic", width: 1920, height: 1080, fps: 30, backgroundColor: "black", textColor: "white" },
  composition: { sourceStartSeconds: 0, sourceEndSeconds: 0.001, items: [] },
} as unknown as ProjectDefinition);

let counter = 0;
const id = () => `n${++counter}`;
const chapters = [{ startSeconds: 0, endSeconds: 60, title: "Alku" }, { startSeconds: 60, endSeconds: 300, title: "Saarna" }];

describe("chaptersFromFfprobe", () => {
  it("reads titled chapters in order and skips empty or too short ones", () => {
    const json = { chapters: [
      { start_time: "60.000000", end_time: "300.000000", tags: { title: " Saarna " } },
      { start_time: "0.000000", end_time: "60.000000", tags: { title: "Alku" } },
      { start_time: "300", end_time: "300.2", tags: { title: "Liian lyhyt" } },
      { start_time: "300", end_time: "400", tags: {} },
    ] };
    expect(chaptersFromFfprobe(json)).toEqual([{ startSeconds: 0, endSeconds: 60, title: "Alku" }, { startSeconds: 60, endSeconds: 300, title: "Saarna" }]);
  });
  it("is empty for a file without chapters or odd input", () => {
    expect(chaptersFromFfprobe({ chapters: [] })).toEqual([]);
    expect(chaptersFromFfprobe({})).toEqual([]);
    expect(chaptersFromFfprobe(null)).toEqual([]);
  });
});

describe("readChapters", () => {
  it("accepts a stored list and treats anything else as none", () => {
    expect(readChapters(chapters)).toEqual(chapters);
    expect(readChapters(null)).toEqual([]);
    expect(readChapters([{ title: "x" }])).toEqual([]);
  });
});

describe("replaceWithChapters", () => {
  it("adds a section, segment and clip for every chapter", () => {
    const next = replaceWithChapters(blank(), "s1", chapters, id);
    expect(next.sections?.map(section => [section.label, section.startSeconds, section.endSeconds])).toEqual([["Alku", 0, 60], ["Saarna", 60, 300]]);
    expect(next.semanticSegments).toHaveLength(2);
    expect(next.composition.items.filter(item => item.type === "source-clip")).toHaveLength(2);
    expect(hasSourceSections(next, "s1")).toBe(true);
    expect(hasSourceSections(next, "other")).toBe(false);
  });

  it("replaces the source's old sequences, their clips and anchored overlays, and leaves other sources alone", () => {
    let def = replaceWithChapters(blank(), "s1", [{ startSeconds: 10, endSeconds: 20, title: "Vanha" }], id);
    def = replaceWithChapters(def, "s2", [{ startSeconds: 5, endSeconds: 15, title: "Toisen" }], id);
    const oldId = def.sections!.find(section => section.label === "Vanha")!.id;
    def = { ...def, composition: { ...def.composition, items: [...def.composition.items, { type: "overlay", template: "rich", kind: "text", sectionId: oldId, startSeconds: 10, endSeconds: 12, opacity: 1, data: {} } as never] } };
    const next = replaceWithChapters(def, "s1", chapters, id);
    expect(next.sections?.map(section => section.label).sort()).toEqual(["Alku", "Saarna", "Toisen"]);
    expect(next.composition.items.some(item => item.type === "overlay")).toBe(false);
    const clips = next.composition.items.filter(item => item.type === "source-clip");
    expect(clips.filter(clip => clip.sourceId === "s2")).toHaveLength(1);
    expect(clips.filter(clip => clip.sourceId === "s1")).toHaveLength(2);
  });

  it("removes subsections with their parent and sections that have no range", () => {
    const def = { ...blank(), sections: [
      { id: "a", label: "A", scope: "SOURCE", sourceId: "s1", startSeconds: 0, endSeconds: 30, origin: "MANUAL" },
      { id: "b", label: "B", scope: "SOURCE", sourceId: "s1", parentId: "a", startSeconds: 5, endSeconds: 10, origin: "MANUAL" },
      { id: "c", label: "C", scope: "SOURCE", sourceId: "s1", origin: "MANUAL" },
      { id: "k", label: "K", scope: "COMPOSITION", origin: "MANUAL" },
    ] } as unknown as ProjectDefinition;
    expect(removeSourceSections(def, "s1").sections?.map(section => section.id)).toEqual(["k"]);
  });

  it("cuts chapters to the video's length and keeps the template's ending slate last", () => {
    const withTemplate = applyTemplateByKey("sermon")!;
    const next = replaceWithChapters(withTemplate as unknown as ProjectDefinition, "s1", chapters, id, 200);
    expect(next.sections?.find(section => section.label === "Saarna")?.endSeconds).toBe(200);
    const bases = next.composition.items.filter(item => item.type === "source-clip" || item.type === "slate");
    expect(bases[bases.length - 1].type).toBe("slate");
  });
});
