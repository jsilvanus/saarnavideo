import { describe, expect, it } from "vitest";
import { readPodcastSettings, referencedAudioAssetIds } from "@/worker/podcast";

describe("readPodcastSettings", () => {
  it("defaults to mono MP3 with a half-second crossfade and no intro/outro", () => {
    expect(readPodcastSettings({}, undefined)).toEqual({ format: "mp3", channels: "mono", crossfadeSeconds: 0.5 });
  });

  it("overlays the request on the saved settings", () => {
    const saved = { podcast: { introAssetId: "i", outroAssetId: "o", format: "mp3", album: "Saarnat" } };
    expect(readPodcastSettings(saved, { podcast: { format: "m4a", crossfadeSeconds: 0 } })).toMatchObject({ introAssetId: "i", outroAssetId: "o", format: "m4a", crossfadeSeconds: 0, album: "Saarnat" });
  });

  it("ignores invalid settings instead of failing the job", () => {
    expect(readPodcastSettings({ podcast: { format: "flac" } }, undefined)).toEqual({ format: "mp3", channels: "mono", crossfadeSeconds: 0.5 });
  });
});

describe("referencedAudioAssetIds", () => {
  const definition = { composition: { items: [{ type: "source-clip" }, { type: "audio-clip", assetId: "a" }, { type: "audio-clip", assetId: "b", mode: "mix" }, { type: "audio-clip", assetId: "a" }] } };

  it("lists voiceover assets once, and podcast intro/outro only when asked", () => {
    expect(referencedAudioAssetIds(definition)).toEqual(["a", "b"]);
    expect(referencedAudioAssetIds(definition, { introAssetId: "i", outroAssetId: "a" })).toEqual(["a", "b", "i"]);
    expect(referencedAudioAssetIds({})).toEqual([]);
  });
});
