import { mkdtemp, writeFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { storeAudioAsset } from "./assets";

describe("storeAudioAsset", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("answers 503 with a server message when ffprobe is not installed, and removes the upload", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "audio-upload-"));
    const tempPath = path.join(directory, "upload.bin");
    await writeFile(tempPath, "not really audio");
    vi.stubEnv("PATH", "/nonexistent-bin-dir-for-test");
    const result = await storeAudioAsset({ tempPath, size: 16, mimeType: "audio/mpeg", contentHash: "0".repeat(64) });
    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "ffprobe is not available on the app server" });
    await expect(access(tempPath)).rejects.toThrow();
  });
});
