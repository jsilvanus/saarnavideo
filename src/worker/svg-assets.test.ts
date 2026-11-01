import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProjectDefinition } from "@/domain/project";
import { prepareSvgAssets, rasterizeSvg } from "./svg-assets";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><rect width="100" height="50" fill="#ff0000"/></svg>';
let dir = "";
beforeAll(async () => { dir = await mkdtemp(path.join(os.tmpdir(), "svg-assets-")); });
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

async function centre(file: string) {
  const { default: sharp } = await import("sharp");
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const at = ((info.height >> 1) * info.width + (info.width >> 1)) * info.channels;
  return [data[at], data[at + 1], data[at + 2]];
}

describe("rasterizeSvg", () => {
  it("renders the SVG to a PNG of the asked width", async () => {
    const png = await rasterizeSvg(SVG, 200);
    expect([...png.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
    const { default: sharp } = await import("sharp");
    expect((await sharp(png).metadata()).width).toBe(200);
  });
});

describe("prepareSvgAssets", () => {
  const definition = (style: Record<string, unknown>) => ({
    graphics: [{ id: "g", name: "G", width: 1920, height: 1080, backgroundColor: "#000", layers: [{ id: "l", type: "image", x: 0, y: 0, width: 400, height: 200, rotation: 0, src: "/api/projects/p/assets/a", style }] }],
    composition: { items: [] },
  }) as unknown as ProjectDefinition;

  it("recolours a layer into its own PNG and points the layer at it", async () => {
    const svg = path.join(dir, "logo.svg");
    await writeFile(svg, SVG);
    const paths = new Map([["/api/projects/p/assets/a", svg], ["logo", svg]]);
    const out = await prepareSvgAssets(definition({ "svg-recolor": JSON.stringify({ "#ff0000": "#0000ff" }) }), paths, path.join(dir, "out1"));
    const src = out.definition.graphics[0].layers[0].src as string;
    expect(src).toMatch(/^\/api\/projects\/p\/assets\/a#[0-9a-f]{10}$/);
    expect(await centre(out.assetPaths.get(src)!)).toEqual([0, 0, 255]);
    // the plain key renders unchanged
    expect(await centre(out.assetPaths.get("logo")!)).toEqual([255, 0, 0]);
  });

  it("leaves everything alone when no SVG is involved", async () => {
    const paths = new Map([["a", "/x/a.png"]]);
    const def = definition({});
    const out = await prepareSvgAssets(def, paths, path.join(dir, "out2"));
    expect(out.definition).toBe(def);
    expect(out.assetPaths).toBe(paths);
  });
});
