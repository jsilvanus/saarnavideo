import { toFacebookLocale, uploadFacebookCaption, uploadFacebookThumbnail, uploadVideoToFacebook, waitForFacebookVideo, type FacebookClientOptions, type FacebookConfig } from "@/integrations/facebook";
import type { SidecarCaption } from "@/worker/caption-publish";

export type FacebookPublishInput = {
  filePath: string;
  thumbnailPath?: string;
  title: string;
  description?: string;
  published: boolean;
  /** The SRT sidecar of the rendered job, when it has one. */
  sidecar: SidecarCaption | null;
};

export type FacebookPublishDeps = {
  config: FacebookConfig;
  log(level: "INFO" | "WARN", message: string, data?: Record<string, unknown>): Promise<void> | void;
  client?: FacebookClientOptions & { pollIntervalMs?: number; timeoutMs?: number };
};

export type FacebookPublishResult = { videoId: string; chunks: number; bytes: number; thumbnail: boolean; captions: boolean };

/**
 * Uploads the video, waits until Facebook has processed it, then adds the thumbnail and the caption track.
 * A failed upload or processing error throws (the publication fails); thumbnail and caption problems are logged as
 * warnings and never fail the publication.
 */
export async function publishVideoToFacebook(input: FacebookPublishInput, deps: FacebookPublishDeps): Promise<FacebookPublishResult> {
  const { config, client = {} } = deps;
  const upload = await uploadVideoToFacebook(config, { filePath: input.filePath, title: input.title, description: input.description, published: input.published }, client);
  await deps.log("INFO", "Uploaded video to Facebook; waiting for processing", { videoId: upload.videoId, chunks: upload.chunks, bytes: upload.bytes, published: input.published });
  await waitForFacebookVideo(config, upload.videoId, client);
  const soft = async (what: string, run: () => Promise<void>): Promise<boolean> => {
    try { await run(); return true; } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try { await deps.log("WARN", `Facebook ${what} failed; the video itself was published`, { videoId: upload.videoId, error: message }); } catch { /* logging must not fail the publication */ }
      return false;
    }
  };
  const thumbnail = input.thumbnailPath ? await soft("thumbnail upload", () => uploadFacebookThumbnail(config, upload.videoId, input.thumbnailPath!, client)) : false;
  let captions = false;
  if (input.sidecar) {
    const locale = toFacebookLocale(input.sidecar.language);
    if (!locale) await deps.log("WARN", "Skipped Facebook caption upload: caption language is unknown", { videoId: upload.videoId });
    else captions = await soft("caption upload", () => uploadFacebookCaption(config, { videoId: upload.videoId, filePath: input.sidecar!.storagePath, locale }, client));
  }
  await deps.log("INFO", "Facebook publication finished", { videoId: upload.videoId, thumbnail, captions });
  return { videoId: upload.videoId, chunks: upload.chunks, bytes: upload.bytes, thumbnail, captions };
}
