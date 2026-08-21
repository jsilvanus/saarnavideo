import { describe, expect, it } from "vitest";
import type { ProjectDefinition } from "@/domain/project";
import { appendSource, getReferencedSourceIds, resolveSourcePaths, type SourceRecord } from "./source-resolution";

function definitionFor(sourceIds: string[]): ProjectDefinition {
  return {
    version: 1,
    semanticSegments: [],
    composition: {
      sourceStartSeconds: 0,
      sourceEndSeconds: 30,
      items: sourceIds.map((sourceId) => ({
        type: "source-clip",
        sourceId,
        startSeconds: 0,
        endSeconds: 30,
      })),
    },
  };
}

describe("source resolution", () => {
  it("supports multiple sources in one project", () => {
    const definition = definitionFor(["upload-1", "upload-2"]);
    const sources: SourceRecord[] = [
      { id: "upload-1", type: "UPLOAD", storagePath: "/tmp/upload-1.mp4", youtubeVideoId: null, youtubeUrl: null },
      { id: "upload-2", type: "UPLOAD", storagePath: "/tmp/upload-2.mp4", youtubeVideoId: null, youtubeUrl: null },
    ];

    expect(getReferencedSourceIds(definition)).toEqual(["upload-1", "upload-2"]);
    expect(resolveSourcePaths(definition, sources)).toEqual(new Map([
      ["upload-1", "/tmp/upload-1.mp4"],
      ["upload-2", "/tmp/upload-2.mp4"],
    ]));
  });

  it("supports two uploaded sources", () => {
    const definition = definitionFor(["uploaded-a", "uploaded-b"]);
    const sourcePaths = resolveSourcePaths(definition, [
      { id: "uploaded-a", type: "UPLOAD", storagePath: "/tmp/a.mp4", youtubeVideoId: null, youtubeUrl: null },
      { id: "uploaded-b", type: "UPLOAD", storagePath: "/tmp/b.mp4", youtubeVideoId: null, youtubeUrl: null },
    ] as SourceRecord[]);

    expect(sourcePaths.size).toBe(2);
  });

  it("supports YouTube plus upload in the same project", () => {
    const definition = definitionFor(["youtube-source", "uploaded-source"]);
    const sourcePaths = resolveSourcePaths(definition, [
      { id: "youtube-source", type: "YOUTUBE", storagePath: "/tmp/youtube.mp4", youtubeVideoId: "abc123", youtubeUrl: "https://youtube.com/watch?v=abc123" },
      { id: "uploaded-source", type: "UPLOAD", storagePath: "/tmp/uploaded.mp4", youtubeVideoId: null, youtubeUrl: null },
    ] as SourceRecord[]);

    expect(sourcePaths.get("youtube-source")).toBe("/tmp/youtube.mp4");
    expect(sourcePaths.get("uploaded-source")).toBe("/tmp/uploaded.mp4");
  });

  it("throws when a referenced sourceId is missing", () => {
    const definition = definitionFor(["missing-source"]);

    expect(() => resolveSourcePaths(definition, [])).toThrow("Missing source path for sourceId: missing-source");
  });

  it("keeps existing single-source projects working", () => {
    const sourceId = "legacy-source";
    const definition = definitionFor([sourceId]);
    const sourcePaths = resolveSourcePaths(definition, [
      { id: sourceId, type: "UPLOAD", storagePath: "/tmp/legacy.mp4", youtubeVideoId: null, youtubeUrl: null },
    ] as SourceRecord[]);

    expect(sourcePaths.get(sourceId)).toBe("/tmp/legacy.mp4");
  });

  it("does not replace existing sources when a new upload is added", () => {
    const existing = [
      { id: "existing", type: "UPLOAD", storagePath: "/tmp/existing.mp4", youtubeVideoId: null, youtubeUrl: null },
    ] as const;
    const next = appendSource(existing, { id: "new-upload", type: "UPLOAD", storagePath: "/tmp/new-upload.mp4", youtubeVideoId: null, youtubeUrl: null });

    expect(next).toHaveLength(2);
    expect(next.map((source) => source.id)).toEqual(["existing", "new-upload"]);
  });
});
