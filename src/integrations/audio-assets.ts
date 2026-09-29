import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Upper size for one audio asset (voiceover, jingle); the `MAX_AUDIO_ASSET_SIZE_BYTES` env var overrides the 200 MB default. */
export const MAX_AUDIO_ASSET_SIZE = Number(process.env.MAX_AUDIO_ASSET_SIZE_BYTES ?? 200 * 1024 * 1024);

/** Canonical MIME type -> stored file extension. */
const AUDIO_TYPES: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
};

/** Browser / OS spellings folded into the canonical types above. */
const MIME_ALIASES: Record<string, string> = {
  "audio/mp3": "audio/mpeg",
  "audio/x-mpeg": "audio/mpeg",
  "audio/m4a": "audio/mp4",
  "audio/x-m4a": "audio/mp4",
  "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/vnd.wave": "audio/wav",
  "video/webm": "audio/webm",
  "application/ogg": "audio/ogg",
};

const EXTENSION_TYPES: Record<string, string> = { mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", webm: "audio/webm" };

export const AUDIO_ACCEPT = "audio/mpeg,audio/mp4,audio/wav,audio/ogg,audio/webm,.mp3,.m4a,.wav,.ogg,.webm";

/**
 * Canonical audio MIME type for an upload, or null when it is not one of mp3/m4a/wav/ogg/webm. The declared type wins
 * (codec parameters such as `audio/webm;codecs=opus` are dropped); a generic or missing type falls back to the file extension.
 */
export function canonicalAudioType(declaredType: string | undefined, fileName?: string): string | null {
  const declared = (declaredType ?? "").split(";")[0].trim().toLowerCase();
  const mapped = MIME_ALIASES[declared] ?? declared;
  if (AUDIO_TYPES[mapped]) return mapped;
  if (declared && declared !== "application/octet-stream") return null;
  const extension = fileName?.split(".").pop()?.toLowerCase();
  return (extension && EXTENSION_TYPES[extension]) || null;
}

export function isAudioMimeType(mimeType: string): boolean {
  return mimeType in AUDIO_TYPES;
}

export function audioExtension(mimeType: string): string {
  return AUDIO_TYPES[mimeType] ?? "bin";
}

export type AudioProbe = { durationMs: number };

/** Parses the last `time=HH:MM:SS.xx` progress stamp out of ffmpeg's stderr; used when the container header has no duration (MediaRecorder WebM). */
export function parseFfmpegTime(stderr: string): number | undefined {
  const matches = [...stderr.matchAll(/time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/g)];
  const last = matches[matches.length - 1];
  return last ? Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]) : undefined;
}

/**
 * Checks with ffprobe that the file holds an audio stream and returns its duration. Streams without a duration in the
 * header (Chrome's MediaRecorder WebM) are decoded once to measure it. Returns null for a file ffprobe cannot read as audio.
 */
export async function probeAudioFile(filePath: string): Promise<AudioProbe | null> {
  try {
    const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_type:format=duration", "-of", "json", filePath]);
    const data = JSON.parse(stdout) as { streams?: Array<{ codec_type?: string }>; format?: { duration?: string } };
    if (!data.streams?.some(stream => stream.codec_type === "audio")) return null;
    const header = Number(data.format?.duration);
    if (Number.isFinite(header) && header > 0) return { durationMs: Math.round(header * 1000) };
    const { stderr } = await execFileAsync("ffmpeg", ["-hide_banner", "-v", "info", "-stats", "-i", filePath, "-vn", "-f", "null", "-"], { maxBuffer: 16 * 1024 * 1024 }).catch(error => ({ stderr: String((error as { stderr?: string }).stderr ?? "") }));
    const measured = parseFfmpegTime(stderr);
    return measured && measured > 0 ? { durationMs: Math.round(measured * 1000) } : null;
  } catch {
    return null;
  }
}
