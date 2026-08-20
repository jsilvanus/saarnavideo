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
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
  data: z.record(z.string(), z.string()).default({}),
}).refine((v) => v.endSeconds > v.startSeconds, "endSeconds must be greater than startSeconds");

export const slateSchema = z.object({
  type: z.literal("slate"),
  template: z.string().min(1),
  durationSeconds: z.number().positive(),
  data: z.record(z.string(), z.string()).default({}),
  transitionIn: transitionSchema.optional(),
  transitionOut: transitionSchema.optional(),
});

export const timelineItemSchema = z.discriminatedUnion("type", [
  sourceClipSchema,
  overlaySchema,
  slateSchema,
]);

export const semanticSegmentSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
}).refine((v) => v.endSeconds > v.startSeconds, "endSeconds must be greater than startSeconds");

export const compositionSchema = z.object({
  items: z.array(timelineItemSchema),
});

export const projectDefinitionSchema = z.object({
  version: z.literal(1),
  semanticSegments: z.array(semanticSegmentSchema),
  composition: compositionSchema,
});

export type Transition = z.infer<typeof transitionSchema>;
export type TimelineItem = z.infer<typeof timelineItemSchema>;
export type SemanticSegment = z.infer<typeof semanticSegmentSchema>;
export type ProjectDefinition = z.infer<typeof projectDefinitionSchema>;

const legacySourceClipSchema = z.object({
  type: z.literal("source-clip"),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
  transitionIn: transitionSchema.optional(),
}).refine((v) => v.endSeconds > v.startSeconds, "endSeconds must be greater than startSeconds");

const legacyTimelineItemSchema = z.discriminatedUnion("type", [
  legacySourceClipSchema,
  overlaySchema,
  slateSchema,
]);

const legacyProjectDefinitionSchema = z.object({
  version: z.literal(1),
  semanticSegments: z.array(semanticSegmentSchema),
  composition: z.object({
    sourceStartSeconds: z.number().nonnegative().optional(),
    sourceEndSeconds: z.number().positive().optional(),
    items: z.array(legacyTimelineItemSchema),
  }),
});

function isSourceClip(item: TimelineItem): item is Extract<TimelineItem, { type: "source-clip" }> {
  return item.type === "source-clip";
}

export function createProjectDefinition(input: Omit<ProjectDefinition, "version">): ProjectDefinition {
  return projectDefinitionSchema.parse({ version: 1, ...input });
}

export function migrateProjectDefinition(input: unknown, fallbackSourceId?: string): ProjectDefinition {
  const parsed = legacyProjectDefinitionSchema.parse(input);
  const migratedItems = parsed.composition.items.map((item) => {
    if (item.type !== "source-clip") return item;
    if (!fallbackSourceId) throw new Error("A source clip is missing sourceId");
    return {
      ...item,
      sourceId: fallbackSourceId,
    };
  });

  const normalizedItems = migratedItems;

  if (normalizedItems.length === 0 && fallbackSourceId && parsed.composition.sourceEndSeconds && parsed.composition.sourceStartSeconds !== undefined) {
    normalizedItems.push({
      type: "source-clip",
      sourceId: fallbackSourceId,
      startSeconds: parsed.composition.sourceStartSeconds,
      endSeconds: parsed.composition.sourceEndSeconds,
    });
  }

  const definition = projectDefinitionSchema.parse({
    version: 1,
    semanticSegments: parsed.semanticSegments,
    composition: {
      items: normalizedItems,
    },
  });

  const missingSourceId = definition.composition.items.some((item) => item.type === "source-clip" && !item.sourceId);
  if (missingSourceId) throw new Error("A source clip is missing sourceId");

  return definition;
}

export function validateCompositionSources(definition: ProjectDefinition, sourceIds: string[]) {
  const sourceIdSet = new Set(sourceIds);
  const missingSourceIds = definition.composition.items
    .filter(isSourceClip)
    .map((item) => item.sourceId)
    .filter((sourceId) => !sourceIdSet.has(sourceId));

  if (missingSourceIds.length > 0) {
    throw new Error(`Composition references missing sources: ${Array.from(new Set(missingSourceIds)).join(", ")}`);
  }
}
