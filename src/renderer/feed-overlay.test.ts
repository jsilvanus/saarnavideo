import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCompositionRenderPlan } from "@/renderer/composition";
import { feedOverlayFilters, ffmpegKeyColor } from "@/renderer/ffmpeg";
import { createProjectDefinition, type FeedOverlayItem, type ProjectDefinition } from "@/domain/project";
import type { Reframe } from "@/domain/reframe";

const run = promisify(execFile);
const W = 320, H = 180;

describe("feed overlay filters", () => {
  const item: FeedOverlayItem = { type: "feed-overlay", sourceId: "d", sourceStartSeconds: 2, startSeconds: 5, endSeconds: 9, opacity: 1 };
  const fill: Reframe = { mode: "fill", fitBackground: "blur" };

  it("trims to the stretch, moves it onto the output timeline, keys the colour and covers the frame", () => {
    const [chain] = feedOverlayFilters(3, item, "fo0", { width: W, height: H }, fill, { color: "#00B140", similarity: 0.25, blend: 0.05 });
    expect(chain).toBe("[3:v]trim=start=2:duration=4,setpts=PTS-STARTPTS+5/TB,colorkey=0x00B140:0.25:0.05,format=rgba,scale=w=320:h=180:force_original_aspect_ratio=increase,crop=320:180,setsar=1,format=rgba[fo0]");
  });

  it("skips the key for a recording with alpha, and pads transparent when the picture is fitted", () => {
    const [chain] = feedOverlayFilters(1, { ...item, opacity: 0.5 }, "fo", { width: W, height: H }, { mode: "fit", fitBackground: "blur" }, { hasAlpha: true });
    expect(chain).not.toContain("colorkey");
    expect(chain).toContain("pad=320:180:(ow-iw)/2:(oh-ih)/2:color=black@0");
    expect(chain).toContain("colorchannelmixer=aa=0.5");
  });

  it("only lets safe characters into the key colour", () => {
    expect(ffmpegKeyColor("#00b140")).toBe("0x00b140");
    expect(ffmpegKeyColor("0xFF00FF")).toBe("0xFF00FF");
    expect(ffmpegKeyColor("green;rm -rf")).toBe("greenrmrf");
    expect(ffmpegKeyColor(undefined)).toBe("0x00B140");
  });

  it("fails the plan when the graphics recording has no file", () => {
    const definition = definitionWith([{ type: "source-clip", sourceId: "c", startSeconds: 0, endSeconds: 3 }, item]);
    expect(() => buildCompositionRenderPlan(definition, new Map([["c", "/tmp/c.mp4"]]), "/tmp/out.mp4")).toThrow(/Missing source path for sourceId: d/);
  });
});

function definitionWith(items: unknown[], extra: Record<string, unknown> = {}): ProjectDefinition {
  return createProjectDefinition({
    template: { key: "basic", width: W, height: H, fps: 25, backgroundColor: "black", textColor: "white" },
    semanticSegments: [], sections: [], graphics: [],
    composition: { sourceStartSeconds: 0, sourceEndSeconds: 3, items: items as never },
    ...extra,
  });
}

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

/** Real ffmpeg: a blue "clean" picture and a "graphics" recording (key green with a red box from t = 1 s); checks which pixels survive the key. */
describe.skipIf(!hasFfmpeg)("feed overlay render", () => {
  let dir: string;
  const clean = () => path.join(dir, "clean.mp4"), dsk = () => path.join(dir, "dsk.mp4");

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "feed-overlay-"));
    const encode = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "12", "-c:a", "aac", "-shortest"];
    await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=blue:s=${W}x${H}:r=25:d=4`, "-f", "lavfi", "-i", "sine=frequency=440:duration=4", ...encode, clean()]);
    await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=0x00B140:s=${W}x${H}:r=25:d=4`, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-vf", "drawbox=x=0:y=0:w=160:h=180:color=red:t=fill:enable='gte(t,1)'", ...encode, dsk()]);
  }, 60_000);
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  async function pixel(file: string, at: number, x: number, y: number): Promise<[number, number, number]> {
    const { stdout } = await run("ffmpeg", ["-v", "error", "-ss", String(at), "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { encoding: "buffer", maxBuffer: 10 * 1024 * 1024 });
    const offset = (y * W + x) * 3;
    return [stdout[offset], stdout[offset + 1], stdout[offset + 2]];
  }
  const isRed = ([r, g, b]: number[]) => r > 200 && g < 60 && b < 60;
  const isBlue = ([r, g, b]: number[]) => b > 200 && r < 60 && g < 60;

  async function render(items: unknown[], name: string, feedKeys = new Map([["d", { color: "#00B140", similarity: 0.3, blend: 0.1 }]])) {
    const output = path.join(dir, name);
    const plan = buildCompositionRenderPlan(definitionWith(items), new Map([["c", clean()], ["d", dsk()]]), output, undefined, { feedKeys });
    await run("ffmpeg", plan.args, { maxBuffer: 16 * 1024 * 1024 });
    return output;
  }

  it("shows the graphics where the recording has them and the clean picture everywhere else", async () => {
    const out = await render([{ type: "source-clip", sourceId: "c", startSeconds: 0, endSeconds: 3 }, { type: "feed-overlay", sourceId: "d", sourceStartSeconds: 0, startSeconds: 0, endSeconds: 3, opacity: 1 }], "plain.mp4");
    // Before the box appears the keyed recording is transparent: blue clean picture everywhere.
    expect(isBlue(await pixel(out, 0.5, 40, 90))).toBe(true);
    expect(isBlue(await pixel(out, 0.5, 280, 90))).toBe(true);
    // From 1 s the red box covers the left half only.
    expect(isRed(await pixel(out, 2, 40, 90))).toBe(true);
    expect(isBlue(await pixel(out, 2, 280, 90))).toBe(true);
  }, 60_000);

  it("places the stretch on the output timeline and reads the recording from its own start", async () => {
    // Recording time 1 s (the box appears) lands on output time 1.5 s; before that the overlay is already running but empty.
    const out = await render([{ type: "source-clip", sourceId: "c", startSeconds: 0, endSeconds: 3 }, { type: "feed-overlay", sourceId: "d", sourceStartSeconds: 0.5, startSeconds: 1, endSeconds: 3, opacity: 1 }], "shifted.mp4");
    expect(isBlue(await pixel(out, 1.2, 40, 90))).toBe(true);
    expect(isRed(await pixel(out, 2.2, 40, 90))).toBe(true);
    // Outside the stretch the graphics never show, even though the recording has them.
    const short = await render([{ type: "source-clip", sourceId: "c", startSeconds: 0, endSeconds: 3 }, { type: "feed-overlay", sourceId: "d", sourceStartSeconds: 1, startSeconds: 0, endSeconds: 1.5, opacity: 1 }], "short.mp4");
    expect(isRed(await pixel(short, 1.0, 40, 90))).toBe(true);
    expect(isBlue(await pixel(short, 2.2, 40, 90))).toBe(true);
  }, 60_000);

  it("keys the default green when no key settings were stored for the recording", async () => {
    const out = await render([{ type: "source-clip", sourceId: "c", startSeconds: 0, endSeconds: 3 }, { type: "feed-overlay", sourceId: "d", sourceStartSeconds: 0, startSeconds: 0, endSeconds: 3, opacity: 1 }], "default-key.mp4", new Map());
    expect(isBlue(await pixel(out, 0.5, 280, 90))).toBe(true);
  }, 60_000);
});
