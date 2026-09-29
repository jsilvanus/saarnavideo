import { describe, expect, it } from "vitest";
import { assColor, assText, assTime, buildAss, wrapCuesForStyle } from "@/renderer/ass";
import { captionStyleFromGraphic, createCaptionGraphic } from "@/domain/caption-style";

const style = captionStyleFromGraphic(createCaptionGraphic("g", "Captions"), 1920, 1080);

describe("ass primitives", () => {
  it("converts colours to &HAABBGGRR with inverted alpha", () => {
    expect(assColor({ r: 255, g: 0, b: 0, a: 1 })).toBe("&H000000FF");
    expect(assColor({ r: 0, g: 0, b: 0, a: 0.6 })).toBe("&H66000000");
    expect(assColor({ r: 1, g: 2, b: 3, a: 0 })).toBe("&HFF030201");
  });
  it("formats times as h:mm:ss.cc", () => {
    expect(assTime(0)).toBe("0:00:00.00");
    expect(assTime(3661.239)).toBe("1:01:01.24");
    expect(assTime(-1)).toBe("0:00:00.00");
  });
  it("escapes override braces and backslashes and joins lines with \\N", () => {
    expect(assText(["a {b}", "c\\d"])).toBe("a (b)\\Nc＼d");
  });
});

describe("buildAss", () => {
  const cues = [{ startSeconds: 1, endSeconds: 2.5, text: "Hyvää huomenta", lines: ["Hyvää huomenta"] }, { startSeconds: 3, endSeconds: 4, text: "Ääkköset", lines: ["Ääkköset", "ö"] }];
  const ass = buildAss(cues, style, { width: 1920, height: 1080 });
  it("declares the video size as script resolution", () => {
    expect(ass).toContain("PlayResX: 1920");
    expect(ass).toContain("PlayResY: 1080");
  });
  it("emits a text style with bottom-centre alignment and margins from the box", () => {
    const line = ass.split("\n").find((l) => l.startsWith("Style:"))!.slice(7).split(",");
    expect(line[1]).toBe("DejaVu Sans");
    expect(Number(line[2])).toBeCloseTo(56 * 1.16, 1);
    expect(line[7]).toBe("-1"); // bold
    expect(line[15]).toBe("1"); // outline style; the box is a separate drawing
    expect(line[16]).toBe("0"); // no outline configured
    expect(line[18]).toBe("2"); // bottom centre
    expect([line[19], line[20], line[21]]).toEqual(["172", "172", "72"]); // x+pad, W-(x+w)+pad, H-(y+h)+pad
  });
  it("draws the background as one rectangle per cue spanning the box width, as tall as the lines, bottom-anchored", () => {
    // 1 line: 56 * 1.16 + 2 * 12 = 89; box bottom = 820 + 200 = 1020 -> top 931. 2 lines: 154, top 866.
    expect(ass).toContain("Dialogue: 0,0:00:01.00,0:00:02.50,CaptionBox,,0,0,0,,{\\pos(160,931)\\bord0\\shad0\\p1}m 0 0 l 1600 0 1600 89 0 89");
    expect(ass).toContain("Dialogue: 0,0:00:03.00,0:00:04.00,CaptionBox,,0,0,0,,{\\pos(160,866)\\bord0\\shad0\\p1}m 0 0 l 1600 0 1600 154 0 154");
    expect(ass).toContain("Style: CaptionBox,");
  });
  it("writes dialogue lines with UTF-8 text intact", () => {
    expect(ass).toContain("Dialogue: 1,0:00:01.00,0:00:02.50,Caption,,0,0,0,,Hyvää huomenta");
    expect(ass).toContain("Ääkköset\\Nö");
  });
  it("draws no box but outline and shadow when there is no background", () => {
    const plain = captionStyleFromGraphic({ width: 1920, height: 1080, layers: [{ id: "c", type: "caption", x: 0, y: 0, width: 1000, height: 200, rotation: 0, style: { background: "transparent", "-webkit-text-stroke": "3px #000000", "text-shadow": "0 2px 4px #000", "text-align": "left", "vertical-align": "top" } }] }, 1920, 1080);
    const doc = buildAss(cues, plain, { width: 1920, height: 1080 });
    expect(doc).not.toContain("CaptionBox,,");
    const line = doc.split("\n").find((l) => l.startsWith("Style:"))!.slice(7).split(",");
    expect(line[15]).toBe("1");
    expect(line[16]).toBe("3");
    expect(line[17]).toBe("2");
    expect(line[18]).toBe("7"); // top-left
    expect(line[21]).toBe("12"); // top margin = y + padding
  });
  it("positions vertically centred captions explicitly", () => {
    const mid = captionStyleFromGraphic({ width: 1920, height: 1080, layers: [{ id: "c", type: "caption", x: 100, y: 400, width: 1000, height: 200, rotation: 0, style: { "vertical-align": "middle" } }] }, 1920, 1080);
    expect(buildAss(cues, mid, { width: 1920, height: 1080 })).toContain("Caption,,0,0,0,,{\\pos(600,500)}Hyvää huomenta");
  });
  it("skips empty cues", () => {
    expect(buildAss([{ startSeconds: 1, endSeconds: 1, text: "x", lines: ["x"] }], style, { width: 1920, height: 1080 })).not.toContain("Dialogue");
  });
});

describe("wrapCuesForStyle", () => {
  it("wraps long transcript segments to the box and pages them by max lines", () => {
    const text = "Kaikkivaltias Jumala, taivaallinen Isä, me kiitämme sinua tästä päivästä ja kaikesta hyvästä mitä olemme saaneet vastaanottaa. ".repeat(2).trim();
    const wrapped = wrapCuesForStyle([{ startSeconds: 0, endSeconds: 20, text }], style);
    expect(wrapped.length).toBeGreaterThan(1);
    for (const cue of wrapped) expect(cue.lines.length).toBeLessThanOrEqual(2);
    expect(wrapped[wrapped.length - 1].endSeconds).toBe(20);
  });
});
