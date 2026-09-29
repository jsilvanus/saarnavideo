import { toYouTubeLanguage } from "@/domain/captions";

export type SidecarCaption = { storagePath: string; language: string | null };
export type CaptionPublishDeps = {
  /** The SRT sidecar rendered by the same job as the published video, if it still exists. */
  findSidecar(jobId: string): Promise<SidecarCaption | null>;
  getAccessToken(): Promise<string>;
  upload(input: { accessToken: string; videoId: string; filePath: string; language: string; name: string }): Promise<{ captionId: string }>;
  log(jobId: string | null, level: "INFO" | "WARN", message: string, data?: Record<string, unknown>): Promise<void> | void;
};

/** Human-readable track name in the track's own language ("suomi" for fi). */
export function captionTrackName(language: string): string {
  try { return new Intl.DisplayNames([language], { type: "language" }).of(language) ?? language; } catch { return language; }
}

/**
 * Uploads the sidecar caption track of a published video. Fails soft: any problem (no sidecar, unknown
 * language, missing OAuth scope, API error) is logged and never throws, so it cannot fail the video publication.
 */
export async function uploadCaptionsAfterVideo(input: { videoId: string; videoOutput: { jobId: string | null } }, deps: CaptionPublishDeps): Promise<{ uploaded: boolean }> {
  const jobId = input.videoOutput.jobId;
  try {
    if (!jobId) return { uploaded: false };
    const sidecar = await deps.findSidecar(jobId);
    if (!sidecar) return { uploaded: false };
    const language = toYouTubeLanguage(sidecar.language);
    if (!language) { await deps.log(jobId, "WARN", "Skipped YouTube caption upload: caption language is unknown", { videoId: input.videoId }); return { uploaded: false }; }
    const result = await deps.upload({ accessToken: await deps.getAccessToken(), videoId: input.videoId, filePath: sidecar.storagePath, language, name: captionTrackName(language) });
    await deps.log(jobId, "INFO", "Uploaded YouTube caption track", { videoId: input.videoId, captionId: result.captionId, language });
    return { uploaded: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try { await deps.log(jobId, "WARN", "YouTube caption upload failed; the video itself was published", { videoId: input.videoId, error: message }); } catch { /* logging must not fail the publication */ }
    return { uploaded: false };
  }
}
