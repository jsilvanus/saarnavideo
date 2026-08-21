import { describe, expect, it } from "vitest";
import { snapAngle, snapRectToLayers, snapValue } from "./graphicsEditorGeometry";

describe("graphics editor geometry", () => {
  it("snaps values to the configured grid", () => {
    expect(snapValue(39)).toBe(40);
    expect(snapValue(31, 10)).toBe(30);
  });

  it("snaps rotation to the configured angle increment", () => {
    expect(snapAngle(22)).toBe(15);
    expect(snapAngle(23)).toBe(30);
  });

  it("snaps a layer to nearby edges of another layer", () => {
    const result = snapRectToLayers(
      { x: 102, y: 202, width: 100, height: 50 },
      [{ x: 0, y: 200, width: 100, height: 100 }],
      5,
    );

    expect(result.x).toBe(100);
    expect(result.y).toBe(200);
  });

  it("does not snap when outside the threshold", () => {
    const rect = { x: 120, y: 220, width: 100, height: 50 };
    expect(snapRectToLayers(rect, [{ x: 0, y: 0, width: 100, height: 100 }], 5)).toEqual(rect);
  });
});
