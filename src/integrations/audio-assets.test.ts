import { describe, expect, it } from "vitest";
import { audioExtension, canonicalAudioType, parseFfmpegTime } from "@/integrations/audio-assets";

describe("canonicalAudioType", () => {
  it("accepts the supported formats and folds browser spellings", () => {
    expect(canonicalAudioType("audio/mpeg")).toBe("audio/mpeg");
    expect(canonicalAudioType("audio/mp3")).toBe("audio/mpeg");
    expect(canonicalAudioType("audio/x-m4a")).toBe("audio/mp4");
    expect(canonicalAudioType("audio/x-wav")).toBe("audio/wav");
    expect(canonicalAudioType("audio/ogg")).toBe("audio/ogg");
    expect(canonicalAudioType("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(canonicalAudioType("video/webm")).toBe("audio/webm");
  });

  it("falls back to the extension only for a missing or generic type", () => {
    expect(canonicalAudioType("", "Voice.M4A")).toBe("audio/mp4");
    expect(canonicalAudioType("application/octet-stream", "take.wav")).toBe("audio/wav");
    expect(canonicalAudioType("audio/flac", "take.wav")).toBeNull();
    expect(canonicalAudioType("image/png", "x.mp3")).toBeNull();
    expect(canonicalAudioType("", "notes.txt")).toBeNull();
  });

  it("knows stored extensions", () => {
    expect(["audio/mpeg", "audio/mp4", "audio/wav", "audio/ogg", "audio/webm"].map(audioExtension)).toEqual(["mp3", "m4a", "wav", "ogg", "webm"]);
  });
});

describe("parseFfmpegTime", () => {
  it("takes the last progress stamp", () => {
    expect(parseFfmpegTime("size=N/A time=00:00:01.20 bitrate=N/A\rsize=N/A time=00:01:02.50 bitrate=N/A")).toBeCloseTo(62.5);
    expect(parseFfmpegTime("no progress")).toBeUndefined();
  });
});
