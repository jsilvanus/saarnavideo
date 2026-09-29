import { buildSourceRenderPlan, type FfmpegPlan, type RenderPlanOptions } from "@/renderer/ffmpeg";
import type { Graphic, GraphicCarrierItem, ProjectDefinition } from "@/domain/project";

function withGraphicLayers(item: GraphicCarrierItem, graphic: Graphic): GraphicCarrierItem {
  const data = { ...item.data, layers: JSON.stringify(graphic.layers), backgroundColor: graphic.backgroundColor };
  if (item.type === "slate") return { ...item, template: "rich", data };
  return { ...item, template: "rich", kind: "text", data };
}

/** Resolve reusable graphics into the existing FFmpeg slate/overlay primitives. */
export function materializeGraphics(definition: ProjectDefinition): ProjectDefinition {
  const graphics = new Map(definition.graphics.map((graphic) => [graphic.id, graphic]));
  const items = definition.composition.items.map((item) => {
    if (item.type === "source-clip" || !item.graphicId) return item;
    const graphic = graphics.get(item.graphicId);
    if (!graphic) throw new Error(`Missing graphic definition: ${item.graphicId}`);
    // A voiceover's picture is built like a slate's (audioClipAsSlate reads data.layers), so it only needs the layers.
    if (item.type === "audio-clip") return { ...item, data: { ...item.data, layers: JSON.stringify(graphic.layers), backgroundColor: graphic.backgroundColor } };
    return withGraphicLayers(item, graphic);
  });
  return { ...definition, composition: { ...definition.composition, items } };
}

export function buildCompositionRenderPlan(
  definition: ProjectDefinition,
  sourcePaths: Map<string, string>,
  outputPath: string,
  assetPaths?: Map<string, string>,
  options?: RenderPlanOptions,
): FfmpegPlan {
  return buildSourceRenderPlan(materializeGraphics(definition), sourcePaths, outputPath, assetPaths, options);
}
