import { execFile, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { parseVtt } from "../src/lib/captions";
import { api, averageColor, baseUrl, createProject, download, frameRgb, fixturesDir, isBlack, isGreen, mediaRoot, probe, setComposition, uploadSource, waitForJob } from "./helpers";

const execFileAsync = promisify(execFile);

// Distinct tones so the order of the podcast segments can be read back from the decoded audio.
const INTRO_HZ = 1000;
const SERMON_HZ = 440; // green.mp4
const VOICE_HZ = 880;
const OUTRO_HZ = 1600;

const audioDir = path.join(fixturesDir, "audio");

function tone(fileName: string, frequency: number, seconds: number, extra: string[] = []) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=44100:duration=${seconds}`, ...extra, path.join(audioDir, fileName)]);
}

beforeAll(async () => {
  await mkdir(audioDir, { recursive: true });
  tone("intro.mp3", INTRO_HZ, 2, ["-c:a", "libmp3lame", "-b:a", "128k"]);
  tone("voice.m4a", VOICE_HZ, 3, ["-c:a", "aac"]);
  tone("outro.wav", OUTRO_HZ, 2);
  tone("voice.webm", VOICE_HZ, 3, ["-c:a", "libopus"]);
});

async function uploadAudio(projectId: string | null, fileName: string, mimeType: string, assetKey: string) {
  const form = new FormData();
  form.set("file", new Blob([await readFile(path.join(audioDir, fileName))], { type: mimeType }), fileName);
  form.set("assetKey", assetKey);
  form.set("type", "AUDIO");
  return api<{ id: string; type: string; mimeType: string; durationMs: number | null }>(projectId ? `/api/projects/${projectId}/assets` : "/api/assets", { method: "POST", body: form });
}

async function generate(projectId: string, body: Record<string, unknown>) {
  const job = await api<{ id: string; type: string }>(`/api/projects/${projectId}/generate`, { method: "POST", json: body });
  const done = await waitForJob(projectId, job.id);
  if (done.status !== "COMPLETED") throw new Error(`Render ${done.status}: ${done.error}`);
  const project = await api<{ outputs: Array<{ id: string; jobId: string; type: string; mimeType: string }> }>(`/api/projects/${projectId}`);
  return { jobId: job.id, outputs: project.outputs.filter((output) => output.jobId === job.id) };
}

/** Mono 16 kHz samples of a file. */
async function pcm(filePath: string): Promise<Float32Array> {
  const { stdout } = await execFileAsync("ffmpeg", ["-v", "error", "-i", filePath, "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
  const samples = new Float32Array(stdout.length / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = stdout.readInt16LE(i * 2) / 32768;
  return samples;
}

/** Goertzel magnitude of one frequency inside [from, to) seconds (amplitude of that sine component). */
function magnitude(samples: Float32Array, from: number, to: number, frequency: number, rate = 16000): number {
  const start = Math.round(from * rate), end = Math.min(samples.length, Math.round(to * rate));
  const omega = (2 * Math.PI * frequency) / rate, coeff = 2 * Math.cos(omega);
  let s1 = 0, s2 = 0;
  for (let i = start; i < end; i++) { const s0 = samples[i] + coeff * s1 - s2; s2 = s1; s1 = s0; }
  return (2 * Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2)) / (end - start);
}

/** The candidate tone with the most energy in the window. */
function dominant(samples: Float32Array, from: number, to: number, candidates = [INTRO_HZ, SERMON_HZ, VOICE_HZ, OUTRO_HZ]) {
  return candidates.map((hz) => ({ hz, m: magnitude(samples, from, to, hz) })).sort((a, b) => b.m - a.m)[0].hz;
}

async function integratedLoudness(filePath: string): Promise<number> {
  const { stderr } = await execFileAsync("ffmpeg", ["-hide_banner", "-nostats", "-i", filePath, "-af", "ebur128=framelog=quiet", "-f", "null", "-"]);
  const match = /Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+) LUFS/.exec(stderr);
  if (!match) throw new Error(`No ebur128 summary in: ${stderr.slice(-400)}`);
  return Number(match[1]);
}

async function ffprobeJson(filePath: string) {
  const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration:format_tags:stream=codec_type,codec_name,sample_rate,channels:stream_disposition=attached_pic", "-of", "json", filePath]);
  return JSON.parse(stdout) as { format: { duration: string; tags?: Record<string, string> }; streams: Array<{ codec_type: string; codec_name: string; sample_rate?: string; channels?: number; disposition?: { attached_pic: number } }> };
}

async function waitForThumbnail(projectId: string) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const project = await api<{ outputs: Array<{ id: string; type: string }> }>(`/api/projects/${projectId}`);
    if (project.outputs.some((output) => output.type === "THUMBNAIL")) return;
    if (Date.now() > deadline) throw new Error("No THUMBNAIL output appeared");
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

describe("audio assets", () => {
  it("stores mp3/m4a/wav/webm with a probed duration, dedupes and serves ranges", async () => {
    const project = await createProject("Audio assets");
    const mp3 = await uploadAudio(project.id, "intro.mp3", "audio/mpeg", "intro");
    const m4a = await uploadAudio(project.id, "voice.m4a", "audio/mp4", "voice");
    const wav = await uploadAudio(null, "outro.wav", "audio/wav", "outro");
    // MediaRecorder reports the codec in the type.
    const webm = await uploadAudio(project.id, "voice.webm", "audio/webm;codecs=opus", "recorded");
    expect(mp3).toMatchObject({ type: "AUDIO", mimeType: "audio/mpeg" });
    expect(webm).toMatchObject({ type: "AUDIO", mimeType: "audio/webm" });
    expect(mp3.durationMs).toBeGreaterThan(1900);
    expect(mp3.durationMs).toBeLessThan(2200);
    expect(m4a.durationMs).toBeGreaterThan(2900);
    expect(wav.durationMs).toBe(2000);
    expect(webm.durationMs).toBeGreaterThan(2900);

    const again = await uploadAudio(project.id, "intro.mp3", "audio/mpeg", "other-name");
    expect(again.id).toBe(mp3.id);

    const listed = await api<{ assets: Array<{ id: string; type: string; durationMs: number | null }> }>("/api/assets");
    expect(listed.assets.find((asset) => asset.id === wav.id)).toMatchObject({ type: "AUDIO", durationMs: 2000 });
    const ranged = await fetch(`${baseUrl}/api/assets/${wav.id}`, { headers: { Range: "bytes=0-99" } });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get("content-type")).toBe("audio/wav");
    expect((await ranged.arrayBuffer()).byteLength).toBe(100);
  });

  it("rejects non-audio bytes, unsupported types and audio typed as an image", async () => {
    const project = await createProject("Bad audio");
    const form = (blob: Blob, name: string, type = "AUDIO") => { const f = new FormData(); f.set("file", blob, name); f.set("assetKey", "bad"); f.set("type", type); return f; };
    await api(`/api/projects/${project.id}/assets`, { method: "POST", body: form(new Blob(["not audio at all"], { type: "audio/mpeg" }), "x.mp3") }, 400);
    await api(`/api/projects/${project.id}/assets`, { method: "POST", body: form(new Blob(["x"], { type: "audio/flac" }), "x.flac") }, 400);
    await api(`/api/projects/${project.id}/assets`, { method: "POST", body: form(new Blob([await readFile(path.join(fixturesDir, "blue.png"))], { type: "image/png" }), "blue.png") }, 400);
    // Audio uploaded with an image type is still stored as AUDIO.
    const audio = await api<{ type: string }>(`/api/projects/${project.id}/assets`, { method: "POST", body: form(new Blob([readFileSync(path.join(audioDir, "intro.mp3"))], { type: "audio/mpeg" }), "i.mp3", "OVERLAY") }, 200);
    expect(audio.type).toBe("AUDIO");
  });
});

describe("video with voiceovers", () => {
  it("renders a standalone voiceover section and a mixed voiceover with ducking", async () => {
    const project = await createProject("Voiceover video");
    const green = await uploadSource(project.id, "green.mp4");
    const voice = await uploadAudio(project.id, "voice.m4a", "audio/mp4", "voiceover");
    // green 0-4 s, standalone voiceover 4-7 s over the template background, mix of the same recording at 1-2.5 s of the video, source ducked to 0.2.
    await setComposition(project.id, [
      { type: "source-clip", sourceId: green.id, startSeconds: 0, endSeconds: 4 },
      { type: "audio-clip", assetId: voice.id, mode: "standalone", startSeconds: 0, endSeconds: 3, data: { title: "Voiceover" } },
      { type: "audio-clip", assetId: voice.id, mode: "mix", startSeconds: 0, endSeconds: 1.5, atSeconds: 1, duckSourceVolume: 0.2 },
    ], 7);
    const { outputs } = await generate(project.id, {});
    const video = outputs.find((output) => output.type === "VIDEO")!;
    const filePath = path.join(mediaRoot, `voiceover-${video.id}.mp4`);
    await download(video.id, filePath);

    const info = await probe(filePath);
    expect(info.duration).toBeGreaterThan(6.8);
    expect(info.duration).toBeLessThan(7.3);
    expect(info.audio).toBeDefined();

    expect(isGreen(averageColor(await frameRgb(filePath, 2)))).toBe(true);
    expect(isBlack(averageColor(await frameRgb(filePath, 4.05, { x: 0, y: 0, w: 200, h: 200 })))).toBe(true);

    const samples = await pcm(filePath);
    expect(dominant(samples, 0.1, 0.9)).toBe(SERMON_HZ);
    expect(dominant(samples, 4.3, 6.8)).toBe(VOICE_HZ);
    const sermonBefore = magnitude(samples, 0.2, 0.9, SERMON_HZ);
    const sermonDucked = magnitude(samples, 1.2, 2.3, SERMON_HZ);
    const voiceInMix = magnitude(samples, 1.2, 2.3, VOICE_HZ);
    const voiceBefore = magnitude(samples, 0.2, 0.9, VOICE_HZ);
    expect(sermonDucked).toBeLessThan(sermonBefore * 0.4);
    expect(sermonDucked).toBeGreaterThan(sermonBefore * 0.05);
    expect(voiceInMix).toBeGreaterThan(Math.max(voiceBefore, 0.001) * 10);
    // The mix ends after 1.5 s: the sermon is back at full level afterwards.
    expect(magnitude(samples, 2.7, 3.9, SERMON_HZ)).toBeGreaterThan(sermonBefore * 0.8);
  });

  it("keeps soft captions aligned when voiceovers are inserted", async () => {
    const project = await createProject("Voiceover captions");
    const green = await uploadSource(project.id, "green.mp4");
    const red = await uploadSource(project.id, "red.mp4");
    for (const [id, vtt] of [[green.id, "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nVihreä alkaa\n"], [red.id, "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nPunainen alkaa\n"]] as const) {
      const form = new FormData();
      form.set("file", new Blob([vtt], { type: "text/vtt" }), "c.vtt");
      form.set("language", "fi");
      await api(`/api/sources/${id}/transcription-runs/upload`, { method: "POST", body: form }, 201);
    }
    const voice = await uploadAudio(project.id, "voice.m4a", "audio/mp4", "voiceover-c");
    await setComposition(project.id, [
      { type: "source-clip", sourceId: green.id, startSeconds: 0, endSeconds: 4 },
      { type: "audio-clip", assetId: voice.id, mode: "standalone", startSeconds: 0, endSeconds: 3 },
      { type: "audio-clip", assetId: voice.id, mode: "mix", startSeconds: 0, endSeconds: 1, atSeconds: 0.5 },
      { type: "source-clip", sourceId: red.id, startSeconds: 0, endSeconds: 4 },
    ], 8);
    const { outputs } = await generate(project.id, { captions: { mode: "soft" } });
    const video = outputs.find((output) => output.type === "VIDEO")!;
    const filePath = path.join(mediaRoot, `voiceover-captions-${video.id}.mp4`);
    await download(video.id, filePath);
    const { stdout } = await execFileAsync("ffmpeg", ["-v", "error", "-i", filePath, "-map", "0:s:0", "-f", "srt", "-"]);
    const cues = parseVtt(stdout).map((cue) => ({ text: cue.text, start: Math.round(cue.startSeconds * 100) / 100, end: Math.round(cue.endSeconds * 100) / 100 }));
    // The voiceover takes 3 s between the clips, so the red cue moves from 1-2 s to 4+3+1 = 8-9 s.
    expect(cues).toEqual([{ text: "Vihreä alkaa", start: 1, end: 2 }, { text: "Punainen alkaa", start: 8, end: 9 }]);
    const sidecar = outputs.find((output) => output.type === "CAPTIONS_SRT")!;
    expect(sidecar).toBeDefined();
    expect((await probe(filePath)).duration).toBeGreaterThan(10.8);
  });
});

describe("podcast export", () => {
  it("renders intro + sermon + voiceover + outro with tags, cover art and -16 LUFS", async () => {
    const project = await createProject("Podcast Sunday");
    await api(`/api/projects/${project.id}`, { method: "PATCH", json: { preacher: "Pastori Pekka", gospelRef: "Joh. 3:16" } });
    const green = await uploadSource(project.id, "green.mp4");
    const voice = await uploadAudio(project.id, "voice.m4a", "audio/mp4", "voiceover-p");
    const intro = await uploadAudio(project.id, "intro.mp3", "audio/mpeg", "podcast-intro");
    const outro = await uploadAudio(null, "outro.wav", "audio/wav", "podcast-outro");
    // A 2 s standalone slate has no audio, so the podcast skips it: body = 4 s sermon + 3 s voiceover.
    await setComposition(project.id, [
      { type: "slate", template: "rich", mode: "standalone", durationSeconds: 2, data: { title: "Sunday" } },
      { type: "source-clip", sourceId: green.id, startSeconds: 0, endSeconds: 4 },
      { type: "audio-clip", assetId: voice.id, mode: "standalone", startSeconds: 0, endSeconds: 3 },
    ], 9);

    // Intro/outro are saved with the project (the Podcast panel does this); the video render must ignore them.
    const saved = await api<{ definition: Record<string, unknown> }>(`/api/projects/${project.id}`);
    await api(`/api/projects/${project.id}`, { method: "PATCH", json: { definition: { ...saved.definition, podcast: { introAssetId: intro.id, outroAssetId: outro.id, crossfadeSeconds: 0.5 } } } });

    // A finished video queues a thumbnail, which becomes the cover art.
    const videoRun = await generate(project.id, {});
    await waitForThumbnail(project.id);
    const videoPath = path.join(mediaRoot, `podcast-video-${videoRun.jobId}.mp4`);
    await download(videoRun.outputs.find((output) => output.type === "VIDEO")!.id, videoPath);
    const videoInfo = await probe(videoPath);
    expect(videoInfo.duration).toBeLessThan(9.4);
    const videoSamples = await pcm(videoPath);
    for (const hz of [INTRO_HZ, OUTRO_HZ]) expect(magnitude(videoSamples, 0, 9, hz)).toBeLessThan(0.005);

    const { outputs } = await generate(project.id, { type: "PODCAST", podcast: { album: "Saarnat", date: "2026-09-27" } });
    expect(outputs.map((output) => output.type)).toEqual(["AUDIO"]);
    const audio = outputs[0];
    expect(audio.mimeType).toBe("audio/mpeg");
    const response = await fetch(`${baseUrl}/api/outputs/${audio.id}`);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(response.headers.get("content-disposition")).toContain("saarnavideo-podcast.mp3");
    const filePath = path.join(mediaRoot, `podcast-${audio.id}.mp3`);
    await download(audio.id, filePath);

    const info = await ffprobeJson(filePath);
    // 2 (intro) + 7 (body) + 2 (outro) - two 0.5 s crossfades.
    expect(Number(info.format.duration)).toBeGreaterThan(9.85);
    expect(Number(info.format.duration)).toBeLessThan(10.3);
    const audioStream = info.streams.find((stream) => stream.codec_type === "audio")!;
    expect(audioStream).toMatchObject({ codec_name: "mp3", sample_rate: "44100", channels: 1 });
    expect(info.format.tags).toMatchObject({ title: "Podcast Sunday", artist: "Pastori Pekka", album: "Saarnat", date: "2026-09-27", comment: "Joh. 3:16" });
    const cover = info.streams.find((stream) => stream.codec_type === "video")!;
    expect(cover).toMatchObject({ codec_name: "mjpeg", disposition: { attached_pic: 1 } });

    expect(Math.abs((await integratedLoudness(filePath)) - -16)).toBeLessThan(1);

    // Segment order: intro, sermon, voiceover, outro (windows stay clear of the crossfades at 1.5-2, 8-8.5 s).
    const samples = await pcm(filePath);
    expect(dominant(samples, 0.2, 1.3)).toBe(INTRO_HZ);
    expect(dominant(samples, 2.2, 5.2)).toBe(SERMON_HZ);
    expect(dominant(samples, 5.9, 7.9)).toBe(VOICE_HZ);
    expect(dominant(samples, 8.7, 9.8)).toBe(OUTRO_HZ);
  });

  it("renders stereo M4A without intro/outro/cover, and a mix voiceover lands at its podcast position", async () => {
    const project = await createProject("Podcast m4a");
    const green = await uploadSource(project.id, "green.mp4");
    const voice = await uploadAudio(project.id, "voice.m4a", "audio/mp4", "voiceover-m");
    // Slate 2 s (skipped), green 4 s, mix voiceover at video time 3 s = 1 s into the green audio once the slate is gone... 3 s video -> 1 s podcast.
    await setComposition(project.id, [
      { type: "slate", template: "rich", mode: "standalone", durationSeconds: 2, data: { title: "Sunday" } },
      { type: "source-clip", sourceId: green.id, startSeconds: 0, endSeconds: 4 },
      { type: "audio-clip", assetId: voice.id, mode: "mix", startSeconds: 0, endSeconds: 1, atSeconds: 3, duckSourceVolume: 0 },
    ], 6);
    const { outputs } = await generate(project.id, { type: "PODCAST", podcast: { format: "m4a", channels: "stereo" } });
    const audio = outputs[0];
    expect(audio).toMatchObject({ type: "AUDIO", mimeType: "audio/mp4" });
    const filePath = path.join(mediaRoot, `podcast-${audio.id}.m4a`);
    await download(audio.id, filePath);
    const info = await ffprobeJson(filePath);
    expect(Number(info.format.duration)).toBeGreaterThan(3.8);
    expect(Number(info.format.duration)).toBeLessThan(4.3);
    expect(info.streams.filter((stream) => stream.codec_type === "video")).toHaveLength(0);
    expect(info.streams.find((stream) => stream.codec_type === "audio")).toMatchObject({ codec_name: "aac", channels: 2, sample_rate: "44100" });
    expect(info.format.tags?.title).toBe("Podcast m4a");
    const samples = await pcm(filePath);
    expect(dominant(samples, 0.1, 0.8)).toBe(SERMON_HZ);
    expect(dominant(samples, 1.2, 1.8)).toBe(VOICE_HZ);
    expect(magnitude(samples, 1.2, 1.8, SERMON_HZ)).toBeLessThan(magnitude(samples, 0.1, 0.8, SERMON_HZ) * 0.1);
    expect(dominant(samples, 2.3, 3.8)).toBe(SERMON_HZ);
  });

  it("validates podcast requests", async () => {
    const project = await createProject("Podcast validation");
    const green = await uploadSource(project.id, "green.mp4");
    await setComposition(project.id, [{ type: "source-clip", sourceId: green.id, startSeconds: 0, endSeconds: 4 }], 4);
    await api(`/api/projects/${project.id}/generate`, { method: "POST", json: { type: "PODCAST", podcast: { introAssetId: "does-not-exist" } } }, 400);
    await api(`/api/projects/${project.id}/generate`, { method: "POST", json: { type: "PODCAST", podcast: { format: "flac" } } }, 400);
    // The intro must be an audio asset, not an image.
    const image = await api<{ id: string }>(`/api/projects/${project.id}/assets`, { method: "POST", body: (() => { const f = new FormData(); f.set("file", new Blob([readFileSync(path.join(fixturesDir, "blue.png"))], { type: "image/png" }), "blue.png"); f.set("assetKey", "pic"); f.set("type", "OVERLAY"); return f; })() });
    await api(`/api/projects/${project.id}/generate`, { method: "POST", json: { type: "PODCAST", podcast: { introAssetId: image.id } } }, 400);
  });
});
