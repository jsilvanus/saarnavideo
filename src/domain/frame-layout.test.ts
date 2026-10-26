import { describe, expect, it } from "vitest";
import { boxFromFrame, boxToFrame, frameLayout, mapAxis } from "./frame-layout";

const lowerThird = { x: 160, y: 820, width: 1600, height: 200 };

describe("frameLayout", () => {
  it("is the identity at the design size", () => {
    const layout = frameLayout({ width: 1920, height: 1080 });
    expect(layout).toMatchObject({ sx: 1, sy: 1, k: 1 });
    expect(boxToFrame(lowerThird, layout)).toEqual(lowerThird);
  });

  it("only scales when the aspect ratio is the design's (positions exactly x * s)", () => {
    for (const [w, h] of [[1280, 720], [960, 540], [3840, 2160]]) {
      const layout = frameLayout({ width: w, height: h });
      const box = boxToFrame(lowerThird, layout);
      expect(box.x).toBe(lowerThird.x * layout.sx);
      expect(box.y).toBe(lowerThird.y * layout.sy);
      expect(box.width).toBe(lowerThird.width * layout.k);
      expect(box.height).toBe(lowerThird.height * layout.k);
    }
  });

  it("keeps shapes undistorted in a vertical frame and a bottom bar near the bottom", () => {
    const layout = frameLayout({ width: 1080, height: 1920 });
    expect(layout.k).toBeCloseTo(0.5625, 10);
    const box = boxToFrame(lowerThird, layout);
    // Same aspect ratio as the design box (no stretching), width follows the frame width.
    expect(box.width / box.height).toBeCloseTo(lowerThird.width / lowerThird.height, 10);
    expect(box.width).toBeCloseTo(900, 8);
    expect(box.x).toBeCloseTo(90, 8);
    // The bar is 60 px above the bottom edge of the design: it stays within about 45 px of the bottom of the frame
    // (60 * k = 33.75, plus the fading pull of the proportional place), not 1920 * 60/1080 = 107 px as before.
    const gap = 1920 - (box.y + box.height);
    expect(gap).toBeGreaterThan(33.75);
    expect(gap).toBeLessThan(45);
  });

  it("keeps a layer that sits in the middle in the middle, and a top bar at the top", () => {
    const layout = frameLayout({ width: 1080, height: 1920 });
    const centred = boxToFrame({ x: 460, y: 440, width: 1000, height: 200 }, layout);
    expect(centred.y + centred.height / 2).toBeCloseTo(960, 6);
    const top = boxToFrame({ x: 160, y: 40, width: 1600, height: 100 }, layout);
    expect(top.y).toBeGreaterThan(40 * layout.k);
    expect(top.y).toBeLessThan(40 * layout.k + 12);
  });

  it("moves continuously: a small change of position never jumps", () => {
    let previous = mapAxis(0, 200, 16 / 9, 0.5625, 1080).position;
    for (let p = 5; p <= 880; p += 5) {
      const next = mapAxis(p, 200, 16 / 9, 0.5625, 1080).position;
      expect(Math.abs(next - previous)).toBeLessThan(30);
      previous = next;
    }
  });

  it("handles a frame wider than the design the same way along x (a layer near the left edge stays there)", () => {
    const layout = frameLayout({ width: 2560, height: 1080 });
    const box = boxToFrame({ x: 100, y: 100, width: 400, height: 200 }, layout);
    expect(box.height).toBe(200);
    expect(box.width).toBe(400);
    expect(box.x).toBeGreaterThanOrEqual(100);
    expect(box.x).toBeLessThan(110);
    expect(box.y).toBe(100);
  });

  it("round-trips through the frame", () => {
    for (const out of [{ width: 1080, height: 1920 }, { width: 1080, height: 1350 }, { width: 2560, height: 1080 }, { width: 1280, height: 720 }]) {
      const layout = frameLayout(out);
      const back = boxFromFrame(boxToFrame(lowerThird, layout), layout);
      expect(back.x).toBeCloseTo(lowerThird.x, 8);
      expect(back.y).toBeCloseTo(lowerThird.y, 8);
      expect(back.width).toBeCloseTo(lowerThird.width, 8);
      expect(back.height).toBeCloseTo(lowerThird.height, 8);
    }
  });

  it("maps one axis", () => {
    expect(mapAxis(100, 50, 2, 2)).toEqual({ position: 200, length: 100 });
    expect(mapAxis(100, 50, 3, 2)).toEqual({ position: 325, length: 100 });
  });
});
