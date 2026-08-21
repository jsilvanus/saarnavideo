import { z } from "zod";

export const transitionSchema = z.object({
  type: z.enum(["cut", "fade", "crossfade"]),
  durationSeconds: z.number().nonnegative().default(0),
});

export const sourceClipSchema = z.object({
  type: z.literal("source-clip"),
  sourceId: z.string().min(1),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
  transitionIn: transitionSchema.optional(),
}).refine((v) => v.endSeconds > v.startSeconds, "endSeconds must be greater than startSeconds");

export const overlaySchema = z.object({
  type: z.literal("overlay"),
  template: z.string().min(1),
  kind: z.enum(["text", "rectangle", "image"]).default("text"),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
  imageAsset: z.string().optional(),
  opacity: z.number().min(0).max(1).default(1),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  color: z.string().optional(),
  data: z.record(z.string(), z.string()).default({}),
}).refine((v) => v.endSeconds > v.startSeconds, "endSeconds must be greater than startSeconds");

export const slateSchema = z.object({
  type: z.literal("slate"),
  template: z.string().min(1),
  mode: z.enum(["standalone", "overlay"]).default("standalone"),
  durationSeconds: z.number().positive(),
  startSeconds: z.number().nonnegative().optional(),
  endSeconds: z.number().positive().optional(),
  backgroundImage: z.string().optional(),
  data: z.record(z.string(), z.string()).default({}),
  transitionIn: transitionSchema.optional(),
  transitionOut: transitionSchema.optional(),
}).refine((v) => v.mode !== "overlay" || (v.startSeconds !== undefined && v.endSeconds !== undefined && v.endSeconds > v.startSeconds), "Overlay slates require valid startSeconds/endSeconds");

export const timelineItemSchema = z.discriminatedUnion("type", [sourceClipSchema, overlaySchema, slateSchema]);

export const semanticSegmentSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
}).refine((v) => v.endSeconds > v.startSeconds, "endSeconds must be greater than startSeconds");

export const compositionSchema = z.object({
  sourceStartSeconds: z.number().nonnegative(),
  sourceEndSeconds: z.number().positive(),
  items: z.array(timelineItemSchema),
});

export const templateSchema = z.object({
  key: z.string().min(1),
  width: z.number().int().positive().default(1920),
  height: z.number().int().positive().default(1080),
  fps: z.number().positive().default(30),
  fontFile: z.string().optional(),
  backgroundColor: z.string().default("black"),
  textColor: z.string().default("white"),
});

export const projectDefinitionSchema = z.object({
  version: z.literal(1),
  semanticSegments: z.array(semanticSegmentSchema),
  template: templateSchema.optional(),
  composition: compositionSchema,
});

export type Transition = z.infer<typeof transitionSchema>;
export type TimelineItem = z.infer<typeof timelineItemSchema>;
export type SemanticSegment = z.infer<typeof semanticSegmentSchema>;
export type TemplateDefinition = z.infer<typeof templateSchema>;
export type ProjectDefinition = z.infer<typeof projectDefinitionSchema>;

export function createProjectDefinition(input: Omit<ProjectDefinition, "version">): ProjectDefinition {
  return projectDefinitionSchema.parse({ version: 1, ...input });
}

const legacySourceClipSchema = z.object({
  type: z.literal("source-clip"),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
  transitionIn: transitionSchema.optional(),
}).refine((v) => v.endSeconds > v.startSeconds, "endSeconds must be greater than startSeconds");

const legacyTimelineItemSchema = z.discriminatedUnion("type", [legacySourceClipSchema, overlaySchema, slateSchema]);
const legacyProjectDefinitionSchema = z.object({
  version: z.literal(1),
  semanticSegments: z.array(semanticSegmentSchema),
  composition: z.object({ sourceStartSeconds: z.number().nonnegative().optional(), sourceEndSeconds: z.number().positive().optional(), items: z.array(legacyTimelineItemSchema) }),
});

function isSourceClip(item: TimelineItem): item is Extract<TimelineItem, { type: "source-clip" }> { return item.type === "source-clip"; }

export function migrateProjectDefinition(input: unknown, fallbackSourceId?: string): ProjectDefinition {
  const parsedCurrent = projectDefinitionSchema.safeParse(input);
  if (parsedCurrent.success) return parsedCurrent.data;
  const parsed = legacyProjectDefinitionSchema.parse(input);
  const migratedItems = parsed.composition.items.map((item) => item.type !== "source-clip" ? item : { ...item, sourceId: fallbackSourceId ?? (() => { throw new Error("A source clip is missing sourceId"); })() });
  if (migratedItems.length === 0 && fallbackSourceId && parsed.composition.sourceEndSeconds && parsed.composition.sourceStartSeconds !== undefined) {
    migratedItems.push({ type: "source-clip", sourceId: fallbackSourceId, startSeconds: parsed.composition.sourceStartSeconds, endSeconds: parsed.composition.sourceEndSeconds });
  }
  return projectDefinitionSchema.parse({
    version: 1,
    semanticSegments: parsed.semanticSegments,
    composition: { sourceStartSeconds: parsed.composition.sourceStartSeconds ?? 0, sourceEndSeconds: parsed.composition.sourceEndSeconds ?? 0.001, items: migratedItems },
  });
}

export function validateCompositionSources(definition: ProjectDefinition, sourceIds: string[]) {
  const sourceIdSet = new Set(sourceIds);
  const missingSourceIds = definition.composition.items.filter(isSourceClip).map((item) => item.sourceId).filter((sourceId) => !sourceIdSet.has(sourceId));
  if (missingSourceIds.length > 0) throw new Error(`Composition references missing sources: ${Array.from(new Set(missingSourceIds)).join(", ")}`);
}
