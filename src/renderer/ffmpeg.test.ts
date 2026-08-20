import { describe, expect, it } from "vitest";
import { buildCompositionRenderPlan, buildSourceRenderPlan } from "./ffmpeg";

const base = {
  version: 1 as const,
  semanticSegments: [],
};

describe("buildSourceRenderPlan", () => {
  it("renders a continuous source range without unnecessary intermediate clips", () => {
    const plan = buildSourceRenderPlan({ ...base, composition: { sourceStartSeconds: 10, sourceEndSeconds: 40, items: [] } }, "/tmp/source.mp4", "/tmp/output.mp4");
    expect(plan.args).toContain("-ss");
    expect(plan.args).toContain("10");
    expect(plan.args).toContain("-t");
    expect(plan.args).toContain("30");
    expect(plan.args).not.toContain("-vf");
    expect(plan.args.at(-1)).toBe("/tmp/output.mp4");
  });

  it("creates a concat filter for separated source clips", () => {
    const plan = buildSourceRenderPlan({ ...base, composition: { sourceStartSeconds: 0, sourceEndSeconds: 100, items: [
      { type: "source-clip", startSeconds: 10, endSeconds: 20 },
      { type: "source-clip", startSeconds: 40, endSeconds: 50 },
    ] } }, "/tmp/source.mp4", "/tmp/output.mp4");
    const filter = plan.args[plan.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("concat=n=2");
    expect(filter).toContain("trim=start=10:duration=10");
    expect(filter).toContain("trim=start=40:duration=10");
  });

  it("keeps cut transitions as a no-op", () => {
    const plan = buildSourceRenderPlan({ ...base, composition: { sourceStartSeconds: 0, sourceEndSeconds: 100, items: [
      { type: "source-clip", startSeconds: 10, endSeconds: 20, transitionIn: { type: "cut", durationSeconds: 0 } },
      { type: "source-clip", startSeconds: 40, endSeconds: 50, transitionIn: { type: "cut", durationSeconds: 0 } },
    ] } }, "/tmp/source.mp4", "/tmp/output.mp4");
    const filter = plan.args[plan.args.indexOf("-filter_complex") + 1];
    expect(filter).not.toContain("xfade");
    expect(filter).not.toContain("fade=");
  });

  it("renders a fade transition on the incoming clip", () => {
    const plan = buildSourceRenderPlan({ ...base, composition: { sourceStartSeconds: 0, sourceEndSeconds: 100, items: [
      { type: "source-clip", startSeconds: 10, endSeconds: 20 },
      { type: "source-clip", startSeconds: 40, endSeconds: 50, transitionIn: { type: "fade", durationSeconds: 0.5 } },
    ] } }, "/tmp/source.mp4", "/tmp/output.mp4");
    const filter = plan.args[plan.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("fade=t=in:st=0:d=0.5");
  });

  it("renders a crossfade transition with matching audio crossfade", () => {
    const plan = buildSourceRenderPlan({ ...base, composition: { sourceStartSeconds: 0, sourceEndSeconds: 100, items: [
      { type: "source-clip", startSeconds: 10, endSeconds: 20 },
      { type: "source-clip", startSeconds: 40, endSeconds: 50, transitionIn: { type: "crossfade", durationSeconds: 0.5 } },
    ] } }, "/tmp/source.mp4", "/tmp/output.mp4");
    const filter = plan.args[plan.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("xfade=transition=fade:duration=0.5:offset=9.5");
    expect(filter).toContain("acrossfade=d=0.5");
  });
});

describe("buildCompositionRenderPlan", () => {
  it("creates generated audio/video inputs for a slate", () => {
    const plan = buildCompositionRenderPlan({ ...base, composition: { sourceStartSeconds: 0, sourceEndSeconds: 20, items: [
      { type: "slate", template: "opening", durationSeconds: 5, data: { title: "Sunday Worship", subtitle: "Sermon" } },
      { type: "source-clip", startSeconds: 10, endSeconds: 25 },
    ] } }, "/tmp/source.mp4", "/tmp/output.mp4");
    expect(plan.args).toContain("color=c=black:s=1920x1080:r=30:d=5");
    expect(plan.args).toContain("anullsrc=channel_layout=stereo:sample_rate=48000");
    const filter = plan.args[plan.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("drawtext=text='Sunday Worship'");
    expect(filter).toContain("drawtext=text='Sermon'");
    expect(filter).toContain("concat=n=2");
  });

  it("places an overlay in output-time coordinates", () => {
    const plan = buildCompositionRenderPlan({ ...base, composition: { sourceStartSeconds: 0, sourceEndSeconds: 30, items: [
      { type: "source-clip", startSeconds: 10, endSeconds: 40 },
      { type: "overlay", template: "gospel", startSeconds: 2, endSeconds: 8, data: { text: "In the beginning" } },
    ] } }, "/tmp/source.mp4", "/tmp/output.mp4");
    const filter = plan.args[plan.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("drawtext=text='In the beginning'");
    expect(filter).toContain("enable='between(t,2,8)'");
    expect(filter).toContain("boxcolor=black@0.55");
  });

  it("keeps a simple continuous source as a direct trim", () => {
    const plan = buildCompositionRenderPlan({ ...base, composition: { sourceStartSeconds: 10, sourceEndSeconds: 40, items: [] } }, "/tmp/source.mp4", "/tmp/output.mp4");
    const filter = plan.args[plan.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("trim=start=10:duration=30");
    expect(plan.args.at(-1)).toBe("/tmp/output.mp4");
  });
});
