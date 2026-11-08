import type { YouTubeVideoResource } from "@/domain/youtube-publish";
import type { YouTubeClient } from "@/integrations/youtube-api";

export type YouTubePublishInput = {
  filePath: string;
  thumbnailPath?: string;
  resource: YouTubeVideoResource;
  notifySubscribers?: boolean;
  playlistId?: string;
  /** Session URL stored by an earlier, interrupted attempt of the same publication. */
  sessionUrl?: string | null;
};

export type YouTubePublishDeps = {
  client: Pick<YouTubeClient, "uploadVideo" | "setThumbnail" | "addToPlaylist">;
  /** Stores (or clears) the upload session so a restarted worker resumes instead of uploading twice. */
  saveSession(url: string | null): Promise<void>;
  /** Upload progress, 0..100 (called when the whole percent changes). */
  progress(percent: number): Promise<void>;
  log(level: "INFO" | "WARN", message: string, data?: Record<string, unknown>): Promise<void> | void;
};

/**
 * Uploads the video (resumable, chunked), then the thumbnail and the playlist entry. Once the video is on YouTube
 * nothing may fail the publication (a retry would upload it twice): the side steps fail soft and come back as warnings.
 */
export async function publishVideoToYouTube(input: YouTubePublishInput, deps: YouTubePublishDeps): Promise<{ videoId: string; warnings: string[]; resumed: boolean }> {
  let lastPercent = -1;
  const { videoId, resumed } = await deps.client.uploadVideo({
    filePath: input.filePath, resource: input.resource, notifySubscribers: input.notifySubscribers, sessionUrl: input.sessionUrl,
    onSession: url => deps.saveSession(url),
    onProgress: async (sent, total) => {
      const percent = total ? Math.floor((sent / total) * 100) : 100;
      if (percent !== lastPercent) { lastPercent = percent; await deps.progress(percent); }
    },
  });
  if (resumed) await deps.log("INFO", "Continued an interrupted YouTube upload", { videoId });
  await deps.saveSession(null);
  const warnings: string[] = [];
  const soft = async (what: string, run: () => Promise<unknown>) => {
    try { await run(); await deps.log("INFO", `YouTube ${what} done`, { videoId }); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(message);
      try { await deps.log("WARN", `YouTube ${what} failed; the video itself was published`, { videoId, error: message }); } catch { /* logging must not fail the publication */ }
    }
  };
  if (input.thumbnailPath) await soft("thumbnail upload", () => deps.client.setThumbnail(videoId, input.thumbnailPath!));
  if (input.playlistId) await soft("playlist insert", () => deps.client.addToPlaylist(videoId, input.playlistId!));
  return { videoId, warnings, resumed };
}
