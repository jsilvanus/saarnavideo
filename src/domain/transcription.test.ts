import { describe, expect, it } from "vitest";
import { transcriptionResultSchema } from "./transcription";

describe("transcription contract", () => {
  it("accepts timestamped transcript segments", () => {
    const result = transcriptionResultSchema.parse({
      transcript: {
        version: 1,
        language: "fi",
        segments: [{ startSeconds: 1, endSeconds: 3, text: "Alussa oli Sana.", confidence: 0.9 }],
      },
      suggestions: [],
    });
    expect(result.transcript.segments[0].text).toBe("Alussa oli Sana.");
  });

  it("does not require semantic suggestions", () => {
    expect(transcriptionResultSchema.parse({
      transcript: { version: 1, language: "fi", segments: [] },
      suggestions: [],
    }).suggestions).toEqual([]);
  });
});
