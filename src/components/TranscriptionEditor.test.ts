import { describe, expect, it } from "vitest";
import { formatTime } from "./format";
import { isWithinSegment, transcriptTextUrl } from "./TranscriptionEditor";

describe("TranscriptionEditor helpers", () => {
  describe("formatTime", () => {
    it("formats sub-hour durations as m:ss", () => {
      expect(formatTime(0)).toBe("0:00");
      expect(formatTime(5)).toBe("0:05");
      expect(formatTime(65)).toBe("1:05");
      expect(formatTime(599)).toBe("9:59");
    });

    it("formats hour-plus durations as h:mm:ss", () => {
      expect(formatTime(3600)).toBe("1:00:00");
      expect(formatTime(3725)).toBe("1:02:05");
    });

    it("clamps negative input to zero", () => {
      expect(formatTime(-10)).toBe("0:00");
    });
  });

  describe("isWithinSegment", () => {
    const segment = { startSeconds: 10, endSeconds: 20 };

    it("is true at the start boundary (inclusive)", () => {
      expect(isWithinSegment(10, segment)).toBe(true);
    });

    it("is false at the end boundary (exclusive)", () => {
      expect(isWithinSegment(20, segment)).toBe(false);
    });

    it("is true strictly inside the range", () => {
      expect(isWithinSegment(15, segment)).toBe(true);
    });

    it("is false outside the range", () => {
      expect(isWithinSegment(5, segment)).toBe(false);
      expect(isWithinSegment(25, segment)).toBe(false);
    });
  });

  describe("transcriptTextUrl", () => {
    it("omits empty and zero-start parameters", () => {
      expect(transcriptTextUrl("s1", "txt")).toBe("/api/sources/s1/transcript.txt");
      expect(transcriptTextUrl("s1", "html", { start: 0, end: "" })).toBe("/api/sources/s1/transcript.html");
    });
    it("passes range and title", () => {
      expect(transcriptTextUrl("s1", "txt", { start: 12.5, end: 60, title: " Saarna " })).toBe("/api/sources/s1/transcript.txt?start=12.5&end=60&title=Saarna");
    });
  });
});
