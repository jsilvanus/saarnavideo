import { z } from "zod";
import { graphicSchema, type Graphic } from "@/domain/graphics";
import { sectionSchema, type Section } from "@/domain/sections";
import { reframeSchema } from "@/domain/reframe";
import { evenDimension } from "@/domain/output-presets";

export const transitionSchema = z.object({
  type: z.enum(["cut", "fade", "crossfade"]),
  durationSeconds: z.number().nonnegative().default(0),
});

const endAfterStart = [(v: { startSeconds: number; endSeconds: number }) => v.endSeconds > v.startSeconds, "endSeconds must be greater than startSeconds"] as const;

const sourceClipFields = {
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
  transitionIn: transitionSchema.optional(),
};

export const sourceClipSchema = z.object({ type: z.literal("source-clip"), sourceId: z.string().min(1), reframe: reframeSchema.optional(), ...sourceClipFields }).refine(...endAfterStart);

export const overlaySchema = z.object({
  type: z.literal("overlay"),
  template: z.string().min(1).default("rich"),
  graphicId: z.string().min(1).optional(),
  sectionId: z.string().min(1).optional(),
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
}).refine(...endAfterStart);

export const slateSchema = z.object({
  type: z.literal("slate"),
  template: z.string().min(1).default("rich"),
  graphicId: z.string().min(1).optional(),
  mode: z.enum(["standalone", "overlay"]).default("standalone"),
  durationSeconds: z.number().positive(),
  startSeconds: z.number().nonnegative().optional(),
  endSeconds: z.number().positive().optional(),
  backgroundImage: z.string().optional(),
  data: z.record(z.string(), z.string()).default({}),
  transitionIn: transitionSchema.optional(),
  transitionOut: transitionSchema.optional(),
}).refine((v) => v.mode !== "overlay" || (v.startSeconds !== undefined && v.endSeconds !== undefined && v.endSeconds > v.startSeconds), "Overlay slates require valid startSeconds/endSeconds");

/**
 * An audio asset (voiceover, jingle) on the timeline. `startSeconds`/`endSeconds` trim the audio file itself, so the
 * clip's length (endSeconds - startSeconds) is known without probing.
 * - "standalone": a section in sequence with the other base items. In the video it shows a background (the graphic,
 *   `backgroundImage` or the template background colour) and plays the clip instead of source audio; in the podcast it is
 *   a voice-only section.
 * - "mix": layered over the finished timeline from `atSeconds` (output-timeline seconds of the video) for its own length.
 *   The source audio underneath is multiplied by `duckSourceVolume` (1 = not lowered) while the clip plays.
 */
export const audioClipSchema = z.object({
  type: z.literal("audio-clip"),
  assetId: z.string().min(1),
  mode: z.enum(["standalone", "mix"]).default("standalone"),
  startSeconds: z.number().nonnegative().default(0),
  endSeconds: z.number().positive(),
  volume: z.number().min(0).max(4).default(1),
  atSeconds: z.number().nonnegative().default(0),
  duckSourceVolume: z.number().min(0).max(1).default(1),
  graphicId: z.string().min(1).optional(),
  backgroundImage: z.string().optional(),
  data: z.record(z.string(), z.string()).default({}),
  transitionIn: transitionSchema.optional(),
}).refine(...endAfterStart);

export const timelineItemSchema = z.discriminatedUnion("type", [sourceClipSchema, overlaySchema, slateSchema, audioClipSchema]);

export const semanticSegmentSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  sourceId: z.string().min(1).optional(),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
}).refine(...endAfterStart);

export const compositionSchema = z.object({
  sourceStartSeconds: z.number().nonnegative(),
  sourceEndSeconds: z.number().positive(),
  items: z.array(timelineItemSchema),
});

export const templateSchema = z.object({
  key: z.string().min(1),
  /** Output size in pixels (even numbers). Graphics and caption styles are authored at 1920x1080 and scaled to it. */
  width: evenDimension.default(1920),
  height: evenDimension.default(1080),
  /** Key of the chosen output preset (see output-presets.ts); informational, width/height are what renders. */
  presetKey: z.string().optional(),
  /** Length the editor is aiming for; the duration notifier warns when the composition drifts away from it. */
  targetSeconds: z.number().positive().optional(),
  /** Project default for fitting source pictures into the frame; sections and clips can override it. */
  reframe: reframeSchema.optional(),
  fps: z.number().positive().default(30),
  fontFile: z.string().optional(),
  backgroundColor: z.string().default("black"),
  textColor: z.string().default("white"),
});

/** Podcast (audio-only) export settings. Intro/outro are audio assets and are used for the podcast only, never for the video. */
export const podcastSettingsSchema = z.object({
  introAssetId: z.string().min(1).optional(),
  outroAssetId: z.string().min(1).optional(),
  format: z.enum(["mp3", "m4a"]).default("mp3"),
  channels: z.enum(["mono", "stereo"]).default("mono"),
  /** Crossfade between intro/body/outro in seconds; 0 = plain concatenation. */
  crossfadeSeconds: z.number().min(0).max(5).default(0.5),
  /** ID3/MP4 tags; empty values fall back to the project (title, preacher, gospel reference). */
  title: z.string().trim().max(200).optional(),
  artist: z.string().trim().max(200).optional(),
  album: z.string().trim().max(200).optional(),
  date: z.string().trim().max(32).optional(),
  comment: z.string().trim().max(1000).optional(),
});

export const projectDefinitionSchema = z.object({
  version: z.literal(1),
  semanticSegments: z.array(semanticSegmentSchema),
  sections: z.array(sectionSchema).default([]),
  graphics: z.array(graphicSchema).default([]),
  template: templateSchema.optional(),
  composition: compositionSchema,
  podcast: podcastSettingsSchema.optional(),
});

export type Transition = z.infer<typeof transitionSchema>;
export type TimelineItem = z.infer<typeof timelineItemSchema>;
/** The two TimelineItem variants that carry graphic-editor state (`data`, `graphicId`) and are drawn by the graphics pipeline. */
export type GraphicCarrierItem = Extract<TimelineItem, { type: "overlay" }> | Extract<TimelineItem, { type: "slate" }>;
export type AudioClipItem = Extract<TimelineItem, { type: "audio-clip" }>;
export type PodcastSettings = z.infer<typeof podcastSettingsSchema>;
/** Timeline items that occupy time in sequence: source clips, standalone slates and standalone audio clips. */
export type BaseItem = Extract<TimelineItem, { type: "source-clip" }> | Extract<TimelineItem, { type: "slate" }> | AudioClipItem;
export function isBaseItem(item: TimelineItem): item is BaseItem {
  return item.type === "source-clip" || (item.type === "slate" && item.mode !== "overlay") || (item.type === "audio-clip" && item.mode !== "mix");
}
export function baseItemDuration(item: BaseItem): number {
  return item.type === "slate" ? item.durationSeconds : item.endSeconds - item.startSeconds;
}
export type SemanticSegment = z.infer<typeof semanticSegmentSchema>;
export type { Section };
export type TemplateDefinition = z.infer<typeof templateSchema>;
export type ProjectDefinition = z.infer<typeof projectDefinitionSchema>;
export type { Graphic };

export function createProjectDefinition(input: Omit<z.input<typeof projectDefinitionSchema>, "version">): ProjectDefinition {
  return projectDefinitionSchema.parse({ version: 1, ...input });
}

const legacySourceClipSchema = z.object({ type: z.literal("source-clip"), ...sourceClipFields }).refine(...endAfterStart);

const legacyTimelineItemSchema = z.discriminatedUnion("type", [legacySourceClipSchema, overlaySchema, slateSchema]);
const legacyProjectDefinitionSchema = z.object({
  version: z.literal(1),
  semanticSegments: z.array(semanticSegmentSchema),
  template: templateSchema.optional(),
  composition: z.object({ sourceStartSeconds: z.number().nonnegative().optional(), sourceEndSeconds: z.number().positive().optional(), items: z.array(legacyTimelineItemSchema) }),
});

function isSourceClip(item: TimelineItem): item is Extract<TimelineItem, { type: "source-clip" }> { return item.type === "source-clip"; }

export function migrateProjectDefinition(input: unknown, fallbackSourceId?: string): ProjectDefinition {
  const parsedCurrent = projectDefinitionSchema.safeParse(input);
  if (parsedCurrent.success) return parsedCurrent.data;
  const parsed = legacyProjectDefinitionSchema.parse(input);
  const migratedItems: TimelineItem[] = parsed.composition.items.map((item) => {
    if (item.type !== "source-clip") return item;
    if (fallbackSourceId == null) throw new Error("A source clip is missing sourceId");
    return { ...item, sourceId: fallbackSourceId };
  });
  if (migratedItems.length === 0 && fallbackSourceId && parsed.composition.sourceEndSeconds && parsed.composition.sourceStartSeconds !== undefined) {
    migratedItems.push({ type: "source-clip", sourceId: fallbackSourceId, startSeconds: parsed.composition.sourceStartSeconds, endSeconds: parsed.composition.sourceEndSeconds });
  }
  return projectDefinitionSchema.parse({
    version: 1,
    semanticSegments: parsed.semanticSegments,
    sections: parsed.semanticSegments.map((segment) => ({ ...segment, scope: "SOURCE" as const, origin: "MANUAL" as const })),
    graphics: [],
    template: parsed.template,
    composition: { sourceStartSeconds: parsed.composition.sourceStartSeconds ?? 0, sourceEndSeconds: parsed.composition.sourceEndSeconds ?? 0.001, items: migratedItems },
  });
}

export function validateCompositionSources(definition: ProjectDefinition, sourceIds: string[]) {
  const sourceIdSet = new Set(sourceIds);
  const missingSourceIds = definition.composition.items.filter(isSourceClip).map((item) => item.sourceId).filter((sourceId) => !sourceIdSet.has(sourceId));
  if (missingSourceIds.length > 0) throw new Error(`Composition references missing sources: ${Array.from(new Set(missingSourceIds)).join(", ")}`);
  const graphicIds = new Set(definition.graphics.map((graphic) => graphic.id));
  const missingGraphics = definition.composition.items.filter((item): item is GraphicCarrierItem | AudioClipItem => item.type !== "source-clip" && !!item.graphicId).map((item) => item.graphicId!).filter((id) => !graphicIds.has(id));
  if (missingGraphics.length > 0) throw new Error(`Composition references missing graphics: ${Array.from(new Set(missingGraphics)).join(", ")}`);
}
