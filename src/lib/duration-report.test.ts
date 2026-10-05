import { describe, expect, it } from "vitest";
import type { ProjectDefinition } from "@/domain/project";
import { computeDurationReport, formatDuration } from "./duration-report";

const definition = (items: unknown[], template: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  version: 1, semanticSegments: [], sections: [], graphics: [],
  template: { key: "t", width: 1080, height: 1920, fps: 30, backgroundColor: "black", textColor: "white", ...template },
  composition: { sourceStartSeconds: 0, sourceEndSeconds: 1000, items },
  ...extra,
}) as unknown as ProjectDefinition;
const clip = (seconds: number) => ({ type: "source-clip", sourceId: "a", startSeconds: 0, endSeconds: seconds });

describe("duration report", () => {
  it("formats durations", () => {
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3725)).toBe("1:02:05");
  });

  it("warns when the video exceeds the limit of the chosen platform preset", () => {
    const report = computeDurationReport(definition([clip(100)], { presetKey: "instagram-reels" }));
    expect(report.videoSeconds).toBe(100);
    expect(report.limitSeconds).toBe(90);
    expect(report.warnings.map((w) => w.code)).toContain("over-platform-limit");
    expect(computeDurationReport(definition([clip(80)], { presetKey: "instagram-reels" })).warnings).toEqual([]);
  });

  it("has no platform limit for landscape presets", () => {
    expect(computeDurationReport(definition([clip(4000)], { width: 1920, height: 1080 })).warnings).toEqual([]);
  });

  it("warns when the length is off the target beyond the tolerance", () => {
    expect(computeDurationReport(definition([clip(100)], { targetSeconds: 60 })).warnings.map((w) => w.code)).toContain("off-target");
    expect(computeDurationReport(definition([clip(61)], { targetSeconds: 60 })).warnings).toEqual([]);
  });

  it("carries the values of a warning so the UI can show it in its own language", () => {
    const warning = computeDurationReport(definition([clip(100)], { targetSeconds: 60 })).warnings.find((w) => w.code === "off-target");
    expect(warning?.params).toMatchObject({ video: "1:40", target: "1:00", diff: "+0:40" });
  });

  it("compares the podcast with the video: no slates, plus intro and outro", () => {
    const items = [{ type: "slate", mode: "standalone", durationSeconds: 30, data: {} }, clip(60)];
    const durations = new Map([["intro", 10], ["outro", 5]]);
    const withIntro = computeDurationReport(definition(items, {}, { podcast: { introAssetId: "intro", outroAssetId: "outro", crossfadeSeconds: 0.5, format: "mp3", channels: "mono" } }), durations);
    expect(withIntro.videoSeconds).toBe(90);
    expect(withIntro.podcastSeconds).toBeCloseTo(60 + 10 + 5 - 1, 6);
    expect(withIntro.warnings.map((w) => w.code)).toContain("podcast-differs");
    expect(computeDurationReport(definition([clip(60)])).podcastSeconds).toBe(60);
  });

  it("has no podcast length for a slate-only composition", () => {
    expect(computeDurationReport(definition([{ type: "slate", mode: "standalone", durationSeconds: 5, data: {} }])).podcastSeconds).toBeUndefined();
  });

  it("counts only the chosen podcast range of the body", () => {
    const items = [{ type: "slate", mode: "standalone", durationSeconds: 30, data: {} }, clip(60)];
    const report = computeDurationReport(definition(items, {}, { podcast: { startSeconds: 10, endSeconds: 40, crossfadeSeconds: 0.5, format: "mp3", channels: "mono" } }));
    expect(report.podcastSeconds).toBe(30);
  });
});
