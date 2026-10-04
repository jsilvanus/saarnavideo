import { describe, expect, it } from "vitest";
import {
  addSourceSection,
  applyTemplate,
  applyTemplateByKey,
  getTemplateRegistry,
  initializeDefaultTemplates,
  templateDefinitionSchema,
} from "./templates";
import { projectDefinitionSchema } from "./project";
import { findPreset } from "./output-presets";
import { validateRenderSettings } from "./render-settings";
import { validateSourceFile, validateDuration, validateCompositionDuration, formatBytes, formatDuration } from "./validation";

const counter = () => {
  let n = 0;
  return () => `id-${++n}`;
};

describe("Template System", () => {
  describe("TemplateRegistry", () => {
    it("initializes with the built-in templates", () => {
      const registry = initializeDefaultTemplates();
      expect(registry.listTemplates().map((template) => template.key)).toEqual(["sermon", "liturgy", "vespers", "short-vertical"]);
      expect(registry.validate()).toEqual({ valid: true, errors: [] });
    });

    it("every template uses a known output preset, theme and its own graphics", () => {
      const registry = initializeDefaultTemplates();
      for (const template of registry.listTemplates()) {
        expect(findPreset(template.output.presetKey), template.key).toBeDefined();
        expect(registry.getTheme(template.themeKey), template.key).not.toBeNull();
        const keys = new Set(template.graphics.map((graphic) => graphic.key));
        for (const rule of template.sectionOverlays) expect(keys.has(rule.graphic)).toBe(true);
      }
    });

    it("rejects a template that points at a graphic it does not define", () => {
      const registry = initializeDefaultTemplates();
      const broken = templateDefinitionSchema.parse({ key: "broken", name: "Broken", themeKey: "default", opening: { graphic: "missing", durationSeconds: 2 } });
      expect(() => registry.registerTemplate(broken)).toThrow(/unknown graphic/);
    });

    it("rejects a template with an unknown theme or output preset", () => {
      const registry = initializeDefaultTemplates();
      expect(() => registry.registerTemplate(templateDefinitionSchema.parse({ key: "a", name: "A", themeKey: "nope" }))).toThrow(/unknown theme/);
      expect(() => registry.registerTemplate(templateDefinitionSchema.parse({ key: "b", name: "B", themeKey: "default", output: { presetKey: "nope" } }))).toThrow(/unknown output preset/);
    });

    it("follows the order of the Mass in the liturgy template", () => {
      const sections = getTemplateRegistry().getTemplate("liturgy")!.sections;
      expect(sections.indexOf("Evankeliumi")).toBeLessThan(sections.indexOf("Saarna"));
      expect(sections.indexOf("Saarna")).toBeLessThan(sections.indexOf("Ehtoollisen vietto"));
      expect(sections.at(-1)).toBe("Loppuvirsi");
    });
  });

  describe("applyTemplate", () => {
    it("builds a valid definition with graphics, slates, variables and output settings", () => {
      const definition = applyTemplateByKey("sermon", { title: "Kolmas sunnuntai", preacher: "Maija Mäkinen", gospelRef: "Joh. 3:16-21", newId: counter() })!;
      expect(projectDefinitionSchema.safeParse(definition).success).toBe(true);
      expect(validateRenderSettings(definition)).toEqual([]);
      expect(definition.template).toMatchObject({ key: "sermon", width: 1920, height: 1080, presetKey: "youtube-1080p", targetSeconds: 900 });
      expect(definition.variables).toEqual([
        { key: "otsikko", value: "Kolmas sunnuntai" },
        { key: "saarnaaja", value: "Maija Mäkinen" },
        { key: "evankeliumi", value: "Joh. 3:16-21" },
      ]);
      expect(definition.graphics.map((graphic) => graphic.name)).toEqual(["Aloitus", "Evankeliumi-alateksti", "Lopetus", "Tekstityksen tyyli"]);
      const [opening, ending] = definition.composition.items;
      expect(opening).toMatchObject({ type: "slate", mode: "standalone", graphicId: "id-1", durationSeconds: 4 });
      expect(ending).toMatchObject({ type: "slate", mode: "standalone", graphicId: "id-3" });
      expect(definition.template?.endingGraphicId).toBe("id-3");
      expect(definition.template?.sectionOverlays).toEqual([{ section: "Evankeliumi", graphicId: "id-2", durationSeconds: 8 }]);
    });

    it("puts the title and the Gospel reference in the graphics as variables", () => {
      const definition = applyTemplateByKey("sermon")!;
      const text = (name: string) => definition.graphics.find((graphic) => graphic.name === name)!.layers.map((layer) => layer.text).join("|");
      expect(text("Aloitus")).toContain("{{otsikko}}");
      expect(text("Aloitus")).toContain("{{saarnaaja}}");
      expect(text("Evankeliumi-alateksti")).toContain("{{evankeliumi}}");
      expect(text("Lopetus")).toContain("Herra siunatkoon sinua");
    });

    it("sets the vertical size, reframe and target length for the short template", () => {
      const definition = applyTemplateByKey("short-vertical")!;
      expect(definition.template).toMatchObject({ width: 1080, height: 1920, presetKey: "youtube-shorts", targetSeconds: 60, reframe: { mode: "fill", fitBackground: "blur" } });
      expect(definition.composition.items).toHaveLength(1);
      expect(definition.template?.endingGraphicId).toBeUndefined();
    });

    it("returns null for an unknown key and for the blank project", () => {
      expect(applyTemplateByKey("basic")).toBeNull();
      expect(applyTemplateByKey("nope")).toBeNull();
    });

    it("gives every application its own graphic ids", () => {
      const registry = getTemplateRegistry();
      const template = registry.getTemplate("vespers")!;
      const theme = registry.getTheme("default")!;
      const a = applyTemplate(template, theme), b = applyTemplate(template, theme);
      expect(a.graphics[0].id).not.toBe(b.graphics[0].id);
    });
  });

  describe("addSourceSection", () => {
    const sermon = () => applyTemplateByKey("sermon", { newId: counter() })!;

    it("inserts new clips before the ending slate, in the order they are added", () => {
      let definition = sermon();
      definition = addSourceSection(definition, { id: "s1", label: "Evankeliumi", sourceId: "src", startSeconds: 10, endSeconds: 70 });
      definition = addSourceSection(definition, { id: "s2", label: "Saarna", sourceId: "src", startSeconds: 100, endSeconds: 900 });
      const types = definition.composition.items.map((item) => (item.type === "slate" ? "slate" : item.type === "source-clip" ? `clip:${item.startSeconds}` : "overlay"));
      expect(types).toEqual(["slate", "clip:10", "clip:100", "slate", "overlay"]);
      expect(definition.composition).toMatchObject({ sourceStartSeconds: 10, sourceEndSeconds: 900 });
      expect(definition.sections.map((section) => section.label)).toEqual(["Evankeliumi", "Saarna"]);
      expect(definition.semanticSegments).toHaveLength(2);
    });

    it("adds the template overlay only to a section with a matching name, at most for its rule's length", () => {
      let definition = sermon();
      definition = addSourceSection(definition, { id: "s1", label: " evankeliumi ", sourceId: "src", startSeconds: 10, endSeconds: 70 });
      definition = addSourceSection(definition, { id: "s2", label: "Saarna", sourceId: "src", startSeconds: 100, endSeconds: 900 });
      definition = addSourceSection(definition, { id: "s3", label: "Evankeliumi", sourceId: "src", startSeconds: 1000, endSeconds: 1003 });
      const overlays = definition.composition.items.filter((item) => item.type === "overlay");
      expect(overlays).toMatchObject([
        { sectionId: "s1", graphicId: "id-2", startSeconds: 10, endSeconds: 18 },
        { sectionId: "s3", graphicId: "id-2", startSeconds: 1000, endSeconds: 1003 },
      ]);
    });

    it("appends after the last item when the ending slate is no longer last", () => {
      let definition = sermon();
      definition = { ...definition, composition: { ...definition.composition, items: [...definition.composition.items, { type: "slate", template: "rich", mode: "standalone", durationSeconds: 3, data: {} }] } };
      definition = addSourceSection(definition, { id: "s1", label: "Saarna", sourceId: "src", startSeconds: 0, endSeconds: 30 });
      expect(definition.composition.items.at(-1)).toMatchObject({ type: "source-clip" });
    });

    it("behaves like a plain project when there is no template", () => {
      const plain = projectDefinitionSchema.parse({ version: 1, semanticSegments: [], composition: { sourceStartSeconds: 0, sourceEndSeconds: 0.001, items: [] } });
      const definition = addSourceSection(plain, { id: "s1", label: "A", sourceId: "src", startSeconds: 5, endSeconds: 9 });
      expect(definition.composition).toMatchObject({ sourceStartSeconds: 5, sourceEndSeconds: 9 });
      expect(definition.composition.items).toEqual([{ type: "source-clip", sourceId: "src", startSeconds: 5, endSeconds: 9 }]);
    });
  });
});

describe("Resource Validation", () => {
  describe("File Size Validation", () => {
    it("accepts file within limits", () => {
      const result = validateSourceFile(1024 * 1024, {
        maxSourceFileSizeBytes: 50 * 1024 * 1024,
      });
      expect(result.valid).toBe(true);
    });

    it("rejects empty file", () => {
      const result = validateSourceFile(0, {
        maxSourceFileSizeBytes: 50 * 1024 * 1024,
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("empty");
    });

    it("rejects oversized file", () => {
      const result = validateSourceFile(100 * 1024 * 1024, {
        maxSourceFileSizeBytes: 50 * 1024 * 1024,
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("exceeds maximum size");
    });
  });

  describe("Duration Validation", () => {
    it("accepts duration within limits", () => {
      const result = validateDuration(3600, { maxDurationSeconds: 12 * 3600 });
      expect(result.valid).toBe(true);
    });

    it("rejects zero/negative duration", () => {
      const result = validateDuration(0, { maxDurationSeconds: 12 * 3600 });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("positive");
    });

    it("rejects excessive duration", () => {
      const result = validateDuration(48 * 3600, { maxDurationSeconds: 12 * 3600 });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("exceeds maximum");
    });
  });

  describe("Composition Duration Validation", () => {
    it("validates composition within limits", () => {
      const result = validateCompositionDuration(3600, {
        maxDurationSeconds: 12 * 3600,
      });
      expect(result.valid).toBe(true);
      expect(result.totalDurationSeconds).toBe(3600);
    });

    it("reports validation errors", () => {
      const result = validateCompositionDuration(48 * 3600, {
        maxDurationSeconds: 12 * 3600,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("Formatting", () => {
    it("formats bytes to human-readable", () => {
      expect(formatBytes(1024)).toBe("1 KB");
      expect(formatBytes(1024 * 1024)).toBe("1 MB");
      expect(formatBytes(1024 * 1024 * 1024)).toBe("1 GB");
    });

    it("formats duration to HH:MM:SS", () => {
      expect(formatDuration(3661)).toBe("01:01:01");
      expect(formatDuration(7200)).toBe("02:00:00");
      expect(formatDuration(60)).toBe("00:01:00");
    });
  });
});

describe("Global Template Registry", () => {
  it("returns initialized registry on first access", () => {
    const registry = getTemplateRegistry();
    expect(registry).toBeDefined();
    expect(registry.listTemplates().length).toBe(4);
  });

  it("returns same instance on subsequent access", () => {
    const registry1 = getTemplateRegistry();
    const registry2 = getTemplateRegistry();
    expect(registry1).toBe(registry2);
  });
});
