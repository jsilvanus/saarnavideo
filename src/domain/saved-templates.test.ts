import { describe, expect, it } from "vitest";
import { applySavedTemplate, captureTemplate, savedTemplateSchema } from "./saved-templates";
import { projectDefinitionSchema, type ProjectDefinition } from "./project";
import { addSourceSection, applyTemplateByKey } from "./templates";

const counter = (prefix = "id") => {
  let n = 0;
  return () => `${prefix}-${++n}`;
};

/** A sermon project with two sections cut, a Gospel overlay, a timed overlay and a mixed voiceover. */
function finishedProject(): ProjectDefinition {
  let definition = applyTemplateByKey("sermon", { title: "Pääsiäinen", preacher: "Maija", newId: counter("g") })!;
  definition = addSourceSection(definition, { id: "gospel", label: "Evankeliumi", sourceId: "src", startSeconds: 10, endSeconds: 70 });
  definition = addSourceSection(definition, { id: "sermon", label: "Saarna", sourceId: "src", startSeconds: 100, endSeconds: 900 });
  const timedOverlay = { type: "overlay" as const, template: "rich", kind: "text" as const, graphicId: "g-2", startSeconds: 3, endSeconds: 6, opacity: 1, data: {} };
  const mix = { type: "audio-clip" as const, assetId: "asset", mode: "mix" as const, startSeconds: 0, endSeconds: 4, volume: 1, atSeconds: 2, duckSourceVolume: 0.5, data: {} };
  return { ...definition, composition: { ...definition.composition, items: [...definition.composition.items, timedOverlay, mix] } };
}

describe("captureTemplate", () => {
  it("drops sources, sections, clips, timed overlays and mixes but keeps slates, graphics and settings", () => {
    const saved = captureTemplate(finishedProject());
    const { definition } = saved;
    expect(savedTemplateSchema.safeParse(saved).success).toBe(true);
    expect(definition.sections).toEqual([]);
    expect(definition.semanticSegments).toEqual([]);
    expect(definition.composition.items.map((item) => item.type)).toEqual(["slate", "slate"]);
    expect(definition.graphics).toHaveLength(4);
    expect(definition.template).toMatchObject({ key: "sermon", presetKey: "youtube-1080p", targetSeconds: 900, endingGraphicId: "g-3" });
    expect(saved.sections).toEqual(["Evankeliumi", "Saarna"]);
  });

  it("clears variable values but keeps their names", () => {
    const { definition } = captureTemplate(finishedProject());
    expect(definition.variables).toEqual([{ key: "otsikko", value: "" }, { key: "saarnaaja", value: "" }, { key: "evankeliumi", value: "" }]);
  });

  it("turns an overlay a person placed on a section into a rule for sections of that name", () => {
    const base = applyTemplateByKey("vespers", { newId: counter("g") })!;
    const withSection = addSourceSection(base, { id: "psalm", label: "Psalmi", sourceId: "src", startSeconds: 0, endSeconds: 60 });
    const overlay = { type: "overlay" as const, template: "rich", kind: "text" as const, graphicId: "g-1", sectionId: "psalm", startSeconds: 0, endSeconds: 5, opacity: 1, data: {} };
    const definition = { ...withSection, composition: { ...withSection.composition, items: [...withSection.composition.items, overlay] } };
    expect(captureTemplate(definition).definition.template?.sectionOverlays).toEqual([{ section: "Psalmi", graphicId: "g-1", durationSeconds: 5 }]);
  });

  it("finds the ending slate when the project has clips and still closes with a slate", () => {
    const { definition } = captureTemplate(finishedProject());
    const last = definition.composition.items.at(-1);
    expect(last).toMatchObject({ type: "slate", graphicId: definition.template?.endingGraphicId });
  });

  it("keeps the suggested section names of a project that has none yet", () => {
    const fresh = applyTemplateByKey("vespers")!;
    expect(captureTemplate(fresh).sections).toContain("Psalmi");
  });

  it("does not change the project it was captured from", () => {
    const project = finishedProject();
    const before = JSON.stringify(project);
    captureTemplate(project);
    expect(JSON.stringify(project)).toBe(before);
  });
});

describe("applySavedTemplate", () => {
  it("gives the new project fresh graphic ids and keeps every reference consistent", () => {
    const saved = captureTemplate(finishedProject());
    const definition = applySavedTemplate(saved, { newId: counter("n") });
    expect(projectDefinitionSchema.safeParse(definition).success).toBe(true);
    const ids = definition.graphics.map((graphic) => graphic.id);
    expect(ids).toEqual(["n-1", "n-2", "n-3", "n-4"]);
    const slateIds = definition.composition.items.flatMap((item) => (item.type === "slate" ? [item.graphicId] : []));
    expect(slateIds).toEqual(["n-1", "n-3"]);
    expect(definition.template?.endingGraphicId).toBe("n-3");
    expect(definition.template?.sectionOverlays?.[0].graphicId).toBe("n-2");
  });

  it("fills variables from the new project's title, preacher and Gospel", () => {
    const definition = applySavedTemplate(captureTemplate(finishedProject()), { title: "Helluntai", preacher: "Pekka", gospelRef: "Joh. 14:23-29" });
    expect(definition.variables).toEqual([{ key: "otsikko", value: "Helluntai" }, { key: "saarnaaja", value: "Pekka" }, { key: "evankeliumi", value: "Joh. 14:23-29" }]);
  });

  it("behaves like the original template: new sections go before the ending slate and get the Gospel overlay", () => {
    let definition = applySavedTemplate(captureTemplate(finishedProject()), { newId: counter("n") });
    definition = addSourceSection(definition, { id: "a", label: "Evankeliumi", sourceId: "s2", startSeconds: 5, endSeconds: 50 });
    definition = addSourceSection(definition, { id: "b", label: "Saarna", sourceId: "s2", startSeconds: 60, endSeconds: 300 });
    expect(definition.composition.items.map((item) => item.type)).toEqual(["slate", "source-clip", "source-clip", "slate", "overlay"]);
    expect(definition.composition.items.at(-1)).toMatchObject({ type: "overlay", graphicId: "n-2", sectionId: "a" });
  });

  it("survives a round trip through JSON, as stored in the database", () => {
    const stored = JSON.parse(JSON.stringify(captureTemplate(finishedProject())));
    expect(() => applySavedTemplate(savedTemplateSchema.parse(stored))).not.toThrow();
  });
});
