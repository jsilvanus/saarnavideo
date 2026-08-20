import { describe, expect, it } from "vitest";
import { buildSourceRenderPlan } from "./ffmpeg";

const base = {
  version: 1 as const,
  semanticSegments: [],
};

describe("buildSourceRenderPlan", () => {
  it("renders a continuous source range without unnecessary intermediate clips", () => {
    const plan = buildSourceRenderPlan(
      {
        ...base,
        composition: {
          sourceStartSeconds: 10,
          sourceEndSeconds: 40,
          items: [],
        },
      },
      "/tmp/source.mp4",
      "/tmp/output.mp4",
    );

    expect(plan.args).toContain("-ss");
    expect(plan.args).toContain("10");
    expect(plan.args).toContain("-t");
    expect(plan.args).toContain("30");
    expect(plan.args).not.toContain("-vf");
    expect(plan.args.at(-1)).toBe("/tmp/output.mp4");
  });

  it("creates a concat filter for separated source clips", () => {
    const plan = buildSourceRenderPlan(
      {
        ...base,
        composition: {
          sourceStartSeconds: 0,
          sourceEndSeconds: 100,
          items: [
            { type: "source-clip", sourceId: "source-1", startSeconds: 10, endSeconds: 20 },
            { type: "source-clip", sourceId: "source-1", startSeconds: 40, endSeconds: 50 },
          ],
        },
      },
      "/tmp/source.mp4",
      "/tmp/output.mp4",
      { "source-1": "/tmp/source.mp4" },
    );

    const filter = plan.args[plan.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("concat=n=2");
    expect(filter).toContain("trim=start=10:duration=10");
    expect(filter).toContain("trim=start=40:duration=10");
  });

  it("keeps cut transitions as a no-op", () => {
    const plan = buildSourceRenderPlan(
      {
        ...base,
        composition: {
          sourceStartSeconds: 0,
          sourceEndSeconds: 100,
          items: [
            { type: "source-clip", sourceId: "source-1", startSeconds: 10, endSeconds: 20, transitionIn: { type: "cut", durationSeconds: 0 } },
            { type: "source-clip", sourceId: "source-1", startSeconds: 40, endSeconds: 50, transitionIn: { type: "cut", durationSeconds: 0 } },
          ],
        },
      },
      "/tmp/source.mp4",
      "/tmp/output.mp4",
      { "source-1": "/tmp/source.mp4" },
    );

    const filter = plan.args[plan.args.indexOf("-filter_complex") + 1];
    expect(filter).not.toContain("xfade");
    expect(filter).not.toContain("fade=");
  });

  it("renders a fade transition on the incoming clip", () => {
    const plan = buildSourceRenderPlan(
      {
        ...base,
        composition: {
          sourceStartSeconds: 0,
          sourceEndSeconds: 100,
          items: [
            { type: "source-clip", sourceId: "source-1", startSeconds: 10, endSeconds: 20 },
            { type: "source-clip", sourceId: "source-1", startSeconds: 40, endSeconds: 50, transitionIn: { type: "fade", durationSeconds: 0.5 } },
          ],
        },
      },
      "/tmp/source.mp4",
      "/tmp/output.mp4",
      { "source-1": "/tmp/source.mp4" },
    );

    const filter = plan.args[plan.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("fade=t=in:st=0:d=0.5");
  });

  it("renders a crossfade transition on the incoming clip", () => {
    const plan = buildSourceRenderPlan(
      {
        ...base,
        composition: {
          sourceStartSeconds: 0,
          sourceEndSeconds: 100,
          items: [
            { type: "source-clip", sourceId: "source-1", startSeconds: 10, endSeconds: 20 },
            { type: "source-clip", sourceId: "source-1", startSeconds: 40, endSeconds: 50, transitionIn: { type: "crossfade", durationSeconds: 0.5 } },
          ],
        },
      },
      "/tmp/source.mp4",
      "/tmp/output.mp4",
      { "source-1": "/tmp/source.mp4" },
    );

    const filter = plan.args[plan.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("xfade=transition=fade:duration=0.5:offset=9.5");
  });

  it("handles multiple sources in composition", () => {
    const plan = buildSourceRenderPlan(
      {
        ...base,
        composition: {
          items: [
            { type: "source-clip", sourceId: "source-a", startSeconds: 10, endSeconds: 30 },
            { type: "source-clip", sourceId: "source-b", startSeconds: 0, endSeconds: 20 },
            { type: "source-clip", sourceId: "source-a", startSeconds: 100, endSeconds: 130 },
          ],
        },
      },
      "/tmp/unused.mp4",
      "/tmp/output.mp4",
      { "source-a": "/tmp/source-a.mp4", "source-b": "/tmp/source-b.mp4" },
    );

    expect(plan.args).toContain("-i");
    expect(plan.args).toContain("/tmp/source-a.mp4");
    expect(plan.args).toContain("/tmp/source-b.mp4");
    const filter = plan.args[plan.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("concat=n=3");
  });

  it("validates that sourceMap is provided for multi-source compositions", () => {
    expect(() => {
      buildSourceRenderPlan(
        {
          ...base,
          composition: {
            items: [
              { type: "source-clip", sourceId: "source-a", startSeconds: 10, endSeconds: 30 },
            ],
          },
        },
        "/tmp/source.mp4",
        "/tmp/output.mp4",
        // no sourceMap provided
      );
    }).toThrow("sourceMap is required for multi-source compositions");
  });

  it("throws error when sourceMap is missing a source", () => {
    expect(() => {
      buildSourceRenderPlan(
        {
          ...base,
          composition: {
            items: [
              { type: "source-clip", sourceId: "source-a", startSeconds: 10, endSeconds: 30 },
              { type: "source-clip", sourceId: "source-b", startSeconds: 0, endSeconds: 20 },
            ],
          },
        },
        "/tmp/unused.mp4",
        "/tmp/output.mp4",
        { "source-a": "/tmp/source-a.mp4" }, // missing source-b
      );
    }).toThrow("No file path provided for source source-b");
  });
});
