import { describe, expect, it } from "vitest";
import type { ProjectDefinition, TimelineItem } from "@/domain/project";
import { buildCompositionRenderPlan } from "@/renderer/composition";
import { anchorSectionOverlays, overlayOutputRange } from "@/renderer/overlay-timing";

const sections = [
  { id: "gospel", label: "Evankeliumi", scope: "SOURCE", sourceId: "a", startSeconds: 10, endSeconds: 40, origin: "MANUAL" },
  { id: "sermon", label: "Saarna", scope: "SOURCE", sourceId: "b", startSeconds: 100, endSeconds: 160, origin: "MANUAL" },
];
const overlay = (sectionId: string | undefined, startSeconds: number, endSeconds: number) => ({ type: "overlay", template: "rich", kind: "text", sectionId, startSeconds, endSeconds, opacity: 1, data: { text: "Nimi" } });
const items = (...extra: object[]) => [
  { type: "slate", mode: "standalone", template: "title", durationSeconds: 5, data: { title: "Alku" } },
  { type: "source-clip", sourceId: "a", startSeconds: 10, endSeconds: 40 },
  { type: "source-clip", sourceId: "b", startSeconds: 100, endSeconds: 160, transitionIn: { type: "crossfade", durationSeconds: 1 } },
  ...extra,
] as unknown as TimelineItem[];
const definition = (list: TimelineItem[]) => ({ version: 1, semanticSegments: [], sections, graphics: [], template: { key: "t", width: 1920, height: 1080, fps: 30 }, composition: { sourceStartSeconds: 0, sourceEndSeconds: 200, items: list } }) as unknown as ProjectDefinition;
const range = (item: object, list: TimelineItem[]) => overlayOutputRange(item as never, list, { sections: sections as never });

describe("section overlays on the output timeline", () => {
  it("maps source seconds of the section to output seconds of its clip", () => {
    // Saarna starts at output 5 + 30 - 1 (crossfade) = 34; source 102..108 is 2..8 s into the clip.
    expect(range(overlay("sermon", 102, 108), items())).toEqual({ startSeconds: 36, endSeconds: 42 });
    expect(range(overlay("gospel", 10, 15), items())).toEqual({ startSeconds: 5, endSeconds: 10 });
  });

  it("follows the clip when sections are reordered", () => {
    const reordered = [items()[0], items()[2], items()[1]] as TimelineItem[];
    expect(range(overlay("sermon", 102, 108), reordered)).toEqual({ startSeconds: 6, endSeconds: 12 }); // its crossfade now pulls it to 4
  });

  it("cuts the overlay to its clip, drops it when the section or clip is gone, and leaves unanchored overlays alone", () => {
    expect(range(overlay("gospel", 35, 50), items())).toEqual({ startSeconds: 30, endSeconds: 35 });
    expect(range(overlay("missing", 1, 2), items())).toBeUndefined();
    expect(range(overlay("sermon", 102, 108), [items()[0], items()[1]] as TimelineItem[])).toBeUndefined();
    expect(range(overlay(undefined, 3, 4), items())).toEqual({ startSeconds: 3, endSeconds: 4 });
  });

  it("uses semantic segments when the definition has no sections", () => {
    expect(overlayOutputRange(overlay("gospel", 12, 14) as never, items(), { semanticSegments: [{ id: "gospel", sourceId: "a", startSeconds: 10, endSeconds: 40 }] })).toEqual({ startSeconds: 7, endSeconds: 9 });
  });

  it("renders the overlay at its output time", () => {
    const anchored = anchorSectionOverlays(definition(items(overlay("sermon", 102, 108), overlay("missing", 1, 2))));
    expect(anchored.composition.items.filter((item) => item.type === "overlay")).toMatchObject([{ startSeconds: 36, endSeconds: 42 }]);
    const plan = buildCompositionRenderPlan(definition(items(overlay("sermon", 102, 108))), new Map([["a", "/tmp/a.mp4"], ["b", "/tmp/b.mp4"]]), "/tmp/out.mp4");
    expect(plan.args[plan.args.indexOf("-filter_complex") + 1]).toContain("between(t,36,42)");
  });
});
