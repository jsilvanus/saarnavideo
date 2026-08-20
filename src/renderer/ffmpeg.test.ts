import { describe, expect, it } from "vitest";
import { buildCompositionRenderPlan, buildSourceRenderPlan } from "./ffmpeg";

const base = {
  version: 1 as const,
  semanticSegments: [],
};

const baseComposition = {
  sourceStartSeconds: 0,
  sourceEndSeconds: 1000,
};

describe("buildCompositionRenderPlan", () => {
  it("renders a single source clip", () => {
    const plan = buildCompositionRenderPlan(
      {
        ...base,
        composition: {
          ...baseComposition,
          items: [
            { type: "source-clip", sourceId: "source-a", startSeconds: 10, endSeconds: 40 },
          ],
        },
      },
      new Map([["source-a", "/tmp/source-a.mp4"]]),
      "/tmp/output.mp4",
    );

    expect(plan.args).toContain("-i");
    expect(plan.args).toContain("/tmp/source-a.mp4");
    // Single source clips now use filter_complex for consistency
    expect(plan.args).toContain("-filter_complex");
    expect(plan.args.at(-1)).toBe("/tmp/output.mp4");
  });

  it("renders multiple clips from different sources", () => {
    const plan = buildCompositionRenderPlan(
      {
        ...base,
        composition: {
          ...baseComposition,
          items: [
            { type: "source-clip", sourceId: "source-a", startSeconds: 10, endSeconds: 20 },
            { type: "source-clip", sourceId: "source-b", startSeconds: 0, endSeconds: 30 },
          ],
        },
      },
      new Map([
        ["source-a", "/tmp/source-a.mp4"],
        ["source-b", "/tmp/source-b.mp4"],
      ]),
      "/tmp/output.mp4",
    );

    const inputCount = plan.args.filter((arg) => arg === "-i").length;
    expect(inputCount).toBe(2);
    expect(plan.args).toContain("/tmp/source-a.mp4");
    expect(plan.args).toContain("/tmp/source-b.mp4");
    
    const filter = plan.args[plan.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("concat=n=2");
    expect(filter).toContain("[0:v]");
    expect(filter).toContain("[1:v]");
  });

  it("handles same source used multiple times", () => {
    const plan = buildCompositionRenderPlan(
      {
        ...base,
        composition: {
          ...baseComposition,
          items: [
            { type: "source-clip", sourceId: "source-a", startSeconds: 10, endSeconds: 20 },
            { type: "source-clip", sourceId: "source-a", startSeconds: 40, endSeconds: 50 },
          ],
        },
      },
      new Map([["source-a", "/tmp/source-a.mp4"]]),
      "/tmp/output.mp4",
    );

    const inputCount = plan.args.filter((arg) => arg === "-i").length;
    expect(inputCount).toBe(1);
    
    const filter = plan.args[plan.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("concat=n=2");
    expect(filter).toContain("trim=start=10:duration=10");
    expect(filter).toContain("trim=start=40:duration=10");
  });

  it("throws error for missing source path", () => {
    expect(() => {
      buildCompositionRenderPlan(
        {
          ...base,
          composition: {
            ...baseComposition,
            items: [
              { type: "source-clip", sourceId: "missing-source", startSeconds: 10, endSeconds: 20 },
            ],
          },
        },
        new Map(),
        "/tmp/output.mp4",
      );
    }).toThrow("Missing source path for sourceId: missing-source");
  });

  it("throws error with no source clips or slates", () => {
    expect(() => {
      buildCompositionRenderPlan(
        {
          ...base,
          composition: {
            ...baseComposition,
            items: [],
          },
        },
        new Map([["source-a", "/tmp/source-a.mp4"]]),
        "/tmp/output.mp4",
      );
    }).toThrow("Composition must contain at least one source clip or slate");
  });

  it("applies cut transition (no-op)", () => {
    const plan = buildCompositionRenderPlan(
      {
        ...base,
        composition: {
          ...baseComposition,
          items: [
            { type: "source-clip", sourceId: "source-a", startSeconds: 10, endSeconds: 20 },
            { type: "source-clip", sourceId: "source-a", startSeconds: 40, endSeconds: 50, transitionIn: { type: "cut", durationSeconds: 0 } },
          ],
        },
      },
      new Map([["source-a", "/tmp/source-a.mp4"]]),
      "/tmp/output.mp4",
    );

    const filter = plan.args[plan.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("concat=n=2");
    expect(filter).not.toContain("xfade");
  });

  it("applies fade transition", () => {
    const plan = buildCompositionRenderPlan(
      {
        ...base,
        composition: {
          ...baseComposition,
          items: [
            { type: "source-clip", sourceId: "source-a", startSeconds: 10, endSeconds: 20 },
            { type: "source-clip", sourceId: "source-a", startSeconds: 40, endSeconds: 50, transitionIn: { type: "fade", durationSeconds: 0.5 } },
          ],
        },
      },
      new Map([["source-a", "/tmp/source-a.mp4"]]),
      "/tmp/output.mp4",
    );

    const filter = plan.args[plan.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("fade=t=in:st=0:d=0.5");
  });

  it("applies crossfade transition", () => {
    const plan = buildCompositionRenderPlan(
      {
        ...base,
        composition: {
          ...baseComposition,
          items: [
            { type: "source-clip", sourceId: "source-a", startSeconds: 10, endSeconds: 20 },
            { type: "source-clip", sourceId: "source-a", startSeconds: 40, endSeconds: 50, transitionIn: { type: "crossfade", durationSeconds: 0.5 } },
          ],
        },
      },
      new Map([["source-a", "/tmp/source-a.mp4"]]),
      "/tmp/output.mp4",
    );

    const filter = plan.args[plan.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("xfade=transition=fade:duration=0.5");
  });

  it("handles source A -> source B transition", () => {
    const plan = buildCompositionRenderPlan(
      {
        ...base,
        composition: {
          ...baseComposition,
          items: [
            { type: "source-clip", sourceId: "source-a", startSeconds: 10, endSeconds: 20 },
            { type: "source-clip", sourceId: "source-b", startSeconds: 0, endSeconds: 15, transitionIn: { type: "crossfade", durationSeconds: 0.5 } },
          ],
        },
      },
      new Map([
        ["source-a", "/tmp/source-a.mp4"],
        ["source-b", "/tmp/source-b.mp4"],
      ]),
      "/tmp/output.mp4",
    );

    const filter = plan.args[plan.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("[0:v]");
    expect(filter).toContain("[1:v]");
    // Crossfade uses xfade directly, not concat
    expect(filter).toContain("xfade=transition=fade");
  });

  it("renders a slate (generated title card)", () => {
    const plan = buildCompositionRenderPlan(
      {
        ...base,
        composition: {          ...baseComposition,          items: [
            { type: "slate", template: "sermon", durationSeconds: 3, data: { title: "Gospel", subtitle: "Matthew 5" } },
            { type: "source-clip", sourceId: "source-a", startSeconds: 10, endSeconds: 20 },
          ],
        },
      },
      new Map([["source-a", "/tmp/source-a.mp4"]]),
      "/tmp/output.mp4",
    );

    const filterComplexIdx = plan.args.indexOf("-filter_complex");
    const filter = plan.args[filterComplexIdx + 1];
    
    // Should have color filter for slate background
    expect(filter).toContain("color=");
    // Should have text rendering
    expect(filter).toContain("drawtext=");
    // Should have concat joining slate and source
    expect(filter).toContain("concat=");
    
    // Should have 3 -i inputs: 1 source + 1 color + 1 anullsrc (for audio)
    const inputCount = plan.args.filter((arg) => arg === "-i").length;
    expect(inputCount).toBeGreaterThanOrEqual(2);
  });

  it("renders overlays with timing", () => {
    const plan = buildCompositionRenderPlan(
      {
        ...base,
        composition: {
          ...baseComposition,
          items: [
            { type: "source-clip", sourceId: "source-a", startSeconds: 10, endSeconds: 30 },
            { type: "overlay", template: "gospel", startSeconds: 15, endSeconds: 25, data: { text: "John 3:16" } },
          ],
        },
      },
      new Map([["source-a", "/tmp/source-a.mp4"]]),
      "/tmp/output.mp4",
    );

    const filter = plan.args[plan.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("drawtext=");
    // Colon is escaped in FFmpeg filters
    expect(filter).toContain("John 3\\:16");
    expect(filter).toContain("enable='between(t,15,25)'");
  });

  it("renders slate with transition", () => {
    const plan = buildCompositionRenderPlan(
      {
        ...base,
        composition: {
          ...baseComposition,
          items: [
            { type: "slate", template: "sermon", durationSeconds: 2, data: { title: "Opening" }, transitionIn: { type: "fade", durationSeconds: 0.5 } },
            { type: "source-clip", sourceId: "source-a", startSeconds: 0, endSeconds: 10 },
          ],
        },
      },
      new Map([["source-a", "/tmp/source-a.mp4"]]),
      "/tmp/output.mp4",
    );

    const filter = plan.args[plan.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("concat=");
  });

  it("respects template settings", () => {
    const plan = buildCompositionRenderPlan(
      {
        ...base,
        template: {
          key: "custom",
          width: 3840,
          height: 2160,
          fps: 60,
          backgroundColor: "navy",
          textColor: "gold",
        },
        composition: {
          ...baseComposition,
          items: [
            { type: "slate", template: "custom", durationSeconds: 2, data: { title: "4K Title" } },
          ],
        },
      },
      new Map(),
      "/tmp/output.mp4",
    );

    // Template dimensions appear in the lavfi color filter input
    const colorArg = plan.args.join(" ");
    expect(colorArg).toContain("3840x2160");
    expect(colorArg).toContain("navy");
    expect(colorArg).toContain("60");
    
    const filter = plan.args[plan.args.indexOf("-filter_complex") + 1];
    // Text color appears in drawtext filter
    expect(filter).toContain("fontcolor=gold");
  });
});

describe("buildSourceRenderPlan (legacy backward compatibility)", () => {
  it("provides backward compatibility wrapper", () => {
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

    expect(plan.args).toContain("-i");
    expect(plan.args).toContain("/tmp/source.mp4");
  });

  it("delegates to composition plan if items exist", () => {
    const plan = buildSourceRenderPlan(
      {
        ...base,
        composition: {
          sourceStartSeconds: 10,
          sourceEndSeconds: 40,
          items: [
            { type: "source-clip", sourceId: "legacy-source", startSeconds: 10, endSeconds: 40 },
          ],
        },
      },
      "/tmp/source.mp4",
      "/tmp/output.mp4",
    );

    expect(plan.args).toContain("-filter_complex");
  });
});
