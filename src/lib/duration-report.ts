import { findPreset, presetForSize } from "@/domain/output-presets";
import type { ProjectDefinition } from "@/domain/project";
import { layoutTimeline, timelineDuration } from "@/domain/timeline";

export type DurationWarning = { code: "over-platform-limit" | "off-target" | "podcast-differs" | "empty"; level: "warning" | "info"; message: string;
  /** Values behind `message`, so the UI can render the warning in its own language. */
  params?: Record<string, string | number | boolean> };
export type DurationReport = {
  videoSeconds: number;
  /** Length of the podcast body plus intro/outro; undefined when the project has no audio to export. */
  podcastSeconds?: number;
  targetSeconds?: number;
  limitSeconds?: number;
  limitLabel?: string;
  warnings: DurationWarning[];
};

/** Off-target tolerance: 5 % or 3 s, whichever is larger. */
const TARGET_TOLERANCE_RATIO = 0.05;
const TARGET_TOLERANCE_MIN = 3;
/** Podcast and video differing by more than this (seconds) is worth a note, e.g. from intro/outro and dropped slates. */
const PODCAST_DIFFERENCE = 10;

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** Length of the podcast body: base items minus standalone slates, minus crossfade overlaps; undefined when there is no audio. */
export function podcastBodySeconds(definition: Pick<ProjectDefinition, "composition">): number | undefined {
  const slots = layoutTimeline(definition.composition.items);
  const hasVoice = slots.some(({ item }) => item.type === "source-clip" || item.type === "audio-clip");
  if (!hasVoice) return undefined;
  const bodyEnd = slots.filter(({ item }) => item.type !== "slate").reduce((total, slot) => total + slot.duration, 0);
  // Crossfades shorten the body by their overlap, which the layout already applies to slot starts; recompute from the timeline.
  const overlap = slots.reduce((sum, slot, index) => sum + (index > 0 && slot.item.type !== "slate" ? Math.max(0, slots[index - 1].outputStart + slots[index - 1].duration - slot.outputStart) : 0), 0);
  return Math.max(0, bodyEnd - overlap);
}

/** Podcast length: the chosen part of the body (all of it when no range is set), plus intro and outro, minus the crossfades between them. */
export function podcastDuration(definition: ProjectDefinition, assetDurations: ReadonlyMap<string, number> = new Map()): number | undefined {
  const body = podcastBodySeconds(definition);
  if (body === undefined) return undefined;
  const settings = definition.podcast;
  const start = Math.min(Math.max(0, settings?.startSeconds ?? 0), body);
  const chosen = Math.max(0, Math.min(body, settings?.endSeconds ?? body) - start);
  const introSeconds = settings?.introAssetId ? assetDurations.get(settings.introAssetId) ?? 0 : 0;
  const outroSeconds = settings?.outroAssetId ? assetDurations.get(settings.outroAssetId) ?? 0 : 0;
  const fade = settings?.crossfadeSeconds ?? 0;
  const joins = (introSeconds ? 1 : 0) + (outroSeconds ? 1 : 0);
  return Math.max(0, chosen + introSeconds + outroSeconds - joins * fade);
}

export function computeDurationReport(definition: ProjectDefinition, assetDurations?: ReadonlyMap<string, number>): DurationReport {
  const template = definition.template;
  const videoSeconds = timelineDuration(definition.composition.items);
  const podcastSeconds = podcastDuration(definition, assetDurations);
  const preset = template ? presetForSize(template.width, template.height, template.presetKey) : findPreset(undefined);
  const chosen = findPreset(template?.presetKey) ?? preset;
  const warnings: DurationWarning[] = [];

  if (videoSeconds <= 0) warnings.push({ code: "empty", level: "info", message: "The composition has no video yet." });

  if (chosen?.maxSeconds && videoSeconds > chosen.maxSeconds + 0.5) {
    warnings.push({ code: "over-platform-limit", level: "warning", message: `Video is ${formatDuration(videoSeconds)}, ${formatDuration(videoSeconds - chosen.maxSeconds)} over the ${formatDuration(chosen.maxSeconds)} limit for ${chosen.label}.`, params: { video: formatDuration(videoSeconds), over: formatDuration(videoSeconds - chosen.maxSeconds), limit: formatDuration(chosen.maxSeconds), label: chosen.label } });
  }
  const target = template?.targetSeconds;
  if (target && videoSeconds > 0 && Math.abs(videoSeconds - target) > Math.max(TARGET_TOLERANCE_MIN, target * TARGET_TOLERANCE_RATIO)) {
    warnings.push({ code: "off-target", level: "warning", message: `Video is ${formatDuration(videoSeconds)}, target was ${formatDuration(target)} (${videoSeconds > target ? "+" : "-"}${formatDuration(Math.abs(videoSeconds - target))}).`, params: { video: formatDuration(videoSeconds), target: formatDuration(target), diff: `${videoSeconds > target ? "+" : "-"}${formatDuration(Math.abs(videoSeconds - target))}` } });
  }
  if (podcastSeconds !== undefined && videoSeconds > 0 && Math.abs(podcastSeconds - videoSeconds) > PODCAST_DIFFERENCE) {
    warnings.push({ code: "podcast-differs", level: "info", message: `Podcast is ${formatDuration(podcastSeconds)} and video ${formatDuration(videoSeconds)}: ${definition.podcast?.startSeconds !== undefined || definition.podcast?.endSeconds !== undefined ? "the podcast uses only its chosen start–end, " : ""}standalone slates are left out of the podcast and intro/outro are added.`, params: { podcast: formatDuration(podcastSeconds), video: formatDuration(videoSeconds), ranged: definition.podcast?.startSeconds !== undefined || definition.podcast?.endSeconds !== undefined } });
  }
  return { videoSeconds, podcastSeconds, targetSeconds: target, limitSeconds: chosen?.maxSeconds, limitLabel: chosen?.label, warnings };
}
