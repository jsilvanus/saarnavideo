import { describe, expect, it } from "vitest";
import { formatSrt, formatVtt, parseVtt } from "@/lib/captions";

describe("formatVtt", () => {
  it("formats the header and cue blocks exactly per the contract", () => {
    const vtt = formatVtt([
      { startSeconds: 1, endSeconds: 4, text: "Text line one" },
      { startSeconds: 4.5, endSeconds: 7, text: "Text line two" },
    ]);
    expect(vtt).toBe(
      "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nText line one\n\n00:00:04.500 --> 00:00:07.000\nText line two\n",
    );
  });

  it("formats an hour-plus timestamp with hours", () => {
    const vtt = formatVtt([{ startSeconds: 3661.25, endSeconds: 3662, text: "x" }]);
    expect(vtt).toContain("01:01:01.250 --> 01:01:02.000");
  });

  it("returns just the header when there are no segments", () => {
    expect(formatVtt([])).toBe("WEBVTT\n\n");
  });

  it("round-trips multi-line cue text", () => {
    const vtt = formatVtt([{ startSeconds: 0, endSeconds: 1, text: "line one\nline two" }]);
    expect(vtt).toContain("line one\nline two");
  });
});

describe("formatSrt", () => {
  it("formats sequential 1-based cue numbers with comma decimals and no header", () => {
    const srt = formatSrt([
      { startSeconds: 1, endSeconds: 4, text: "Text line one" },
      { startSeconds: 4.5, endSeconds: 7, text: "Text line two" },
    ]);
    expect(srt).toBe("1\n00:00:01,000 --> 00:00:04,000\nText line one\n\n2\n00:00:04,500 --> 00:00:07,000\nText line two\n");
  });

  it("returns an empty string for no segments", () => {
    expect(formatSrt([])).toBe("");
  });
});

describe("parseVtt", () => {
  it("parses the contract's example file", () => {
    const content = "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nText line one\n\n00:00:04.500 --> 00:00:07.000\nText line two\n";
    expect(parseVtt(content)).toEqual([
      { startSeconds: 1, endSeconds: 4, text: "Text line one" },
      { startSeconds: 4.5, endSeconds: 7, text: "Text line two" },
    ]);
  });

  it("accepts MM:SS.mmm timestamps with no hours", () => {
    const content = "WEBVTT\n\n01:04.000 --> 01:07.500\nHi\n";
    expect(parseVtt(content)).toEqual([{ startSeconds: 64, endSeconds: 67.5, text: "Hi" }]);
  });

  it("ignores an optional cue identifier line", () => {
    const content = "WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nHello\n";
    expect(parseVtt(content)).toEqual([{ startSeconds: 1, endSeconds: 2, text: "Hello" }]);
  });

  it("joins multi-line cue text with \\n", () => {
    const content = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nline one\nline two\n";
    expect(parseVtt(content)).toEqual([{ startSeconds: 1, endSeconds: 2, text: "line one\nline two" }]);
  });

  it("ignores cue settings after the timestamps", () => {
    const content = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000 align:start line:0%\nHello\n";
    expect(parseVtt(content)).toEqual([{ startSeconds: 1, endSeconds: 2, text: "Hello" }]);
  });

  it("handles CRLF line endings", () => {
    const content = "WEBVTT\r\n\r\n00:00:01.000 --> 00:00:02.000\r\nHello\r\n";
    expect(parseVtt(content)).toEqual([{ startSeconds: 1, endSeconds: 2, text: "Hello" }]);
  });

  it("round-trips through formatVtt", () => {
    const segments = [
      { startSeconds: 0, endSeconds: 2.5, text: "one" },
      { startSeconds: 3, endSeconds: 5, text: "two" },
    ];
    expect(parseVtt(formatVtt(segments))).toEqual(segments);
  });

  it("returns no segments for a header-only file", () => {
    expect(parseVtt("WEBVTT\n\n")).toEqual([]);
  });
});
