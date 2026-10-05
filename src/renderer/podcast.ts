import { baseItemDuration, isBaseItem, type AudioClipItem, type PodcastSettings, type ProjectDefinition } from "@/domain/project";
import { layoutTimeline, timelineDuration } from "@/domain/timeline";
import { AUDIO_NORMALIZE, audioAssetPath, audioClipFilter, audioMixFilters, formatSeconds, sourceAudioFilter, type FfmpegPlan } from "@/renderer/ffmpeg";

/** Integrated loudness target for spoken word, in LUFS. */
export const PODCAST_TARGET_LUFS = -16;
const TRUE_PEAK_DB = -1.5;
const LOUDNESS_RANGE = 11;

export type LoudnormMeasurement = { input_i: string; input_tp: string; input_lra: string; input_thresh: string; target_offset: string };
export type PodcastMetadata = Partial<Record<"title" | "artist" | "album" | "date" | "comment" | "genre", string>>;
export type PodcastPlanOptions = {
  settings: Pick<PodcastSettings, "format" | "channels" | "crossfadeSeconds" | "startSeconds" | "endSeconds">;
  /** Prerecorded intro/outro files. They exist for the podcast only; the video render never reads them. */
  intro?: { path: string; durationSeconds?: number };
  outro?: { path: string; durationSeconds?: number };
  /** JPEG/PNG embedded as cover art (attached picture). */
  coverPath?: string;
  metadata?: PodcastMetadata;
  /** "measure" builds the analysis pass (loudnorm print_format=json, no output file); a measurement builds the linear second pass; undefined is single-pass dynamic loudnorm. */
  loudness?: "measure" | LoudnormMeasurement;
};
export type PodcastPlan = FfmpegPlan & { /** Expected length of the audio file. */ durationSeconds: number };

export function podcastMimeType(format: "mp3" | "m4a"): string { return format === "m4a" ? "audio/mp4" : "audio/mpeg"; }

/**
 * Tag values for the podcast file. Explicit settings win; otherwise title is the project title, artist the preacher,
 * comment the Gospel reference and date today (YYYY-MM-DD). Blank values are left out.
 */
export function resolvePodcastMetadata(project: { title: string; preacher?: string | null; gospelRef?: string | null }, settings: Partial<PodcastMetadata>, now = new Date()): PodcastMetadata {
  const pick = (value: string | null | undefined) => (value?.trim() ? value.trim() : undefined);
  const metadata: PodcastMetadata = {
    title: pick(settings.title) ?? pick(project.title),
    artist: pick(settings.artist) ?? pick(project.preacher),
    album: pick(settings.album),
    date: pick(settings.date) ?? now.toISOString().slice(0, 10),
    comment: pick(settings.comment) ?? pick(project.gospelRef),
    genre: "Podcast",
  };
  return Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined)) as PodcastMetadata;
}

/** Reads the measurement block that `loudnorm=print_format=json` prints at the end of ffmpeg's stderr; null when absent or the input was silent. */
export function parseLoudnormMeasurement(stderr: string): LoudnormMeasurement | null {
  const start = stderr.lastIndexOf("{");
  const end = stderr.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    const data = JSON.parse(stderr.slice(start, end + 1)) as Record<string, string>;
    const measurement = { input_i: data.input_i, input_tp: data.input_tp, input_lra: data.input_lra, input_thresh: data.input_thresh, target_offset: data.target_offset };
    return Object.values(measurement).every((value) => Number.isFinite(Number(value))) ? measurement : null;
  } catch {
    return null;
  }
}

function loudnormFilter(loudness: PodcastPlanOptions["loudness"]): string {
  const base = `loudnorm=I=${PODCAST_TARGET_LUFS}:TP=${TRUE_PEAK_DB}:LRA=${LOUDNESS_RANGE}`;
  if (loudness === "measure") return `${base}:print_format=json`;
  if (loudness) return `${base}:measured_I=${loudness.input_i}:measured_TP=${loudness.input_tp}:measured_LRA=${loudness.input_lra}:measured_thresh=${loudness.input_thresh}:offset=${loudness.target_offset}:linear=true`;
  return base;
}

/** The exported part of a podcast body of `bodySeconds`: the settings' start/end, clamped to the body; the whole body when unset. */
export function podcastBodyRange(settings: { startSeconds?: number; endSeconds?: number }, bodySeconds: number): { start: number; end: number } {
  const start = Math.min(Math.max(0, settings.startSeconds ?? 0), bodySeconds);
  const end = Math.min(bodySeconds, settings.endSeconds ?? bodySeconds);
  if (!(end > start)) throw new Error(`Podcast range ${start.toFixed(1)}–${end.toFixed(1)} s is outside the ${bodySeconds.toFixed(1)} s of audio`);
  return { start, end };
}

/**
 * Audio-only render of a composition. Segments are, in order: [intro] + the composition's audio + [outro].
 * The composition's audio is its base items in order: source clips (their audio), standalone voiceovers (audio-clips),
 * with the same cut / fade / crossfade transitions as the video. Standalone slates carry no audio and are skipped;
 * mixed voiceovers are layered at their video-timeline position, moved earlier by the slate time removed before them.
 * Only `startSeconds..endSeconds` of that body is kept when set. Intro, body and outro are joined with a `crossfadeSeconds` crossfade (0 = plain concat), then the result is
 * downmixed, loudness-normalised (loudnorm, -16 LUFS / -1.5 dBTP) and encoded at 44.1 kHz.
 */
export function buildPodcastRenderPlan(definition: ProjectDefinition, sourcePaths: Map<string, string>, outputPath: string, assetPaths: Map<string, string>, options: PodcastPlanOptions): PodcastPlan {
  const items = definition.composition.items;
  const slots = layoutTimeline(items);
  const mixes = items.filter((item): item is AudioClipItem => item.type === "audio-clip" && item.mode === "mix");
  const baseItems = items.filter(isBaseItem);
  const included = baseItems.filter((item) => item.type !== "slate");
  if (!included.length) throw new Error("A podcast needs at least one source clip or standalone voiceover (slates carry no audio)");

  const args: string[] = ["-hide_banner", "-y"];
  let nextInput = 0;
  const addInput = (filePath: string) => { args.push("-i", filePath); return nextInput++; };
  const sourceInputs = new Map<string, number>();

  const filters: string[] = [];
  // The body is the base items minus standalone slates, laid out by the same function as the video (src/domain/timeline.ts).
  const bodySlot = new Map(layoutTimeline(included).map((slot) => [slot.item, slot]));
  const startsBySlot = new Map<number, number>();
  let current = "";
  baseItems.forEach((item, slotIndex) => {
    if (item.type === "slate") return;
    const duration = baseItemDuration(item);
    const label = `p${slotIndex}`;
    if (item.type === "source-clip") {
      if (!sourceInputs.has(item.sourceId)) {
        const sourcePath = sourcePaths.get(item.sourceId);
        if (!sourcePath) throw new Error(`Missing source path for sourceId: ${item.sourceId}`);
        sourceInputs.set(item.sourceId, addInput(sourcePath));
      }
      filters.push(sourceAudioFilter(sourceInputs.get(item.sourceId)!, item.startSeconds, duration, label));
    } else {
      filters.push(audioClipFilter(addInput(audioAssetPath(assetPaths, item.assetId)), item, label));
    }
    const { outputStart, transition: d } = bodySlot.get(item)!;
    startsBySlot.set(slotIndex, outputStart);
    if (!current) {
      current = label;
      return;
    }
    const type = item.transitionIn?.type;
    const next = `pc${slotIndex}`;
    if (type === "crossfade" && d > 0) {
      filters.push(`[${current}][${label}]acrossfade=d=${formatSeconds(d)}:curve1=tri:curve2=tri[${next}]`);
    } else if (type === "fade" && d > 0) {
      const at = formatSeconds(outputStart - d);
      filters.push(`[${current}]afade=t=out:st=${at}:d=${formatSeconds(d)}[${next}o]`, `[${label}]afade=t=in:st=0:d=${formatSeconds(d)}[${next}i]`, `[${next}o][${next}i]concat=n=2:v=0:a=1[${next}]`);
    } else {
      filters.push(`[${current}][${label}]concat=n=2:v=0:a=1[${next}]`);
    }
    current = next;
  });
  const bodyDuration = timelineDuration(included);

  // Video-timeline seconds -> podcast-timeline seconds: skipped slates collapse to the point where the next audio starts.
  const podcastTime = (videoSeconds: number): number => {
    const index = slots.findIndex((slot) => videoSeconds >= slot.outputStart && videoSeconds < slot.outputStart + slot.duration);
    if (index < 0) return videoSeconds < 0 ? 0 : bodyDuration;
    for (let i = index; i < slots.length; i++) {
      const start = startsBySlot.get(i);
      if (start !== undefined) return Math.min(bodyDuration, i === index ? start + (videoSeconds - slots[i].outputStart) : start);
    }
    return bodyDuration;
  };
  mixes.forEach((item, index) => {
    const mixed = audioMixFilters(current, addInput(audioAssetPath(assetPaths, item.assetId)), item, podcastTime(item.atSeconds ?? 0), index);
    filters.push(...mixed.filters);
    current = mixed.output;
  });

  // The chosen part of the body (startSeconds..endSeconds of the podcast body); the whole body when no range is set.
  const range = podcastBodyRange(options.settings, bodyDuration);
  if (range.start > 0 || range.end < bodyDuration) {
    filters.push(`[${current}]atrim=start=${formatSeconds(range.start)}:end=${formatSeconds(range.end)},asetpts=PTS-STARTPTS[body]`);
    current = "body";
  }

  // Intro + body + outro.
  const crossfade = options.settings.crossfadeSeconds;
  let joined = current;
  let total = range.end - range.start;
  const join = (name: "intro" | "outro", track: { path: string; durationSeconds?: number }) => {
    filters.push(`[${addInput(track.path)}:a]${AUDIO_NORMALIZE}[${name}]`);
    const seconds = track.durationSeconds ?? Infinity;
    const d = Math.min(crossfade, seconds / 2, total / 2);
    const [first, second] = name === "intro" ? [name, joined] : [joined, name];
    const out = `with${name}`;
    filters.push(d > 0 ? `[${first}][${second}]acrossfade=d=${formatSeconds(d)}:curve1=tri:curve2=tri[${out}]` : `[${first}][${second}]concat=n=2:v=0:a=1[${out}]`);
    total += (Number.isFinite(seconds) ? seconds : 0) - d;
    joined = out;
  };
  if (options.intro) join("intro", options.intro);
  if (options.outro) join("outro", options.outro);

  const layout = options.settings.channels === "stereo" ? "stereo" : "mono";
  filters.push(`[${joined}]aformat=channel_layouts=${layout},${loudnormFilter(options.loudness)},aresample=44100[podcast]`);

  const measuring = options.loudness === "measure";
  const coverIndex = !measuring && options.coverPath ? addInput(options.coverPath) : undefined;
  args.push("-filter_complex", filters.join(";"), "-map", "[podcast]");
  if (measuring) {
    args.push("-f", "null", "-");
    return { sourcePaths, assetPaths, outputPath, args, durationSeconds: total };
  }
  const bitrate = layout === "stereo" ? "128k" : "96k";
  if (options.settings.format === "m4a") args.push("-c:a", "aac", "-b:a", bitrate, "-ar", "44100", "-movflags", "+faststart");
  else args.push("-c:a", "libmp3lame", "-b:a", bitrate, "-ar", "44100", "-id3v2_version", "3", "-write_id3v1", "1");
  if (coverIndex !== undefined) args.push("-map", `${coverIndex}:v`, "-c:v", "copy", "-disposition:v:0", "attached_pic", "-metadata:s:v", "title=Cover", "-metadata:s:v", "comment=Cover (front)");
  args.push("-map_metadata", "-1");
  for (const [key, value] of Object.entries(options.metadata ?? {})) args.push("-metadata", `${key}=${value}`);
  args.push(outputPath);
  return { sourcePaths, assetPaths, outputPath, args, durationSeconds: total };
}
