import { describe, expect, it } from "vitest";
import type { ProjectDefinition } from "@/domain/project";
import { buildPodcastRenderPlan, parseLoudnormMeasurement, podcastBodyRange, podcastMimeType, resolvePodcastMetadata } from "@/renderer/podcast";

const definition = (items: object[]) => ({ version: 1, semanticSegments: [], sections: [], graphics: [], composition: { sourceStartSeconds: 0, sourceEndSeconds: 100, items } }) as unknown as ProjectDefinition;
const clip = (startSeconds: number, endSeconds: number, extra = {}) => ({ type: "source-clip", sourceId: "s", startSeconds, endSeconds, ...extra });
const slate = (durationSeconds: number) => ({ type: "slate", template: "rich", mode: "standalone", durationSeconds, data: {} });
const voice = (extra = {}) => ({ type: "audio-clip", assetId: "vo", mode: "standalone", startSeconds: 0, endSeconds: 3, ...extra });
const sources = new Map([["s", "/src.mp4"]]);
const assets = new Map([["vo", "/vo.m4a"]]);
const settings = { format: "mp3" as const, channels: "mono" as const, crossfadeSeconds: 0.5 };
const graphOf = (args: string[]) => args[args.indexOf("-filter_complex") + 1];

describe("buildPodcastRenderPlan", () => {
  it("keeps only the chosen start..end of the body, before intro and outro are added", () => {
    const plan = buildPodcastRenderPlan(definition([slate(5), clip(0, 10), voice()]), sources, "/out.mp3", assets, { settings: { ...settings, startSeconds: 2, endSeconds: 11 }, outro: { path: "/outro.wav", durationSeconds: 3 } });
    const g = graphOf(plan.args);
    expect(g).toContain("[pc2]atrim=start=2:end=11,asetpts=PTS-STARTPTS[body]");
    expect(g).toContain("[body][outro]acrossfade=d=0.5");
    expect(plan.durationSeconds).toBe(9 + 3 - 0.5);
  });

  it("clamps the range to the body and refuses an empty one", () => {
    expect(podcastBodyRange({ startSeconds: 2, endSeconds: 99 }, 10)).toEqual({ start: 2, end: 10 });
    expect(podcastBodyRange({}, 10)).toEqual({ start: 0, end: 10 });
    expect(() => podcastBodyRange({ startSeconds: 12, endSeconds: 20 }, 10)).toThrow("outside");
    const whole = buildPodcastRenderPlan(definition([clip(0, 10)]), sources, "/out.mp3", assets, { settings: { ...settings, startSeconds: 0, endSeconds: 10 } });
    expect(graphOf(whole.args)).not.toContain("atrim=start=0:end=10");
  });

  it("concatenates source clips and voiceovers, skips standalone slates and has no video", () => {
    const plan = buildPodcastRenderPlan(definition([slate(5), clip(0, 4), voice()]), sources, "/out.mp3", assets, { settings });
    const g = graphOf(plan.args);
    expect(plan.durationSeconds).toBe(7);
    expect(g).toContain("[p1][p2]concat=n=2:v=0:a=1[pc2]");
    expect(g).not.toContain("p0");
    expect(g).not.toContain("[0:v]");
    expect(plan.args).not.toContain("-c:v");
    expect(plan.args.filter((arg) => arg === "-i")).toHaveLength(2);
  });

  it("adds intro and outro with a crossfade and shortens the total by each overlap", () => {
    const plan = buildPodcastRenderPlan(definition([clip(0, 10)]), sources, "/out.mp3", assets, { settings, intro: { path: "/intro.mp3", durationSeconds: 4 }, outro: { path: "/outro.wav", durationSeconds: 3 } });
    const g = graphOf(plan.args);
    expect(g).toContain("[intro][pc0]".replace("pc0", "p0") + "acrossfade=d=0.5");
    expect(g).toContain("[withintro][outro]acrossfade=d=0.5");
    expect(plan.durationSeconds).toBe(4 + 10 + 3 - 1);
    expect(plan.args.indexOf("/intro.mp3")).toBeLessThan(plan.args.indexOf("/outro.wav"));
  });

  it("uses plain concat when the crossfade is 0 and caps it at half the shorter part", () => {
    const zero = buildPodcastRenderPlan(definition([clip(0, 10)]), sources, "/out.mp3", assets, { settings: { ...settings, crossfadeSeconds: 0 }, intro: { path: "/i.mp3", durationSeconds: 4 } });
    expect(graphOf(zero.args)).toContain("[intro][p0]concat=n=2:v=0:a=1[withintro]");
    expect(zero.durationSeconds).toBe(14);
    const short = buildPodcastRenderPlan(definition([clip(0, 10)]), sources, "/out.mp3", assets, { settings: { ...settings, crossfadeSeconds: 5 }, intro: { path: "/i.mp3", durationSeconds: 2 } });
    expect(graphOf(short.args)).toContain("acrossfade=d=1");
  });

  it("moves a mixed voiceover earlier by the skipped slate time before it", () => {
    const plan = buildPodcastRenderPlan(definition([slate(2), clip(0, 4), voice({ mode: "mix", atSeconds: 3, endSeconds: 1, duckSourceVolume: 0.3 })]), sources, "/out.mp3", assets, { settings });
    const g = graphOf(plan.args);
    expect(g).toContain("adelay=delays=1000:all=1");
    expect(g).toContain("if(between(t,1,2),0.3,1)");
    expect(plan.durationSeconds).toBe(4);
  });

  it("puts a mix that starts inside a skipped slate at the start of the next audio", () => {
    const plan = buildPodcastRenderPlan(definition([slate(2), clip(0, 4), voice({ mode: "mix", atSeconds: 1, endSeconds: 1 })]), sources, "/out.mp3", assets, { settings });
    expect(graphOf(plan.args)).toContain("adelay=delays=0:all=1");
  });

  it("normalises loudness in the requested pass and channel layout", () => {
    const single = graphOf(buildPodcastRenderPlan(definition([clip(0, 4)]), sources, "/out.mp3", assets, { settings }).args);
    expect(single).toContain("aformat=channel_layouts=mono,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100[podcast]");
    const stereo = graphOf(buildPodcastRenderPlan(definition([clip(0, 4)]), sources, "/out.mp3", assets, { settings: { ...settings, channels: "stereo" } }).args);
    expect(stereo).toContain("channel_layouts=stereo");
    const measure = buildPodcastRenderPlan(definition([clip(0, 4)]), sources, "/out.mp3", assets, { settings, coverPath: "/cover.jpg", metadata: { title: "T" }, loudness: "measure" });
    expect(graphOf(measure.args)).toContain("print_format=json");
    expect(measure.args.slice(-3)).toEqual(["-f", "null", "-"]);
    expect(measure.args).not.toContain("/cover.jpg");
    const applied = graphOf(buildPodcastRenderPlan(definition([clip(0, 4)]), sources, "/out.mp3", assets, { settings, loudness: { input_i: "-23.5", input_tp: "-5.1", input_lra: "1.2", input_thresh: "-34", target_offset: "0.3" } }).args);
    expect(applied).toContain("measured_I=-23.5:measured_TP=-5.1:measured_LRA=1.2:measured_thresh=-34:offset=0.3:linear=true");
  });

  it("encodes MP3 with ID3v2.3 tags and an attached cover, or AAC for m4a", () => {
    const mp3 = buildPodcastRenderPlan(definition([clip(0, 4)]), sources, "/out.mp3", assets, { settings, coverPath: "/cover.jpg", metadata: { title: "Saarna", artist: "Pekka" } }).args;
    expect(mp3).toEqual(expect.arrayContaining(["-c:a", "libmp3lame", "-id3v2_version", "3", "-disposition:v:0", "attached_pic", "title=Saarna", "artist=Pekka", "-map_metadata", "-1"]));
    expect(mp3.at(-1)).toBe("/out.mp3");
    const coverMap = mp3.indexOf("-map", mp3.indexOf("-map") + 1);
    expect(mp3[coverMap + 1]).toBe("1:v");
    const m4a = buildPodcastRenderPlan(definition([clip(0, 4)]), sources, "/out.m4a", assets, { settings: { ...settings, format: "m4a" } }).args;
    expect(m4a).toEqual(expect.arrayContaining(["-c:a", "aac", "+faststart"]));
    expect(m4a).not.toContain("-disposition:v:0");
  });

  it("rejects compositions without audio and missing inputs", () => {
    expect(() => buildPodcastRenderPlan(definition([slate(3)]), sources, "/o.mp3", assets, { settings })).toThrow(/at least one source clip or standalone voiceover/);
    expect(() => buildPodcastRenderPlan(definition([voice()]), sources, "/o.mp3", new Map(), { settings })).toThrow(/Missing audio asset/);
    expect(() => buildPodcastRenderPlan(definition([clip(0, 1)]), new Map(), "/o.mp3", assets, { settings })).toThrow(/Missing source path/);
  });
});

describe("podcast helpers", () => {
  it("fills tags from the project and lets settings win", () => {
    const now = new Date("2026-09-27T10:00:00Z");
    expect(resolvePodcastMetadata({ title: "Sunday", preacher: "Pekka", gospelRef: "Joh 3:16" }, {}, now)).toEqual({ title: "Sunday", artist: "Pekka", date: "2026-09-27", comment: "Joh 3:16", genre: "Podcast" });
    expect(resolvePodcastMetadata({ title: "Sunday", preacher: null }, { title: " Own ", album: "Saarnat", comment: "x", date: "2026-01-01" }, now)).toEqual({ title: "Own", album: "Saarnat", date: "2026-01-01", comment: "x", genre: "Podcast" });
  });

  it("parses the loudnorm JSON block from ffmpeg stderr", () => {
    const stderr = `size=N/A time=00:00:09.99\n[Parsed_loudnorm_5 @ 0x1] \n{\n\t"input_i" : "-21.83",\n\t"input_tp" : "-15.07",\n\t"input_lra" : "0.00",\n\t"input_thresh" : "-31.83",\n\t"output_i" : "-16.55",\n\t"target_offset" : "0.55"\n}\n`;
    expect(parseLoudnormMeasurement(stderr)).toEqual({ input_i: "-21.83", input_tp: "-15.07", input_lra: "0.00", input_thresh: "-31.83", target_offset: "0.55" });
    expect(parseLoudnormMeasurement("nothing here")).toBeNull();
    expect(parseLoudnormMeasurement('{"input_i":"-inf","input_tp":"-inf","input_lra":"0","input_thresh":"-70","target_offset":"0"}')).toBeNull();
  });

  it("maps formats to MIME types", () => {
    expect(podcastMimeType("mp3")).toBe("audio/mpeg");
    expect(podcastMimeType("m4a")).toBe("audio/mp4");
  });
});
