import { z } from "zod";

/**
 * Sound settings of a source clip or of the section it was made from (the clip's own setting wins, as with reframe).
 * Everything is optional; an empty object changes nothing.
 * - `volume`: the manual fader, 1 = as recorded, 0..4.
 * - `highpassHz`: cuts rumble below this frequency (20..500 Hz).
 * - `humHz`: notches mains hum (50 Hz in Finland) and its first harmonics.
 * - `normalize`: evens the section out to the speech loudness target (single-pass loudnorm).
 */
export const clipAudioSchema = z.object({
  volume: z.number().min(0).max(4).optional(),
  highpassHz: z.number().min(20).max(500).optional(),
  humHz: z.union([z.literal(50), z.literal(60)]).optional(),
  normalize: z.boolean().optional(),
});
export type ClipAudio = z.infer<typeof clipAudioSchema>;

type SectionLike = { sourceId?: string; startSeconds?: number; endSeconds?: number; audio?: ClipAudio };
type ClipLike = { sourceId: string; startSeconds: number; endSeconds: number; audio?: ClipAudio };

export const SPEECH_LUFS = -16;
export const SPEECH_TRUE_PEAK = -1.5;
const HUM_HARMONICS = 4;

/** The clip's own audio settings, else those of the section it was cut from (same source, clip range inside the section range). */
export function resolveClipAudio(clip: ClipLike, sections: SectionLike[] | undefined): ClipAudio | undefined {
  if (clip.audio) return clip.audio;
  const tolerance = 0.001;
  return sections?.find(s => s.sourceId === clip.sourceId && s.startSeconds !== undefined && s.endSeconds !== undefined
    && clip.startSeconds >= s.startSeconds - tolerance && clip.endSeconds <= s.endSeconds + tolerance && s.audio)?.audio;
}

const num = (n: number) => String(Math.round(n * 1000) / 1000);

/** ffmpeg filters for the settings, in the order that suits speech: clean first (high-pass, hum), then level (fader, normalise). Empty when nothing is set. */
export function clipAudioFilters(audio: ClipAudio | undefined): string[] {
  if (!audio) return [];
  const filters: string[] = [];
  if (audio.highpassHz) filters.push(`highpass=f=${num(audio.highpassHz)}`);
  if (audio.humHz) for (let k = 1; k <= HUM_HARMONICS; k++) filters.push(`equalizer=f=${audio.humHz * k}:width_type=q:w=30:g=-30`);
  if (audio.volume !== undefined && audio.volume !== 1) filters.push(`volume=${num(audio.volume)}`);
  if (audio.normalize) filters.push(`loudnorm=I=${SPEECH_LUFS}:TP=${SPEECH_TRUE_PEAK}:LRA=11`);
  return filters;
}
