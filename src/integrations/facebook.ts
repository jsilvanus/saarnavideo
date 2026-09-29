import { open, readFile, stat } from "node:fs/promises";

/**
 * Facebook Page video publishing through the Graph API (single Page, configured through environment variables).
 * The Page access token is never stored in the database and never appears in errors or logs: it travels in the request
 * body only and is scrubbed from every message built here.
 */

export type FacebookConfig = { pageId: string; accessToken: string; version: string; baseUrl: string; videoBaseUrl: string };

export const DEFAULT_GRAPH_VERSION = "v24.0";
const DEFAULT_GRAPH_BASE_URL = "https://graph.facebook.com";
const DEFAULT_GRAPH_VIDEO_BASE_URL = "https://graph-video.facebook.com";

/** The configured Page, or null when FACEBOOK_PAGE_ID / FACEBOOK_PAGE_ACCESS_TOKEN are not both set. */
export function readFacebookConfig(env: Record<string, string | undefined> = process.env): FacebookConfig | null {
  const pageId = env.FACEBOOK_PAGE_ID?.trim();
  const accessToken = env.FACEBOOK_PAGE_ACCESS_TOKEN?.trim();
  if (!pageId || !accessToken) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(pageId)) throw new Error("FACEBOOK_PAGE_ID must be the numeric Page ID");
  const baseOverride = env.FACEBOOK_GRAPH_BASE_URL?.trim().replace(/\/+$/, "");
  const version = env.FACEBOOK_GRAPH_VERSION?.trim() || DEFAULT_GRAPH_VERSION;
  const baseUrl = baseOverride || DEFAULT_GRAPH_BASE_URL;
  const videoBaseUrl = env.FACEBOOK_GRAPH_VIDEO_BASE_URL?.trim().replace(/\/+$/, "") || baseOverride || DEFAULT_GRAPH_VIDEO_BASE_URL;
  return { pageId, accessToken, version: /^v\d+\.\d+$/.test(version) ? version : DEFAULT_GRAPH_VERSION, baseUrl, videoBaseUrl };
}

type GraphErrorBody = { error?: { message?: string; type?: string; code?: number; error_subcode?: number; fbtrace_id?: string; error_user_msg?: string } };

export class FacebookApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: number, readonly subcode?: number, readonly retryable = false) {
    super(message);
    this.name = "FacebookApiError";
  }
}

/** Readable message for a Graph API error response. Well-known codes get an explanation and the fix. */
export function describeGraphError(status: number, body: unknown): { message: string; code?: number; subcode?: number } {
  const error = (body as GraphErrorBody | null)?.error;
  if (!error) return { message: `Facebook request failed (HTTP ${status})` };
  const { code, error_subcode: subcode } = error;
  const detail = error.error_user_msg || error.message || "no details";
  const trace = error.fbtrace_id ? ` [trace ${error.fbtrace_id}]` : "";
  let message: string;
  if (code === 190) {
    message = subcode === 463 || /expired/i.test(detail)
      ? "The Facebook Page access token has expired (code 190). Create a new long-lived Page access token and update FACEBOOK_PAGE_ACCESS_TOKEN."
      : "The Facebook Page access token is invalid or was revoked (code 190). Create a new Page access token and update FACEBOOK_PAGE_ACCESS_TOKEN.";
  } else if (code === 102) message = "The Facebook session is no longer valid (code 102). Create a new Page access token and update FACEBOOK_PAGE_ACCESS_TOKEN.";
  else if (code === 10 || (code !== undefined && code >= 200 && code < 300)) message = `Facebook denied the request because a permission is missing (code ${code}): ${detail}. The token needs pages_manage_posts and pages_read_engagement for this Page.`;
  else if (code === 4 || code === 17 || code === 32 || code === 341 || code === 613) message = `Facebook rate limit reached (code ${code}); try again later. ${detail}`;
  else if (code === 368) message = `Facebook has temporarily blocked publishing for this Page (code 368): ${detail}`;
  else if (code === 100) message = `Facebook rejected a request parameter (code 100): ${detail}`;
  else message = `Facebook API error (code ${code ?? "unknown"}, HTTP ${status}): ${detail}`;
  return { message: message + trace, code, subcode };
}

export type FacebookClientOptions = { fetchTimeoutMs?: number; retries?: number; retryDelayMs?: number };

function scrub(text: string, token: string): string {
  return token ? text.split(token).join("[token]") : text;
}

async function sleep(ms: number) { await new Promise((resolve) => setTimeout(resolve, ms)); }

/** One Graph API call. `params` go into the form body together with the token (GET: query string, as the Graph API documents). Throws FacebookApiError. */
async function graph(config: FacebookConfig, method: "GET" | "POST", path: string, params: Record<string, string | Blob | { blob: Blob; filename: string }>, options: FacebookClientOptions & { video?: boolean } = {}): Promise<Record<string, unknown>> {
  const base = options.video ? config.videoBaseUrl : config.baseUrl;
  const url = `${base}/${config.version}/${path}`;
  const timeout = AbortSignal.timeout(options.fetchTimeoutMs ?? 120_000);
  let response: Response;
  try {
    if (method === "GET") {
      const query = new URLSearchParams({ access_token: config.accessToken, ...Object.fromEntries(Object.entries(params).filter((entry): entry is [string, string] => typeof entry[1] === "string")) });
      response = await fetch(`${url}?${query}`, { method, signal: timeout });
    } else {
      const form = new FormData();
      form.set("access_token", config.accessToken);
      for (const [key, value] of Object.entries(params)) {
        if (typeof value === "string") form.set(key, value);
        else if (value instanceof Blob) form.set(key, value);
        else form.set(key, value.blob, value.filename);
      }
      response = await fetch(url, { method, body: form, signal: timeout });
    }
  } catch (error) {
    const reason = error instanceof Error ? (error.name === "TimeoutError" ? "the request timed out" : error.message) : String(error);
    throw new FacebookApiError(scrub(`Could not reach Facebook (${reason})`, config.accessToken), 0, undefined, undefined, true);
  }
  const text = await response.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!response.ok || (body && typeof body === "object" && "error" in body)) {
    const described = describeGraphError(response.status, body);
    throw new FacebookApiError(scrub(described.message, config.accessToken), response.status, described.code, described.subcode, response.status >= 500);
  }
  return (body ?? {}) as Record<string, unknown>;
}

async function withRetry<T>(fn: () => Promise<T>, options: FacebookClientOptions): Promise<T> {
  const attempts = (options.retries ?? 2) + 1;
  for (let attempt = 1; ; attempt++) {
    try { return await fn(); } catch (error) {
      if (attempt >= attempts || !(error instanceof FacebookApiError) || !error.retryable) throw error;
      await sleep((options.retryDelayMs ?? 1000) * attempt);
    }
  }
}

/** Name of the configured Page (also proves the token works). */
export async function getFacebookPageName(config: FacebookConfig, options: FacebookClientOptions = {}): Promise<string> {
  const page = await graph(config, "GET", config.pageId, { fields: "name" }, { ...options, fetchTimeoutMs: options.fetchTimeoutMs ?? 15_000 });
  return typeof page.name === "string" ? page.name : config.pageId;
}

export type FacebookUpload = {
  filePath: string;
  title: string;
  description?: string;
  /** true publishes immediately; false leaves the video unpublished (visible to Page admins only). */
  published: boolean;
  onProgress?: (sentBytes: number, totalBytes: number) => void;
};

export type FacebookUploadResult = { videoId: string; chunks: number; bytes: number };

const toNumber = (value: unknown, name: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new FacebookApiError(`Facebook returned an invalid ${name}`, 200);
  return parsed;
};

/**
 * Resumable upload (upload_phase start / transfer / finish). Facebook dictates the chunk boundaries: each transfer
 * response names the next [start_offset, end_offset) and the client sends exactly that slice.
 */
export async function uploadVideoToFacebook(config: FacebookConfig, input: FacebookUpload, options: FacebookClientOptions = {}): Promise<FacebookUploadResult> {
  const size = (await stat(input.filePath)).size;
  if (size === 0) throw new Error("The video file is empty");
  const path = `${config.pageId}/videos`;
  const start = await graph(config, "POST", path, { upload_phase: "start", file_size: String(size) }, { ...options, video: true });
  const sessionId = String(start.upload_session_id ?? "");
  const videoId = String(start.video_id ?? "");
  if (!sessionId || !videoId) throw new FacebookApiError("Facebook did not return an upload session", 200);
  let startOffset = toNumber(start.start_offset, "start_offset");
  let endOffset = toNumber(start.end_offset, "end_offset");
  let chunks = 0;
  const handle = await open(input.filePath, "r");
  try {
    while (startOffset < endOffset) {
      if (endOffset > size) throw new FacebookApiError("Facebook asked for bytes beyond the end of the file", 200);
      const buffer = Buffer.alloc(endOffset - startOffset);
      await handle.read(buffer, 0, buffer.length, startOffset);
      const next = await withRetry(() => graph(config, "POST", path, { upload_phase: "transfer", upload_session_id: sessionId, start_offset: String(startOffset), video_file_chunk: { blob: new Blob([buffer]), filename: "chunk.mp4" } }, { ...options, video: true }), options);
      chunks++;
      const nextStart = toNumber(next.start_offset, "start_offset");
      const nextEnd = toNumber(next.end_offset, "end_offset");
      if (nextStart <= startOffset && nextStart < size) throw new FacebookApiError("Facebook did not accept the uploaded chunk", 200);
      startOffset = nextStart; endOffset = nextEnd;
      input.onProgress?.(startOffset, size);
    }
  } finally { await handle.close(); }
  const finish = await graph(config, "POST", path, {
    upload_phase: "finish", upload_session_id: sessionId, title: input.title, description: input.description ?? "", published: input.published ? "true" : "false",
  }, { ...options, video: true });
  if (finish.success === false) throw new FacebookApiError("Facebook did not accept the finished upload", 200);
  return { videoId, chunks, bytes: size };
}

export type FacebookVideoStatus = { state: "processing" | "ready" | "error"; detail?: string };

export async function getFacebookVideoStatus(config: FacebookConfig, videoId: string, options: FacebookClientOptions = {}): Promise<FacebookVideoStatus> {
  const video = await withRetry(() => graph(config, "GET", videoId, { fields: "status" }, options), options);
  const status = (video.status ?? {}) as { video_status?: string; processing_phase?: { error?: { message?: string } } };
  if (status.video_status === "ready") return { state: "ready" };
  if (status.video_status === "error") return { state: "error", detail: status.processing_phase?.error?.message };
  return { state: "processing" };
}

/** Polls until the video is ready. Throws when Facebook reports a processing error or the timeout elapses. */
export async function waitForFacebookVideo(config: FacebookConfig, videoId: string, options: FacebookClientOptions & { pollIntervalMs?: number; timeoutMs?: number } = {}): Promise<void> {
  const deadline = Date.now() + (options.timeoutMs ?? 30 * 60_000);
  for (;;) {
    const status = await getFacebookVideoStatus(config, videoId, options);
    if (status.state === "ready") return;
    if (status.state === "error") throw new FacebookApiError(`Facebook could not process the video${status.detail ? `: ${status.detail}` : ""}`, 200);
    if (Date.now() >= deadline) throw new FacebookApiError(`Facebook is still processing the video after ${Math.round((options.timeoutMs ?? 30 * 60_000) / 60_000)} minutes. It may still appear in the Page's video library; check there before publishing again.`, 200);
    await sleep(options.pollIntervalMs ?? 5000);
  }
}

/** Sets the video's preferred thumbnail (JPEG/PNG). */
export async function uploadFacebookThumbnail(config: FacebookConfig, videoId: string, filePath: string, options: FacebookClientOptions = {}): Promise<void> {
  const bytes = await readFile(filePath);
  await graph(config, "POST", `${videoId}/thumbnails`, { source: { blob: new Blob([bytes], { type: "image/jpeg" }), filename: "thumbnail.jpg" }, is_preferred: "true" }, options);
}

/** Locale in Facebook's language_COUNTRY form ("fi" -> "fi_FI"); undefined when unknown. */
export function toFacebookLocale(tag: string | null | undefined): string | undefined {
  if (!tag) return undefined;
  const [language, region] = tag.replace("_", "-").split("-");
  const primary = language.toLowerCase();
  if (region && /^[A-Za-z]{2}$/.test(region)) return `${primary}_${region.toUpperCase()}`;
  const defaults: Record<string, string> = { fi: "fi_FI", sv: "sv_SE", en: "en_US", et: "et_EE", de: "de_DE", ru: "ru_RU", no: "nb_NO", nb: "nb_NO", da: "da_DK", fr: "fr_FR", es: "es_LA", it: "it_IT", pt: "pt_PT", pl: "pl_PL", uk: "uk_UA", ar: "ar_AR", nl: "nl_NL", hu: "hu_HU", cs: "cs_CZ", lv: "lv_LV", lt: "lt_LT", is: "is_IS", sk: "sk_SK", se: "se_NO" };
  return defaults[primary];
}

/**
 * Attaches an SRT file as a caption track. Facebook reads the locale from the file name (`video.fi_FI.srt`), so the
 * name is built from `locale`; `default_locale` is sent as well.
 */
export async function uploadFacebookCaption(config: FacebookConfig, input: { videoId: string; filePath: string; locale: string }, options: FacebookClientOptions = {}): Promise<void> {
  const bytes = await readFile(input.filePath);
  await graph(config, "POST", `${input.videoId}/captions`, {
    captions_file: { blob: new Blob([bytes], { type: "application/x-subrip" }), filename: `video.${input.locale}.srt` },
    default_locale: input.locale,
  }, options);
}
