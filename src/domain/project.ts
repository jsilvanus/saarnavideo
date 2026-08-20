import { z } from "zod";

export const sourceTypeSchema = z.enum(["UPLOAD", "YOUTUBE"]);

export const sourceSchema = z.object({
  id: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  type: sourceTypeSchema,
  youtubeVideoId: z.string().min(1).nullable().optional(),
  youtubeUrl: z.string().url().nullable().optional(),
  originalName: z.string().min(1).nullable().optional(),
  storagePath: z.string().min(1).nullable().optional(),
  mimeType: z.string().min(1).nullable().optional(),
  sizeBytes: z.number().nonnegative().nullable().optional(),
  durationMs: z.number().nonnegative().nullable().optional(),
  createdAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
});

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
  transitionOut: transitionSchema.optional(),
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
  sourceStartSeconds: z.number().nonnegative(),
  sourceEndSeconds: z.number().positive(),
  items: z.array(timelineItemSchema),
});

export const projectDefinitionSchema = z.object({
  version: z.literal(1),
  semanticSegments: z.array(semanticSegmentSchema),
  composition: compositionSchema,
});

export type Source = z.infer<typeof sourceSchema>;
export type Transition = z.infer<typeof transitionSchema>;
export type TimelineItem = z.infer<typeof timelineItemSchema>;
export type SemanticSegment = z.infer<typeof semanticSegmentSchema>;
export type ProjectDefinition = z.infer<typeof projectDefinitionSchema>;

export function createProjectDefinition(input: Omit<ProjectDefinition, "version">): ProjectDefinition {
  return projectDefinitionSchema.parse({ version: 1, ...input });
}

export function collectSourceIds(definition: ProjectDefinition): string[] {
  const ids = definition.composition.items.flatMap((item) => item.type === "source-clip" ? [item.sourceId] : []);
  return [...new Set(ids)];
}

export function validateCompositionSources(definition: ProjectDefinition, sourceIds: Iterable<string>): void {
  const valid = new Set(sourceIds);
  const missing = collectSourceIds(definition).filter((sourceId) => !valid.has(sourceId));
  if (missing.length > 0) {
    throw new Error(`Composition references missing source IDs: ${missing.join(", ")}`);
  }
}
