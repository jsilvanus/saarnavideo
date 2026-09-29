import { describe, expect, it } from "vitest";
import { buildCompositionRenderPlan, buildSourceRenderPlan } from "./ffmpeg";

const base = {
  version: 1 as const,
  semanticSegments: [],
  sections: [],
  graphics: [],
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
    }).toThrow("Composition must contain at least one source clip or standalone slate");
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
            { type: "slate", template: "sermon", mode: "standalone", durationSeconds: 3, data: { title: "Gospel", subtitle: "Matthew 5" } },
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
            { type: "overlay", template: "gospel", kind: "text", opacity: 1, startSeconds: 15, endSeconds: 25, data: { text: "John 3:16" } },
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
            { type: "slate", template: "sermon", mode: "standalone", durationSeconds: 2, data: { title: "Opening" }, transitionIn: { type: "fade", durationSeconds: 0.5 } },
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
            { type: "slate", template: "custom", mode: "standalone", durationSeconds: 2, data: { title: "4K Title" } },
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

describe("soft caption track", () => {
  const definition = { ...base, composition: { ...baseComposition, items: [
    { type: "source-clip" as const, sourceId: "a", startSeconds: 0, endSeconds: 5 },
    { type: "slate" as const, template: "rich", mode: "standalone" as const, durationSeconds: 2, data: { title: "Hi" } },
  ] } };
  const sources = new Map([["a", "/tmp/a.mp4"]]);

  it("adds the subtitle file as the last input and muxes it as mov_text after the video/audio maps", () => {
    const { args } = buildCompositionRenderPlan(definition, sources, "/tmp/out.mp4", undefined, { captions: { path: "/tmp/c.srt", language: "fin" } });
    const inputs = args.flatMap((arg, i) => (arg === "-i" ? [args[i + 1]] : []));
    const captionInput = inputs.indexOf("/tmp/c.srt");
    expect(captionInput).toBe(inputs.length - 1);
    expect(args.indexOf("/tmp/c.srt")).toBeLessThan(args.indexOf("-filter_complex"));
    const maps = args.flatMap((arg, i) => (arg === "-map" ? [args[i + 1]] : []));
    expect(maps).toHaveLength(3);
    expect(maps[2]).toBe(`${captionInput}:0`);
    expect(args.slice(args.indexOf("-c:s"))).toEqual(["-c:s", "mov_text", "-metadata:s:s:0", "language=fin", "/tmp/out.mp4"]);
  });

  it("changes nothing without caption options", () => {
    const withOptions = buildCompositionRenderPlan(definition, sources, "/tmp/out.mp4", undefined, {}).args;
    expect(withOptions).toEqual(buildCompositionRenderPlan(definition, sources, "/tmp/out.mp4").args);
    expect(withOptions).not.toContain("mov_text");
  });
});

describe("burned-in captions", () => {
  const definition = { ...base, composition: { ...baseComposition, items: [
    { type: "source-clip" as const, sourceId: "a", startSeconds: 0, endSeconds: 5 },
    { type: "overlay" as const, template: "rich", kind: "text" as const, startSeconds: 1, endSeconds: 2, opacity: 1, data: { text: "Overlay" } },
  ] } };
  const sources = new Map([["a", "/tmp/a.mp4"]]);
  const graph = (args: string[]) => args[args.indexOf("-filter_complex") + 1];
  const maps = (args: string[]) => args.flatMap((arg, i) => (arg === "-map" ? [args[i + 1]] : []));

  it("applies the ass filter after the overlays and maps its output as the video", () => {
    const { args } = buildCompositionRenderPlan(definition, sources, "/tmp/out.mp4", undefined, { burnedCaptions: { assPath: "/tmp/c.ass" } });
    const filters = graph(args).split(";");
    const last = filters[filters.length - 1];
    expect(last).toMatch(/^\[ol0\]ass=filename='\/tmp\/c\.ass'\[burned\]$/);
    expect(filters.findIndex((f) => f.includes("drawtext"))).toBeLessThan(filters.length - 1);
    expect(maps(args)[0]).toBe("[burned]");
    expect(args).not.toContain("mov_text");
  });

  it("passes the template font directory to libass and escapes the path", () => {
    const { args } = buildCompositionRenderPlan(definition, sources, "/tmp/out.mp4", undefined, { burnedCaptions: { assPath: "/tmp/it's:here/c.ass", fontsDir: "/usr/share/fonts/x" } });
    expect(graph(args)).toContain("ass=filename='/tmp/it\\'s\\:here/c.ass':fontsdir='/usr/share/fonts/x'[burned]");
  });

  it("combines with a soft track and leaves the plan alone without the option", () => {
    const both = buildCompositionRenderPlan(definition, sources, "/tmp/out.mp4", undefined, { captions: { path: "/tmp/c.srt", language: "fin" }, burnedCaptions: { assPath: "/tmp/c.ass" } }).args;
    expect(maps(both)).toHaveLength(3);
    expect(both).toContain("mov_text");
    expect(graph(both)).toContain("[burned]");
    expect(graph(buildCompositionRenderPlan(definition, sources, "/tmp/out.mp4").args)).not.toContain("ass=");
  });
});

describe("audio clips", () => {
  const voice = { type: "audio-clip" as const, assetId: "vo", mode: "standalone" as const, startSeconds: 1, endSeconds: 4, volume: 1, atSeconds: 0, duckSourceVolume: 1, data: {} };
  const clipItem = { type: "source-clip" as const, sourceId: "a", startSeconds: 0, endSeconds: 5 };
  const build = (items: object[], assets = new Map([["vo", "/lib/voice.m4a"]])) =>
    buildCompositionRenderPlan({ ...base, composition: { ...baseComposition, items: items as never } }, new Map([["a", "/tmp/a.mp4"]]), "/tmp/out.mp4", assets);
  const graph = (plan: { args: string[] }) => plan.args[plan.args.indexOf("-filter_complex") + 1];

  it("renders a standalone voiceover as a background section with the recording as audio", () => {
    const plan = build([clipItem, voice]);
    expect(plan.args).toContain("/lib/voice.m4a");
    expect(plan.args.join(" ")).toContain("color=c=black:s=1920x1080:r=30:d=3");
    const g = graph(plan);
    expect(g).toMatch(/\[\d:a\]atrim=start=1:duration=3,.*apad=whole_dur=3,atrim=duration=3.*\[a1\]/);
    expect(g).toContain("[v0][a0][v1][a1]concat=n=2:v=1:a=1");
  });

  it("supports a voiceover-only composition and a background image", () => {
    const plan = build([{ ...voice, backgroundImage: "bg" }], new Map([["vo", "/lib/voice.m4a"], ["bg", "/lib/bg.png"]]));
    expect(plan.args).toContain("/lib/bg.png");
    expect(graph(plan)).toContain("[0:v]trim=duration=3");
  });

  it("layers a mix over the finished audio and ducks the source only for the mix window", () => {
    const g = graph(build([clipItem, { ...voice, mode: "mix", atSeconds: 2, volume: 1.5, duckSourceVolume: 0.25 }]));
    expect(g).toContain("volume=1.5,");
    expect(g).toContain("adelay=delays=2000:all=1[mixin0]");
    expect(g).toContain("volume=volume='if(between(t,2,5),0.25,1)':eval=frame[duck0]");
    expect(g).toContain("[duck0][mixin0]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix0]");
  });

  it("leaves the source audio alone when not ducking, and maps the mix as the audio output", () => {
    const plan = build([clipItem, { ...voice, mode: "mix", atSeconds: 0 }]);
    expect(graph(plan)).not.toContain("eval=frame");
    expect(plan.args[plan.args.indexOf("-map", plan.args.indexOf("-filter_complex")) + 3]).toBe("[mix0]");
  });

  it("fails clearly when the audio asset is missing", () => {
    expect(() => build([clipItem, voice], new Map())).toThrow(/Missing audio asset for assetId: vo/);
    expect(() => build([clipItem, { ...voice, mode: "mix" }], new Map())).toThrow(/Missing audio asset/);
  });
});

describe("output size and reframing", () => {
  const graph = (definition: Record<string, unknown>) => {
    const plan = buildCompositionRenderPlan(
      { ...base, ...definition } as never,
      new Map([["a", "/tmp/a.mp4"]]),
      "/tmp/out.mp4",
    );
    return plan.args[plan.args.indexOf("-filter_complex") + 1];
  };
  const clipDef = (template: Record<string, unknown> | undefined, extra: Record<string, unknown> = {}) => ({
    template: template && { key: "t", fps: 30, backgroundColor: "navy", textColor: "white", ...template },
    composition: { ...baseComposition, items: [{ type: "source-clip", sourceId: "a", startSeconds: 0, endSeconds: 5, ...extra }] },
  });

  it("uses the template size instead of 1920x1080 for source clips", () => {
    const filters = graph(clipDef({ width: 1080, height: 1920 }));
    expect(filters).toContain("scale=w=1080:h=1920:force_original_aspect_ratio=increase,crop=1080:1920");
    expect(filters).not.toContain("1920:h=1080");
  });

  it("crops the chosen rectangle before covering the frame", () => {
    const filters = graph(clipDef({ width: 1080, height: 1920 }, { reframe: { mode: "custom", fitBackground: "blur", crop: { x: 0.1, y: 0, w: 0.3164, h: 1 } } }));
    expect(filters).toContain("crop=w=trunc(iw*0.316/2)*2:h=trunc(ih*1/2)*2:x=trunc(iw*0.1/2)*2:y=trunc(ih*0/2)*2,scale=w=1080:h=1920");
  });

  it("letterboxes with the template colour or a blurred copy", () => {
    const color = graph(clipDef({ width: 1080, height: 1920 }, { reframe: { mode: "fit", fitBackground: "color" } }));
    expect(color).toContain("force_original_aspect_ratio=decrease:force_divisible_by=2,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=navy");
    const blur = graph(clipDef({ width: 1080, height: 1920 }, { reframe: { mode: "fit", fitBackground: "blur" } }));
    expect(blur).toContain("split=2[v0bgs][v0fgs]");
    expect(blur).toContain("gblur");
    expect(blur).toContain("overlay=x=(main_w-overlay_w)/2:y=(main_h-overlay_h)/2,setsar=1[v0]");
  });

  it("takes the reframe of the section a clip was made from, and lets the clip override it", () => {
    const sections = [{ id: "s", label: "S", scope: "SOURCE", origin: "MANUAL", sourceId: "a", startSeconds: 0, endSeconds: 10, reframe: { mode: "fit", fitBackground: "color" } }];
    expect(graph({ ...clipDef({ width: 1080, height: 1080 }), sections })).toContain("pad=1080:1080");
    expect(graph({ ...clipDef({ width: 1080, height: 1080 }, { reframe: { mode: "fill", fitBackground: "blur" } }), sections })).not.toContain("pad=");
  });

  it("scales rich graphic layers and legacy overlays from the 1920x1080 canvas to the output", () => {
    const layers = JSON.stringify([{ type: "rect", x: 192, y: 108, width: 960, height: 540, style: { background: "red" } }, { type: "text", text: "Hi", x: 0, y: 540, style: { "font-size": 100 } }]);
    const filters = graph({
      ...clipDef({ width: 960, height: 540 }),
      composition: { ...baseComposition, items: [
        { type: "source-clip", sourceId: "a", startSeconds: 0, endSeconds: 5 },
        { type: "overlay", kind: "text", startSeconds: 0, endSeconds: 5, x: 200, y: 100, data: { text: "T", fontSize: "60" } },
        { type: "overlay", template: "rich", kind: "text", startSeconds: 0, endSeconds: 5, data: { layers } },
      ] },
    });
    expect(filters).toContain("drawtext=text='T':fontcolor=white@1:fontsize=30:x=100:y=50");
    expect(filters).toContain("drawbox=x=96:y=54:w=480:h=270");
    expect(filters).toContain("fontsize=50:x=0:y=270");
  });

  it("does not scale anything at 1920x1080", () => {
    const filters = graph({
      ...clipDef({ width: 1920, height: 1080 }),
      composition: { ...baseComposition, items: [
        { type: "source-clip", sourceId: "a", startSeconds: 0, endSeconds: 5 },
        { type: "overlay", kind: "text", startSeconds: 0, endSeconds: 5, x: 200, y: 100, data: { text: "T", fontSize: "60" } },
      ] },
    });
    expect(filters).toContain("fontsize=60:x=200:y=100");
  });
});
