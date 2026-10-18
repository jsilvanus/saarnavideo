import * as React from "react";
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { frameLayout } from "@/domain/frame-layout";
import { GraphicsEditorCanvas } from "./GraphicsEditorCanvas";
import type { Layer } from "./types";

// The components rely on the automatic JSX runtime of Next; vitest compiles them with the classic one.
(globalThis as { React?: typeof React }).React = React;

const bar: Layer = { id: "bar", type: "rect", x: 160, y: 820, width: 1600, height: 200, style: { background: "red" } };

function render(width: number, height: number, layers: Layer[] = [bar], extra: { grid?: boolean } = {}) {
  const layout = frameLayout({ width, height });
  return renderToStaticMarkup(createElement(GraphicsEditorCanvas, {
    canvasRef: createRef<HTMLDivElement>(), artboardRef: createRef<HTMLDivElement>(), scale: 0.5, variables: [], layout, margin: 100, layers,
    selectedIds: new Set<string>(), grid: extra.grid ?? false, safe: false, background: "#111",
    onPointerMove: () => undefined, onPointerUp: () => undefined, onCanvasPointerDown: () => undefined, onLayerPointerDown: () => undefined,
  }));
}

describe("graphics editor stage", () => {
  it("shows the output size and aspect, and a stage larger than the frame by the margin", () => {
    const html = render(1080, 1920);
    expect(html).toContain("1080 × 1920 · 9:16");
    expect(html).toContain("width:1280px;height:2120px");
  });

  it("draws a layer where the renderer puts it: uniform size, a bottom bar stays near the bottom edge", () => {
    const html = render(1080, 1920);
    // 1600x200 -> 900x112.5, top at 1764.1 (edge anchoring, see frame-layout.test.ts); content keeps design size and is scaled by 0.5625.
    expect(html).toMatch(/left:90px;top:1764\.1\d*px;width:900px;height:112\.5px/);
    expect(html).toContain("transform-origin:0 0;transform:scale(0.5625)");
  });

  it("is unchanged at 1920x1080: the layer sits at its design place and nothing is scaled", () => {
    const html = render(1920, 1080);
    expect(html).toContain("left:160px;top:820px;width:1600px;height:200px");
    expect(html).not.toMatch(/transform-origin:0 0;transform/);
  });

  it("makes the grid square in the frame", () => {
    expect(render(1080, 1920, [], { grid: true })).toContain("background-size:11.25px 11.25px");
  });
});
