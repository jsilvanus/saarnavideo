import { describe, expect, it } from "vitest";
import { buildCompositionRenderPlan } from "./ffmpeg";

const source = new Map([["source-a", "/tmp/source-a.mp4"]]);

const base = {
  version: 1 as const,
  semanticSegments: [],
  template: { key: "generic", width: 1920, height: 1080, fps: 30, backgroundColor: "black", textColor: "white" },
  composition: { sourceStartSeconds: 0, sourceEndSeconds: 60, items: [] },
};

describe("layered composition", () => {
  it("keeps a rectangle overlay on top of the running video", () => {
    const plan = buildCompositionRenderPlan({
      ...base,
      composition: {
        ...base.composition,
        items: [
          { type: "source-clip", sourceId: "source-a", startSeconds: 0, endSeconds: 20 },
          { type: "overlay", template: "generic", kind: "rectangle", startSeconds: 2, endSeconds: 8, color: "black", opacity: 0.45, x: 0, y: 0, width: 1920, height: 1080, data: {} },
          { type: "overlay", template: "generic", kind: "text", startSeconds: 2, endSeconds: 8, opacity: 1, data: { text: "Example text" } },
        ],
      },
    }, source, "/tmp/output.mp4");

    const filter = plan.args[plan.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("drawbox=");
    expect(filter).toContain("black@0.45");
    expect(filter).toContain("Example text");
    expect(filter).toContain("between(t,2,8)");
  });

  it("supports a slate as an overlay without replacing the video", () => {
    const plan = buildCompositionRenderPlan({
      ...base,
      composition: {
        ...base.composition,
        items: [
          { type: "source-clip", sourceId: "source-a", startSeconds: 0, endSeconds: 20 },
          { type: "slate", template: "generic", mode: "overlay", durationSeconds: 6, startSeconds: 5, endSeconds: 11, data: { title: "Title", subtitle: "Subtitle", backgroundColor: "black", backgroundOpacity: "0.45" } },
        ],
      },
    }, source, "/tmp/output.mp4");

    const filter = plan.args[plan.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("drawbox=");
    expect(filter).toContain("Title");
    expect(filter).toContain("Subtitle");
    expect(filter).toContain("between(t,5,11)");
    expect(filter).toContain("[v0]");
  });
});
