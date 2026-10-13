import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ffmpegKeyColor, formatSeconds } from "@/renderer/ffmpeg";
import type { FeedPart } from "@/domain/lcyt-manifest";

const execFileAsync = promisify(execFile);

export type VideoProbe = { width: number; height: number; fps: number; durationMs: number; hasAudio: boolean };

function parseRate(value: string | undefined): number {
  const [n, d] = (value ?? "").split("/").map(Number);
  const rate = d ? n / d : n;
  return Number.isFinite(rate) && rate > 0 && rate < 240 ? rate : 25;
}

/** Size, frame rate, length and whether there is audio, read with ffprobe. Throws for a file that is not a readable video. */
export async function probeVideo(file: string): Promise<VideoProbe> {
  const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height,r_frame_rate:format=duration", "-of", "json", file], { maxBuffer: 4 * 1024 * 1024 });
  const data = JSON.parse(stdout) as { streams?: Array<{ codec_type?: string; width?: number; height?: number; r_frame_rate?: string }>; format?: { duration?: string } };
  const video = data.streams?.find((stream) => stream.codec_type === "video");
  if (!video?.width || !video.height) throw new Error("The file has no video stream");
  const duration = Number(data.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("The file has no readable duration");
  return { width: video.width, height: video.height, fps: parseRate(video.r_frame_rate), durationMs: Math.round(duration * 1000), hasAudio: !!data.streams?.some((stream) => stream.codec_type === "audio") };
}

/** Quiet time between consecutive parts, in ms (parts that touch or overlap leave none). */
export function gapsBetween(parts: readonly FeedPart[]): number[] {
  const ordered = [...parts].sort((a, b) => a.startMs - b.startMs);
  return ordered.slice(1).map((part, index) => Math.max(0, Math.round(part.startMs - (ordered[index].startMs + ordered[index].durationMs))));
}

export type JoinInput = { file: string; part: FeedPart; hasAudio: boolean };

/**
 * ffmpeg arguments that join the recorded parts of one feed into a single file whose t = 0 is the start of its first part,
 * with a gap (black, or the key colour for a DSK feed so no stray graphics appear) wherever the stream was not recording.
 * Every part is brought to one size, frame rate and audio layout first.
 */
export function buildJoinArgs(inputs: readonly JoinInput[], frame: { width: number; height: number; fps: number }, gapColor: string, output: string): string[] {
  const ordered = [...inputs].sort((a, b) => a.part.startMs - b.part.startMs);
  const gaps = gapsBetween(ordered.map((input) => input.part));
  const args = ["-hide_banner", "-y"];
  for (const input of ordered) args.push("-i", input.file);
  const filters: string[] = [];
  const labels: string[] = [];
  const { width: W, height: H, fps } = frame;
  const audio = "aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo";
  const segment = (index: number) => {
    const input = ordered[index];
    filters.push(`[${index}:v]fps=${fps},scale=w=${W}:h=${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,setpts=PTS-STARTPTS[v${labels.length}]`);
    filters.push(input.hasAudio
      ? `[${index}:a]${audio},asetpts=PTS-STARTPTS[a${labels.length}]`
      : `anullsrc=r=48000:cl=stereo,atrim=duration=${formatSeconds(input.part.durationMs / 1000)}[a${labels.length}]`);
    labels.push(`[v${labels.length}][a${labels.length}]`);
  };
  const gap = (ms: number) => {
    const n = labels.length;
    filters.push(`color=c=${gapColor}:s=${W}x${H}:r=${fps}:d=${formatSeconds(ms / 1000)},setsar=1,format=yuv420p[v${n}]`);
    filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${formatSeconds(ms / 1000)}[a${n}]`);
    labels.push(`[v${n}][a${n}]`);
  };
  ordered.forEach((_input, index) => {
    segment(index);
    if (index < gaps.length && gaps[index] > 0) gap(gaps[index]);
  });
  filters.push(`${labels.join("")}concat=n=${labels.length}:v=1:a=1[outv][outa]`);
  args.push("-filter_complex", filters.join(";"), "-map", "[outv]", "-map", "[outa]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-movflags", "+faststart", output);
  return args;
}

export function gapColorFor(role: "clean" | "program" | "dsk", key?: { color?: string } | null): string {
  return role === "dsk" ? ffmpegKeyColor(key?.color) : "black";
}

/** Runs ffmpeg and rejects with the last lines of stderr. */
export async function runFfmpegJoin(args: string[]): Promise<void> {
  try {
    await execFileAsync("ffmpeg", args, { maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    const stderr = String((error as { stderr?: string }).stderr ?? "").trim().split("\n").slice(-6).join("\n");
    throw new Error(`Joining the recorded parts failed: ${stderr || (error instanceof Error ? error.message : "ffmpeg error")}`);
  }
}
