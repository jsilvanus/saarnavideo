import { describe, expect, it, vi } from "vitest";
import { acquireRequiredSources, resolveRequiredSourceIds, type WorkerSource } from "./sources";

const sourceA: WorkerSource = {
  id: "source-a",
  type: "UPLOAD",
  storagePath: "/tmp/source-a.mp4",
  youtubeVideoId: null,
  youtubeUrl: null,
};

const sourceB: WorkerSource = {
  id: "source-b",
  type: "YOUTUBE",
  storagePath: null,
  youtubeVideoId: "abc123",
  youtubeUrl: "https://youtu.be/abc123",
};

describe("worker source resolution", () => {
  it("resolves unique source ids used by source clips", () => {
    const required = resolveRequiredSourceIds({
      version: 1,
      semanticSegments: [],
      composition: {
        items: [
          { type: "source-clip", sourceId: "source-a", startSeconds: 0, endSeconds: 10 },
          { type: "slate", template: "sermon", durationSeconds: 3, data: {} },
          { type: "source-clip", sourceId: "source-b", startSeconds: 10, endSeconds: 20 },
          { type: "source-clip", sourceId: "source-a", startSeconds: 20, endSeconds: 30 },
        ],
      },
    }, [sourceA, sourceB]);

    expect(required).toEqual(["source-a", "source-b"]);
  });

  it("acquires only required sources and returns sourceId path map", async () => {
    const downloadYouTubeSource = vi.fn(async () => undefined);
    const updateSource = vi.fn(async () => undefined);

    const paths = await acquireRequiredSources({
      projectId: "project-1",
      sources: [sourceA, sourceB],
      requiredSourceIds: ["source-a"],
      mediaRoot: "/tmp/media",
      retentionMs: 1000,
      downloadYouTubeSource,
      updateSource,
    });

    expect(paths).toEqual({ "source-a": "/tmp/source-a.mp4" });
    expect(downloadYouTubeSource).not.toHaveBeenCalled();
    expect(updateSource).not.toHaveBeenCalled();
  });
});
