import { execFileSync, spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFleet, type S3Client } from "fffleet";
import { parseLoudnormMeasurement } from "@/renderer/podcast";
import { createRemoteExecutor, deriveRequires, readRemoteConfig, translateFfmpegArgs } from "@/worker/remote-ffmpeg";

const ROOT = "/data/media";

describe("translateFfmpegArgs", () => {
  it("replaces inputs, the output and the font directory, also inside filter graphs", () => {
    const t = translateFfmpegArgs({
      args: ["-hide_banner", "-y", "-i", `${ROOT}/sources/p/a.mp4`, "-i", `${ROOT}/assets/library/x.png`, "-filter_complex", `[0:v]ass=filename='${ROOT}/o.ass':fontsdir='${ROOT}/fonts'[v]`, "-map", "[v]", `${ROOT}/o.mp4`],
      files: [`${ROOT}/sources/p/a.mp4`, `${ROOT}/assets/library/x.png`, `${ROOT}/assets/library/unused.png`, `${ROOT}/o.ass`],
      fonts: { file: `${ROOT}/fonts/Brand.ttf`, dir: `${ROOT}/fonts` },
      outputPath: `${ROOT}/o.mp4`,
      mediaRoot: ROOT,
    });
    expect(t.args).toEqual(["-i", "{{input:in0}}", "-i", "{{input:in1}}", "-filter_complex", "[0:v]ass=filename='{{input:in2}}':fontsdir='{{inputdir:font}}'[v]", "-map", "[v]", "{{output:out}}"]);
    expect(t.inputs.map(i => i.path)).toEqual([`${ROOT}/sources/p/a.mp4`, `${ROOT}/assets/library/x.png`, `${ROOT}/o.ass`, `${ROOT}/fonts/Brand.ttf`]);
    expect(t.inputs.at(-1)?.name).toBe("font");
    expect(t.output).toBe(true);
  });

  it("does not half-replace a path that another file's path starts with", () => {
    const t = translateFfmpegArgs({ args: ["-i", `${ROOT}/a.mp4`, "-i", `${ROOT}/a.mp4.srt`], files: [`${ROOT}/a.mp4`, `${ROOT}/a.mp4.srt`], mediaRoot: ROOT });
    expect(t.args).toEqual(["-i", "{{input:in0}}", "-i", "{{input:in1}}"]);
  });

  it("refuses a plan that still mentions an unstaged local file", () => {
    expect(() => translateFfmpegArgs({ args: ["-i", `${ROOT}/missing.mp4`, "o.mp4"], files: [], mediaRoot: ROOT })).toThrow(/not staged/);
  });

  it("has no output when the plan writes none, and asks for info logging when loudnorm prints JSON", () => {
    const t = translateFfmpegArgs({ args: ["-hide_banner", "-y", "-i", `${ROOT}/a.wav`, "-af", "loudnorm=I=-16:print_format=json", "-f", "null", "-"], files: [`${ROOT}/a.wav`], outputPath: `${ROOT}/o.mp3`, mediaRoot: ROOT });
    expect(t.output).toBe(false);
    expect(t.args.slice(0, 2)).toEqual(["-loglevel", "info"]);
  });
});

describe("deriveRequires", () => {
  it("lists the filters and encoders the arguments use", () => {
    expect(deriveRequires(["-filter_complex", "[0:v]drawtext=text='x'[a];[a]ass=filename=a.ass[v]", "-c:a", "libmp3lame", "-af", "loudnorm=I=-16"])).toEqual(["encoder:libmp3lame", "filter:ass", "filter:drawtext", "filter:loudnorm"]);
    expect(deriveRequires(["-i", "a.mp4", "o.mp4"])).toEqual([]);
  });
});

describe("readRemoteConfig", () => {
  it("is off by default and checks its settings when on", () => {
    expect(readRemoteConfig({})).toBeNull();
    expect(() => readRemoteConfig({ RENDER_EXECUTOR: "fffleet" })).toThrow(/FFFLEET_S3_BUCKET/);
    const c = readRemoteConfig({ RENDER_EXECUTOR: "fffleet", FFFLEET_S3_BUCKET: "b", AWS_ACCESS_KEY_ID: "k", AWS_SECRET_ACCESS_KEY: "s", FFFLEET_URL: "http://o:5000", FFFLEET_S3_PREFIX: "/pre/" });
    expect(c).toMatchObject({ bucket: "b", prefix: "pre", url: "http://o:5000" });
  });
});

/** A bucket on the local disk with the parts of the S3 client the fleet and this module use. */
function diskS3(dir: string): S3Client & { puts: string[] } {
  const file = (bucket: string, key: string) => path.join(dir, bucket, key);
  const puts: string[] = [];
  return {
    puts,
    async getFile(bucket, key, to) { await mkdir(path.dirname(to), { recursive: true }); await copyFile(file(bucket, key), to); },
    async head(bucket, key) { const s = await stat(file(bucket, key)); return { size: s.size, etag: `"${s.size}-${s.mtimeMs}"` }; },
    async putFile(bucket, key, from) { puts.push(key); await mkdir(path.dirname(file(bucket, key)), { recursive: true }); await copyFile(from, file(bucket, key)); return (await stat(from)).size; },
    async putDirectory() { return 0; },
    async deleteObject(bucket, key) { await rm(file(bucket, key), { force: true }); },
    async createBucket() {},
  };
}

// The plain unit job has no ffmpeg; the e2e job (and local runs) do.
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

describe.skipIf(!hasFfmpeg)("createRemoteExecutor (real ffmpeg, an in-process fleet and a disk bucket)", () => {
  let dir: string; let media: string; let s3: ReturnType<typeof diskS3>; let fleet: ReturnType<typeof createFleet>;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "sv-remote-"));
    media = path.join(dir, "media");
    await mkdir(media, { recursive: true });
    s3 = diskS3(path.join(dir, "bucket"));
    fleet = createFleet({ fallback: "local", local: { s3, workRoot: path.join(dir, "work"), slots: { default: 2 } } });
  });
  afterAll(async () => { await fleet.close(); await rm(dir, { recursive: true, force: true }); });

  it("stages the source once, renders on the fleet and copies the output back", async () => {
    const source = path.join(media, "src.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=red:s=64x48:d=1:r=10", "-pix_fmt", "yuv420p", source]);
    const remote = createRemoteExecutor({ fleet, s3, bucket: "b", prefix: "sv" });
    const progress: number[] = [];
    const run = (name: string) => remote.run({ jobId: name, args: ["-hide_banner", "-y", "-i", source, "-vf", "scale=32:24", "-pix_fmt", "yuv420p", path.join(media, `${name}.mp4`)], totalMs: 1000, files: [source], outputPath: path.join(media, `${name}.mp4`), mediaRoot: media, onProgress: p => progress.push(p.currentMs) });
    await run("one");
    await run("two");
    expect((await stat(path.join(media, "one.mp4"))).size).toBeGreaterThan(0);
    expect((await stat(path.join(media, "two.mp4"))).size).toBeGreaterThan(0);
    expect(s3.puts.filter(k => k.endsWith("src.mp4"))).toHaveLength(1);
    expect(await readdir(path.join(dir, "bucket", "b", "sv", "out"), { recursive: true }).then(l => l.filter(f => f.endsWith(".mp4")))).toEqual([]);
  });

  it("returns ffmpeg's stderr so the loudnorm measurement can be read", async () => {
    const wav = path.join(media, "tone.wav");
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", wav]);
    const remote = createRemoteExecutor({ fleet, s3, bucket: "b", prefix: "sv" });
    const { stderr } = await remote.run({ jobId: "measure", args: ["-hide_banner", "-y", "-i", wav, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"], totalMs: 1000, files: [wav], mediaRoot: media });
    expect(parseLoudnormMeasurement(stderr)).not.toBeNull();
  });

  it("fails with ffmpeg's message when the command fails", async () => {
    const remote = createRemoteExecutor({ fleet, s3, bucket: "b", prefix: "sv" });
    const bad = path.join(media, "bad.txt");
    await writeFile(bad, "not media");
    await expect(remote.run({ jobId: "bad", args: ["-i", bad, path.join(media, "bad.mp4")], totalMs: 1000, files: [bad], outputPath: path.join(media, "bad.mp4"), mediaRoot: media })).rejects.toThrow(/FFmpeg failed on the fleet/);
  });
});
