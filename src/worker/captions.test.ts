import { describe, expect, it } from "vitest";
import type { ProjectDefinition } from "@/domain/project";
import { buildBurnedCaptionAss, buildCaptionFiles, clipSourceIds, readCaptionOptions, resolveCaptionStyle } from "@/worker/captions";

const definition: ProjectDefinition = {
  version: 1, semanticSegments: [], sections: [], graphics: [],
  composition: { sourceStartSeconds: 0, sourceEndSeconds: 10, items: [
    { type: "source-clip", sourceId: "g", startSeconds: 0, endSeconds: 5 },
    { type: "source-clip", sourceId: "r", startSeconds: 0, endSeconds: 5 },
    { type: "source-clip", sourceId: "g", startSeconds: 0, endSeconds: 2 },
  ] },
};

describe("worker caption helpers", () => {
  it("reads caption options defensively", () => {
    expect(readCaptionOptions({ captions: { mode: "soft", language: "fi" } })).toEqual({ mode: "soft", language: "fi" });
    expect(readCaptionOptions({ captions: { mode: "burn", styleGraphicId: "s" } })).toEqual({ mode: "burn", styleGraphicId: "s" });
    expect(readCaptionOptions({ captions: { mode: "hard" } })).toEqual({ mode: "none" });
    expect(readCaptionOptions(null)).toEqual({ mode: "none" });
    expect(readCaptionOptions({})).toEqual({ mode: "none" });
  });
  it("lists clip sources once", () => expect(clipSourceIds(definition)).toEqual(["g", "r"]));
  it("builds SRT and VTT on the output timeline", () => {
    const files = buildCaptionFiles(definition, new Map([["g", [{ startSeconds: 1, endSeconds: 2, text: "Hei" }]], ["r", [{ startSeconds: 1, endSeconds: 2, text: "Moi" }]]]));
    expect(files.srt).toBe("1\n00:00:01,000 --> 00:00:02,000\nHei\n\n2\n00:00:06,000 --> 00:00:07,000\nMoi\n\n3\n00:00:11,000 --> 00:00:12,000\nHei\n");
    expect(files.vtt.startsWith("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHei")).toBe(true);
  });
});

describe("burned caption ass", () => {
  const cues = [{ startSeconds: 1, endSeconds: 2, text: "Ääkköset" }];
  it("falls back to the built-in style when the style graphic is missing, with a warning", () => {
    const built = buildBurnedCaptionAss(definition, cues, { mode: "burn", styleGraphicId: "nope" });
    expect(built.warning).toMatch(/nope/);
    expect(built.ass).toContain("Dialogue");
  });
  it("uses the caption layer of the chosen style graphic", () => {
    const styled: ProjectDefinition = { ...definition, graphics: [{ id: "s1", name: "Ylhäällä", width: 1920, height: 1080, backgroundColor: "transparent", layers: [{ id: "c", type: "caption", x: 0, y: 0, width: 1920, height: 200, rotation: 0, style: { "vertical-align": "top", background: "transparent" } }] }] };
    const built = buildBurnedCaptionAss(styled, cues, { mode: "both", styleGraphicId: "s1" }, "Custom Font");
    expect(built.warning).toBeUndefined();
    expect(built.style.vertical).toBe("top");
    expect(built.ass).toContain("Style: Caption,Custom Font,");
    expect(built.ass).not.toContain("CaptionBox,,");
  });
  it("resolves plain graphics without caption layers to the default with a warning", () => {
    const plain: ProjectDefinition = { ...definition, graphics: [{ id: "p", name: "Plain", width: 1920, height: 1080, backgroundColor: "#000", layers: [] }] };
    expect(resolveCaptionStyle(plain, "p").warning).toBeDefined();
    expect(resolveCaptionStyle(plain, undefined).warning).toBeUndefined();
  });
});

describe("caption style spans", () => {
  const top = { id: "top", name: "Ylhäällä", width: 1920, height: 1080, backgroundColor: "transparent", layers: [{ id: "c", type: "caption" as const, x: 0, y: 0, width: 1920, height: 200, rotation: 0, style: { "vertical-align": "top" } }] };
  const big = { ...top, id: "big", name: "Iso", layers: [{ ...top.layers[0], style: { "font-size": "90px" } }] };
  const cues = [{ startSeconds: 1, endSeconds: 2, text: "Yksi" }, { startSeconds: 5, endSeconds: 6, text: "Kaksi" }, { startSeconds: 8, endSeconds: 9, text: "Kolme" }];
  const withSpans = (items: ProjectDefinition["composition"]["items"]): ProjectDefinition => ({ ...definition, graphics: [top, big], composition: { ...definition.composition, items: [...definition.composition.items, ...items] } });

  it("draws cues that start inside a span with its style and the rest with the default", () => {
    const def = withSpans([{ type: "caption-style", styleGraphicId: "top", startSeconds: 4, endSeconds: 7 }]);
    const built = buildBurnedCaptionAss(def, cues, { mode: "burn" });
    expect(built.styles).toBe(2);
    expect(built.ass).toMatch(/Style: Caption,/);
    expect(built.ass).toMatch(/Style: Caption2,/);
    expect(built.ass).toMatch(/Dialogue: 1,0:00:05\.00,0:00:06\.00,Caption2,,.*Kaksi/);
    expect(built.ass).toMatch(/Dialogue: 1,0:00:01\.00,0:00:02\.00,Caption,,.*Yksi/);
    expect(built.ass).toMatch(/Dialogue: 1,0:00:08\.00,0:00:09\.00,Caption,,.*Kolme/);
  });

  it("lets the later span win where spans overlap, and falls back with a warning for a missing style", () => {
    const def = withSpans([{ type: "caption-style", styleGraphicId: "top", startSeconds: 0, endSeconds: 10 }, { type: "caption-style", styleGraphicId: "big", startSeconds: 4, endSeconds: 7 }, { type: "caption-style", styleGraphicId: "gone", startSeconds: 7.5, endSeconds: 10 }]);
    const built = buildBurnedCaptionAss({ ...def, composition: { ...def.composition, items: def.composition.items } }, cues, { mode: "burn" });
    expect(built.warning).toMatch(/gone/);
    expect(built.ass).toMatch(/Dialogue: 1,0:00:01\.00,0:00:02\.00,Caption2,/);
    expect(built.ass).toMatch(/Dialogue: 1,0:00:05\.00,0:00:06\.00,Caption3,/);
    expect(built.ass).toMatch(/Dialogue: 1,0:00:08\.00,0:00:09\.00,Caption4,/);
  });

  it("keeps a render without spans exactly as before", () => {
    const built = buildBurnedCaptionAss(definition, cues, { mode: "burn" });
    expect(built.styles).toBe(1);
    expect(built.ass).not.toMatch(/Caption2/);
  });
});
