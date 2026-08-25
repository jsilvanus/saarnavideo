import { describe, expect, it, beforeEach } from "vitest";
import { decryptYouTubeToken, encryptYouTubeToken } from "./youtube-token-crypto";

describe("YouTube token encryption", () => {
  beforeEach(() => {
    process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  });

  it("round-trips tokens without storing plaintext", () => {
    const token = "ya29.example-secret-token";
    const encrypted = encryptYouTubeToken(token);
    expect(encrypted).toMatch(/^enc:v1:/);
    expect(encrypted).not.toContain(token);
    expect(decryptYouTubeToken(encrypted)).toBe(token);
  });

  it("rejects an invalid encryption key", () => {
    process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY = "too-short";
    expect(() => encryptYouTubeToken("secret")).toThrow();
  });
});
