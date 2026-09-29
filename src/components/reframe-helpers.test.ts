import { describe, expect, it } from "vitest";
import { choiceOf, dragCrop, pixelsToNormalised, reframeBadge, reframeFromChoice, withZoom, zoomOf } from "./reframe-helpers";
import { cropAspect, cropForAspect } from "@/domain/reframe";
import { checkDimension, formatTargetLength, parseTargetLength } from "./output-helpers";

describe("reframe helpers", () => {
  it("converts pixel deltas to normalised deltas", () => {
    expect(pixelsToNormalised(50, -20, 500, 200)).toEqual({ dx: 0.1, dy: -0.1 });
    expect(pixelsToNormalised(50, 20, 0, 0)).toEqual({ dx: 0, dy: 0 });
  });

  it("drags a vertical crop sideways and clamps at the edges", () => {
    const start = cropForAspect(1920, 1080, 1080, 1920);
    expect(start.w).toBeCloseTo(0.31640625);
    const moved = dragCrop(start, 100, 0, 1000, 562.5);
    expect(moved.x).toBeCloseTo(start.x + 0.1);
    expect(moved.y).toBe(0);
    expect(dragCrop(start, 99999, 99999, 1000, 500).x).toBeCloseTo(1 - start.w);
    expect(dragCrop(start, -99999, 0, 1000, 500).x).toBe(0);
  });

  it("keeps the output aspect while zooming", () => {
    const start = cropForAspect(1920, 1080, 1080, 1920, { x: 0.3, y: 0.5 });
    const zoomed = withZoom(start, 2, 1920, 1080, 1080, 1920);
    expect(cropAspect(zoomed, 1920, 1080)).toBeCloseTo(1080 / 1920);
    expect(zoomed.w).toBeCloseTo(start.w / 2);
    expect(zoomOf(zoomed, 1920, 1080, 1080, 1920)).toBeCloseTo(2);
    expect(zoomOf(start, 1920, 1080, 1080, 1920)).toBeCloseTo(1);
    expect(withZoom(start, 99, 1920, 1080, 1080, 1920).w).toBeCloseTo(start.w / 4);
  });

  it("maps between choices and stored reframes", () => {
    const crop = { x: 0.1, y: 0, w: 0.3, h: 1 };
    expect(reframeFromChoice("default", crop)).toBeUndefined();
    expect(reframeFromChoice("custom", crop)).toMatchObject({ mode: "custom", crop });
    expect(choiceOf(reframeFromChoice("fit-color", undefined))).toBe("fit-color");
    expect(choiceOf(reframeFromChoice("fit-blur", undefined))).toBe("fit-blur");
    expect(choiceOf(undefined)).toBe("default");
    expect(reframeBadge(reframeFromChoice("custom", crop))).toBe("crop");
    expect(reframeBadge(undefined)).toBeUndefined();
  });
});

describe("output helpers", () => {
  it("parses and formats target lengths", () => {
    expect(parseTargetLength("12:00")).toBe(720);
    expect(parseTargetLength("90")).toBe(90);
    expect(parseTargetLength("1:02:03")).toBe(3723);
    expect(parseTargetLength("1:75")).toBeUndefined();
    expect(parseTargetLength("abc")).toBeUndefined();
    expect(parseTargetLength("")).toBeUndefined();
    expect(formatTargetLength(720)).toBe("12:00");
    expect(formatTargetLength(undefined)).toBe("");
  });
  it("validates dimensions", () => {
    expect(checkDimension("1080", 128, 7680)).toEqual({ value: 1080 });
    expect(checkDimension("1081", 128, 7680).error).toBeTruthy();
    expect(checkDimension("64", 128, 7680).error).toBeTruthy();
    expect(checkDimension("", 128, 7680).error).toBeTruthy();
  });
});
