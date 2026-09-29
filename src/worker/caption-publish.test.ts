import { describe, expect, it, vi } from "vitest";
import { captionTrackName, uploadCaptionsAfterVideo, type CaptionPublishDeps } from "@/worker/caption-publish";

function deps(overrides: Partial<CaptionPublishDeps> = {}): CaptionPublishDeps & { log: ReturnType<typeof vi.fn>; upload: ReturnType<typeof vi.fn> } {
  return { findSidecar: async () => ({ storagePath: "/tmp/c.srt", language: "fin" }), getAccessToken: async () => "tok", upload: vi.fn(async () => ({ captionId: "cap" })), log: vi.fn(), ...overrides } as never;
}

describe("uploadCaptionsAfterVideo", () => {
  it("uploads the sidecar with a two-letter language and a native track name", async () => {
    const d = deps();
    expect(await uploadCaptionsAfterVideo({ videoId: "v1", videoOutput: { jobId: "j1" } }, d)).toEqual({ uploaded: true });
    expect(d.upload).toHaveBeenCalledWith({ accessToken: "tok", videoId: "v1", filePath: "/tmp/c.srt", language: "fi", name: "suomi" });
  });
  it("does nothing without a sidecar or job", async () => {
    const d = deps({ findSidecar: async () => null });
    expect(await uploadCaptionsAfterVideo({ videoId: "v1", videoOutput: { jobId: "j1" } }, d)).toEqual({ uploaded: false });
    expect(await uploadCaptionsAfterVideo({ videoId: "v1", videoOutput: { jobId: null } }, deps())).toEqual({ uploaded: false });
    expect(d.upload).not.toHaveBeenCalled();
  });
  it("skips (with a warning) when the language is unknown", async () => {
    const d = deps({ findSidecar: async () => ({ storagePath: "/x", language: "und" }) });
    expect((await uploadCaptionsAfterVideo({ videoId: "v", videoOutput: { jobId: "j" } }, d)).uploaded).toBe(false);
    expect(d.log).toHaveBeenCalledWith("j", "WARN", expect.stringContaining("language is unknown"), expect.anything());
  });
  it("fails soft when the API call throws", async () => {
    const d = deps({ upload: vi.fn(async () => { throw new Error("403 insufficientPermissions"); }) });
    await expect(uploadCaptionsAfterVideo({ videoId: "v", videoOutput: { jobId: "j" } }, d)).resolves.toEqual({ uploaded: false });
    expect(d.log).toHaveBeenCalledWith("j", "WARN", expect.stringContaining("failed"), expect.objectContaining({ error: "403 insufficientPermissions" }));
  });
  it("fails soft even when token lookup or logging throws", async () => {
    const d = deps({ getAccessToken: async () => { throw new Error("no token"); }, log: vi.fn(async () => { throw new Error("db down"); }) });
    await expect(uploadCaptionsAfterVideo({ videoId: "v", videoOutput: { jobId: "j" } }, d)).resolves.toEqual({ uploaded: false });
  });
  it("names tracks in their own language", () => expect(captionTrackName("sv")).toBe("svenska"));
});
