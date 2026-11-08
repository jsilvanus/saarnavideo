import { open, readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import type { YouTubeVideoResource } from "@/domain/youtube-publish";

/**
 * YouTube Data API v3 calls used for publishing: the resumable videos.insert upload (chunked, resumable after a network
 * error or a worker restart), thumbnails.set, playlistItems.insert and playlists.list.
 * The access token comes from a supplier so a 401 can force one refresh; transient answers (429, 5xx, network errors)
 * are retried with exponential backoff. Errors carry Google's reason (quotaExceeded, uploadLimitExceeded, ...).
 */

/** Base URL of the YouTube Data API; overridable for tests (e2e points it at a fake server). */
export const youtubeApiBase = () => (process.env.YOUTUBE_API_BASE_URL?.trim() || "https://www.googleapis.com").replace(/\/+$/, "");

const CHUNK_UNIT = 256 * 1024;
export const DEFAULT_CHUNK_BYTES = 32 * CHUNK_UNIT; // 8 MiB
export const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;

/** Chunk size from YOUTUBE_UPLOAD_CHUNK_BYTES: a multiple of 256 KiB (YouTube requires it for every chunk but the last). */
export function chunkBytesFromEnv(value = process.env.YOUTUBE_UPLOAD_CHUNK_BYTES): number {
  const n = Number(value);
  if (!value || !Number.isFinite(n) || n <= 0) return DEFAULT_CHUNK_BYTES;
  return Math.max(CHUNK_UNIT, Math.floor(n / CHUNK_UNIT) * CHUNK_UNIT);
}

const HINTS: Record<string, string> = {
  quotaExceeded: "the project's daily YouTube API quota is used up; it resets at midnight Pacific time",
  uploadLimitExceeded: "the channel has reached YouTube's upload limit for now; try again later",
  authError: "reconnect the YouTube account",
  insufficientPermissions: "the YouTube connection lacks a permission; disconnect and connect the account again",
  forbidden: "the YouTube account is not allowed to do this",
  playlistNotFound: "the playlist does not exist or belongs to another channel",
  videoNotFound: "the uploaded video was not found",
};

export class YouTubeApiError extends Error {
  constructor(message: string, readonly status: number, readonly reason?: string) { super(message); this.name = "YouTubeApiError"; }
}

/** Turns a failed response into a readable error: "<what> failed (403): quotaExceeded: The request cannot... (hint)". */
export async function youtubeError(response: Response, what: string): Promise<YouTubeApiError> {
  const text = await response.text().catch(() => "");
  let reason: string | undefined; let message = text.slice(0, 1000);
  try {
    const body = JSON.parse(text) as { error?: { message?: string; errors?: Array<{ reason?: string }> } | string; error_description?: string };
    if (body.error && typeof body.error === "object") { reason = body.error.errors?.[0]?.reason; message = body.error.message ?? message; }
    else if (typeof body.error === "string") { reason = body.error; message = body.error_description ?? body.error; }
  } catch { /* not JSON: keep the text */ }
  const hint = reason ? HINTS[reason] : response.status === 401 ? HINTS.authError : undefined;
  return new YouTubeApiError(`${what} failed (${response.status}): ${reason && !message.includes(reason) ? `${reason}: ` : ""}${message}${hint ? ` (${hint})` : ""}`, response.status, reason);
}

export type TokenSupplier = (forceRefresh?: boolean) => Promise<string>;
export type YouTubeClientOptions = {
  token: TokenSupplier;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** First backoff delay; doubles per retry (default 1000 ms, YOUTUBE_RETRY_DELAY_MS). */
  retryDelayMs?: number;
  maxRetries?: number;
  chunkBytes?: number;
  baseUrl?: string;
};

const TRANSIENT = new Set([429, 500, 502, 503, 504]);
const isTransient = (status: number) => TRANSIENT.has(status);

export type VideoUploadInput = {
  filePath: string;
  resource: YouTubeVideoResource;
  notifySubscribers?: boolean;
  /** Upload session of an earlier, interrupted attempt; the upload continues from where YouTube says it stopped. */
  sessionUrl?: string | null;
  /** Called with a new session URL before any bytes are sent, so it can be stored for a resume after a restart. */
  onSession?: (url: string) => Promise<void> | void;
  onProgress?: (sentBytes: number, totalBytes: number) => Promise<void> | void;
};

type SessionStatus = { done: string } | { offset: number } | { expired: true };

export function createYouTubeClient(options: YouTubeClientOptions) {
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const retryDelayMs = options.retryDelayMs ?? Number(process.env.YOUTUBE_RETRY_DELAY_MS ?? 1000);
  const maxRetries = options.maxRetries ?? 6;
  const chunkBytes = options.chunkBytes ?? chunkBytesFromEnv();
  const base = () => (options.baseUrl ?? youtubeApiBase()).replace(/\/+$/, "");
  const backoff = (attempt: number) => sleep(Math.min(retryDelayMs * 2 ** attempt, 64_000));

  /** One API call with the current token: a 401 refreshes the token once, transient answers are retried. */
  async function call(what: string, make: (token: string) => [string, RequestInit]): Promise<Response> {
    let refreshed = false; let force = false;
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        const [url, init] = make(await options.token(force)); force = false;
        response = await doFetch(url, init);
      } catch (error) {
        if (error instanceof YouTubeApiError || attempt >= maxRetries) throw error;
        await backoff(attempt); continue;
      }
      if (response.ok || response.status === 308) return response;
      if (response.status === 401 && !refreshed) { refreshed = true; force = true; await response.body?.cancel().catch(() => undefined); continue; }
      if (isTransient(response.status) && attempt < maxRetries) { await response.body?.cancel().catch(() => undefined); await backoff(attempt); continue; }
      throw await youtubeError(response, what);
    }
  }

  async function startVideoSession(input: VideoUploadInput, size: number): Promise<string> {
    const notify = input.notifySubscribers === false ? "&notifySubscribers=false" : "";
    const response = await call("YouTube upload initialization", token => [`${base()}/upload/youtube/v3/videos?part=snippet,status&uploadType=resumable${notify}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(size) }, body: JSON.stringify(input.resource) }]);
    const url = response.headers.get("location");
    await response.body?.cancel().catch(() => undefined);
    if (!url) throw new YouTubeApiError("YouTube did not return an upload URL", response.status);
    return url;
  }

  async function finished(response: Response): Promise<string> {
    const result = await response.json().catch(() => ({})) as { id?: string };
    if (!result.id) throw new YouTubeApiError("YouTube upload response did not contain a video ID", response.status);
    return result.id;
  }

  const confirmedOffset = (response: Response) => {
    const range = response.headers.get("range")?.match(/bytes=0-(\d+)/);
    return range ? Number(range[1]) + 1 : 0;
  };

  /** Asks an upload session how far it got (PUT with "bytes * /size"). */
  async function sessionStatus(sessionUrl: string, size: number): Promise<SessionStatus> {
    let force = false;
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await doFetch(sessionUrl, { method: "PUT", headers: { Authorization: `Bearer ${await options.token(force)}`, "Content-Range": `bytes */${size}`, "Content-Length": "0" } });
      } catch (error) { if (attempt >= maxRetries) throw error; await backoff(attempt); continue; }
      if (response.status === 200 || response.status === 201) return { done: await finished(response) };
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 308) return { offset: confirmedOffset(response) };
      if (response.status === 404 || response.status === 410) return { expired: true };
      if ((isTransient(response.status) || response.status === 401) && attempt < maxRetries) { force = response.status === 401; await backoff(attempt); continue; }
      throw await youtubeError(response, "YouTube upload status");
    }
  }

  /** videos.insert as a chunked resumable upload. Returns the video id; `resumed` when an earlier session was continued. */
  async function uploadVideo(input: VideoUploadInput): Promise<{ videoId: string; resumed: boolean }> {
    const size = (await stat(input.filePath)).size;
    let session = input.sessionUrl ?? null;
    let offset = 0;
    let resumed = false;
    if (session) {
      const status = await sessionStatus(session, size);
      if ("done" in status) return { videoId: status.done, resumed: true };
      if ("expired" in status) session = null; else { offset = status.offset; resumed = true; }
    }
    if (!session) { session = await startVideoSession(input, size); await input.onSession?.(session); }
    const file = await open(input.filePath, "r");
    try {
      let failures = 0; let refreshed = false; let force = false; let restarts = 0;
      while (true) {
        const length = Math.min(chunkBytes, size - offset);
        const chunk = Buffer.alloc(length);
        if (length) await file.read(chunk, 0, length, offset);
        let response: Response | null = null;
        try {
          response = await doFetch(session, { method: "PUT", headers: { Authorization: `Bearer ${await options.token(force)}`, "Content-Type": "video/mp4", "Content-Length": String(length), "Content-Range": length ? `bytes ${offset}-${offset + length - 1}/${size}` : `bytes */${size}` }, body: chunk });
        } catch { response = null; }
        force = false;
        if (response && (response.status === 200 || response.status === 201)) { await input.onProgress?.(size, size); return { videoId: await finished(response), resumed }; }
        if (response?.status === 308) {
          await response.body?.cancel().catch(() => undefined);
          offset = confirmedOffset(response); failures = 0; refreshed = false;
          await input.onProgress?.(offset, size);
          continue;
        }
        if (response?.status === 401 && !refreshed) { await response.body?.cancel().catch(() => undefined); refreshed = true; force = true; continue; }
        if (response && (response.status === 404 || response.status === 410) && restarts < 1) {
          // The session expired (they live about a week): nothing is on YouTube yet, so start over once.
          await response.body?.cancel().catch(() => undefined);
          restarts++; session = await startVideoSession(input, size); await input.onSession?.(session); offset = 0; resumed = false;
          continue;
        }
        if (response && !isTransient(response.status)) throw await youtubeError(response, "YouTube video upload");
        if (failures >= maxRetries) throw response ? await youtubeError(response, "YouTube video upload") : new YouTubeApiError("YouTube video upload failed: network error, retries used up", 0);
        await response?.body?.cancel().catch(() => undefined);
        await backoff(failures++);
        // Ask how much arrived before sending more: a lost answer may hide a completed upload.
        const status = await sessionStatus(session, size);
        if ("done" in status) { await input.onProgress?.(size, size); return { videoId: status.done, resumed }; }
        if ("expired" in status) throw new YouTubeApiError("YouTube upload session expired during the upload", 410);
        offset = status.offset;
      }
    } finally { await file.close(); }
  }

  /** thumbnails.set; JPEG or PNG up to 2 MB. The channel must be verified for custom thumbnails. */
  async function setThumbnail(videoId: string, filePath: string): Promise<void> {
    const bytes = await readFile(filePath);
    if (bytes.length > MAX_THUMBNAIL_BYTES) throw new YouTubeApiError(`YouTube thumbnail upload skipped: the image is ${(bytes.length / 1048576).toFixed(1)} MB, YouTube allows 2 MB`, 413);
    const type = extname(filePath).toLowerCase() === ".png" ? "image/png" : "image/jpeg";
    await call("YouTube thumbnail upload", token => [`${base()}/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": type, "Content-Length": String(bytes.length) }, body: bytes }]);
  }

  /** playlistItems.insert: appends the video to a playlist of the connected channel. */
  async function addToPlaylist(videoId: string, playlistId: string): Promise<{ playlistItemId: string }> {
    const response = await call("YouTube playlist insert", token => [`${base()}/youtube/v3/playlistItems?part=snippet`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" }, body: JSON.stringify({ snippet: { playlistId, resourceId: { kind: "youtube#video", videoId } } }) }]);
    const body = await response.json().catch(() => ({})) as { id?: string };
    return { playlistItemId: body.id ?? "" };
  }

  /** playlists.list mine=true (up to 250 playlists). */
  async function listPlaylists(): Promise<Array<{ id: string; title: string; privacyStatus?: string; itemCount?: number }>> {
    const out: Array<{ id: string; title: string; privacyStatus?: string; itemCount?: number }> = [];
    let pageToken = "";
    for (let page = 0; page < 5; page++) {
      const response = await call("YouTube playlist list", token => [`${base()}/youtube/v3/playlists?part=snippet,status,contentDetails&mine=true&maxResults=50${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`, { headers: { Authorization: `Bearer ${token}` } }]);
      const body = await response.json() as { nextPageToken?: string; items?: Array<{ id: string; snippet?: { title?: string }; status?: { privacyStatus?: string }; contentDetails?: { itemCount?: number } }> };
      for (const item of body.items ?? []) out.push({ id: item.id, title: item.snippet?.title ?? item.id, privacyStatus: item.status?.privacyStatus, itemCount: item.contentDetails?.itemCount });
      if (!body.nextPageToken) break;
      pageToken = body.nextPageToken;
    }
    return out;
  }

  return { uploadVideo, setThumbnail, addToPlaylist, listPlaylists, sessionStatus };
}

export type YouTubeClient = ReturnType<typeof createYouTubeClient>;
