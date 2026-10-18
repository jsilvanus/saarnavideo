import { describe, expect, it } from "vitest";
import { boxToFrame, frameLayout } from "@/domain/frame-layout";
import { moveInFrame, resizeInFrame } from "./geometry";

const layer = { x: 160, y: 820, width: 1600, height: 200 };

describe("dragging in the output frame", () => {
  it("is plain design pixels at 1920x1080", () => {
    const layout = frameLayout({ width: 1920, height: 1080 });
    expect(moveInFrame(boxToFrame(layer, layout), 30, -45, layout, false)).toEqual({ x: 190, y: 775 });
    expect(resizeInFrame("e", boxToFrame(layer, layout), 100, 0, layout, false)).toMatchObject({ width: 1700, height: 200, x: 160 });
  });

  it("moves the layer by what the user sees: a drag of d frame pixels shifts the design centre by d / s", () => {
    const layout = frameLayout({ width: 1080, height: 1920 });
    const display = boxToFrame(layer, layout);
    const moved = moveInFrame(display, 0, 192, layout, false);
    // 192 frame px down = 108 design px (sy = 16/9).
    expect(moved.y - layer.y).toBe(108);
    expect(moved.x).toBe(layer.x);
  });

  it("drops the layer on the frame's grid when snapping", () => {
    const layout = frameLayout({ width: 1080, height: 1920 });
    const display = boxToFrame(layer, layout);
    const moved = moveInFrame(display, 3, 3, layout, true);
    const back = boxToFrame({ ...layer, ...moved }, layout);
    expect(back.x / (20 * layout.k)).toBeCloseTo(Math.round(back.x / (20 * layout.k)), 0);
  });

  it("resizes in frame pixels and stores design pixels", () => {
    const layout = frameLayout({ width: 1080, height: 1920 });
    const display = boxToFrame(layer, layout);
    // Widening by 90 frame px (the layer is 900 wide) = +160 design px.
    const resized = resizeInFrame("e", display, 90, 0, layout, false);
    expect(resized.width).toBe(1760);
    expect(resized.height).toBe(200);
  });
});
