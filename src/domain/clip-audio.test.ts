import { describe, expect, it } from "vitest";
import { clipAudioFilters, resolveClipAudio } from "./clip-audio";
import { sourceAudioFilter } from "@/renderer/ffmpeg";

describe("clipAudioFilters", () => {
  it("is empty when nothing is set or the fader is at 1", () => {
    expect(clipAudioFilters(undefined)).toEqual([]);
    expect(clipAudioFilters({})).toEqual([]);
    expect(clipAudioFilters({ volume: 1 })).toEqual([]);
  });
  it("cleans first, then levels: high-pass, hum notches, fader, loudness", () => {
    const chain = clipAudioFilters({ volume: 0.8, highpassHz: 80, humHz: 50, normalize: true });
    expect(chain[0]).toBe("highpass=f=80");
    expect(chain.slice(1, 5).map(f => f.match(/f=(\d+)/)?.[1])).toEqual(["50", "100", "150", "200"]);
    expect(chain.slice(5)).toEqual(["volume=0.8", "loudnorm=I=-16:TP=-1.5:LRA=11"]);
  });
});

describe("resolveClipAudio", () => {
  const sections = [{ sourceId: "a", startSeconds: 10, endSeconds: 60, audio: { volume: 1.5 } }];
  it("takes the clip's own setting, else the section it was cut from", () => {
    expect(resolveClipAudio({ sourceId: "a", startSeconds: 10, endSeconds: 60, audio: { normalize: true } }, sections)).toEqual({ normalize: true });
    expect(resolveClipAudio({ sourceId: "a", startSeconds: 20, endSeconds: 30 }, sections)).toEqual({ volume: 1.5 });
    expect(resolveClipAudio({ sourceId: "b", startSeconds: 20, endSeconds: 30 }, sections)).toBeUndefined();
  });
});

describe("sourceAudioFilter", () => {
  it("keeps the old chain without settings and inserts the settings before the format filter", () => {
    expect(sourceAudioFilter(0, 5, 10, "a0")).toBe("[0:a]atrim=start=5:duration=10,asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a0]");
    expect(sourceAudioFilter(0, 5, 10, "a0", { volume: 2 })).toContain("asetpts=PTS-STARTPTS,volume=2,aresample=48000");
  });
});
