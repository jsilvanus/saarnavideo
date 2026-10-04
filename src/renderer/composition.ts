import { buildSourceRenderPlan, type FfmpegPlan, type RenderPlanOptions } from "@/renderer/ffmpeg";
import type { Graphic, GraphicCarrierItem, ProjectDefinition, TimelineItem } from "@/domain/project";
import { applyVariables, type ProjectVariable } from "@/domain/variables";
import { anchorSectionOverlays } from "@/renderer/overlay-timing";

function withGraphicLayers(item: GraphicCarrierItem, graphic: Graphic): GraphicCarrierItem {
  const data = { ...item.data, layers: JSON.stringify(graphic.layers), backgroundColor: graphic.backgroundColor };
  if (item.type === "slate") return { ...item, template: "rich", data };
  return { ...item, template: "rich", kind: "text", data };
}

/** Fills `{{name}}` in a graphic's text layers. */
function graphicWithVariables(graphic: Graphic, variables: readonly ProjectVariable[]): Graphic {
  return { ...graphic, layers: graphic.layers.map((layer) => (layer.text ? { ...layer, text: applyVariables(layer.text, variables) } : layer)) };
}

/** Inline rich layers (`data.layers`, a JSON array) of items that carry their own graphic. Unparseable JSON is left to the renderer. */
function layersWithVariables(json: string, variables: readonly ProjectVariable[]): string {
  if (!variables.length || !json.includes("{{")) return json;
  try {
    const layers: unknown = JSON.parse(json);
    if (!Array.isArray(layers)) return json;
    return JSON.stringify(layers.map((layer) => (layer && typeof layer === "object" && typeof layer.text === "string" ? { ...layer, text: applyVariables(layer.text, variables) } : layer)));
  } catch {
    return json;
  }
}

/** Fills `{{name}}` in an item's plain-text data (legacy title/subtitle/text slates and overlays). */
function itemWithVariables(item: TimelineItem, variables: readonly ProjectVariable[]): TimelineItem {
  if (item.type === "source-clip" || !item.data) return item;
  const data = Object.fromEntries(Object.entries(item.data).map(([key, value]) => [key, key === "layers" ? layersWithVariables(value, variables) : applyVariables(value, variables)]));
  return { ...item, data } as TimelineItem;
}

/** Resolve reusable graphics into the existing FFmpeg slate/overlay primitives, with project variables filled in. */
export function materializeGraphics(definition: ProjectDefinition): ProjectDefinition {
  const variables = definition.variables ?? [];
  const graphics = new Map(definition.graphics.map((graphic) => [graphic.id, graphicWithVariables(graphic, variables)]));
  const items = definition.composition.items.map((original) => {
    const item = itemWithVariables(original, variables);
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
  return buildSourceRenderPlan(anchorSectionOverlays(materializeGraphics(definition)), sourcePaths, outputPath, assetPaths, options);
}
