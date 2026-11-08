import { describe, expect, it, vi } from "vitest";
import { buildVideoResource } from "@/domain/youtube-publish";
import { publishVideoToYouTube, type YouTubePublishDeps } from "@/worker/youtube-publish";

const resource = buildVideoResource({ title: "T" }, "PRIVATE");

function deps(client: Partial<YouTubePublishDeps["client"]> = {}) {
  const sessions: Array<string | null> = []; const progress: number[] = [];
  const d: YouTubePublishDeps = {
    client: {
      uploadVideo: vi.fn(async (input) => { await input.onSession?.("https://up/s1"); await input.onProgress?.(50, 200); await input.onProgress?.(51, 200); await input.onProgress?.(200, 200); return { videoId: "vid1", resumed: false }; }),
      setThumbnail: vi.fn(async () => undefined),
      addToPlaylist: vi.fn(async () => ({ playlistItemId: "i1" })),
      ...client,
    },
    saveSession: async (url) => { sessions.push(url); },
    progress: async (p) => { progress.push(p); },
    log: vi.fn(),
  };
  return { d, sessions, progress };
}

describe("publishVideoToYouTube", () => {
  it("uploads, stores then clears the session, reports whole percents, sets thumbnail and playlist", async () => {
    const { d, sessions, progress } = deps();
    const result = await publishVideoToYouTube({ filePath: "/v.mp4", thumbnailPath: "/t.jpg", resource, playlistId: "PL1" }, d);
    expect(result).toEqual({ videoId: "vid1", warnings: [], resumed: false });
    expect(sessions).toEqual(["https://up/s1", null]);
    expect(progress).toEqual([25, 100]);
    expect(d.client.setThumbnail).toHaveBeenCalledWith("vid1", "/t.jpg");
    expect(d.client.addToPlaylist).toHaveBeenCalledWith("vid1", "PL1");
  });

  it("keeps the publication when thumbnail and playlist fail, returning warnings", async () => {
    const { d } = deps({ setThumbnail: vi.fn(async () => { throw new Error("thumb no"); }), addToPlaylist: vi.fn(async () => { throw new Error("playlist no"); }) });
    const result = await publishVideoToYouTube({ filePath: "/v.mp4", thumbnailPath: "/t.jpg", resource, playlistId: "PL1" }, d);
    expect(result.videoId).toBe("vid1");
    expect(result.warnings).toEqual(["thumb no", "playlist no"]);
  });

  it("passes a stored session on and skips the playlist when none is chosen", async () => {
    const uploadVideo = vi.fn(async () => ({ videoId: "vid2", resumed: true }));
    const { d } = deps({ uploadVideo });
    expect((await publishVideoToYouTube({ filePath: "/v.mp4", resource, sessionUrl: "https://up/old" }, d)).resumed).toBe(true);
    expect(uploadVideo).toHaveBeenCalledWith(expect.objectContaining({ sessionUrl: "https://up/old" }));
    expect(d.client.addToPlaylist).not.toHaveBeenCalled();
    expect(d.client.setThumbnail).not.toHaveBeenCalled();
  });

  it("fails when the video upload fails", async () => {
    const { d } = deps({ uploadVideo: vi.fn(async () => { throw new Error("quota"); }) });
    await expect(publishVideoToYouTube({ filePath: "/v.mp4", resource }, d)).rejects.toThrow("quota");
  });
});
