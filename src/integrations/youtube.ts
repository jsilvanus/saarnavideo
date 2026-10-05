import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, stat, readFile } from "node:fs/promises";
import { dirname } from "node:path";

export type YouTubeSource = { videoId: string; url: string };
export type DownloadProgress = { percent: number; bytesProcessed?: bigint; totalBytes?: bigint; speed?: string; etaSeconds?: number };

export async function downloadYouTubeSource(source: YouTubeSource, outputPath: string, onProgress?: (progress: DownloadProgress) => Promise<void> | void, options: { cookiesFile?: string } = {}): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const child = spawn("yt-dlp", [...(options.cookiesFile ? ["--cookies", options.cookiesFile] : []), "--no-playlist", "--format", "bv*+ba/b", "--merge-output-format", "mp4", "--newline", "--progress", "--output", outputPath, source.url], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      const match = text.match(/(\d+(?:\.\d+)?)%.*?(?:(\d+(?:\.\d+)?)(?:MiB|MB)\/)?(?:.*?at\s+([^\s]+))?(?:.*?ETA\s+(\S+))?/);
      if (match) void onProgress?.({ percent: Math.max(0, Math.min(100, Number(match[1]))), speed: match[3], etaSeconds: parseEta(match[4]) });
    });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`yt-dlp failed (${code}): ${stderr.slice(-4000)}`)));
  });
}

function parseEta(value?: string): number | undefined {
  if (!value || value === "Unknown") return undefined;
  const parts = value.split(":").map(Number);
  if (parts.some(Number.isNaN)) return undefined;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

/** Base URL of the YouTube Data API; overridable for tests (e2e points it at a fake server). */
const youtubeApiBase = () => (process.env.YOUTUBE_API_BASE_URL?.trim() || "https://www.googleapis.com").replace(/\/+$/, "");

export type YouTubeUpload = { accessToken: string; filePath: string; thumbnailPath?: string; title: string; description?: string; privacyStatus?: "private" | "unlisted" | "public" };

export async function uploadToYouTube(input: YouTubeUpload): Promise<{ videoId: string; thumbnailError?: string }> {
  const size = (await stat(input.filePath)).size;
  const init = await fetch(`${youtubeApiBase()}/upload/youtube/v3/videos?part=snippet,status&uploadType=resumable`, { method: "POST", headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(size) }, body: JSON.stringify({ snippet: { title: input.title, description: input.description ?? "" }, status: { privacyStatus: input.privacyStatus ?? "private" } }) });
  if (!init.ok) throw new Error(`YouTube upload initialization failed (${init.status}): ${await init.text()}`);
  const uploadUrl = init.headers.get("location"); if (!uploadUrl) throw new Error("YouTube did not return an upload URL");
  const upload = await fetch(uploadUrl, { method: "PUT", headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "video/mp4", "Content-Length": String(size) }, body: createReadStream(input.filePath) as unknown as BodyInit, duplex: "half" } as RequestInit & { duplex: "half" });
  if (!upload.ok) throw new Error(`YouTube video upload failed (${upload.status}): ${await upload.text()}`);
  const result = await upload.json() as { id?: string }; if (!result.id) throw new Error("YouTube upload response did not contain a video ID");
  // The video is already on YouTube here: a failed thumbnail must not fail the publication (a retry would upload the video twice).
  let thumbnailError: string | undefined;
  if (input.thumbnailPath) {
    try {
      const thumbnail = await readFile(input.thumbnailPath);
      const thumb = await fetch(`${youtubeApiBase()}/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(result.id)}`, { method: "POST", headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "image/jpeg", "Content-Length": String(thumbnail.length) }, body: thumbnail });
      if (!thumb.ok) throw new Error(`YouTube thumbnail upload failed (${thumb.status}): ${await thumb.text()}`);
    } catch (error) {
      thumbnailError = error instanceof Error ? error.message : String(error);
    }
  }
  return { videoId: result.id, thumbnailError };
}

export function youtubeVideoIdFromUrl(value: string): string | null {
  try { const url = new URL(value); if (url.hostname === "youtu.be") return url.pathname.slice(1).split("/")[0] || null; if (url.hostname === "youtube.com" || url.hostname.endsWith(".youtube.com")) { if (url.pathname === "/watch") return url.searchParams.get("v"); for (const prefix of ["/shorts/", "/live/"]) if (url.pathname.startsWith(prefix)) return url.pathname.slice(prefix.length).split("/")[0] || null; } } catch { return null; }
  return null;
}

export type YouTubeCaptionUpload = { accessToken: string; videoId: string; filePath: string; language: string; name: string };

/** captions.insert (resumable): attaches an SRT/VTT file to an uploaded video as a published caption track. Needs the youtube.force-ssl scope. */
export async function uploadCaptionToYouTube(input: YouTubeCaptionUpload): Promise<{ captionId: string }> {
  const body = await readFile(input.filePath);
  const init = await fetch(`${youtubeApiBase()}/upload/youtube/v3/captions?part=snippet&uploadType=resumable`, { method: "POST", headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "application/octet-stream", "X-Upload-Content-Length": String(body.length) }, body: JSON.stringify({ snippet: { videoId: input.videoId, language: input.language, name: input.name, isDraft: false } }) });
  if (!init.ok) throw new Error(`YouTube caption upload initialization failed (${init.status}): ${await init.text()}`);
  const uploadUrl = init.headers.get("location"); if (!uploadUrl) throw new Error("YouTube did not return a caption upload URL");
  const upload = await fetch(uploadUrl, { method: "PUT", headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/octet-stream", "Content-Length": String(body.length) }, body });
  if (!upload.ok) throw new Error(`YouTube caption upload failed (${upload.status}): ${await upload.text()}`);
  const result = await upload.json() as { id?: string }; if (!result.id) throw new Error("YouTube caption response did not contain a caption ID");
  return { captionId: result.id };
}
