import { describe, expect, it } from "vitest";
import type { JobResultSegment } from "@/integrations/auditorStt/client";
import { applyRangeOffset, confidenceFromAvgLogprob, isPartialRange } from "./transcription-range";

function segment(overrides: Partial<JobResultSegment> = {}): JobResultSegment {
  return { start: 0, end: 1, text: "x", avg_logprob: null, no_speech_prob: null, words: [], ...overrides };
}

describe("isPartialRange", () => {
  it("is false for the whole source (start at 0, end at the known duration)", () => {
    expect(isPartialRange(0, 120, 120)).toBe(false);
  });

  it("is true when the range starts after zero", () => {
    expect(isPartialRange(5, 120, 120)).toBe(true);
  });

  it("is true when the range ends before the source's end", () => {
    expect(isPartialRange(0, 100, 120)).toBe(true);
  });

  it("is false when start is 0 and duration is unknown (nothing to compare rangeEnd against)", () => {
    expect(isPartialRange(0, 999999, undefined)).toBe(false);
  });

  it("is true when start is after zero even with unknown duration", () => {
    expect(isPartialRange(5, 999999, undefined)).toBe(true);
  });
});

describe("applyRangeOffset", () => {
  it("adds rangeStartSeconds to both start and end of every segment", () => {
    const result = applyRangeOffset([segment({ start: 0, end: 3, text: "a" }), segment({ start: 3, end: 6, text: "b" })], 100);
    expect(result).toEqual([
      { startSeconds: 100, endSeconds: 103, text: "a", confidence: undefined },
      { startSeconds: 103, endSeconds: 106, text: "b", confidence: undefined },
    ]);
  });

  it("is a no-op offset for a full-range (rangeStartSeconds 0) submission", () => {
    const result = applyRangeOffset([segment({ start: 5, end: 9 })], 0);
    expect(result[0].startSeconds).toBe(5);
    expect(result[0].endSeconds).toBe(9);
  });

  it("drops segments where end does not exceed start rather than failing the whole transcript", () => {
    const result = applyRangeOffset([segment({ start: 5, end: 5, text: "zero-length" }), segment({ start: 5, end: 4, text: "inverted" }), segment({ start: 5, end: 6, text: "valid" })], 0);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("valid");
  });

  it("carries the avg_logprob-derived confidence through the offset", () => {
    const result = applyRangeOffset([segment({ start: 0, end: 1, avg_logprob: -0.2 })], 10);
    expect(result[0].confidence).toBeCloseTo(0.8);
  });
});

describe("confidenceFromAvgLogprob", () => {
  it("clamps avg_logprob + 1 to [0, 1]", () => {
    expect(confidenceFromAvgLogprob(0)).toBe(1);
    expect(confidenceFromAvgLogprob(-1)).toBe(0);
    expect(confidenceFromAvgLogprob(-2)).toBe(0);
    expect(confidenceFromAvgLogprob(-0.5)).toBeCloseTo(0.5);
  });

  it("returns undefined when avg_logprob is null", () => {
    expect(confidenceFromAvgLogprob(null)).toBeUndefined();
  });
});
