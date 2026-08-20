import { describe, expect, it } from "vitest";
import { buildSourceRenderPlan } from "./ffmpeg";

const base = {
  version: 1 as const,
  semanticSegments: [],
};

describe("buildSourceRenderPlan", () => {
  it("adds multiple ffmpeg inputs for mixed-source composition", () => {
    const plan = buildSourceRenderPlan(
      {
        ...base,
        composition: {
          items: [
            { type: "source-clip", sourceId: "source-a", startSeconds: 10, endSeconds: 20 },
            { type: "source-clip", sourceId: "source-b", startSeconds: 0, endSeconds: 8 },
            { type: "source-clip", sourceId: "source-a", startSeconds: 50, endSeconds: 60 },
          ],
        },
      },
      {
        "source-a": "/tmp/source-a.mp4",
        "source-b": "/tmp/source-b.mp4",
      },
      "/tmp/output.mp4",
    );

    expect(plan.args.filter((arg) => arg === "-i")).toHaveLength(2);
    expect(plan.args).toContain("/tmp/source-a.mp4");
    expect(plan.args).toContain("/tmp/source-b.mp4");
    const filter = plan.args[plan.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("[0:v]trim=start=10:duration=10");
    expect(filter).toContain("[1:v]trim=start=0:duration=8");
  });

  it("rejects compositions that reference missing source ids", () => {
    expect(() => buildSourceRenderPlan(
      {
        ...base,
        composition: {
          items: [
            { type: "source-clip", sourceId: "missing", startSeconds: 0, endSeconds: 10 },
          ],
        },
      },
      { "source-a": "/tmp/source-a.mp4" },
      "/tmp/output.mp4",
    )).toThrow(/missing sources/i);
  });

  it("builds source-to-source crossfades including audio", () => {
    const plan = buildSourceRenderPlan(
      {
        ...base,
        composition: {
          items: [
            { type: "source-clip", sourceId: "source-a", startSeconds: 10, endSeconds: 20 },
            { type: "source-clip", sourceId: "source-b", startSeconds: 40, endSeconds: 52, transitionIn: { type: "crossfade", durationSeconds: 0.5 } },
          ],
        },
      },
      {
        "source-a": "/tmp/source-a.mp4",
        "source-b": "/tmp/source-b.mp4",
      },
      "/tmp/output.mp4",
    );

    const filter = plan.args[plan.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("xfade=transition=fade:duration=0.5:offset=9.5");
    expect(filter).toContain("acrossfade=d=0.5");
  });

  it("supports transitions from source to slate and slate to source", () => {
    const plan = buildSourceRenderPlan(
      {
        ...base,
        composition: {
          items: [
            { type: "source-clip", sourceId: "source-a", startSeconds: 0, endSeconds: 15 },
            { type: "slate", template: "sermon", durationSeconds: 5, data: { title: "Title" }, transitionIn: { type: "fade", durationSeconds: 0.75 }, transitionOut: { type: "crossfade", durationSeconds: 1 } },
            { type: "source-clip", sourceId: "source-b", startSeconds: 20, endSeconds: 35 },
          ],
        },
      },
      {
        "source-a": "/tmp/source-a.mp4",
        "source-b": "/tmp/source-b.mp4",
      },
      "/tmp/output.mp4",
    );

    const filter = plan.args[plan.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("color=c=#111111:s=1280x720:d=5");
    expect(filter).toContain("xfade=transition=fadeblack:duration=0.75:offset=14.25");
    expect(filter).toContain("xfade=transition=fade:duration=1:offset=18.25");
  });

  it("applies timed overlays after timeline composition", () => {
    const plan = buildSourceRenderPlan(
      {
        ...base,
        composition: {
          items: [
            { type: "source-clip", sourceId: "source-a", startSeconds: 0, endSeconds: 20 },
            { type: "overlay", template: "lower-third", startSeconds: 2, endSeconds: 8, data: { text: "Gospel Reading" } },
          ],
        },
      },
      { "source-a": "/tmp/source-a.mp4" },
      "/tmp/output.mp4",
    );

    const filter = plan.args[plan.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("drawbox=x=40:y=h-180");
    expect(filter).toContain("enable='between(t,2,8)'");
    expect(filter).toContain("drawtext=text='Gospel Reading'");
  });
});
