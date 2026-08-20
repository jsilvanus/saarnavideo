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
            { type: "source-clip", startSeconds: 10, endSeconds: 20 },
            { type: "source-clip", startSeconds: 40, endSeconds: 50 },
          ],
        },
      },
      "/tmp/source.mp4",
      "/tmp/output.mp4",
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
            { type: "source-clip", startSeconds: 10, endSeconds: 20, transitionIn: { type: "cut", durationSeconds: 0 } },
            { type: "source-clip", startSeconds: 40, endSeconds: 50, transitionIn: { type: "cut", durationSeconds: 0 } },
          ],
        },
      },
      "/tmp/source.mp4",
      "/tmp/output.mp4",
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
            { type: "source-clip", startSeconds: 10, endSeconds: 20 },
            { type: "source-clip", startSeconds: 40, endSeconds: 50, transitionIn: { type: "fade", durationSeconds: 0.5 } },
          ],
        },
      },
      "/tmp/source.mp4",
      "/tmp/output.mp4",
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
            { type: "source-clip", startSeconds: 10, endSeconds: 20 },
            { type: "source-clip", startSeconds: 40, endSeconds: 50, transitionIn: { type: "crossfade", durationSeconds: 0.5 } },
          ],
        },
      },
      "/tmp/source.mp4",
      "/tmp/output.mp4",
    );

    const filter = plan.args[plan.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("xfade=transition=fade:duration=0.5:offset=4.5");
  });
});
