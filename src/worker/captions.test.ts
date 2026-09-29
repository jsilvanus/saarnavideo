import { describe, expect, it } from "vitest";
import type { ProjectDefinition } from "@/domain/project";
import { buildCaptionFiles, clipSourceIds, readCaptionOptions } from "@/worker/captions";

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
    expect(readCaptionOptions({ captions: { mode: "burn" } })).toEqual({ mode: "none" });
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
