import { describe, expect, it } from "vitest";
import { applyResize, gridSnap, handleAnchor, rotationFromPointerAngle, snapRotation, snapToLayerEdges } from "./geometry";

describe("graphics editor geometry", () => {
  const layer = { id: "a", x: 100, y: 200, width: 400, height: 200 };

  it("calculates resize handles", () => {
    expect(handleAnchor("nw", layer)).toEqual({ left: 100, top: 200 });
    expect(handleAnchor("se", layer)).toEqual({ left: 500, top: 400 });
    expect(handleAnchor("n", layer)).toEqual({ left: 300, top: 200 });
  });

  it("resizes from any edge without allowing tiny dimensions", () => {
    expect(applyResize("e", layer, 50, 0)).toMatchObject({ width: 450 });
    expect(applyResize("w", layer, 50, 0)).toMatchObject({ x: 150, width: 350 });
    expect(applyResize("nw", layer, 500, 500)).toMatchObject({ x: 600, y: 700, width: 20, height: 20 });
  });

  it("snaps to the editor grid", () => {
    expect(gridSnap(29)).toBe(20);
    expect(gridSnap(31)).toBe(40);
  });

  it("snaps a moving layer to another layer's edges", () => {
    const other = { id: "b", x: 600, y: 300, width: 200, height: 100 };
    expect(snapToLayerEdges(195, 305, { ...layer, id: "a" }, [other], new Set(["a"]))).toEqual({ x: 200, y: 300 });
  });

  it("snaps rotation in 15 degree increments", () => {
    expect(snapRotation(23, true)).toBe(30);
    expect(snapRotation(23, false)).toBe(23);
    expect(rotationFromPointerAngle(0, 0, 1, 0)).toBe(90);
  });
});
