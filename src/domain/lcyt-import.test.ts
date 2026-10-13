import { describe, expect, it } from "vitest";
import { lcytManifestSchema } from "@/domain/lcyt-manifest";
import { buildImportedDefinition, chooseMainRole, importSections, mergeVariables } from "@/domain/lcyt-import";
import { createProjectDefinition } from "@/domain/project";
import { sampleManifest } from "@/domain/lcyt-manifest.fixture";

const manifest = (overrides: Record<string, unknown> = {}) => lcytManifestSchema.parse(sampleManifest(overrides));
const ids = () => { let n = 0; return () => `s${++n}`; };
const blank = () => createProjectDefinition({ template: { key: "basic", width: 1920, height: 1080, fps: 30, backgroundColor: "black", textColor: "white" }, semanticSegments: [], composition: { sourceStartSeconds: 0, sourceEndSeconds: 0.001, items: [] } });

describe("choosing the working feed", () => {
  it("prefers program (as aired), else clean, and honours a request for a feed that has a file", () => {
    expect(chooseMainRole(manifest())).toBe("program");
    expect(chooseMainRole(manifest(), "clean")).toBe("clean");
    expect(chooseMainRole(manifest(), "dsk")).toBe("program");
    const aliased = manifest({ feeds: [(sampleManifest().feeds as unknown[])[0], { role: "program", aliasOf: "clean" }] });
    expect(chooseMainRole(aliased)).toBe("clean");
    expect(chooseMainRole(aliased, "program")).toBe("clean");
  });
});

describe("sections of the working source", () => {
  it("makes one section for the whole recording without markers", () => {
    expect(importSections(manifest(), 0, 120, ids())).toEqual([{ id: "s1", label: "Test broadcast", startSeconds: 0, endSeconds: 120 }]);
  });

  it("splits at cue markers, in the working file's time", () => {
    const m = manifest({ markers: [{ atMs: 31500, kind: "cue", label: "Gospel" }, { atMs: 11500, kind: "cue", label: "Opening" }, { atMs: 50000, kind: "note", label: "ignored" }] });
    // The program file starts 1.5 s after the clean picture, so markers move 1.5 s earlier.
    expect(importSections(m, 1500, 100, ids())).toEqual([
      { id: "s1", label: "Test broadcast", startSeconds: 0, endSeconds: 10 },
      { id: "s2", label: "Opening", startSeconds: 10, endSeconds: 30 },
      { id: "s3", label: "Gospel", startSeconds: 30, endSeconds: 100 },
    ]);
  });

  it("starts at the first marker when it is at the very beginning, and drops markers outside the recording or too close together", () => {
    const m = manifest({ markers: [{ atMs: 0, kind: "cue", label: "Start" }, { atMs: 200, kind: "cue", label: "Too close" }, { atMs: 999000, kind: "cue", label: "After the end" }, { atMs: 5000, kind: "cue", label: "Next" }] });
    expect(importSections(m, 0, 60, ids()).map((s) => [s.label, s.startSeconds, s.endSeconds])).toEqual([["Start", 0, 5], ["Next", 5, 60]]);
  });
});

describe("the imported project", () => {
  it("merges variables, replacing the template's value of the same name", () => {
    expect(mergeVariables([{ key: "a", value: "1" }, { key: "b", value: "2" }], [{ key: "b", value: "3" }, { key: "c", value: "4" }])).toEqual([{ key: "a", value: "1" }, { key: "b", value: "3" }, { key: "c", value: "4" }]);
  });

  it("cuts a clip per section from the working source and fills the variables", () => {
    const definition = buildImportedDefinition(blank(), { manifest: manifest(), sourceId: "src1", offsetMs: 0, durationSeconds: 120, variables: [{ key: "date", value: "2026-10-11" }], newId: ids() });
    expect(definition.variables).toEqual([{ key: "date", value: "2026-10-11" }]);
    expect(definition.composition.items).toEqual([{ type: "source-clip", sourceId: "src1", startSeconds: 0, endSeconds: 120 }]);
    expect(definition.sections).toHaveLength(1);
  });
});
