import { podcastSettingsSchema, type PodcastSettings } from "@/domain/project";

/**
 * Podcast settings for a PODCAST job: `definition.podcast` (saved with the project) overlaid with the `podcast` object
 * the generate request stored in MediaJob.parameters. Invalid values fall back to the defaults.
 */
export function readPodcastSettings(definition: { podcast?: unknown }, parameters: unknown): PodcastSettings {
  const overrides = parameters && typeof parameters === "object" ? (parameters as { podcast?: unknown }).podcast : undefined;
  const merged = { ...(definition.podcast && typeof definition.podcast === "object" ? definition.podcast : {}), ...(overrides && typeof overrides === "object" ? overrides : {}) };
  const parsed = podcastSettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : podcastSettingsSchema.parse({});
}

/** Audio assets a render needs: every audio-clip of the composition (both modes) plus, for podcasts, the intro and outro. */
export function referencedAudioAssetIds(definition: { composition?: { items?: ReadonlyArray<{ type: string; assetId?: string }> } }, settings?: Pick<PodcastSettings, "introAssetId" | "outroAssetId">): string[] {
  const ids = new Set<string>();
  for (const item of definition.composition?.items ?? []) if (item.type === "audio-clip" && item.assetId) ids.add(item.assetId);
  if (settings?.introAssetId) ids.add(settings.introAssetId);
  if (settings?.outroAssetId) ids.add(settings.outroAssetId);
  return [...ids];
}
