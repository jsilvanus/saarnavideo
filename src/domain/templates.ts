import { z } from "zod";
import type { ProjectDefinition, TimelineItem } from "./project";

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
 * Template defines a composition recipe: the structure of slates, overlays, and source ranges.
 * Templates are reusable across projects; they define the structure, not the specific content.
 */
export const templateDefinitionSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  themeKey: z.string().min(1),
  version: z.number().int().positive().default(1),
  /** List of semantic segment IDs this template expects (e.g., ["gospel", "sermon"]) */
  expectedSegments: z.array(z.string()).default([]),
  /** Template-level dimensions and rendering settings */
  renderSettings: z.object({
    width: z.number().int().positive().default(1920),
    height: z.number().int().positive().default(1080),
    fps: z.number().positive().default(30),
    bitrate: z.string().optional().describe("e.g. '5000k'"),
    audioCodec: z.string().default("aac"),
    audioSampleRate: z.number().int().default(48000),
  }).optional(),
  /** Composition factory function name (or inline composition logic) */
  compositionFactory: z.string().optional().describe("e.g. 'sermon', 'liturgy', 'vespers'"),
  /** Optional thumbnail template definition */
  thumbnail: z.object({
    factory: z.string().optional().describe("Thumbnail generation factory function"),
    height: z.number().int().positive().default(720),
    width: z.number().int().positive().default(1280),
  }).optional(),
});

export type Theme = z.infer<typeof themeSchema>;
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

/**
 * Factory functions that generate compositions based on semantic segments.
 * These convert semantic meaning into concrete timeline items.
 */
export type CompositionFactory = (
  sourceId: string,
  semanticSegments: Record<string, { startSeconds: number; endSeconds: number }>,
  theme: Theme
) => TimelineItem[];

/**
 * Sermon template composition:
 * - Opening slate
 * - Gospel with overlay (if gospel exists)
 * - Sermon source
 * - Optional ending slate
 */
export function sermonComposition(
  sourceId: string,
  segments: Record<string, { startSeconds: number; endSeconds: number }>,
  _theme: Theme
): TimelineItem[] {
  const items: TimelineItem[] = [];

  // Opening slate
  items.push({
    type: "slate",
    template: "opening",
    durationSeconds: 3,
    data: { title: "Service", subtitle: "" },
  });

  // Gospel with overlay (if present)
  if (segments.gospel) {
    items.push({
      type: "source-clip",
      sourceId,
      startSeconds: segments.gospel.startSeconds,
      endSeconds: segments.gospel.endSeconds,
    });
    items.push({
      type: "overlay",
      template: "gospel-text",
      startSeconds: 0,
      endSeconds: segments.gospel.endSeconds - segments.gospel.startSeconds,
      data: { text: "Gospel" },
    });
  }

  // Sermon
  if (segments.sermon) {
    items.push({
      type: "source-clip",
      sourceId,
      startSeconds: segments.sermon.startSeconds,
      endSeconds: segments.sermon.endSeconds,
    });
  }

  // Ending slate
  items.push({
    type: "slate",
    template: "ending",
    durationSeconds: 2,
    data: { title: "Thank you" },
  });

  return items;
}

/**
 * Liturgy template: continuous source with section markers.
 */
export function liturgyComposition(
  sourceId: string,
  segments: Record<string, { startSeconds: number; endSeconds: number }>,
  _theme: Theme
): TimelineItem[] {
  const items: TimelineItem[] = [];

  // Opening slate
  items.push({
    type: "slate",
    template: "opening",
    durationSeconds: 2,
    data: { title: "Divine Liturgy" },
  });

  // Collect all segments in order
  const allSegments = Object.entries(segments)
    .map(([label, range]) => ({ label, ...range }))
    .sort((a, b) => a.startSeconds - b.startSeconds);

  if (allSegments.length > 0) {
    const firstStart = allSegments[0].startSeconds;
    const lastEnd = allSegments[allSegments.length - 1].endSeconds;

    items.push({
      type: "source-clip",
      sourceId,
      startSeconds: firstStart,
      endSeconds: lastEnd,
    });
  }

  return items;
}

/**
 * Vespers template: similar to liturgy but with different opening/closing.
 */
export function vespersComposition(
  sourceId: string,
  segments: Record<string, { startSeconds: number; endSeconds: number }>,
  _theme: Theme
): TimelineItem[] {
  const items: TimelineItem[] = [];

  // Opening slate
  items.push({
    type: "slate",
    template: "opening",
    durationSeconds: 2,
    data: { title: "Vespers" },
  });

  // Collect all segments in order
  const allSegments = Object.entries(segments)
    .map(([label, range]) => ({ label, ...range }))
    .sort((a, b) => a.startSeconds - b.startSeconds);

  if (allSegments.length > 0) {
    const firstStart = allSegments[0].startSeconds;
    const lastEnd = allSegments[allSegments.length - 1].endSeconds;

    items.push({
      type: "source-clip",
      sourceId,
      startSeconds: firstStart,
      endSeconds: lastEnd,
    });
  }

  return items;
}

/** Default composition factories by key */
const COMPOSITION_FACTORIES: Record<string, CompositionFactory> = {
  sermon: sermonComposition,
  liturgy: liturgyComposition,
  vespers: vespersComposition,
};

/**
 * Resolve a composition factory by name.
 */
export function resolveCompositionFactory(name: string): CompositionFactory | null {
  return COMPOSITION_FACTORIES[name] ?? null;
}

/**
 * Global template registry instance.
 */
let globalRegistry: TemplateRegistry | null = null;

/**
 * Initialize the global template registry with default templates and themes.
 */
export function initializeDefaultTemplates(): TemplateRegistry {
  const registry = new TemplateRegistry();

  // Register default theme
  const defaultTheme: Theme = {
    key: "default",
    name: "Default Church Theme",
    description: "Clean, professional theme for church videos",
    colors: {
      primary: "#1a472a",
      secondary: "#2d5f40",
      text: "#ffffff",
      background: "#000000",
      accent: "#d4af37",
    },
    typography: {
      fontFamily: "Arial, sans-serif",
      fontSize: {
        title: 48,
        subtitle: 32,
        body: 24,
      },
    },
  };

  registry.registerTheme(defaultTheme);

  // Register default templates
  const sermonTemplate: TemplateDefinition = {
    key: "sermon",
    name: "Sermon",
    description: "Suitable for sermon videos with Gospel overlay",
    themeKey: "default",
    version: 1,
    expectedSegments: ["gospel", "sermon"],
    renderSettings: {
      width: 1920,
      height: 1080,
      fps: 30,
      bitrate: "5000k",
      audioCodec: "aac",
      audioSampleRate: 48000,
    },
    compositionFactory: "sermon",
    thumbnail: { height: 720, width: 1280, factory: "sermon-thumbnail" },
  };

  const liturgyTemplate: TemplateDefinition = {
    key: "liturgy",
    name: "Divine Liturgy",
    description: "For complete liturgical services",
    themeKey: "default",
    version: 1,
    expectedSegments: [],
    renderSettings: {
      width: 1920,
      height: 1080,
      fps: 30,
      bitrate: "4000k",
      audioCodec: "aac",
      audioSampleRate: 48000,
    },
    compositionFactory: "liturgy",
    thumbnail: { height: 720, width: 1280, factory: "generic-thumbnail" },
  };

  const vespersTemplate: TemplateDefinition = {
    key: "vespers",
    name: "Vespers",
    description: "For vespers and evening services",
    themeKey: "default",
    version: 1,
    expectedSegments: [],
    renderSettings: {
      width: 1920,
      height: 1080,
      fps: 30,
      bitrate: "4000k",
      audioCodec: "aac",
      audioSampleRate: 48000,
    },
    compositionFactory: "vespers",
    thumbnail: { height: 720, width: 1280, factory: "generic-thumbnail" },
  };

  registry.registerTemplate(sermonTemplate);
  registry.registerTemplate(liturgyTemplate);
  registry.registerTemplate(vespersTemplate);

  const validation = registry.validate();
  if (!validation.valid) {
    throw new Error(`Template registry validation failed: ${validation.errors.join("; ")}`);
  }

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
