import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { inject } from "vitest";

const execFileAsync = promisify(execFile);

export const baseUrl = inject("baseUrl");
export const mediaRoot = inject("mediaRoot");
export const fixturesDir = inject("fixturesDir");
export const fixture = (name: string) => path.join(fixturesDir, name);

type Json = Record<string, any>;

export async function api<T = Json>(route: string, init?: RequestInit & { json?: unknown }, expectedStatus?: number): Promise<T> {
  const { json, ...rest } = init ?? {};
  const response = await fetch(`${baseUrl}${route}`, json === undefined ? rest : { ...rest, headers: { "Content-Type": "application/json" }, body: JSON.stringify(json) });
  const text = await response.text();
  if (expectedStatus !== undefined ? response.status !== expectedStatus : !response.ok) {
    throw new Error(`${init?.method ?? "GET"} ${route} -> ${response.status}: ${text}`);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function createProject(title: string) {
  return api<{ id: string }>("/api/projects", { method: "POST", json: { title, templateKey: "basic" } });
}

export async function uploadSource(projectId: string, fileName: string, durationMs = 5000) {
  const form = new FormData();
  form.set("file", new Blob([await readFile(fixture(fileName))], { type: "video/mp4" }), fileName);
  form.set("durationMs", String(durationMs));
  return api<{ id: string }>(`/api/projects/${projectId}/source`, { method: "POST", body: form });
}

export async function uploadAsset(projectId: string, fileName: string, assetKey: string) {
  const form = new FormData();
  form.set("file", new Blob([await readFile(fixture(fileName))], { type: "image/png" }), fileName);
  form.set("assetKey", assetKey);
  form.set("type", "OVERLAY");
  return api<{ id: string }>(`/api/projects/${projectId}/assets`, { method: "POST", body: form });
}

export type Item = Record<string, unknown> & { type: "source-clip" | "overlay" | "slate" | "audio-clip" };

export async function setComposition(projectId: string, items: Item[], endSeconds = 10) {
  const definition = {
    version: 1,
    semanticSegments: [],
    sections: [],
    graphics: [],
    template: { key: "basic", width: 1920, height: 1080, fps: 30, backgroundColor: "black", textColor: "white" },
    composition: { sourceStartSeconds: 0, sourceEndSeconds: endSeconds, items },
  };
  return api(`/api/projects/${projectId}`, { method: "PATCH", json: { definition } });
}

type Job = { id: string; type: string; status: string; error: string | null };

export async function waitForJob(projectId: string, jobId: string, timeoutMs = 120_000): Promise<Job> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = await api<Job>(`/api/projects/${projectId}/jobs/${jobId}`);
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(job.status)) return job;
    if (Date.now() > deadline) throw new Error(`Job ${jobId} still ${job.status} after ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

/** Queues a render, waits for it and returns the downloaded output file. */
export async function render(projectId: string, type: "VIDEO" | "PREVIEW" = "VIDEO") {
  // Same request bodies the UI sends for "Generate" and "Render fast preview".
  const job = await api<{ id: string }>(`/api/projects/${projectId}/generate`, { method: "POST", json: type === "PREVIEW" ? { preview: true } : {} });
  const done = await waitForJob(projectId, job.id);
  if (done.status !== "COMPLETED") throw new Error(`Render ${done.status}: ${done.error}`);
  const project = await api<{ outputs: Array<{ id: string; jobId: string; type: string }> }>(`/api/projects/${projectId}`);
  const output = project.outputs.find((item) => item.jobId === job.id && item.type === "VIDEO");
  if (!output) throw new Error(`No VIDEO output for job ${job.id}`);
  const filePath = path.join(mediaRoot, `download-${output.id}.mp4`);
  await download(output.id, filePath);
  return { jobId: job.id, outputId: output.id, filePath };
}

export async function download(outputId: string, filePath: string) {
  const response = await fetch(`${baseUrl}/api/outputs/${outputId}`);
  if (!response.ok) throw new Error(`Download ${outputId} -> ${response.status}: ${await response.text()}`);
  await writeFile(filePath, Buffer.from(await response.arrayBuffer()));
}

export async function probe(filePath: string) {
  const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height", "-of", "json", filePath]);
  const data = JSON.parse(stdout) as { format: { duration: string }; streams: Array<{ codec_type: string; codec_name: string; width?: number; height?: number }> };
  const video = data.streams.find((stream) => stream.codec_type === "video");
  const audio = data.streams.find((stream) => stream.codec_type === "audio");
  return { duration: Number(data.format.duration), video, audio };
}

/** Raw RGB pixels of one frame at `seconds`, optionally cropped to a region of the (unscaled) frame. */
export async function frameRgb(filePath: string, seconds: number, crop?: { x: number; y: number; w: number; h: number }) {
  const filters = crop ? ["-vf", `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`] : [];
  // `-ss 0` yields no frame for a single image (thumbnail), so only seek when needed.
  const seek = seconds > 0 ? ["-ss", String(seconds)] : [];
  const { stdout } = await execFileAsync("ffmpeg", ["-v", "error", ...seek, "-i", filePath, "-frames:v", "1", ...filters, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
  return stdout as Buffer;
}

export function averageColor(pixels: Buffer) {
  const total = [0, 0, 0];
  for (let i = 0; i < pixels.length; i += 3) for (let c = 0; c < 3; c++) total[c] += pixels[i + c];
  const count = pixels.length / 3;
  const [r, g, b] = total.map((value) => Math.round(value / count));
  return { r, g, b };
}

/** Share of pixels that are near-white, i.e. rendered text on a coloured background. */
export function whiteShare(pixels: Buffer) {
  let white = 0;
  for (let i = 0; i < pixels.length; i += 3) if (pixels[i] > 200 && pixels[i + 1] > 200 && pixels[i + 2] > 200) white++;
  return white / (pixels.length / 3);
}

export const isGreen = ({ r, g, b }: { r: number; g: number; b: number }) => g > 100 && r < 60 && b < 60;
export const isRed = ({ r, g, b }: { r: number; g: number; b: number }) => r > 180 && g < 60 && b < 60;
export const isBlue = ({ r, g, b }: { r: number; g: number; b: number }) => b > 180 && r < 60 && g < 60;
export const isBlack = ({ r, g, b }: { r: number; g: number; b: number }) => r < 30 && g < 30 && b < 30;
