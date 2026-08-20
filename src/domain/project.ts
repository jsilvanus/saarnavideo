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
  imageAsset: z.string().optional(), // Reference to Asset.assetKey (image with transparency)
  data: z.record(z.string(), z.string()).default({}),
}).refine((v) => v.endSeconds > v.startSeconds, "endSeconds must be greater than startSeconds");

export const slateSchema = z.object({
  type: z.literal("slate"),
  template: z.string().min(1),
  durationSeconds: z.number().positive(),
  backgroundImage: z.string().optional(), // Reference to Asset.assetKey (background with or without transparency)
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
