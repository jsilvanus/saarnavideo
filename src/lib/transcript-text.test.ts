import { describe, expect, it } from "vitest";
import { buildTranscriptHtml, buildTranscriptParagraphs, buildTranscriptText, htmlLanguage, normalizeWhitespace, selectSegmentsInRange } from "./transcript-text";

const seg = (startSeconds: number, endSeconds: number, text: string, speaker?: string) => ({ startSeconds, endSeconds, text, speaker });

describe("selectSegmentsInRange", () => {
  const all = [seg(0, 4, "a"), seg(10, 14, "b"), seg(20, 24, "c"), seg(19, 21, "d")];
  it("keeps segments whose start is in [start, end) and sorts them", () => {
    expect(selectSegmentsInRange(all, 10, 20).map((s) => s.text)).toEqual(["b", "d"]);
    expect(selectSegmentsInRange(all, 10, 20.0001).map((s) => s.text)).toEqual(["b", "d", "c"]);
  });
  it("excludes a segment that began before start and includes one that runs past end", () => {
    expect(selectSegmentsInRange([seg(8, 12, "early"), seg(19, 25, "late")], 10, 20).map((s) => s.text)).toEqual(["late"]);
  });
  it("adjacent ranges partition the transcript", () => {
    const first = selectSegmentsInRange(all, 0, 10), second = selectSegmentsInRange(all, 10);
    expect(first.length + second.length).toBe(all.length);
  });
  it("treats missing bounds as open", () => {
    expect(selectSegmentsInRange(all)).toHaveLength(4);
    expect(selectSegmentsInRange(all, undefined, 10)).toHaveLength(1);
  });
});

describe("buildTranscriptParagraphs", () => {
  it("joins continuous speech into one paragraph and never adds punctuation", () => {
    expect(buildTranscriptParagraphs([seg(0, 2, "Hyvää huomenta"), seg(2.5, 4, "ja tervetuloa")])).toEqual(["Hyvää huomenta ja tervetuloa"]);
  });
  it("breaks at pauses longer than the threshold, not at exactly the threshold", () => {
    const segments = [seg(0, 2, "One."), seg(4, 6, "Same."), seg(8.5, 9, "New.")];
    expect(buildTranscriptParagraphs(segments)).toEqual(["One. Same.", "New."]);
    expect(buildTranscriptParagraphs(segments, { paragraphGapSeconds: 1 })).toEqual(["One.", "Same.", "New."]);
  });
  it("measures the pause against the latest end so overlapping cues do not split", () => {
    expect(buildTranscriptParagraphs([seg(0, 10, "Long"), seg(1, 2, "inside"), seg(11, 12, "after")])).toEqual(["Long inside after"]);
  });
  it("splits an over-long paragraph only at a sentence end", () => {
    const segments = [seg(0, 1, "aaaa bbbb"), seg(1, 2, "cccc dddd."), seg(2, 3, "eeee"), seg(3, 4, "ffff.")];
    expect(buildTranscriptParagraphs(segments, { maxParagraphChars: 10 })).toEqual(["aaaa bbbb cccc dddd.", "eeee ffff."]);
    expect(buildTranscriptParagraphs([seg(0, 1, "aaaa bbbb cccc"), seg(1, 2, "dddd")], { maxParagraphChars: 5 })).toEqual(["aaaa bbbb cccc dddd"]);
  });
  it("counts closing quotes after the full stop as a sentence end", () => {
    expect(buildTranscriptParagraphs([seg(0, 1, "Hän sanoi: \"Tule.\""), seg(1, 2, "Toinen")], { maxParagraphChars: 5 })).toEqual(["Hän sanoi: \"Tule.\"", "Toinen"]);
  });
  it("normalises whitespace and drops empty segments", () => {
    expect(buildTranscriptParagraphs([seg(0, 1, "  rivi\none \u00a0 kaksi "), seg(1, 2, "   "), seg(2, 3, "kolme")])).toEqual(["rivi one kaksi kolme"]);
    expect(normalizeWhitespace("a\t\nb")).toBe("a b");
  });
  it("uses speaker labels only when segments carry them", () => {
    expect(buildTranscriptParagraphs([seg(0, 1, "Hei"), seg(1, 2, "maailma")])).toEqual(["Hei maailma"]);
    expect(buildTranscriptParagraphs([seg(0, 1, "Hei", "Pastori"), seg(1, 2, "taas", "Pastori"), seg(2, 3, "Aamen", "Seurakunta")])).toEqual(["Pastori: Hei taas", "Seurakunta: Aamen"]);
  });
  it("returns nothing for no text", () => {
    expect(buildTranscriptParagraphs([])).toEqual([]);
    expect(buildTranscriptText([])).toBe("");
  });
  it("sorts unordered input", () => {
    expect(buildTranscriptParagraphs([seg(2, 3, "toinen"), seg(0, 1, "ensimmäinen")])).toEqual(["ensimmäinen toinen"]);
  });
});

describe("buildTranscriptText", () => {
  it("has blank lines between paragraphs, a trailing newline and no timestamps", () => {
    const text = buildTranscriptText([seg(0, 2, "Yksi."), seg(10, 12, "Kaksi.")]);
    expect(text).toBe("Yksi.\n\nKaksi.\n");
    expect(text).not.toMatch(/\d\d:\d\d|-->/);
  });
  it("puts an optional title first, only when there is text", () => {
    expect(buildTranscriptText([seg(0, 1, "Teksti")], { title: "  Saarna  " })).toBe("Saarna\n\nTeksti\n");
    expect(buildTranscriptText([], { title: "Saarna" })).toBe("");
  });
});

describe("buildTranscriptHtml", () => {
  it("is an accessible document with lang, title, heading and escaped paragraphs", () => {
    const html = buildTranscriptHtml([seg(0, 1, "Tom & <Jerry>"), seg(10, 11, "Toinen")], { title: "Saarna \"1\"", language: "fi" });
    expect(html.startsWith("<!doctype html>\n<html lang=\"fi\">")).toBe(true);
    expect(html).toContain("<meta charset=\"utf-8\">");
    expect(html).toContain("<title>Saarna &quot;1&quot;</title>");
    expect(html).toContain("<h1>Saarna &quot;1&quot;</h1>");
    expect(html).toContain("<p>Tom &amp; &lt;Jerry&gt;</p>\n<p>Toinen</p>");
  });
  it("has no heading without a title and falls back to und for unknown languages", () => {
    const html = buildTranscriptHtml([seg(0, 1, "x")], { language: "auto" });
    expect(html).not.toContain("<h1>");
    expect(html).toContain("<html lang=\"und\">");
    expect(htmlLanguage("fi-FI")).toBe("fi-FI");
    expect(htmlLanguage("not a tag")).toBe("und");
    expect(htmlLanguage(null)).toBe("und");
  });
});
