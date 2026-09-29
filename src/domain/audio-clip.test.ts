import { describe, expect, it } from "vitest";
import { audioClipSchema, baseItemDuration, isBaseItem, migrateProjectDefinition, podcastSettingsSchema, projectDefinitionSchema, validateCompositionSources, type TimelineItem } from "@/domain/project";

const composition = (items: unknown[]) => ({ sourceStartSeconds: 0, sourceEndSeconds: 10, items });

describe("audioClipSchema", () => {
  it("applies defaults: standalone, full volume, no ducking", () => {
    expect(audioClipSchema.parse({ type: "audio-clip", assetId: "a", endSeconds: 5 })).toEqual({ type: "audio-clip", assetId: "a", mode: "standalone", startSeconds: 0, endSeconds: 5, volume: 1, atSeconds: 0, duckSourceVolume: 1, data: {} });
  });

  it("requires an asset and a positive trim window", () => {
    expect(audioClipSchema.safeParse({ type: "audio-clip", endSeconds: 5 }).success).toBe(false);
    expect(audioClipSchema.safeParse({ type: "audio-clip", assetId: "a", startSeconds: 5, endSeconds: 5 }).success).toBe(false);
    expect(audioClipSchema.safeParse({ type: "audio-clip", assetId: "a", endSeconds: 5, duckSourceVolume: 1.5 }).success).toBe(false);
    expect(audioClipSchema.safeParse({ type: "audio-clip", assetId: "a", endSeconds: 5, mode: "overlay" }).success).toBe(false);
  });
});

describe("project definition with audio", () => {
  const audio = { type: "audio-clip", assetId: "a", endSeconds: 3 };

  it("accepts audio-clips in the composition and an optional podcast block", () => {
    const parsed = projectDefinitionSchema.parse({ version: 1, semanticSegments: [], composition: composition([audio]), podcast: { introAssetId: "i" } });
    expect(parsed.podcast).toEqual({ introAssetId: "i", format: "mp3", channels: "mono", crossfadeSeconds: 0.5 });
  });

  it("still parses definitions saved before audio existed", () => {
    const old = { version: 1, semanticSegments: [], sections: [], graphics: [], composition: composition([{ type: "source-clip", sourceId: "s", startSeconds: 0, endSeconds: 2 }]) };
    expect(projectDefinitionSchema.parse(old).podcast).toBeUndefined();
    expect(migrateProjectDefinition(old).composition.items).toHaveLength(1);
  });

  it("checks a voiceover background graphic like a slate's", () => {
    const definition = projectDefinitionSchema.parse({ version: 1, semanticSegments: [], composition: composition([{ ...audio, graphicId: "g" }]) });
    expect(() => validateCompositionSources(definition, [])).toThrow(/missing graphics: g/);
  });
});

describe("podcastSettingsSchema", () => {
  it("bounds the crossfade and restricts the format", () => {
    expect(podcastSettingsSchema.safeParse({ crossfadeSeconds: 9 }).success).toBe(false);
    expect(podcastSettingsSchema.safeParse({ format: "flac" }).success).toBe(false);
    expect(podcastSettingsSchema.parse({ format: "m4a", channels: "stereo", crossfadeSeconds: 0 }).format).toBe("m4a");
  });
});

describe("base items", () => {
  const item = (extra: object) => ({ type: "audio-clip", assetId: "a", startSeconds: 1, endSeconds: 4, ...extra }) as TimelineItem;

  it("counts standalone audio clips (not mixes or overlays) as sequential items with their trimmed length", () => {
    expect(isBaseItem(item({ mode: "standalone" }))).toBe(true);
    expect(isBaseItem(item({}))).toBe(true);
    expect(isBaseItem(item({ mode: "mix" }))).toBe(false);
    expect(isBaseItem({ type: "slate", mode: "overlay", durationSeconds: 1, startSeconds: 0, endSeconds: 1 } as TimelineItem)).toBe(false);
    const clip = item({});
    if (isBaseItem(clip)) expect(baseItemDuration(clip)).toBe(3);
  });
});
