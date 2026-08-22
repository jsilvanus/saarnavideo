import { buildSourceRenderPlan, type FfmpegPlan } from "@/renderer/ffmpeg";
import type { Graphic, ProjectDefinition, TimelineItem } from "@/domain/project";

function withGraphicLayers(item: TimelineItem, graphic: Graphic): TimelineItem {
  const data = { ...(item.data ?? {}), layers: JSON.stringify(graphic.layers), backgroundColor: graphic.backgroundColor };
  if (item.type === "slate") return { ...item, template: "rich", data };
  return { ...item, template: "rich", kind: "text", data };
}

/** Resolve reusable graphics into the existing FFmpeg slate/overlay primitives. */
export function materializeGraphics(definition: ProjectDefinition): ProjectDefinition {
  const graphics = new Map(definition.graphics.map((graphic) => [graphic.id, graphic]));
  const items = definition.composition.items.map((item) => {
    if (item.type === "source-clip") return item;
    if (!item.graphicId) return item;
    const graphic = graphics.get(item.graphicId);
    if (!graphic) throw new Error(`Missing graphic definition: ${item.graphicId}`);
    return withGraphicLayers(item, graphic);
  });
  return { ...definition, composition: { ...definition.composition, items } };
}

export function buildCompositionRenderPlan(
  definition: ProjectDefinition,
  sourcePaths: Map<string, string>,
  outputPath: string,
  assetPaths?: Map<string, string>,
): FfmpegPlan {
  return buildSourceRenderPlan(materializeGraphics(definition), sourcePaths, outputPath, assetPaths);
}
