import { z } from "zod";

export const sourceClipSchema = z.object({
  type: z.literal("source-clip"),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
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

export type TimelineItem = z.infer<typeof timelineItemSchema>;
export type SemanticSegment = z.infer<typeof semanticSegmentSchema>;
export type ProjectDefinition = z.infer<typeof projectDefinitionSchema>;

export function createProjectDefinition(input: Omit<ProjectDefinition, "version">): ProjectDefinition {
  return projectDefinitionSchema.parse({ version: 1, ...input });
}
