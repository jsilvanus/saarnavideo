import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { prisma } from "@/lib/prisma";
import { timelineDuration } from "@/domain/timeline";
import { buildCompositionRenderPlan } from "@/renderer/composition";
import type { ProjectDefinition } from "@/domain/project";
import { resolveSourcePaths } from "@/worker/source-resolution";
import { withDownloadCookies } from "@/integrations/ytdlp-cookies";
import { downloadYouTubeSource, uploadCaptionToYouTube, uploadToYouTube } from "@/integrations/youtube";
import { getYouTubeAccessToken } from "@/integrations/youtube-oauth";
import { validateSourceFile, formatBytes, type ResourceLimits } from "@/domain/validation";
import { AuditorSttClient, type JobStatusResponse } from "@/integrations/auditorStt/client";
import { createTranscriptionRun } from "@/lib/transcriptionRuns";
import { applyRangeOffset, isPartialRange } from "@/worker/transcription-range";
import { buildBurnedCaptionAss, buildCaptionCues, clipSourceIds, readCaptionOptions } from "@/worker/captions";
import { CAPTION_MIME, toIso6392, wantsBurnedCaptions, wantsSoftCaptions, type CaptionOptions } from "@/domain/captions";
import { readPodcastSettings, referencedAudioAssetIds } from "@/worker/podcast";
import { PODCAST_TARGET_LUFS, buildPodcastRenderPlan, parseLoudnormMeasurement, podcastMimeType, resolvePodcastMetadata } from "@/renderer/podcast";
import { uploadCaptionsAfterVideo, type CaptionPublishDeps } from "@/worker/caption-publish";
import { findUnresolvedImageRefs } from "@/domain/asset-usage";
import { linkReferencedAssets } from "@/lib/asset-link";
import { formatSrt, formatVtt } from "@/lib/captions";
import { readFacebookConfig } from "@/integrations/facebook";
import { publishVideoToFacebook } from "@/worker/facebook-publish";
import { createRemoteExecutorFromEnv, type RemoteRun } from "@/worker/remote-ffmpeg";
import { createRemoteDownloaderFromEnv } from "@/worker/remote-download";
import { getMediaStore } from "@/lib/media-store";
import { HEARTBEAT_MS, heartbeat, recoverStaleJobs, type RecoveryDb } from "@/worker/job-recovery";
import { randomUUID } from "node:crypto";
import os from "node:os";
import { openJobFiles, resolveLocalFile, type JobFiles } from "@/worker/media-io";
import { createTranscriptionStaging } from "@/worker/transcription-staging";

const execFileAsync = promisify(execFile);
const MIN_POLL_MS = 500;
const MAX_POLL_MS = 2000;
const DEFAULT_POLL_MS = 750;
const POLL_MS = Math.min(Math.max(Number(process.env.WORKER_POLL_MS ?? DEFAULT_POLL_MS), MIN_POLL_MS), MAX_POLL_MS);
const PROGRESS_WRITE_MS = 750;
const MEDIA_ROOT = process.env.MEDIA_ROOT ?? "/data/media";
const RESOURCE_LIMITS: ResourceLimits = { maxSourceFileSizeBytes: Number(process.env.MAX_SOURCE_SIZE_BYTES ?? 50 * 1024 * 1024 * 1024), maxOutputFileSizeBytes: Number(process.env.MAX_OUTPUT_SIZE_BYTES ?? 100 * 1024 * 1024 * 1024), maxDurationSeconds: Number(process.env.MAX_DURATION_SECONDS ?? 12 * 60 * 60), maxConcurrentJobs: Number(process.env.MAX_CONCURRENT_JOBS ?? 2), requestTimeoutSeconds: Number(process.env.REQUEST_TIMEOUT_SECONDS ?? 60 * 60) };
const runningProcesses = new Map<string, ChildProcessWithoutNullStreams>();
/** Jobs run side by side only when the fleet does the rendering (a local ffmpeg already uses the machine's cores). */
const JOB_CONCURRENCY = Math.max(1, Number(process.env.MAX_CONCURRENT_JOBS ?? (process.env.RENDER_EXECUTOR === "fffleet" ? 4 : 1)) || 1);
const CANCEL_POLL_MS = 1500;
/** The user cancelled the job while ffmpeg (local or on the fleet) was running it. */
class JobCancelled extends Error { constructor() { super("Cancelled by user"); } }
/** Calls `onCancel` once when the job's cancelRequested flag is set; returns a function that stops watching and says whether it fired. */
function watchCancel(jobId: string, onCancel: () => void): () => boolean {
  let fired = false;
  const timer = setInterval(() => { void prisma.mediaJob.findUnique({ where: { id: jobId }, select: { cancelRequested: true } }).then(row => { if (row?.cancelRequested && !fired) { fired = true; onCancel(); } }, () => undefined); }, CANCEL_POLL_MS);
  return () => { clearInterval(timer); return fired; };
}
/** RENDER_EXECUTOR=fffleet sends ffmpeg commands to an fffleet fleet (staged through S3) instead of spawning them here. */
const remoteExecutor = createRemoteExecutorFromEnv(process.env, message => console.log(`[remote-ffmpeg] ${message}`));
/** DOWNLOAD_EXECUTOR=fffleet runs yt-dlp on an fffleet worker (job type "download") instead of here. */
const remoteDownloader = createRemoteDownloaderFromEnv(process.env, message => console.log(`[remote-download] ${message}`));
/** AUDITOR_STT_FETCH=s3 stages the audio in S3 and gives the transcription service a presigned URL instead of uploading the file. */
const transcriptionStaging = createTranscriptionStaging(process.env);
/** Identifies this worker process on the jobs it runs (job heartbeats and recovery, see job-recovery.ts). */
const WORKER_ID = `${os.hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
const progressTimers = new Map<string, NodeJS.Timeout>();
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function logJobEvent(jobId: string, level: "DEBUG" | "INFO" | "WARN" | "ERROR", message: string, data?: Record<string, unknown>) { try { await prisma.jobLog.create({ data: { jobId, level, message, data: data ? JSON.stringify(data) : undefined } }); } catch (error) { console.error(`Failed to log job event: ${error}`); } }
async function updateProgress(jobId: string, data: Record<string, unknown>, force = false) { const write = async () => { progressTimers.delete(jobId); try { await prisma.mediaJob.update({ where: { id: jobId }, data }); } catch (error) { console.error(`Failed to update job progress: ${error}`); } }; if (force) { const timer = progressTimers.get(jobId); if (timer) clearTimeout(timer); await write(); return; } if (progressTimers.has(jobId)) return; progressTimers.set(jobId, setTimeout(() => void write(), PROGRESS_WRITE_MS)); }

export async function claimJob() {
  const candidates = await prisma.mediaJob.findMany({ where: { status: "QUEUED" }, orderBy: [{ priority: "desc" }, { createdAt: "asc" }], take: 10 });
  for (const candidate of candidates) {
    if (!candidate.dependsOnJobId) {
      const result = await prisma.mediaJob.updateMany({ where: { id: candidate.id, status: "QUEUED" }, data: { status: "RUNNING", startedAt: new Date(), workerId: WORKER_ID, heartbeatAt: new Date(), phase: "STARTING", message: "Worker claimed job" } });
      if (result.count === 1) return candidate;
      continue;
    }
    const dependency = await prisma.mediaJob.findUnique({ where: { id: candidate.dependsOnJobId }, select: { status: true } });
    if (!dependency) {
      await prisma.mediaJob.update({ where: { id: candidate.id }, data: { status: "FAILED", phase: "FAILED", message: "Dependency job not found", error: "Dependency job not found" } }).catch(() => undefined);
      continue;
    }
    if (dependency.status !== "COMPLETED") {
      if (dependency.status === "FAILED" || dependency.status === "CANCELLED") {
        await prisma.mediaJob.update({ where: { id: candidate.id }, data: { status: "FAILED", phase: "FAILED", message: "Dependency did not complete", error: "Dependency did not complete" } }).catch(() => undefined);
      }
      continue;
    }
    const result = await prisma.mediaJob.updateMany({ where: { id: candidate.id, status: "QUEUED" }, data: { status: "RUNNING", startedAt: new Date(), workerId: WORKER_ID, heartbeatAt: new Date(), phase: "STARTING", message: "Worker claimed job" } });
    if (result.count === 1) return candidate;
  }
  return null;
}

const workerEntry = process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false;
if (workerEntry) {
  main().catch(error => { console.error("Fatal error:", error); process.exit(1); });
}

/** Stores a finished local file (uploading it first when media lives in S3) and records it as an Output row. */
async function createOutput(files: JobFiles, projectId: string, jobId: string, type: "VIDEO" | "THUMBNAIL" | "CAPTIONS_SRT" | "CAPTIONS_VTT" | "AUDIO", localPath: string, mimeType: string, preview = false, language?: string) {
  const sizeBytes = await stat(localPath).then(s => s.size, () => undefined);
  const maxSize = type === "VIDEO" || type === "AUDIO" ? RESOURCE_LIMITS.maxOutputFileSizeBytes : 50 * 1024 * 1024;
  if (sizeBytes !== undefined && sizeBytes > maxSize) throw new Error(`${type} file size ${formatBytes(sizeBytes)} exceeds limit ${formatBytes(maxSize)}`);
  const storagePath = await files.finalize(localPath, `outputs/${projectId}/${path.basename(localPath)}`, mimeType);
  return prisma.output.create({ data: { projectId, jobId, type, preview, storagePath, mimeType, language, sizeBytes } }); }

/** Replaces every stored reference in a path map by a local file path (downloading S3 files into the cache). */
async function localizePaths(files: JobFiles, paths: Map<string, string>): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  const byRef = new Map<string, Promise<string>>();
  for (const ref of new Set(paths.values())) byRef.set(ref, files.local(ref));
  for (const [key, ref] of paths) resolved.set(key, await byRef.get(ref)!);
  return resolved;
}

async function processDownload(job: Awaited<ReturnType<typeof claimJob>>, files: JobFiles) {
  const store = await getMediaStore();
  if (!job?.sourceId) throw new Error("DOWNLOAD job has no source");
  const source = await prisma.source.findUnique({ where: { id: job.sourceId } }); if (!source) throw new Error("Source not found");
  if (source.storagePath) { try { const s = await store.stat(source.storagePath); if (s && validateSourceFile(s.size, RESOURCE_LIMITS).valid) { await updateProgress(job.id, { progress: 100, phase: "DOWNLOADED", message: "Source already available" }, true); return; } } catch { /* re-download */ } }
  if (source.type !== "YOUTUBE" || !source.youtubeUrl || !source.youtubeVideoId) throw new Error("Source is not a downloadable YouTube source");
  // Downloaded next to the other sources for local storage; into the job's scratch directory (then uploaded) for S3.
  const localPath = store.mode === "local" ? path.join(MEDIA_ROOT, "sources", job.projectId, `${source.youtubeVideoId}.mp4`) : path.join(files.scratchDir, `${source.youtubeVideoId}.mp4`);
  await mkdir(path.dirname(localPath), { recursive: true });
  await updateProgress(job.id, { phase: "DOWNLOADING", message: "Downloading YouTube source", progress: 0 }, true);
  const { cookies } = await withDownloadCookies(async cookiesFile => {
    if (remoteDownloader) {
      const stopWatching = watchCancel(job.id, () => void remoteDownloader.cancel(job.id));
      try {
        await remoteDownloader.run({ jobId: job.id, url: source.youtubeUrl!, outputPath: localPath, cookiesFile, onProgress: percent => void updateProgress(job.id, { phase: "DOWNLOADING", message: "Downloading YouTube source", progress: Math.round(percent) }) });
      } catch (error) { throw stopWatching() ? new JobCancelled() : error; } finally { stopWatching(); }
    } else await downloadYouTubeSource({ videoId: source.youtubeVideoId!, url: source.youtubeUrl! }, localPath, async p => { await updateProgress(job.id, { phase: "DOWNLOADING", message: "Downloading YouTube source", progress: Math.round(p.percent), bytesProcessed: p.bytesProcessed, totalBytes: p.totalBytes, speed: p.speed, etaSeconds: p.etaSeconds }); }, { cookiesFile });
  });
  if (cookies) await logJobEvent(job.id, "INFO", cookies.source === "db" ? `Used the YouTube cookies from Settings${cookies.updated ? "; yt-dlp refreshed them and the stored copy was updated" : ""}` : "Used the cookie file from YTDLP_COOKIES_FILE");
  const s = await stat(localPath); const validation = validateSourceFile(s.size, RESOURCE_LIMITS); if (!validation.valid) { await rm(localPath, { force: true }); throw new Error(validation.reason); }
  const storagePath = await files.finalize(localPath, `sources/${job.projectId}/${source.youtubeVideoId}.mp4`, "video/mp4");
  await prisma.source.update({ where: { id: source.id }, data: { storagePath, mimeType: "video/mp4", sizeBytes: BigInt(s.size) } });
  await updateProgress(job.id, { progress: 100, phase: "DOWNLOADED", message: "Download complete", bytesProcessed: BigInt(s.size), totalBytes: BigInt(s.size) }, true);
}

const fontFamilies = new Map<string, Promise<string | undefined>>();
/** Family name of a font file for libass (which looks fonts up by name), read with fontconfig's fc-scan; undefined when unavailable. Memoized per path. */
function fontFamilyOfFile(fontFile: string): Promise<string | undefined> {
  let family = fontFamilies.get(fontFile);
  if (!family) {
    family = execFileAsync("fc-scan", ["--format", "%{family}\\n", fontFile]).then(({ stdout }) => stdout.split("\n")[0]?.split(",")[0]?.trim() || undefined, () => undefined);
    fontFamilies.set(fontFile, family);
  }
  return family;
}

/**
 * Maps the active transcript of every clip source onto the output timeline and prepares what the requested caption
 * modes need: sidecar SRT/VTT files (soft) and/or an ASS file (burned-in). Returns null (and logs) when there is nothing to caption.
 */
async function prepareCaptions(jobId: string, definition: ProjectDefinition, outputPath: string, options: CaptionOptions) {
  const sourceIds = clipSourceIds(definition);
  const segments = await prisma.transcriptSegment.findMany({ where: { sourceId: { in: sourceIds }, isActive: true }, orderBy: { startSeconds: "asc" }, select: { sourceId: true, startSeconds: true, endSeconds: true, text: true } });
  const bySource = new Map<string, typeof segments>();
  for (const segment of segments) { const list = bySource.get(segment.sourceId); if (list) list.push(segment); else bySource.set(segment.sourceId, [segment]); }
  const cues = buildCaptionCues(definition, bySource);
  if (!cues.length) { await logJobEvent(jobId, "WARN", `Captions (${options.mode}) requested but no active transcript segments fall inside the composition; rendering without captions`); return null; }
  const base = outputPath.replace(/\.mp4$/, "");
  let soft: { srtPath: string; vttPath: string; language: string } | null = null;
  if (wantsSoftCaptions(options)) {
    const run = options.language ? null : await prisma.transcriptionRun.findFirst({ where: { sourceId: { in: sourceIds }, status: "APPLIED" }, orderBy: { appliedAt: "desc" }, select: { language: true } });
    const language = options.language ?? run?.language ?? "und";
    const srtPath = `${base}.srt`; const vttPath = `${base}.vtt`;
    await writeFile(srtPath, formatSrt(cues), "utf8"); await writeFile(vttPath, formatVtt(cues), "utf8");
    soft = { srtPath, vttPath, language };
    await logJobEvent(jobId, "INFO", "Soft captions prepared", { cues: cues.length, language });
  }
  let burn: { assPath: string; fontsDir?: string } | null = null;
  if (wantsBurnedCaptions(options)) {
    const fontFile = definition.template?.fontFile;
    const fontName = fontFile ? await fontFamilyOfFile(fontFile) : undefined;
    const built = buildBurnedCaptionAss(definition, cues, options, fontName);
    if (built.warning) await logJobEvent(jobId, "WARN", built.warning);
    const assPath = `${base}.ass`;
    await writeFile(assPath, built.ass, "utf8");
    burn = { assPath, fontsDir: fontFile && fontName ? path.dirname(fontFile) : undefined };
    await logJobEvent(jobId, "INFO", "Burned-in captions prepared", { cues: cues.length, displayCues: built.lines, styleGraphicId: options.styleGraphicId ?? "default", font: fontName ?? built.style.fontFamily });
  }
  return { soft, burn };
}

/** The definition snapshot a job was queued with (`parameters.renderDefinition`), else the project's current one. */
function jobDefinition(job: { parameters: unknown }, project: { definition: unknown }): ProjectDefinition {
  const parameters = job.parameters && typeof job.parameters === "object" ? (job.parameters as Record<string, unknown>) : {};
  return ("renderDefinition" in parameters ? parameters.renderDefinition : project.definition) as ProjectDefinition;
}

async function runFfmpegJob(job: Awaited<ReturnType<typeof claimJob>>, type: "VIDEO" | "PREVIEW" | "THUMBNAIL", files: JobFiles) {
  if (!job) throw new Error("Missing job");
  const project = await prisma.project.findUnique({ where: { id: job.projectId }, include: { sources: true, assets: true } }); if (!project) throw new Error("Project not found");
  const definition = jobDefinition(job, project);
  if (type !== "THUMBNAIL") for (const asset of await linkReferencedAssets(prisma, project.id, definition, project.assets, referencedAudioAssetIds(definition))) { project.assets.push(asset); await logJobEvent(job.id, "INFO", `Linked library asset "${asset.assetKey}" to the project because the composition uses it`); }
  await mkdir(MEDIA_ROOT, { recursive: true });
  if (type === "THUMBNAIL") {
    const video = await prisma.output.findFirst({ where: { projectId: project.id, type: "VIDEO", preview: false }, orderBy: { createdAt: "desc" } }); if (!video) throw new Error("No completed video available for thumbnail");
    const videoPath = await files.local(video.storagePath); const outputPath = path.join(files.scratchDir, `${project.id}-${job.id}.jpg`); await updateProgress(job.id, { phase: "THUMBNAIL", message: "Extracting thumbnail", progress: 10 }, true); await runSimpleFfmpeg(job.id, ["-hide_banner", "-y", "-ss", "1", "-i", videoPath, "-frames:v", "1", "-q:v", "2", outputPath], { files: [videoPath], outputPath }); await createOutput(files, project.id, job.id, "THUMBNAIL", outputPath, "image/jpeg"); await updateProgress(job.id, { status: "COMPLETED", progress: 100, phase: "COMPLETE", message: "Thumbnail ready", completedAt: new Date() }, true); return;
  }
  const sourcePaths = await localizePaths(files, resolveSourcePaths(definition, project.sources)); const assetRefs = new Map<string, string>(); for (const asset of project.assets) { assetRefs.set(asset.assetKey, asset.storagePath); assetRefs.set(asset.id, asset.storagePath); assetRefs.set(`/api/projects/${project.id}/assets/${asset.id}`, asset.storagePath); }
  for (const warning of findUnresolvedImageRefs(definition, project.assets)) await logJobEvent(job.id, "WARN", warning);
  // Voiceovers are looked up by id in the whole library (they need not be linked to the project like images do).
  for (const asset of await prisma.asset.findMany({ where: { id: { in: referencedAudioAssetIds(definition) } } })) assetRefs.set(asset.id, asset.storagePath);
  const assetPaths = await localizePaths(files, assetRefs);
  const outputPath = path.join(files.scratchDir, `${project.id}-${job.id}${type === "PREVIEW" ? ".preview" : ""}.mp4`); const captions = readCaptionOptions(job.parameters); const prepared = captions.mode !== "none" ? await prepareCaptions(job.id, definition, outputPath, captions) : null; const captionFiles = prepared?.soft ?? null;
  const plan = buildCompositionRenderPlan(definition, sourcePaths, outputPath, assetPaths, { captions: captionFiles ? { path: captionFiles.srtPath, language: toIso6392(captionFiles.language) } : undefined, burnedCaptions: prepared?.burn ?? undefined, preview: type === "PREVIEW" ? { width: 640 } : undefined });
  const phase = type === "PREVIEW" ? "PREVIEW_RENDER" : "ENCODING"; const message = type === "PREVIEW" ? "Rendering preview" : "Rendering video"; const outputSeconds = definition.composition.items.length ? timelineDuration(definition.composition.items) : definition.composition.sourceEndSeconds - definition.composition.sourceStartSeconds; const totalMs = Math.max(1, Math.round(outputSeconds * 1000));
  await updateProgress(job.id, { phase, message, progress: 0, totalMs: BigInt(totalMs) }, true);
  const fontFile = definition.template?.fontFile; const remote = { files: [...sourcePaths.values(), ...assetPaths.values(), ...(captionFiles ? [captionFiles.srtPath] : []), ...(prepared?.burn ? [prepared.burn.assPath] : [])], fonts: fontFile && prepared?.burn?.fontsDir ? { file: fontFile, dir: prepared.burn.fontsDir } : undefined, outputPath };
  try { await runFfmpegWithProgress(job.id, plan.args, totalMs, { phase, message, from: 0, to: 99, reportSpeed: true }, remote); }
  finally { if (prepared?.burn) void rm(prepared.burn.assPath, { force: true }).catch(() => undefined); }
  await createOutput(files, project.id, job.id, "VIDEO", outputPath, "video/mp4", type === "PREVIEW", captionFiles?.language);
  if (captionFiles) { await createOutput(files, project.id, job.id, "CAPTIONS_SRT", captionFiles.srtPath, CAPTION_MIME.srt, type === "PREVIEW", captionFiles.language); await createOutput(files, project.id, job.id, "CAPTIONS_VTT", captionFiles.vttPath, CAPTION_MIME.vtt, type === "PREVIEW", captionFiles.language); }
  await updateProgress(job.id, { status: "COMPLETED", progress: 100, phase: "COMPLETE", message: `${type === "PREVIEW" ? "Preview" : "Video"} ready`, completedAt: new Date() }, true);
}

type ProgressRange = { phase: string; message: string; from: number; to: number; reportSpeed?: boolean };

/** Runs ffmpeg with -progress output; resolves with stderr (loudnorm prints its measurement there). Progress covers [from, to] percent. */
type RemoteFiles = Pick<RemoteRun, "files" | "fonts" | "outputPath">;

/** Runs a short ffmpeg command (no progress) locally, or on the fleet when RENDER_EXECUTOR=fffleet. */
async function runSimpleFfmpeg(jobId: string, args: string[], remote: RemoteFiles) {
  if (!remoteExecutor) { await execFileAsync("ffmpeg", args); return; }
  await remoteExecutor.run({ jobId, args, totalMs: 1, mediaRoot: MEDIA_ROOT, labels: { jobType: "THUMBNAIL" }, ...remote });
}

async function runFfmpegWithProgress(jobId: string, args: string[], totalMs: number, { phase, message, from, to, reportSpeed }: ProgressRange, remote?: RemoteFiles): Promise<string> {
  if (remoteExecutor) {
    if (!remote) throw new Error("RENDER_EXECUTOR=fffleet: this ffmpeg command did not say which files it uses");
    const stopWatching = watchCancel(jobId, () => void remoteExecutor?.cancel(jobId));
    const result = await remoteExecutor.run({
      jobId, args, totalMs, mediaRoot: MEDIA_ROOT, labels: { jobType: phase }, ...remote,
      onProgress: ({ currentMs, speed }) => {
        const progress = Math.round(from + Math.max(0, Math.min(1, currentMs / totalMs)) * (to - from));
        void updateProgress(jobId, { phase, message, progress: Math.min(99, progress), currentMs: BigInt(Math.round(currentMs)), totalMs: BigInt(totalMs) });
        if (reportSpeed && speed) void updateProgress(jobId, { speed });
      },
    }).catch(error => { throw stopWatching() ? new JobCancelled() : error; });
    stopWatching();
    return result.stderr;
  }
  const withProgress = [...args.slice(0, 2), "-progress", "pipe:1", "-nostats", ...args.slice(2)];
  const child = spawn("ffmpeg", withProgress, { stdio: ["pipe", "pipe", "pipe"] });
  runningProcesses.set(jobId, child);
  const stopWatching = watchCancel(jobId, () => child.kill("SIGTERM"));
  let stdoutBuffer = ""; let stderr = "";
  child.stdout.on("data", chunk => { stdoutBuffer += chunk.toString(); const lines = stdoutBuffer.split("\n"); stdoutBuffer = lines.pop() ?? ""; for (const line of lines) { const [key, value] = line.trim().split("="); if (key === "out_time_ms" && value && Number.isFinite(Number(value))) { const currentMs = Number(value) / 1000; const progress = Math.round(from + Math.max(0, Math.min(1, currentMs / totalMs)) * (to - from)); void updateProgress(jobId, { phase, message, progress: Math.min(99, progress), currentMs: BigInt(Math.round(currentMs)), totalMs: BigInt(totalMs) }); } if (reportSpeed && key === "speed" && value) void updateProgress(jobId, { speed: value }); } });
  child.stderr.on("data", chunk => { stderr += chunk.toString(); });
  try { await new Promise<void>((resolve, reject) => { child.on("close", code => code === 0 ? resolve() : reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-2000)}`))); child.on("error", reject); }); } catch (error) { throw stopWatching() ? new JobCancelled() : error; } finally { stopWatching(); runningProcesses.delete(jobId); }
  return stderr;
}

/** PODCAST job: intro + composition audio + outro as one loudness-normalised MP3/M4A with tags and cover art (see buildPodcastRenderPlan). */
async function runPodcastJob(job: Awaited<ReturnType<typeof claimJob>>, files: JobFiles) {
  if (!job) throw new Error("Missing job");
  const project = await prisma.project.findUnique({ where: { id: job.projectId }, include: { sources: true } }); if (!project) throw new Error("Project not found");
  const definition = jobDefinition(job, project);
  const settings = readPodcastSettings(definition, job.parameters);
  await mkdir(MEDIA_ROOT, { recursive: true });
  const sourcePaths = await localizePaths(files, resolveSourcePaths(definition, project.sources));
  const audioIds = referencedAudioAssetIds(definition, settings);
  const audioAssets = new Map((await prisma.asset.findMany({ where: { id: { in: audioIds } } })).map(asset => [asset.id, asset]));
  const missing = audioIds.filter(id => !audioAssets.has(id)); if (missing.length) throw new Error(`Audio assets not found in the library: ${missing.join(", ")}`);
  const assetPaths = await localizePaths(files, new Map([...audioAssets].map(([id, asset]) => [id, asset.storagePath])));
  const pickTrack = (assetId?: string) => { const asset = assetId ? audioAssets.get(assetId) : undefined; return asset ? { path: assetPaths.get(asset.id)!, durationSeconds: asset.durationMs != null ? asset.durationMs / 1000 : undefined } : undefined; };
  const thumbnails = await prisma.output.findMany({ where: { projectId: project.id, type: "THUMBNAIL" }, orderBy: { createdAt: "desc" }, take: 5 });
  let coverPath: string | undefined; for (const thumbnail of thumbnails) { const local = await files.local(thumbnail.storagePath).catch(() => undefined); if (local && await stat(local).then(() => true, () => false)) { coverPath = local; break; } }
  if (!coverPath) await logJobEvent(job.id, "INFO", "No thumbnail available yet; the podcast gets no cover art");
  const metadata = resolvePodcastMetadata(project, settings);
  const outputPath = path.join(files.scratchDir, `${project.id}-${job.id}.${settings.format}`);
  const planOptions = { settings, intro: pickTrack(settings.introAssetId), outro: pickTrack(settings.outroAssetId), coverPath, metadata };
  // The body (source audio, voiceovers, mixes, range) is decoded once into a temporary WAV; the loudness measure and the
  // encode pass read that file, so a multi-GB sermon video is not demuxed three times.
  const bodyPath = path.join(files.scratchDir, `${project.id}-${job.id}.body.wav`);
  try {
    const bodyPlan = buildPodcastRenderPlan(definition, sourcePaths, bodyPath, assetPaths, { ...planOptions, bodyOnly: true });
    const bodyMs = Math.max(1, Math.round(bodyPlan.durationSeconds * 1000));
    await updateProgress(job.id, { phase: "EXTRACTING_AUDIO", message: "Rendering the audio body", progress: 0, totalMs: BigInt(bodyMs) }, true);
    await runFfmpegWithProgress(job.id, bodyPlan.args, bodyMs, { phase: "EXTRACTING_AUDIO", message: "Rendering the audio body", from: 0, to: 40 }, { files: [...sourcePaths.values(), ...assetPaths.values()], outputPath: bodyPath });
    // Later passes need only the body file, the intro/outro and the cover.
    const finalAssets = new Map([...assetPaths].filter(([id]) => id === settings.introAssetId || id === settings.outroAssetId));
    const remote = { files: [bodyPath, ...finalAssets.values(), ...(coverPath ? [coverPath] : [])], outputPath };
    const measurePlan = buildPodcastRenderPlan(definition, sourcePaths, outputPath, assetPaths, { ...planOptions, bodyWav: bodyPath, loudness: "measure" });
    const totalMs = Math.max(1, Math.round(measurePlan.durationSeconds * 1000));
    await updateProgress(job.id, { phase: "ANALYSING", message: "Measuring loudness", progress: 40, totalMs: BigInt(totalMs) }, true);
    const measureLog = await runFfmpegWithProgress(job.id, measurePlan.args, totalMs, { phase: "ANALYSING", message: "Measuring loudness", from: 40, to: 60 }, remote);
    const measurement = parseLoudnormMeasurement(measureLog);
    // Silent or unmeasurable audio: fall back to single-pass loudnorm rather than failing the job.
    if (!measurement) await logJobEvent(job.id, "WARN", "Loudness measurement failed; using single-pass normalisation");
    else await logJobEvent(job.id, "INFO", `Measured ${measurement.input_i} LUFS, normalising to ${PODCAST_TARGET_LUFS} LUFS`, { ...measurement });
    const plan = buildPodcastRenderPlan(definition, sourcePaths, outputPath, assetPaths, { ...planOptions, bodyWav: bodyPath, loudness: measurement ?? undefined });
    await updateProgress(job.id, { phase: "ENCODING", message: "Encoding podcast", progress: 60 }, true);
    await runFfmpegWithProgress(job.id, plan.args, totalMs, { phase: "ENCODING", message: "Encoding podcast", from: 60, to: 100 }, remote);
  } finally { await rm(bodyPath, { force: true }); }
  await createOutput(files, project.id, job.id, "AUDIO", outputPath, podcastMimeType(settings.format));
  await updateProgress(job.id, { status: "COMPLETED", progress: 100, phase: "COMPLETE", message: "Podcast ready", completedAt: new Date() }, true);
}

type MediaJobRow = NonNullable<Awaited<ReturnType<typeof claimJob>>>;

const TERMINAL_STT_STATUSES: ReadonlySet<JobStatusResponse["status"]> = new Set(["completed", "failed", "cancelled"]);

async function failJob(jobId: string, error: unknown, logMessage: string, data?: Record<string, unknown>) {
  const message = error instanceof Error ? error.message : String(error);
  await updateProgress(jobId, { status: "FAILED", phase: "FAILED", message, error: message }, true);
  await logJobEvent(jobId, "ERROR", logMessage, { error: message, ...data });
}

type TranscribeParameters = {
  rangeStartSeconds: number;
  rangeEndSeconds: number;
  language: string;
  auditorJobId?: string;
  tempClipPath?: string;
  /** S3 key of the staged original (AUDITOR_STT_FETCH=s3-source), deleted when the job ends. */
  stagedKey?: string;
};

// See docs/transcription-editor-contract.md, "MediaJob.parameters shape for a TRANSCRIBE job".
function readTranscribeParameters(parameters: unknown): TranscribeParameters {
  const params = (parameters && typeof parameters === "object" ? parameters : {}) as Partial<TranscribeParameters>;
  if (typeof params.rangeStartSeconds !== "number" || typeof params.rangeEndSeconds !== "number" || typeof params.language !== "string") {
    throw new Error("TRANSCRIBE job is missing rangeStartSeconds/rangeEndSeconds/language parameters");
  }
  return { rangeStartSeconds: params.rangeStartSeconds, rangeEndSeconds: params.rangeEndSeconds, language: params.language, auditorJobId: params.auditorJobId, tempClipPath: params.tempClipPath, stagedKey: params.stagedKey };
}

function serializeTranscribeParameters(params: TranscribeParameters): Record<string, string | number> {
  const result: Record<string, string | number> = { rangeStartSeconds: params.rangeStartSeconds, rangeEndSeconds: params.rangeEndSeconds, language: params.language };
  if (params.auditorJobId) result.auditorJobId = params.auditorJobId;
  if (params.tempClipPath) result.tempClipPath = params.tempClipPath;
  if (params.stagedKey) result.stagedKey = params.stagedKey;
  return result;
}

async function cleanupTempClip(tempClipPath: string | undefined) { if (!tempClipPath) return; await rm(tempClipPath, { force: true }).catch(() => undefined); }

/** Deletes the staged original of a transcription job (AUDITOR_STT_FETCH=s3-source), whatever process staged it. */
async function releaseStagedSource(jobId: string) {
  if (!transcriptionStaging) return;
  const row = await prisma.mediaJob.findUnique({ where: { id: jobId }, select: { parameters: true } });
  const key = row?.parameters && typeof row.parameters === "object" ? (row.parameters as Record<string, unknown>).stagedKey : undefined;
  if (typeof key === "string") await transcriptionStaging.delete(key);
}

async function extractTranscriptionClip(jobId: string, sourceStoragePath: string, rangeStartSeconds?: number, rangeEndSeconds?: number): Promise<string> {
  const tmpDir = path.join(MEDIA_ROOT, "tmp");
  await mkdir(tmpDir, { recursive: true });
  const tempClipPath = path.join(tmpDir, `${jobId}.wav`);
  // -ss/-to placed after -i so the cut is sample-accurate rather than keyframe-snapped.
  const range = rangeStartSeconds !== undefined && rangeEndSeconds !== undefined ? ["-ss", String(rangeStartSeconds), "-to", String(rangeEndSeconds)] : [];
  await execFileAsync("ffmpeg", ["-y", "-i", sourceStoragePath, ...range, "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", tempClipPath]);
  return tempClipPath;
}

/**
 * Submits (or resumes watching) a TRANSCRIBE job against liturgos-auditor-stt,
 * applies the mandatory range-offset correction to the result, and persists it
 * as a new TranscriptionRun. See docs/transcription-editor-contract.md for the
 * full contract this implements (partial-range extraction, offset correction,
 * cancellation, resumability).
 */
async function processTranscription(job: MediaJobRow) {
  try {
    await processTranscriptionInner(job);
  } catch (error) {
    await releaseStagedSource(job.id).catch(() => undefined);
    throw error;
  }
}

async function processTranscriptionInner(job: MediaJobRow) {
  if (!job.sourceId) throw new Error("TRANSCRIBE job has no source");
  const source = await prisma.source.findUnique({ where: { id: job.sourceId } });
  if (!source) throw new Error("Source not found");
  if (!source.storagePath) throw new Error("Source has no media available to transcribe");

  let params = readTranscribeParameters(job.parameters);
  const client = new AuditorSttClient();

  // Honor a cancellation that arrived while this job was still QUEUED (claimJob just flipped it to RUNNING and we haven't submitted anything yet).
  const preStart = await prisma.mediaJob.findUnique({ where: { id: job.id }, select: { cancelRequested: true } });
  if (preStart?.cancelRequested) {
    await cleanupTempClip(params.tempClipPath);
    await releaseStagedSource(job.id);
    await updateProgress(job.id, { status: "CANCELLED", phase: "CANCELLED", message: "Cancelled before transcription started", completedAt: new Date() }, true);
    return;
  }

  if (!params.auditorJobId) {
    const durationSeconds = source.durationMs != null ? source.durationMs / 1000 : undefined;
    const isPartial = isPartialRange(params.rangeStartSeconds, params.rangeEndSeconds, durationSeconds);
    // S3-stored sources are downloaded into the worker cache first (ffmpeg needs a real file).
    const sourcePath = await resolveLocalFile(await getMediaStore(), MEDIA_ROOT, source.storagePath);
    let filePath = sourcePath;
    // With S3 staging the whole source is reduced to 16 kHz mono audio first, so far less than the video goes to the bucket.
    // In s3-source mode a whole source is staged as it is and the service strips the audio on a fleet worker.
    const stageSource = transcriptionStaging?.mode === "source" && !isPartial;
    if (isPartial || (transcriptionStaging && !stageSource)) {
      await updateProgress(job.id, { phase: "EXTRACTING_RANGE", message: isPartial ? "Extracting requested range" : "Extracting audio", progress: 0 }, true);
      const tempClipPath = await extractTranscriptionClip(job.id, sourcePath, isPartial ? params.rangeStartSeconds : undefined, isPartial ? params.rangeEndSeconds : undefined);
      params = { ...params, tempClipPath };
      await prisma.mediaJob.update({ where: { id: job.id }, data: { parameters: serializeTranscribeParameters(params) } });
      filePath = tempClipPath;
    }
    await updateProgress(job.id, { phase: "SUBMITTING", message: "Submitting to transcription service", progress: 0 }, true);
    let submission;
    if (transcriptionStaging) {
      const staged = await transcriptionStaging.stage(filePath, job.id);
      try {
        submission = await client.submitUrl(staged.url, { language: params.language });
      } catch (error) {
        await staged.release();
        throw error;
      }
      // The service has its own copy of staged audio right away; a staged original is fetched later, so it stays until the job ends.
      if (stageSource) params = { ...params, stagedKey: staged.key };
      else await staged.release();
    } else {
      submission = await client.submitJob(filePath, { language: params.language });
    }
    params = { ...params, auditorJobId: submission.id };
    // Persisted before the first poll so a worker restart can resume watching this job (see "Resumability").
    await prisma.mediaJob.update({ where: { id: job.id }, data: { parameters: serializeTranscribeParameters(params) } });
  }

  const auditorJobId = params.auditorJobId!;
  let pollMs = DEFAULT_POLL_MS;
  let finalStatus: JobStatusResponse | null = null;
  for (;;) {
    const current = await prisma.mediaJob.findUnique({ where: { id: job.id }, select: { cancelRequested: true } });
    if (current?.cancelRequested) {
      await client.deleteJob(auditorJobId).catch(() => undefined);
      await cleanupTempClip(params.tempClipPath);
      await releaseStagedSource(job.id);
      await updateProgress(job.id, { status: "CANCELLED", phase: "CANCELLED", message: "Cancelled by user", completedAt: new Date() }, true);
      return;
    }
    const status = await client.getJobStatus(auditorJobId);
    await updateProgress(job.id, {
      phase: status.phase,
      message: status.phase,
      progress: Math.round(status.progress),
      currentMs: BigInt(Math.round(status.current_seconds * 1000)),
      totalMs: BigInt(Math.round(status.total_seconds * 1000)),
      etaSeconds: status.eta_seconds ?? undefined,
    });
    if (TERMINAL_STT_STATUSES.has(status.status)) { finalStatus = status; break; }
    await sleep(pollMs);
    pollMs = Math.min(MAX_POLL_MS, pollMs + 250);
  }

  if (finalStatus.status === "cancelled") {
    await cleanupTempClip(params.tempClipPath);
    await releaseStagedSource(job.id);
    await updateProgress(job.id, { status: "CANCELLED", phase: "CANCELLED", message: "Cancelled", completedAt: new Date() }, true);
    return;
  }
  if (finalStatus.status === "failed") {
    await cleanupTempClip(params.tempClipPath);
    await releaseStagedSource(job.id);
    throw new Error(finalStatus.error ?? "Auditor STT job failed");
  }

  const result = await client.getJobResult(auditorJobId);
  const segments = applyRangeOffset(result.segments, params.rangeStartSeconds);

  await createTranscriptionRun({ sourceId: source.id, jobId: job.id, origin: "SERVICE", language: params.language, rangeStartSeconds: params.rangeStartSeconds, rangeEndSeconds: params.rangeEndSeconds, segments });

  await cleanupTempClip(params.tempClipPath);
  await releaseStagedSource(job.id);
  await updateProgress(job.id, { status: "COMPLETED", progress: 100, phase: "COMPLETE", message: "Transcription complete", completedAt: new Date() }, true);
}

/**
 * Takes over jobs left RUNNING by a worker that stopped refreshing its heartbeat. A TRANSCRIBE job that already
 * has an auditorJobId is resumed (the auditor job is durable, only the polling is redone); any other stale job is
 * failed, because a half-finished render cannot be resumed. The takeover is one atomic update, so with several workers
 * only one resumes a job. Runs at startup and then periodically.
 */
async function recoverInterruptedJobs() {
  const { resume, failed } = await recoverStaleJobs(prisma as unknown as RecoveryDb, WORKER_ID);
  if (failed) console.warn(`Marked ${failed} stale job(s) as failed: their worker stopped`);
  for (const { id } of resume) {
    const job = await prisma.mediaJob.findUnique({ where: { id } });
    if (!job) continue;
    void processTranscription(job).catch(error => failJob(job.id, error, "Resumed transcription job failed"));
  }
}

async function runClaimedJob(job: MediaJobRow) { let files: JobFiles | undefined; try { if (job.type === "TRANSCRIBE") await processTranscription(job); else { files = await openJobFiles({ store: await getMediaStore(), mediaRoot: MEDIA_ROOT, jobId: job.id, cacheMaxBytes: process.env.MEDIA_CACHE_MAX_BYTES ? Number(process.env.MEDIA_CACHE_MAX_BYTES) : undefined }); if (job.type === "DOWNLOAD") await processDownload(job, files); else if (job.type === "PODCAST") await runPodcastJob(job, files); else await runFfmpegJob(job, job.type, files); } } catch (error) { if (error instanceof JobCancelled) await updateProgress(job.id, { status: "CANCELLED", phase: "CANCELLED", message: "Cancelled by user", completedAt: new Date() }, true); else await failJob(job.id, error, "Media job failed", { type: job.type }); } finally { await files?.cleanup(); } }

const captionPublishDeps: CaptionPublishDeps = {
  findSidecar: (jobId) => prisma.output.findFirst({ where: { jobId, type: "CAPTIONS_SRT", preview: false }, orderBy: { createdAt: "desc" }, select: { storagePath: true, language: true } }),
  getAccessToken: getYouTubeAccessToken,
  upload: uploadCaptionToYouTube,
  log: async (jobId, level, message, data) => { console.warn(`[captions] ${message}`, data ?? ""); if (jobId) await logJobEvent(jobId, level, message, data); },
};

type PublicationRow = { id: string; projectId: string; privacy: string; project: { title: string; preacher: string | null }; output: { storagePath: string; jobId: string | null } };
type PublicationInputs = { thumbnailPath?: string; title: string; description?: string };

/** Facebook Page upload: the token comes from the environment (never the database) and stays out of logs and errors. */
async function runFacebookPublication(publication: PublicationRow, inputs: PublicationInputs, deps: CaptionPublishDeps) {
  const config = readFacebookConfig();
  if (!config) throw new Error("Facebook is not configured: set FACEBOOK_PAGE_ID and FACEBOOK_PAGE_ACCESS_TOKEN on the worker (see docs/FACEBOOK_SETUP.md)");
  const jobId = publication.output.jobId;
  const sidecar = jobId ? await deps.findSidecar(jobId) : null;
  const log = async (level: "INFO" | "WARN", message: string, data?: Record<string, unknown>) => { console.log(`[facebook] ${message}`, data ?? ""); if (jobId) await logJobEvent(jobId, level, message, data); };
  const result = await publishVideoToFacebook({ filePath: publication.output.storagePath, ...inputs, published: publication.privacy === "PUBLIC", sidecar }, { config, log, client: { pollIntervalMs: Number(process.env.FACEBOOK_STATUS_POLL_MS ?? 5000), timeoutMs: Number(process.env.FACEBOOK_PROCESSING_TIMEOUT_MS ?? 30 * 60_000), retryDelayMs: Number(process.env.FACEBOOK_RETRY_DELAY_MS ?? 1000) } });
  return result.videoId;
}

async function runYouTubePublication(publication: PublicationRow, inputs: PublicationInputs, _deps: CaptionPublishDeps) {
  const result = await uploadToYouTube({ accessToken: await getYouTubeAccessToken(), filePath: publication.output.storagePath, ...inputs, privacyStatus: publication.privacy.toLowerCase() as "private" | "unlisted" | "public" });
  if (result.thumbnailError && publication.output.jobId) await logJobEvent(publication.output.jobId, "WARN", "YouTube thumbnail upload failed; the video itself was published", { videoId: result.videoId, error: result.thumbnailError });
  return result.videoId;
}

async function processPublication() {
  const publication = await prisma.publication.findFirst({ where: { status: "QUEUED" }, orderBy: { createdAt: "asc" }, include: { project: true, output: true } }); if (!publication?.output) return false;
  const claimed = await prisma.publication.updateMany({ where: { id: publication.id, status: "QUEUED" }, data: { status: "UPLOADING" } }); if (!claimed.count) return false;
  // The uploaders read local files: with S3 media the video, thumbnail and caption sidecar are downloaded first.
  const files = await openJobFiles({ store: await getMediaStore(), mediaRoot: MEDIA_ROOT, jobId: `publication-${publication.id}` });
  const deps: CaptionPublishDeps = { ...captionPublishDeps, findSidecar: async jobId => { const sidecar = await captionPublishDeps.findSidecar(jobId); return sidecar ? { ...sidecar, storagePath: await files.local(sidecar.storagePath) } : null; } };
  try {
    const row = { ...publication, output: { ...publication.output, storagePath: await files.local(publication.output.storagePath) } };
    const thumbnail = await prisma.output.findFirst({ where: { projectId: publication.projectId, type: "THUMBNAIL", preview: false }, orderBy: { createdAt: "desc" } });
    const inputs: PublicationInputs = { thumbnailPath: thumbnail ? await files.local(thumbnail.storagePath).catch(() => undefined) : undefined, title: publication.project.title, description: publication.project.preacher ? `Preacher: ${publication.project.preacher}` : undefined };
    const externalId = await (publication.provider === "FACEBOOK" ? runFacebookPublication : runYouTubePublication)(row, inputs, deps);
    await prisma.publication.update({ where: { id: publication.id }, data: { status: "COMPLETED", externalId, completedAt: new Date(), error: null } });
    // Facebook uploads its captions as part of publishVideoToFacebook; YouTube captions go up after the video.
    if (publication.provider === "YOUTUBE") await uploadCaptionsAfterVideo({ videoId: externalId, videoOutput: publication.output }, deps);
  } catch (error) { await prisma.publication.update({ where: { id: publication.id }, data: { status: "FAILED", error: error instanceof Error ? error.message : String(error) } }); } finally { await files.cleanup(); }
  return true;
}

// No expiry cleanup: project media is persistent. The expiresAt columns are legacy and nothing reads or writes them.
process.on("SIGTERM", async () => { for (const timer of progressTimers.values()) clearTimeout(timer); for (const proc of runningProcesses.values()) proc.kill("SIGTERM"); await remoteExecutor?.close(); await remoteDownloader?.close(); process.exit(0); });
/** Publications run in their own lane: a slow upload (Facebook polls for up to 30 minutes) must not hold up renders. */
async function publicationLane() { while (true) { try { if (!(await processPublication())) await sleep(POLL_MS); } catch (error) { console.error("Publication loop error:", error); await sleep(POLL_MS); } } }
async function main() {
  setInterval(() => { void heartbeat(prisma as unknown as RecoveryDb, WORKER_ID).catch(error => console.error("Heartbeat failed:", error)); }, HEARTBEAT_MS);
  await recoverInterruptedJobs().catch(error => console.error("Failed to recover interrupted jobs:", error));
  setInterval(() => { void recoverInterruptedJobs().catch(error => console.error("Failed to recover interrupted jobs:", error)); }, 30_000);
  void publicationLane();
  const running = new Set<Promise<void>>();
  while (true) {
    try {
      if (running.size >= JOB_CONCURRENCY) { await Promise.race(running); continue; }
      const job = await claimJob(); if (!job) { await sleep(POLL_MS); continue; }
      const task: Promise<void> = runClaimedJob(job).finally(() => running.delete(task)); running.add(task);
    } catch (error) { console.error("Worker loop error:", error); await sleep(POLL_MS); }
  }
}
