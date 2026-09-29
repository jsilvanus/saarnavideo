import { describe, expect, it } from "vitest";
import { cropAspect, cropForAspect, DEFAULT_REFRAME, moveCrop, reframeSchema, resolveReframe, sectionForClip } from "./reframe";

const clip = { sourceId: "s1", startSeconds: 10, endSeconds: 20 };

describe("reframe resolution", () => {
  it("prefers the clip, then the section, then the project default, then fill", () => {
    const sectionFit = { mode: "fit" as const, fitBackground: "color" as const };
    const sections = [{ sourceId: "s1", startSeconds: 0, endSeconds: 30, reframe: sectionFit }];
    const projectDefault = { mode: "fit" as const, fitBackground: "blur" as const };
    expect(resolveReframe({ ...clip, reframe: DEFAULT_REFRAME }, sections, projectDefault)).toBe(DEFAULT_REFRAME);
    expect(resolveReframe(clip, sections, projectDefault)).toBe(sectionFit);
    expect(resolveReframe(clip, [], projectDefault)).toBe(projectDefault);
    expect(resolveReframe(clip, undefined)).toEqual(DEFAULT_REFRAME);
  });

  it("only matches a section of the same source that contains the clip", () => {
    expect(sectionForClip(clip, [{ sourceId: "other", startSeconds: 0, endSeconds: 30 }])).toBeUndefined();
    expect(sectionForClip(clip, [{ sourceId: "s1", startSeconds: 12, endSeconds: 30 }])).toBeUndefined();
    expect(sectionForClip(clip, [{ sourceId: "s1", startSeconds: 10, endSeconds: 20 }])).toBeDefined();
  });
});

describe("reframe schema", () => {
  it("requires a crop rectangle inside the picture for custom mode", () => {
    expect(reframeSchema.safeParse({ mode: "custom" }).success).toBe(false);
    expect(reframeSchema.safeParse({ mode: "custom", crop: { x: 0.6, y: 0, w: 0.5, h: 1 } }).success).toBe(false);
    expect(reframeSchema.safeParse({ mode: "custom", crop: { x: 0.5, y: 0, w: 0.5, h: 1 } }).success).toBe(true);
    expect(reframeSchema.parse({})).toEqual({ mode: "fill", fitBackground: "blur" });
  });
});

describe("crop geometry", () => {
  it("cuts a 9:16 column out of a 16:9 picture", () => {
    const crop = cropForAspect(1920, 1080, 1080, 1920);
    expect(crop.h).toBe(1);
    expect(crop.w).toBeCloseTo(0.31640625, 6);
    expect(crop.x).toBeCloseTo(0.341796875, 6);
    expect(cropAspect(crop, 1920, 1080)).toBeCloseTo(9 / 16, 6);
  });

  it("keeps the crop inside the picture when centred near an edge or zoomed", () => {
    const edge = cropForAspect(1920, 1080, 1080, 1920, { x: 0.02, y: 0.5 });
    expect(edge.x).toBe(0);
    const zoomed = cropForAspect(1920, 1080, 1080, 1920, { x: 0.5, y: 0.1 }, 2);
    expect(zoomed.y).toBe(0);
    expect(zoomed.h).toBeCloseTo(0.5, 6);
    expect(cropAspect(zoomed, 1920, 1080)).toBeCloseTo(9 / 16, 6);
  });

  it("moves a crop without leaving the picture", () => {
    const moved = moveCrop({ x: 0.3, y: 0, w: 0.3, h: 1 }, 5, 5);
    expect(moved.x).toBeCloseTo(0.7, 6);
    expect(moved.y).toBe(0);
    expect(moveCrop({ x: 0.3, y: 0, w: 0.3, h: 1 }, -5, 0).x).toBe(0);
  });
});
