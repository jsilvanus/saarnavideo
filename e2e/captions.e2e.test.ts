import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { parseVtt } from "../src/lib/captions";
import { api, baseUrl, createProject, download, generate, importVtt, mediaRoot, setComposition, uploadSource } from "./helpers";

const execFileAsync = promisify(execFile);


async function streams(filePath: string) {
  const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "stream=index,codec_type,codec_name:stream_tags=language", "-of", "json", filePath]);
  return (JSON.parse(stdout) as { streams: Array<{ codec_type: string; codec_name: string; tags?: { language?: string } }> }).streams;
}

/** Cues of the MP4's first subtitle stream, read back through ffmpeg's own SRT muxer. */
async function embeddedCues(filePath: string) {
  const { stdout } = await execFileAsync("ffmpeg", ["-v", "error", "-i", filePath, "-map", "0:s:0", "-f", "srt", "-"]);
  return parseVtt(stdout);
}

const round = (cues: Array<{ startSeconds: number; endSeconds: number; text: string }>) => cues.map((cue) => ({ ...cue, startSeconds: Math.round(cue.startSeconds * 100) / 100, endSeconds: Math.round(cue.endSeconds * 100) / 100 }));

// Green source (5 s) and red source (5 s). Cues are in each source's own timeline.
const GREEN_VTT = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHyvää huomenta\n\n00:00:04.500 --> 00:00:06.000\nLoppu vihreä\n";
const RED_VTT = "WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nPunainen alkaa\n\n00:00:04.000 --> 00:00:05.000\nÄäköset: \"kauniit\"\n";

async function twoClipProject(title: string, redTransition?: Record<string, unknown>) {
  const project = await createProject(title);
  const green = await uploadSource(project.id, "green.mp4");
  const red = await uploadSource(project.id, "red.mp4");
  await importVtt(green.id, GREEN_VTT);
  await importVtt(red.id, RED_VTT);
  await setComposition(project.id, [
    { type: "source-clip", sourceId: green.id, startSeconds: 0, endSeconds: 5 },
    { type: "source-clip", sourceId: red.id, startSeconds: 0, endSeconds: 5, ...(redTransition ? { transitionIn: redTransition } : {}) },
  ]);
  return project;
}

describe("soft captions", () => {
  it("muxes a mov_text track with the output-timeline cues and stores SRT/VTT sidecars", async () => {
    const project = await twoClipProject("Captions cut");
    const { byType } = await generate(project.id, { captions: { mode: "soft" } });

    const video = byType("VIDEO")!;
    const filePath = `${mediaRoot}/captions-${video.id}.mp4`;
    await download(video.id, filePath);

    const all = await streams(filePath);
    expect(all.filter((stream) => stream.codec_type === "video")).toHaveLength(1);
    expect(all.filter((stream) => stream.codec_type === "audio")).toHaveLength(1);
    const subtitles = all.filter((stream) => stream.codec_type === "subtitle");
    expect(subtitles).toHaveLength(1);
    expect(subtitles[0]).toMatchObject({ codec_name: "mov_text", tags: { language: "fin" } });

    // Red clip starts at 5 s, so its cues shift by 5 s; the green cue that runs past the clip end is clipped to 5 s.
    const expected = [
      { startSeconds: 1, endSeconds: 2, text: "Hyvää huomenta" },
      { startSeconds: 4.5, endSeconds: 5, text: "Loppu vihreä" },
      { startSeconds: 6, endSeconds: 7.5, text: "Punainen alkaa" },
      { startSeconds: 9, endSeconds: 10, text: "Ääköset: \"kauniit\"" },
    ];
    expect(round(await embeddedCues(filePath))).toEqual(expected);

    // Sidecars: same cues, right types, mime types and file names.
    const srt = byType("CAPTIONS_SRT")!;
    const vtt = byType("CAPTIONS_VTT")!;
    expect(srt).toMatchObject({ mimeType: "application/x-subrip; charset=utf-8", language: "fi", preview: false });
    expect(vtt).toMatchObject({ mimeType: "text/vtt; charset=utf-8", language: "fi", preview: false });
    expect(video.language).toBe("fi");

    const srtResponse = await fetch(`${baseUrl}/api/outputs/${srt.id}`);
    expect(srtResponse.headers.get("content-type")).toBe("application/x-subrip; charset=utf-8");
    expect(srtResponse.headers.get("content-disposition")).toBe('attachment; filename="saarnavideo-captions-fi.srt"');
    const srtText = await srtResponse.text();
    expect(srtText).toBe(
      "1\n00:00:01,000 --> 00:00:02,000\nHyvää huomenta\n\n" +
      "2\n00:00:04,500 --> 00:00:05,000\nLoppu vihreä\n\n" +
      "3\n00:00:06,000 --> 00:00:07,500\nPunainen alkaa\n\n" +
      "4\n00:00:09,000 --> 00:00:10,000\nÄäköset: \"kauniit\"\n",
    );

    const vttResponse = await fetch(`${baseUrl}/api/outputs/${vtt.id}`);
    expect(vttResponse.headers.get("content-type")).toBe("text/vtt; charset=utf-8");
    expect(vttResponse.headers.get("content-disposition")).toBe('attachment; filename="saarnavideo-captions-fi.vtt"');
    const vttText = await vttResponse.text();
    expect(vttText.startsWith("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHyvää huomenta")).toBe(true);
    expect(round(parseVtt(vttText))).toEqual(expected);
    expect(round(parseVtt(srtText))).toEqual(expected);
  });

  it("shifts cues by the crossfade overlap and honours an explicit language", async () => {
    const project = await twoClipProject("Captions crossfade", { type: "crossfade", durationSeconds: 2 });
    const { byType } = await generate(project.id, { captions: { mode: "soft", language: "sv" } });
    const video = byType("VIDEO")!;
    const filePath = `${mediaRoot}/captions-${video.id}.mp4`;
    await download(video.id, filePath);

    const subtitle = (await streams(filePath)).find((stream) => stream.codec_type === "subtitle");
    expect(subtitle).toMatchObject({ codec_name: "mov_text", tags: { language: "swe" } });
    // Red starts at 5 - 2 = 3 s. mov_text cannot overlap cues, so "Punainen alkaa" (4-5.5) is cut where "Loppu vihreä" starts.
    expect(round(await embeddedCues(filePath)).map((cue) => [cue.startSeconds, cue.endSeconds, cue.text])).toEqual([
      [1, 2, "Hyvää huomenta"],
      [4, 4.5, "Punainen alkaa"],
      [4.5, 5, "Loppu vihreä"],
      [7, 8, "Ääköset: \"kauniit\""],
    ]);
    expect(byType("CAPTIONS_SRT")!.language).toBe("sv");
  });

  it("renders a scaled preview with the caption track too", async () => {
    const project = await twoClipProject("Captions preview");
    const { byType } = await generate(project.id, { preview: true, captions: { mode: "soft" } });
    const video = byType("VIDEO")!;
    expect(video.preview).toBe(true);
    expect(byType("CAPTIONS_SRT")!.preview).toBe(true);
    const filePath = `${mediaRoot}/captions-${video.id}.mp4`;
    await download(video.id, filePath);
    const all = await streams(filePath);
    expect(all.some((stream) => stream.codec_type === "subtitle" && stream.codec_name === "mov_text")).toBe(true);
    expect((await embeddedCues(filePath))).toHaveLength(4);
  });

  it("adds nothing without captions, and renders without a track when the transcript is empty", async () => {
    const plain = await createProject("No captions");
    const green = await uploadSource(plain.id, "green.mp4");
    await setComposition(plain.id, [{ type: "source-clip", sourceId: green.id, startSeconds: 0, endSeconds: 5 }], 5);
    const none = await generate(plain.id, {});
    expect(none.outputs.map((output) => output.type).sort()).toEqual(["VIDEO"]);

    const soft = await generate(plain.id, { captions: { mode: "soft" } });
    expect(soft.outputs.map((output) => output.type)).toEqual(["VIDEO"]);
    const filePath = `${mediaRoot}/captions-${soft.byType("VIDEO")!.id}.mp4`;
    await download(soft.byType("VIDEO")!.id, filePath);
    expect((await streams(filePath)).some((stream) => stream.codec_type === "subtitle")).toBe(false);
  });

  it("rejects invalid caption options", async () => {
    const project = await createProject("Bad captions");
    await api(`/api/projects/${project.id}/generate`, { method: "POST", json: { captions: { mode: "hard" } } }, 400);
    await api(`/api/projects/${project.id}/generate`, { method: "POST", json: { captions: { mode: "burn", styleGraphicId: "" } } }, 400);
    await api(`/api/projects/${project.id}/generate`, { method: "POST", json: { captions: { mode: "soft", language: "not a language" } } }, 400);
  });
});
