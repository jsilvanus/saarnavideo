import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type YouTubeSource = {
  videoId: string;
  url: string;
};

export async function downloadYouTubeSource(source: YouTubeSource, outputPath: string): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const child = spawn("yt-dlp", [
      "--no-playlist",
      "--format", "bv*+ba/b",
      "--merge-output-format", "mp4",
      "--no-progress",
      "--output", outputPath,
      source.url,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`yt-dlp failed (${code}): ${stderr.slice(-4000)}`)));
  });
}

export type YouTubeUpload = {
  accessToken: string;
  filePath: string;
  title: string;
  description?: string;
  privacyStatus?: "private" | "unlisted" | "public";
};

/**
 * Upload implementation is deliberately kept behind this integration boundary.
 * The Data API client is added in the OAuth/publication phase; this function
 * currently fails explicitly rather than silently claiming an upload succeeded.
 */
export async function uploadToYouTube(_input: YouTubeUpload): Promise<never> {
  throw new Error("YouTube publishing is not enabled until OAuth credentials are configured");
}
