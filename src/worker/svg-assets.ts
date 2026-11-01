import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProjectDefinition } from "@/domain/project";
import { layerRecolor, recolorSvg } from "@/domain/svg";

const isSvgPath = (file: string) => file.toLowerCase().endsWith(".svg");
const clampWidth = (width: number) => Math.min(4096, Math.max(64, Math.round(width)));

type Layer = { type?: string; src?: string; width?: number; style?: Record<string, unknown> };

/** Renders SVG text to PNG bytes `width` pixels wide (transparent background). sharp is loaded on demand: only SVG renders need it. */
export async function rasterizeSvg(svg: string, width: number): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  return sharp(Buffer.from(svg), { density: 192 }).resize({ width: clampWidth(width) }).png().toBuffer();
}

function mapLayers(definition: ProjectDefinition, change: (layer: Layer) => Layer): ProjectDefinition {
  const graphics = definition.graphics.map((graphic) => ({ ...graphic, layers: graphic.layers.map((layer) => change(layer as Layer) as typeof layer) }));
  const items = definition.composition.items.map((item) => {
    const raw = (item as { data?: Record<string, string> }).data?.layers;
    if (!raw) return item;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return item;
      return { ...item, data: { ...(item as { data: Record<string, string> }).data, layers: JSON.stringify(parsed.map((layer) => change(layer as Layer))) } } as typeof item;
    } catch { return item; }
  });
  return { ...definition, graphics, composition: { ...definition.composition, items } };
}

/**
 * ffmpeg cannot read SVG, so before the render plan is built every SVG asset becomes a PNG in `outDir`:
 * - an image layer with a colour map (`style["svg-recolor"]`) gets its own PNG under a new key `<src>#<hash>`, and the
 *   layer's `src` is rewritten to that key (the same SVG recoloured two ways is two inputs);
 * - every other reference to an SVG path (plain layers, overlay images, slate backgrounds) is pointed at a plain PNG.
 * Returns the definition and path map to render with; both are returned unchanged when no SVG is involved.
 */
export async function prepareSvgAssets(definition: ProjectDefinition, assetPaths: Map<string, string>, outDir: string): Promise<{ definition: ProjectDefinition; assetPaths: Map<string, string> }> {
  if (![...assetPaths.values()].some(isSvgPath)) return { definition, assetPaths };
  await mkdir(outDir, { recursive: true });
  const paths = new Map(assetPaths);
  const recolored = new Map<string, string>(); // variant key -> png path, filled while mapping
  const jobs: Array<Promise<void>> = [];
  const next = mapLayers(definition, (layer) => {
    const file = layer.type === "image" && layer.src ? assetPaths.get(layer.src) : undefined;
    if (!file || !isSvgPath(file) || !layer.src) return layer;
    const map = layerRecolor(layer.style);
    if (!Object.keys(map).length) return layer;
    const width = clampWidth((layer.width ?? 512) * 2);
    const key = `${layer.src}#${createHash("sha1").update(JSON.stringify([map, width])).digest("hex").slice(0, 10)}`;
    if (!recolored.has(key)) {
      const target = path.join(outDir, `${createHash("sha1").update(key).digest("hex").slice(0, 16)}.png`);
      recolored.set(key, target);
      jobs.push(readFile(file, "utf8").then((svg) => rasterizeSvg(recolorSvg(svg, map), width)).then((png) => writeFile(target, png)));
    }
    return { ...layer, src: key };
  });
  for (const [key, target] of recolored) paths.set(key, target);
  // Plain conversion: one PNG per SVG file, shared by every key that points at it.
  const plain = new Map<string, string>();
  for (const [key, file] of assetPaths) {
    if (!isSvgPath(file)) continue;
    let target = plain.get(file);
    if (!target) {
      target = path.join(outDir, `${createHash("sha1").update(file).digest("hex").slice(0, 16)}-plain.png`);
      plain.set(file, target);
      const out = target;
      jobs.push(readFile(file, "utf8").then((svg) => rasterizeSvg(svg, 1024)).then((png) => writeFile(out, png)));
    }
    paths.set(key, target);
  }
  await Promise.all(jobs);
  return { definition: next, assetPaths: paths };
}
