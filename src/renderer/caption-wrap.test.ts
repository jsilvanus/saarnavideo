import { describe, expect, it } from "vitest";
import { charBudget, effectiveMaxLines, estimateTextWidth, layoutCue, wrapText } from "@/renderer/caption-wrap";

const metrics = { fontSize: 20 }; // 11 px per character -> 100 px = 9 chars

describe("estimateTextWidth", () => {
  it("uses an average glyph factor of the font size, wider for bold", () => {
    expect(estimateTextWidth("abcd", { fontSize: 20 })).toBeCloseTo(44);
    expect(estimateTextWidth("abcd", { fontSize: 20, bold: true })).toBeCloseTo(48);
  });
  it("counts code points, not UTF-16 units", () => {
    expect(estimateTextWidth("ä🙂", { fontSize: 10 })).toBeCloseTo(11);
  });
});

describe("charBudget", () => {
  it("fits whole characters and is at least 1", () => {
    expect(charBudget(100, metrics)).toBe(9);
    expect(charBudget(1, metrics)).toBe(1);
  });
});

describe("wrapText", () => {
  it("wraps greedily at word boundaries within the budget", () => {
    expect(wrapText("Hyvää huomenta kaikille", 110, metrics)).toEqual(["Hyvää", "huomenta", "kaikille"]);
    expect(wrapText("aa bb cc dd", 100, metrics)).toEqual(["aa bb cc", "dd"]);
  });
  it("keeps short text on one line and collapses whitespace and newlines", () => {
    expect(wrapText("  yksi \n kaksi\t ", 400, metrics)).toEqual(["yksi kaksi"]);
  });
  it("breaks words longer than a line", () => {
    expect(wrapText("Rukoushuoneisto", 100, metrics)).toEqual(["Rukoushuo", "neisto"]);
  });
  it("returns nothing for blank text", () => {
    expect(wrapText("   ", 100, metrics)).toEqual([]);
  });
  it("never exceeds the budget on any line", () => {
    const text = "Kaikkivaltias Jumala, taivaallinen Isä, me kiitämme sinua tästä päivästä ja kaikesta hyvästä";
    for (const line of wrapText(text, 200, metrics)) expect(Array.from(line).length).toBeLessThanOrEqual(charBudget(200, metrics));
  });
});

describe("effectiveMaxLines", () => {
  it("is limited by the box height", () => {
    expect(effectiveMaxLines(4, 200, 10, 50)).toBe(3); // (200-20)/60 = 3
    expect(effectiveMaxLines(2, 200, 10, 50)).toBe(2);
    expect(effectiveMaxLines(2, 10, 10, 50)).toBe(1);
  });
});

describe("layoutCue", () => {
  const cue = { startSeconds: 10, endSeconds: 16, text: "aa bb cc dd ee ff gg hh ii jj kk ll" };
  it("keeps a cue that fits as one page", () => {
    expect(layoutCue({ startSeconds: 1, endSeconds: 2, text: "lyhyt" }, 100, 2, metrics)).toEqual([{ startSeconds: 1, endSeconds: 2, text: "lyhyt", lines: ["lyhyt"] }]);
  });
  it("splits a cue with too many lines into consecutive pages that tile the time span", () => {
    const pages = layoutCue(cue, 100, 2, metrics); // 9 chars per line: 4 lines -> 2 pages
    expect(pages.map((p) => p.lines)).toEqual([["aa bb cc", "dd ee ff"], ["gg hh ii", "jj kk ll"]]);
    expect(pages[0].startSeconds).toBe(10);
    expect(pages[0].endSeconds).toBeCloseTo(pages[1].startSeconds, 9);
    expect(pages[1].endSeconds).toBe(16);
    expect(pages[0].endSeconds).toBeCloseTo(13); // equal character counts -> equal shares
    expect(pages.every((p) => p.lines.length <= 2)).toBe(true);
  });
  it("gives longer pages more time", () => {
    const pages = layoutCue({ startSeconds: 0, endSeconds: 10, text: "aaaaaaaa bbbbbbbb cc" }, 100, 2, metrics);
    expect(pages).toHaveLength(2);
    expect(pages[0].endSeconds).toBeGreaterThan(5);
    expect(pages[1].endSeconds).toBe(10);
  });
  it("drops cues without text", () => {
    expect(layoutCue({ startSeconds: 0, endSeconds: 1, text: " " }, 100, 2, metrics)).toEqual([]);
  });
});
