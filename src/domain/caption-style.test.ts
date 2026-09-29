import { describe, expect, it } from "vitest";
import { captionStyleFromGraphic, createCaptionGraphic, findCaptionLayer, isCaptionStyleGraphic, parseColor, primaryFontFamily, CAPTION_SAMPLE_TEXT } from "@/domain/caption-style";
import { graphicSchema } from "@/domain/graphics";
import { captionOptionsSchema } from "@/domain/captions";
import { createGraphicPackage, parseGraphicPackage } from "@/domain/graphic-package";

describe("parseColor", () => {
  it("understands hex, rgba(), names and transparent", () => {
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("#00000080")?.a).toBeCloseTo(0.502, 2);
    expect(parseColor("rgba(10, 20, 30, 0.5)")).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseColor("yellow")).toEqual({ r: 255, g: 255, b: 0, a: 1 });
    expect(parseColor("transparent")?.a).toBe(0);
    expect(parseColor("banana")).toBeUndefined();
    expect(parseColor(undefined)).toBeUndefined();
  });
});

describe("primaryFontFamily", () => {
  it("takes the first family and maps generic ones to the bundled font", () => {
    expect(primaryFontFamily("'Open Sans', Arial")).toBe("Open Sans");
    expect(primaryFontFamily("sans-serif")).toBe("DejaVu Sans");
    expect(primaryFontFamily(undefined)).toBe("DejaVu Sans");
  });
});

describe("caption style graphics", () => {
  const graphic = createCaptionGraphic("g1", "Tekstitys");
  it("is a valid graphic with a caption layer and sample text", () => {
    expect(graphicSchema.parse(graphic)).toBeTruthy();
    expect(isCaptionStyleGraphic(graphic)).toBe(true);
    expect(findCaptionLayer(graphic)?.text).toBe(CAPTION_SAMPLE_TEXT);
  });
  it("older graphics without caption layers are not caption styles and still parse", () => {
    const old = graphicSchema.parse({ id: "x", name: "Old", layers: [{ id: "t", type: "text", text: "Hi" }] });
    expect(isCaptionStyleGraphic(old)).toBe(false);
  });
  it("round-trips through the graphic package format", () => {
    const parsed = parseGraphicPackage(JSON.parse(JSON.stringify(createGraphicPackage(graphic, [], "referenced"))));
    expect(isCaptionStyleGraphic(parsed.graphic)).toBe(true);
  });
});

describe("captionStyleFromGraphic", () => {
  it("falls back to the built-in default: bottom-centre, white, semi-transparent box", () => {
    const style = captionStyleFromGraphic(undefined, 1920, 1080);
    expect(style).toMatchObject({ align: "center", vertical: "bottom", fontSize: 56, bold: true, maxLines: 2, x: 160, y: 820, width: 1600, height: 200 });
    expect(style.color).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(style.box).toEqual({ r: 0, g: 0, b: 0, a: 0.6 });
  });
  it("uses the default when the graphic has no caption layer", () => {
    const noCaption = graphicSchema.parse({ id: "x", name: "Old", layers: [{ id: "t", type: "text", text: "Hi" }] });
    expect(captionStyleFromGraphic(noCaption, 1920, 1080).y).toBe(820);
  });
  it("scales the box and sizes to the video size", () => {
    const style = captionStyleFromGraphic(createCaptionGraphic("g", "G"), 1280, 720);
    expect(style).toMatchObject({ x: 107, y: 547, width: 1067, height: 133 });
    expect(style.fontSize).toBeCloseTo(56 * 2 / 3, 5);
    expect(style.padding).toBeCloseTo(8, 5);
  });
  it("reads position, alignment, outline, shadow, opacity and max lines from the layer", () => {
    const style = captionStyleFromGraphic({ width: 1920, height: 1080, layers: [{ id: "c", type: "caption", x: 50, y: 60, width: 700, height: 300, rotation: 0, style: { "font-size": "40px", "font-weight": "400", color: "#ff0", "text-align": "right", "vertical-align": "top", background: "transparent", "-webkit-text-stroke": "2px #112233", "text-shadow": "0 3px 6px rgba(0,0,0,0.5)", "max-lines": 3, opacity: 0.5 } }] }, 1920, 1080);
    expect(style).toMatchObject({ x: 50, y: 60, width: 700, height: 300, fontSize: 40, bold: false, align: "right", vertical: "top", box: null, maxLines: 3 });
    expect(style.color).toEqual({ r: 255, g: 255, b: 0, a: 0.5 });
    expect(style.outline).toEqual({ width: 2, color: { r: 17, g: 34, b: 51, a: 0.5 } });
    expect(style.shadow?.depth).toBe(3);
    expect(style.shadow?.color.a).toBeCloseTo(0.25);
  });
  it("keeps the box inside the frame", () => {
    const style = captionStyleFromGraphic({ width: 1920, height: 1080, layers: [{ id: "c", type: "caption", x: 5000, y: -20, width: 100, height: 100, rotation: 0, style: {} }] }, 1920, 1080);
    expect(style.x).toBe(1919);
    expect(style.y).toBe(0);
  });
});

describe("captionOptionsSchema", () => {
  it("accepts burn and both with an optional style graphic and still none/soft", () => {
    expect(captionOptionsSchema.parse({ mode: "burn", styleGraphicId: "abc" })).toEqual({ mode: "burn", styleGraphicId: "abc" });
    expect(captionOptionsSchema.parse({ mode: "both" }).mode).toBe("both");
    expect(captionOptionsSchema.parse({ mode: "soft" }).mode).toBe("soft");
    expect(captionOptionsSchema.parse({}).mode).toBe("none");
    expect(captionOptionsSchema.safeParse({ mode: "hard" }).success).toBe(false);
    expect(captionOptionsSchema.safeParse({ mode: "burn", styleGraphicId: "" }).success).toBe(false);
  });
});
