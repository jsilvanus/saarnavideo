import { z } from "zod";
import { createCaptionGraphic } from "@/domain/caption-style";
import type { Graphic, GraphicLayer } from "@/domain/graphics";
import { findPreset } from "@/domain/output-presets";
import { createProjectDefinition, isBaseItem, type ProjectDefinition, type TimelineItem } from "@/domain/project";
import type { Reframe } from "@/domain/reframe";
import type { Section } from "@/domain/sections";
import type { ProjectVariable } from "@/domain/variables";

/**
 * Theme defines visual styling: fonts, colors, logos, backgrounds, typography.
 * Themes are referenced by templates and can be reused across multiple templates.
 */
export const themeSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  colors: z.object({
    primary: z.string(),
    secondary: z.string().optional(),
    text: z.string(),
    background: z.string(),
    accent: z.string().optional(),
  }),
  typography: z.object({
    fontFamily: z.string(),
    fontSize: z.object({
      title: z.number().positive(),
      subtitle: z.number().positive(),
      body: z.number().positive(),
    }),
  }),
  assets: z.object({
    logo: z.string().optional(), // Path to logo image
    background: z.string().optional(), // Path to background image
    fontFile: z.string().optional(), // Path to custom font file
  }).optional(),
});

/**
 * A graphic a template puts into the project, described by its look. `buildTemplateGraphic` turns it into a
 * `Graphic` (the same scene graph the graphics editor edits) using the template's theme.
 * Texts may contain `{{variable}}` tokens; they are filled from the project's variables when rendering.
 * - "title-card": full-frame card with a title and an optional subtitle (opening and ending slates).
 * - "lower-third": transparent graphic with a text bar near the bottom (overlay on a section).
 * - "caption-style": a caption style for burned-in captions.
 */
export const graphicSpecSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["title-card", "lower-third", "caption-style"]),
  title: z.string().optional(),
  subtitle: z.string().optional(),
});

/**
 * Template defines a composition recipe: output settings, project variables, graphics, the slates around the
 * source sections, and graphics that follow sections by name (for example a Gospel text bar on "Evankeliumi").
 * Templates are reusable across projects; they define the structure, not the specific content.
 */
export const templateDefinitionSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  themeKey: z.string().min(1),
  version: z.number().int().positive().default(1),
  /** Section names the template suggests; offered as a section list in the Structure step. */
  sections: z.array(z.string().min(1)).default([]),
  /** Variable names (`{{name}}` in graphics) created with the project. */
  variables: z.array(z.string().min(1)).default([]),
  output: z.object({
    presetKey: z.string().default("youtube-1080p"),
    fps: z.number().positive().default(30),
    /** Length the duration notifier aims for. */
    targetSeconds: z.number().positive().optional(),
    reframe: z.object({ mode: z.enum(["fill", "fit"]), fitBackground: z.enum(["blur", "color"]).default("blur") }).optional(),
  }).default({ presetKey: "youtube-1080p", fps: 30 }),
  graphics: z.array(graphicSpecSchema).default([]),
  /** Standalone slates placed first and last in the composition (graphic key and length). */
  opening: z.object({ graphic: z.string().min(1), durationSeconds: z.number().positive() }).optional(),
  ending: z.object({ graphic: z.string().min(1), durationSeconds: z.number().positive() }).optional(),
  /** Added as an overlay on a new section whose name matches `section` (case-insensitive). */
  sectionOverlays: z.array(z.object({ section: z.string().min(1), graphic: z.string().min(1), durationSeconds: z.number().positive() })).default([]),
});

export type Theme = z.infer<typeof themeSchema>;
export type GraphicSpec = z.infer<typeof graphicSpecSchema>;
export type TemplateDefinition = z.infer<typeof templateDefinitionSchema>;

/**
 * TemplateRegistry manages available templates and themes.
 * Validates that templates reference existing themes and all dependencies are satisfied.
 */
export class TemplateRegistry {
  private themes: Map<string, Theme> = new Map();
  private templates: Map<string, TemplateDefinition> = new Map();

  registerTheme(theme: Theme): void {
    this.themes.set(theme.key, theme);
  }

  registerTemplate(template: TemplateDefinition): void {
    const themeKey = template.themeKey;
    if (!this.themes.has(themeKey)) {
      throw new Error(
        `Template "${template.key}" references unknown theme "${themeKey}". Register theme first.`
      );
    }
    const graphicKeys = new Set(template.graphics.map((graphic) => graphic.key));
    const used = [template.opening?.graphic, template.ending?.graphic, ...template.sectionOverlays.map((overlay) => overlay.graphic)];
    for (const key of used) {
      if (key && !graphicKeys.has(key)) throw new Error(`Template "${template.key}" uses unknown graphic "${key}".`);
    }
    if (!findPreset(template.output.presetKey)) throw new Error(`Template "${template.key}" uses unknown output preset "${template.output.presetKey}".`);
    this.templates.set(template.key, template);
  }

  getTemplate(key: string): TemplateDefinition | null {
    return this.templates.get(key) ?? null;
  }

  getTheme(key: string): Theme | null {
    return this.themes.get(key) ?? null;
  }

  listTemplates(): TemplateDefinition[] {
    return Array.from(this.templates.values());
  }

  listThemes(): Theme[] {
    return Array.from(this.themes.values());
  }

  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const [key, template] of this.templates) {
      if (!this.themes.has(template.themeKey)) {
        errors.push(`Template "${key}" references unknown theme "${template.themeKey}"`);
      }
    }

    return { valid: errors.length === 0, errors };
  }
}

const TEXT_SHADOW = "0 3px 10px #000";

function textLayer(id: string, text: string, box: Pick<GraphicLayer, "x" | "y" | "width" | "height">, style: GraphicLayer["style"]): GraphicLayer {
  return { id, type: "text", rotation: 0, text, ...box, style: { "text-align": "center", "text-shadow": TEXT_SHADOW, ...style } };
}

/** Builds the graphic a spec describes, in the theme's colours and font, on the 1920x1080 design canvas. */
export function buildTemplateGraphic(spec: GraphicSpec, theme: Theme, id: string): Graphic {
  const { colors, typography } = theme;
  const font = typography.fontFamily;
  if (spec.kind === "caption-style") return { ...createCaptionGraphic(id, spec.name) };
  if (spec.kind === "lower-third") {
    return {
      id, name: spec.name, width: 1920, height: 1080, backgroundColor: "transparent",
      layers: [
        { id: "bar", type: "rect", x: 120, y: 820, width: 1680, height: spec.subtitle ? 190 : 130, rotation: 0, style: { background: colors.primary, opacity: 0.85 } },
        textLayer("title", spec.title ?? "", { x: 160, y: 830, width: 1600, height: 90 }, { "font-family": font, "font-size": `${typography.fontSize.subtitle + 8}px`, "font-weight": "700", color: colors.text, "text-shadow": "none" }),
        ...(spec.subtitle ? [textLayer("subtitle", spec.subtitle, { x: 160, y: 925, width: 1600, height: 70 }, { "font-family": font, "font-size": `${typography.fontSize.body + 8}px`, color: colors.accent ?? colors.text, "text-shadow": "none" })] : []),
      ],
    };
  }
  return {
    id, name: spec.name, width: 1920, height: 1080, backgroundColor: colors.background,
    layers: [
      textLayer("title", spec.title ?? "", { x: 160, y: 360, width: 1600, height: 200 }, { "font-family": font, "font-size": `${typography.fontSize.title + 40}px`, "font-weight": "700", color: colors.text }),
      ...(spec.subtitle ? [textLayer("subtitle", spec.subtitle, { x: 160, y: 590, width: 1600, height: 120 }, { "font-family": font, "font-size": `${typography.fontSize.subtitle + 12}px`, color: colors.accent ?? colors.text })] : []),
    ],
  };
}

/** Facts about the project a template can fill in when it is applied. */
export type TemplateContext = {
  title?: string;
  preacher?: string;
  gospelRef?: string;
  /** Id generator; tests pass a counter so the output is deterministic. */
  newId?: () => string;
};

/** Variables the built-in templates use, and the project field that fills them in. */
export const VARIABLE_DEFAULTS: Record<string, (context: TemplateContext) => string | undefined> = {
  otsikko: (context) => context.title,
  saarnaaja: (context) => context.preacher,
  evankeliumi: (context) => context.gospelRef,
};

/**
 * Builds a new project definition from a template: output size and reframe, variables, graphics, the opening and ending
 * slates, and the rules that put graphics on matching sections later (stored in `definition.template`).
 */
export function applyTemplate(template: TemplateDefinition, theme: Theme, context: TemplateContext = {}): ProjectDefinition {
  const newId = context.newId ?? (() => crypto.randomUUID());
  const preset = findPreset(template.output.presetKey);
  const graphicIds = new Map<string, string>();
  const graphics = template.graphics.map((spec) => {
    const id = newId();
    graphicIds.set(spec.key, id);
    return buildTemplateGraphic(spec, theme, id);
  });
  const slate = (placement: { graphic: string; durationSeconds: number }): TimelineItem => ({
    type: "slate", template: "rich", mode: "standalone", durationSeconds: placement.durationSeconds, graphicId: graphicIds.get(placement.graphic), data: {},
  });
  const items: TimelineItem[] = [];
  if (template.opening) items.push(slate(template.opening));
  if (template.ending) items.push(slate(template.ending));
  const variables: ProjectVariable[] = template.variables.map((key) => ({ key, value: VARIABLE_DEFAULTS[key]?.(context) ?? "" }));
  const reframe: Reframe | undefined = template.output.reframe ? { mode: template.output.reframe.mode, fitBackground: template.output.reframe.fitBackground } : undefined;
  return createProjectDefinition({
    semanticSegments: [],
    sections: [],
    graphics,
    variables,
    template: {
      key: template.key,
      width: preset?.width ?? 1920,
      height: preset?.height ?? 1080,
      presetKey: template.output.presetKey,
      fps: template.output.fps,
      targetSeconds: template.output.targetSeconds,
      reframe,
      backgroundColor: theme.colors.background,
      textColor: theme.colors.text,
      sectionNames: template.sections.length ? template.sections : undefined,
      endingGraphicId: template.ending ? graphicIds.get(template.ending.graphic) : undefined,
      sectionOverlays: template.sectionOverlays.flatMap((overlay) => {
        const graphicId = graphicIds.get(overlay.graphic);
        return graphicId ? [{ section: overlay.section, graphicId, durationSeconds: overlay.durationSeconds }] : [];
      }),
    },
    composition: { sourceStartSeconds: 0, sourceEndSeconds: 0.001, items },
  });
}

type SourceSectionInput = { id: string; label: string; sourceId: string; startSeconds: number; endSeconds: number };

/**
 * Adds a section with its range, the clip cut from it and the template's overlay for that section name. The clip goes
 * before the template's ending slate when that slate is still the last item, so new sections never land after it.
 */
export function addSourceSection(definition: ProjectDefinition, input: SourceSectionInput): ProjectDefinition {
  const { id, label, sourceId, startSeconds, endSeconds } = input;
  const section: Section = { id, label, scope: "SOURCE", sourceId, startSeconds, endSeconds, origin: "MANUAL" };
  const items = [...definition.composition.items];
  const endingId = definition.template?.endingGraphicId;
  // Overlays and mixes sit after the base items in the list, so the ending slate is the last *base* item, not the last item.
  const lastBase = items.reduce((found, item, index) => (isBaseItem(item) ? index : found), -1);
  const ending = items[lastBase];
  const endsWithEnding = !!endingId && ending?.type === "slate" && ending.graphicId === endingId;
  const clip: TimelineItem = { type: "source-clip", sourceId, startSeconds, endSeconds };
  items.splice(endsWithEnding ? lastBase : items.length, 0, clip);

  const rule = definition.template?.sectionOverlays?.find((candidate) => candidate.section.trim().toLowerCase() === label.trim().toLowerCase());
  if (rule && (definition.graphics ?? []).some((graphic) => graphic.id === rule.graphicId)) {
    const overlayEnd = Math.min(endSeconds, startSeconds + rule.durationSeconds);
    if (overlayEnd > startSeconds) {
      items.push({ type: "overlay", template: "rich", kind: "text", graphicId: rule.graphicId, sectionId: id, startSeconds, endSeconds: overlayEnd, opacity: 1, data: {} });
    }
  }
  const hasClips = definition.composition.items.some((item) => item.type === "source-clip");
  return {
    ...definition,
    semanticSegments: [...definition.semanticSegments, { id, label, sourceId, startSeconds, endSeconds }],
    sections: [...(definition.sections ?? []), section],
    composition: {
      ...definition.composition,
      sourceStartSeconds: hasClips ? Math.min(definition.composition.sourceStartSeconds, startSeconds) : startSeconds,
      sourceEndSeconds: hasClips ? Math.max(definition.composition.sourceEndSeconds, endSeconds) : endSeconds,
      items,
    },
  };
}

/**
 * Global template registry instance.
 */
let globalRegistry: TemplateRegistry | null = null;

const BLESSING = "Herra siunatkoon sinua ja varjelkoon sinua.";

/**
 * Initialize the global template registry with the built-in templates and themes.
 * Content follows the Evangelical Lutheran Church of Finland: the order of the Mass (messu) from the church handbook,
 * the Gospel as its own section, and the Aaronic blessing as the closing card.
 */
export function initializeDefaultTemplates(): TemplateRegistry {
  const registry = new TemplateRegistry();

  const defaultTheme: Theme = {
    key: "default",
    name: "Seurakunnan perusteema",
    description: "Rauhallinen, tummanvihreä teema seurakunnan videoille",
    colors: {
      primary: "#1a472a",
      secondary: "#2d5f40",
      text: "#ffffff",
      background: "#000000",
      accent: "#d4af37",
    },
    typography: {
      fontFamily: "DejaVu Sans",
      fontSize: {
        title: 48,
        subtitle: 32,
        body: 24,
      },
    },
  };

  registry.registerTheme(defaultTheme);

  const opening: GraphicSpec = { key: "opening", name: "Aloitus", kind: "title-card", title: "{{otsikko}}", subtitle: "{{saarnaaja}}" };
  const ending: GraphicSpec = { key: "ending", name: "Lopetus", kind: "title-card", title: "Kiitos katsomisesta", subtitle: BLESSING };
  const gospel: GraphicSpec = { key: "gospel", name: "Evankeliumi-alateksti", kind: "lower-third", title: "Evankeliumi", subtitle: "{{evankeliumi}}" };
  const captions: GraphicSpec = { key: "captions", name: "Tekstityksen tyyli", kind: "caption-style" };
  const common = { themeKey: "default", version: 1, opening: { graphic: "opening", durationSeconds: 4 }, ending: { graphic: "ending", durationSeconds: 5 } };

  registry.registerTemplate(templateDefinitionSchema.parse({
    ...common,
    key: "sermon",
    name: "Saarna",
    description: "Saarnavideo: aloituskortti, evankeliumi alatekstillä, saarna ja siunaus lopussa",
    sections: ["Evankeliumi", "Saarna"],
    variables: ["otsikko", "saarnaaja", "evankeliumi"],
    output: { presetKey: "youtube-1080p", fps: 30, targetSeconds: 15 * 60 },
    graphics: [opening, gospel, ending, captions],
    sectionOverlays: [{ section: "Evankeliumi", graphic: "gospel", durationSeconds: 8 }],
  }));

  registry.registerTemplate(templateDefinitionSchema.parse({
    ...common,
    key: "liturgy",
    name: "Messu",
    description: "Koko jumalanpalvelus messun kulun mukaan, evankeliumi alatekstillä",
    sections: [
      "Alkuvirsi", "Johdanto", "Herra armahda", "Kunnia Jumalalle", "Päivän rukous",
      "Vanhan testamentin lukukappale", "Epistola", "Evankeliumi", "Uskontunnustus", "Saarna",
      "Esirukous", "Pyhä", "Isä meidän", "Jumalan Karitsa", "Ehtoollisen vietto", "Siunaus", "Loppuvirsi",
    ],
    variables: ["otsikko", "saarnaaja", "evankeliumi"],
    output: { presetKey: "youtube-1080p", fps: 30 },
    graphics: [opening, gospel, ending, captions],
    sectionOverlays: [{ section: "Evankeliumi", graphic: "gospel", durationSeconds: 8 }],
  }));

  registry.registerTemplate(templateDefinitionSchema.parse({
    ...common,
    key: "vespers",
    name: "Iltahartaus",
    description: "Iltahartaus tai vesper: virsi, raamatunluku, hartaus, rukous ja siunaus",
    sections: ["Alkuvirsi", "Psalmi", "Raamatunluku", "Hartaus", "Rukous", "Isä meidän", "Siunaus", "Loppuvirsi"],
    variables: ["otsikko", "saarnaaja"],
    output: { presetKey: "youtube-1080p", fps: 30 },
    graphics: [opening, ending, captions],
  }));

  registry.registerTemplate(templateDefinitionSchema.parse({
    themeKey: "default",
    version: 1,
    key: "short-vertical",
    name: "Lyhyt pystyvideo",
    description: "Ote saarnasta pystyvideoksi (Shorts, Reels, TikTok): tavoite alle minuutti, polttotekstitys",
    sections: ["Ote saarnasta"],
    variables: ["otsikko", "saarnaaja"],
    output: { presetKey: "youtube-shorts", fps: 30, targetSeconds: 60, reframe: { mode: "fill", fitBackground: "blur" } },
    graphics: [{ ...opening, name: "Aloitus (pysty)" }, captions],
    opening: { graphic: "opening", durationSeconds: 2 },
  }));

  globalRegistry = registry;
  return registry;
}

/**
 * Get the global template registry, initializing if necessary.
 */
export function getTemplateRegistry(): TemplateRegistry {
  if (!globalRegistry) {
    globalRegistry = initializeDefaultTemplates();
  }
  return globalRegistry;
}

/** Applies a built-in template by key; null for an unknown key (including "basic", a project with no template). */
export function applyTemplateByKey(key: string, context: TemplateContext = {}): ProjectDefinition | null {
  const registry = getTemplateRegistry();
  const template = registry.getTemplate(key);
  const theme = template ? registry.getTheme(template.themeKey) : null;
  return template && theme ? applyTemplate(template, theme, context) : null;
}
