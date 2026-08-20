import { spawn } from "node:child_process";
import { mkdir, stat, readFile } from "node:fs/promises";
import { dirname } from "node:path";

export type YouTubeSource = { videoId: string; url: string };

export async function downloadYouTubeSource(source: YouTubeSource, outputPath: string): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const child = spawn("yt-dlp", ["--no-playlist", "--format", "bv*+ba/b", "--merge-output-format", "mp4", "--no-progress", "--output", outputPath, source.url], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`yt-dlp failed (${code}): ${stderr.slice(-4000)}`)));
  });
}

export type YouTubeUpload = {
  accessToken: string;
  filePath: string;
  thumbnailPath?: string;
  title: string;
  description?: string;
  privacyStatus?: "private" | "unlisted" | "public";
};

export async function uploadToYouTube(input: YouTubeUpload): Promise<{ videoId: string }> {
  const size = (await stat(input.filePath)).size;
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?part=snippet,status&uploadType=resumable", {
    method: "POST",
    headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(size) },
    body: JSON.stringify({ snippet: { title: input.title, description: input.description ?? "" }, status: { privacyStatus: input.privacyStatus ?? "private" } }),
  });
  if (!init.ok) throw new Error(`YouTube upload initialization failed (${init.status}): ${await init.text()}`);
  const uploadUrl = init.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube did not return an upload URL");
  const video = await readFile(input.filePath);
  const upload = await fetch(uploadUrl, { method: "PUT", headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "video/mp4", "Content-Length": String(video.length) }, body: video });
  if (!upload.ok) throw new Error(`YouTube video upload failed (${upload.status}): ${await upload.text()}`);
  const result = await upload.json() as { id?: string };
  if (!result.id) throw new Error("YouTube upload response did not contain a video ID");
  if (input.thumbnailPath) {
    const thumbnail = await readFile(input.thumbnailPath);
    const thumb = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(result.id)}`, { method: "POST", headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "image/jpeg", "Content-Length": String(thumbnail.length) }, body: thumbnail });
    if (!thumb.ok) throw new Error(`YouTube thumbnail upload failed (${thumb.status}): ${await thumb.text()}`);
  }
  return { videoId: result.id };
}

export function youtubeVideoIdFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.hostname === "youtu.be") return url.pathname.slice(1).split("/")[0] || null;
    if (url.hostname === "youtube.com" || url.hostname.endsWith(".youtube.com")) {
      if (url.pathname === "/watch") return url.searchParams.get("v");
      for (const prefix of ["/shorts/", "/live/"]) if (url.pathname.startsWith(prefix)) return url.pathname.slice(prefix.length).split("/")[0] || null;
    }
  } catch { return null; }
  return null;
}
