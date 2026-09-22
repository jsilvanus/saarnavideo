import type { JobResultSegment } from "@/integrations/auditorStt/client";

/**
 * Pure helpers for the "one correctness-critical rule" in
 * docs/transcription-editor-contract.md's "Partial-range transcription"
 * section: deciding whether a range needs a separate audio extraction, and
 * correcting the STT result's clip-relative timestamps back to
 * source-absolute ones. Kept separate from src/worker/index.ts (which calls
 * main() as a side effect of being imported) so this logic can be unit
 * tested directly.
 */

/**
 * True when [rangeStartSeconds, rangeEndSeconds) does not cover the whole
 * source, i.e. an ffmpeg range extraction is required before submitting to
 * the STT service. A source with unknown duration is always treated as
 * requiring extraction unless rangeStartSeconds is 0, since there's nothing
 * to compare rangeEndSeconds against.
 */
export function isPartialRange(rangeStartSeconds: number, rangeEndSeconds: number, durationSeconds: number | undefined): boolean {
  return rangeStartSeconds > 0 || (durationSeconds !== undefined && rangeEndSeconds < durationSeconds);
}

export type CorrectedSegment = { startSeconds: number; endSeconds: number; text: string; confidence?: number };

/**
 * Rough confidence heuristic mirrored from confidenceFromAvgLogprob in
 * src/integrations/auditorStt/provider.ts: clamp(avg_logprob + 1.0, 0, 1).
 */
export function confidenceFromAvgLogprob(avgLogprob: number | null): number | undefined {
  if (avgLogprob === null || avgLogprob === undefined) return undefined;
  return Math.max(0, Math.min(1, avgLogprob + 1));
}

/**
 * The result's segments come back time-zeroed to the submitted clip, not the
 * source - this adds rangeStartSeconds to both start and end of every
 * segment so every TranscriptSegment ever stored is in source-absolute time,
 * full stop. Segments where end <= start (which the STT service does not
 * itself guard against) are dropped rather than failing the whole transcript.
 */
export function applyRangeOffset(segments: JobResultSegment[], rangeStartSeconds: number): CorrectedSegment[] {
  return segments
    .filter((segment) => segment.end > segment.start)
    .map((segment) => ({
      startSeconds: segment.start + rangeStartSeconds,
      endSeconds: segment.end + rangeStartSeconds,
      text: segment.text,
      confidence: confidenceFromAvgLogprob(segment.avg_logprob),
    }));
}
