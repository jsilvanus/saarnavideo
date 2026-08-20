import { z } from "zod";

export const transitionSchema = z.object({
  type: z.enum(["cut", "fade", "crossfade"]),
  durationSeconds: z.number().nonnegative().default(0),
});

const timingSchema = z.object({
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
}).refine((v) => v.endSeconds > v.startSeconds, "endSeconds must be greater than startSeconds");

export const sourceClipSchema = timingSchema.extend({
  type: z.literal("source-clip"),
  transitionIn: transitionSchema.optional(),
});

export const overlaySchema = timingSchema.extend({
  type: z.literal("overlay"),
  template: z.string().min(1),
  data: z.record(z.string(), z.string()).default({}),
});

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

export const semanticSegmentSchema = timingSchema.extend({
  id: z.string().min(1),
  label: z.string().min(1),
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

export const compositionSchema = z.object({
  sourceStartSeconds: z.number().nonnegative(),
  sourceEndSeconds: z.number().positive(),
  items: z.array(timelineItemSchema),
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

export function timelineDuration(item: TimelineItem): number {
  if (item.type === "slate") return item.durationSeconds;
  return item.endSeconds - item.startSeconds;
}
