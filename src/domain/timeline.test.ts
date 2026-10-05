import { describe, expect, it } from "vitest";
import type { ProjectDefinition, TimelineItem } from "@/domain/project";
import { layoutTimeline, timelineDuration, transitionDuration } from "@/domain/timeline";
import { buildCompositionRenderPlan } from "@/renderer/ffmpeg";
import { buildPodcastRenderPlan } from "@/renderer/podcast";

const clip = (startSeconds: number, endSeconds: number, transitionIn?: object) => ({ type: "source-clip", sourceId: "s", startSeconds, endSeconds, ...(transitionIn ? { transitionIn } : {}) });
const slate = (durationSeconds: number, transitionIn?: object) => ({ type: "slate", template: "rich", mode: "standalone", durationSeconds, data: {}, ...(transitionIn ? { transitionIn } : {}) });
const definition = (items: object[]) => ({ version: 1, semanticSegments: [], sections: [], graphics: [], composition: { sourceStartSeconds: 0, sourceEndSeconds: 1000, items } }) as unknown as ProjectDefinition;
const graphOf = (args: string[]) => args[args.indexOf("-filter_complex") + 1];

describe("layoutTimeline", () => {
  const items = [clip(0, 10), clip(20, 30, { type: "crossfade", durationSeconds: 2 }), slate(4, { type: "fade", durationSeconds: 1 }), clip(40, 50, { type: "cut", durationSeconds: 0 })] as unknown as TimelineItem[];

  it("reports the effective transition and overlap of every slot", () => {
    const slots = layoutTimeline(items);
    expect(slots.map((s) => [s.outputStart, s.transition, s.overlap])).toEqual([[0, 0, 0], [8, 2, 2], [18, 1, 0], [22, 0, 0]]);
    expect(timelineDuration(items)).toBe(32);
  });

  it("caps a transition at half of the shorter side", () => {
    expect(transitionDuration({ type: "crossfade", durationSeconds: 9 }, 4)).toBe(2);
    expect(transitionDuration({ type: "cut", durationSeconds: 3 }, 4)).toBe(0);
  });

  it("is the offset the video render uses for xfade and fade", () => {
    const g = graphOf(buildCompositionRenderPlan(definition(items as unknown as object[]), new Map([["s", "/s.mp4"]]), "/o.mp4").args);
    const [, crossfade, fade] = layoutTimeline(items);
    expect(g).toContain(`xfade=transition=fade:duration=2:offset=${crossfade.outputStart}`);
    expect(g).toContain(`fade=t=out:st=${fade.outputStart - fade.transition}:d=1`);
  });

  it("gives the podcast the layout of the same items without standalone slates", () => {
    const plan = buildPodcastRenderPlan(definition(items as unknown as object[]), new Map([["s", "/s.mp4"]]), "/o.mp3", new Map(), { settings: { format: "mp3", channels: "mono", crossfadeSeconds: 0 } });
    expect(plan.durationSeconds).toBe(timelineDuration(items.filter((i) => i.type !== "slate")));
    expect(graphOf(plan.args)).toContain("acrossfade=d=2");
  });
});
