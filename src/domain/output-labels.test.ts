import { describe, expect, it } from "vitest";
import { OUTPUT_LABEL_MAX, attachmentDisposition, normalizeOutputLabel, outputDownloadName, sanitizeOutputFileBase } from "@/domain/output-labels";

describe("normalizeOutputLabel", () => {
  it("trims, clears on an empty string or null, and refuses more than 120 characters", () => {
    expect(normalizeOutputLabel("  Sunnuntai 14.6.  ")).toEqual({ ok: true, label: "Sunnuntai 14.6." });
    expect(normalizeOutputLabel("   ")).toEqual({ ok: true, label: null });
    expect(normalizeOutputLabel("")).toEqual({ ok: true, label: null });
    expect(normalizeOutputLabel(null)).toEqual({ ok: true, label: null });
    expect(normalizeOutputLabel("x".repeat(OUTPUT_LABEL_MAX))).toMatchObject({ ok: true });
    expect(normalizeOutputLabel("x".repeat(OUTPUT_LABEL_MAX + 1))).toMatchObject({ ok: false });
    expect(normalizeOutputLabel(42)).toMatchObject({ ok: false });
  });
});

describe("sanitizeOutputFileBase", () => {
  it("removes path and shell characters and dots at the ends", () => {
    expect(sanitizeOutputFileBase("../etc/passwd")).toBe("etc passwd");
    expect(sanitizeOutputFileBase('a:b*c?"d"<e>|f')).toBe("a b c d e f");
    expect(sanitizeOutputFileBase("...hidden...")).toBe("hidden");
    expect(sanitizeOutputFileBase("  \t  ")).toBeNull();
    expect(sanitizeOutputFileBase("...")).toBeNull();
  });
});

describe("outputDownloadName", () => {
  it("uses the default name without a label and the label with the right extension when set", () => {
    expect(outputDownloadName({ type: "VIDEO", mimeType: "video/mp4", language: null })).toBe("saarnavideo-video.mp4");
    expect(outputDownloadName({ type: "VIDEO", mimeType: "video/mp4", language: null, label: "Sunnuntai 14.6. klo 10" })).toBe("Sunnuntai 14.6. klo 10.mp4");
    expect(outputDownloadName({ type: "AUDIO", mimeType: "audio/mp4", language: null, label: "Podcast: Ilta" })).toBe("Podcast Ilta.m4a");
    expect(outputDownloadName({ type: "CAPTIONS_VTT", mimeType: "text/vtt", language: "fi", label: "Tekstitys" })).toBe("Tekstitys.vtt");
  });

  it("does not add the extension twice and falls back to the default when the label is only punctuation", () => {
    expect(outputDownloadName({ type: "VIDEO", mimeType: "video/mp4", language: null, label: "Saarna.MP4" })).toBe("Saarna.mp4");
    expect(outputDownloadName({ type: "CAPTIONS_SRT", mimeType: "text/plain", language: "sv", label: "..." })).toBe("saarnavideo-captions-sv.srt");
    expect(outputDownloadName({ type: "VIDEO", mimeType: "video/mp4", language: null, label: "" })).toBe("saarnavideo-video.mp4");
  });
});

describe("attachmentDisposition", () => {
  it("keeps the UTF-8 name and gives an ASCII fallback", () => {
    expect(attachmentDisposition("Sunnuntai.mp4")).toBe(`attachment; filename="Sunnuntai.mp4"; filename*=UTF-8''Sunnuntai.mp4`);
    const header = attachmentDisposition("Pääsiäinen ä ö.mp4");
    expect(header).toContain('filename="P__si_inen _ _.mp4"');
    expect(header).toContain("filename*=UTF-8''P%C3%A4%C3%A4si%C3%A4inen%20%C3%A4%20%C3%B6.mp4");
  });
});
