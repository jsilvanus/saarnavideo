import { describe, expect, it } from "vitest";
import { captionOptionsSchema, outputExtension, toIso6392, toYouTubeLanguage } from "@/domain/captions";

describe("captionOptionsSchema", () => {
  it("defaults to no captions", () => expect(captionOptionsSchema.parse({})).toEqual({ mode: "none" }));
  it("accepts soft captions with a language", () => expect(captionOptionsSchema.parse({ mode: "soft", language: "fi-FI" })).toEqual({ mode: "soft", language: "fi-FI" }));
  it("rejects unknown modes and bad languages", () => {
    expect(captionOptionsSchema.safeParse({ mode: "hard" }).success).toBe(false);
    expect(captionOptionsSchema.safeParse({ mode: "soft", language: "finnish please" }).success).toBe(false);
  });
});

describe("language helpers", () => {
  it("maps tags to ISO 639-2 for MP4 metadata", () => {
    expect(toIso6392("fi")).toBe("fin");
    expect(toIso6392("fi-FI")).toBe("fin");
    expect(toIso6392("SV")).toBe("swe");
    expect(toIso6392("fin")).toBe("fin");
    expect(toIso6392("xx")).toBe("und");
    expect(toIso6392(undefined)).toBe("und");
  });
  it("maps tags to YouTube language codes", () => {
    expect(toYouTubeLanguage("fin")).toBe("fi");
    expect(toYouTubeLanguage("fi-FI")).toBe("fi");
    expect(toYouTubeLanguage("und")).toBeUndefined();
  });
  it("picks file extensions per output type", () => {
    expect(["VIDEO", "THUMBNAIL", "CAPTIONS_SRT", "CAPTIONS_VTT"].map((type) => outputExtension(type))).toEqual(["mp4", "jpg", "srt", "vtt"]);
    expect(outputExtension("AUDIO", "audio/mpeg")).toBe("mp3");
    expect(outputExtension("AUDIO", "audio/mp4")).toBe("m4a");
  });
});
