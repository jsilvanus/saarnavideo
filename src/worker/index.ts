import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { buildCompositionRenderPlan } from "@/renderer/composition";
import type { ProjectDefinition } from "@/domain/project";
import { resolveSourcePaths } from "@/worker/source-resolution";
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
import { formatSrt, formatVtt } from "@/lib/captions";
import { readFacebookConfig } from "@/integrations/facebook";
import { publishVideoToFacebook } from "@/worker/facebook-publish";

const execFileAsync = promisify(execFile);
const MIN_POLL_MS = 500;
const MAX_POLL_MS = 2000;
const DEFAULT_POLL_MS = 750;
const POLL_MS = Math.min(Math.max(Number(process.env.WORKER_POLL_MS ?? DEFAULT_POLL_MS), MIN_POLL_MS), MAX_POLL_MS);
const PROGRESS_WRITE_MS = 750;
const MEDIA_ROOT = process.env.MEDIA_ROOT ?? "/data/media";
const RESOURCE_LIMITS: ResourceLimits = { maxSourceFileSizeBytes: Number(process.env.MAX_SOURCE_SIZE_BYTES ?? 50 * 1024 * 1024 * 1024), maxOutputFileSizeBytes: Number(process.env.MAX_OUTPUT_SIZE_BYTES ?? 100 * 1024 * 1024 * 1024), maxDurationSeconds: Number(process.env.MAX_DURATION_SECONDS ?? 12 * 60 * 60), maxConcurrentJobs: Number(process.env.MAX_CONCURRENT_JOBS ?? 2), requestTimeoutSeconds: Number(process.env.REQUEST_TIMEOUT_SECONDS ?? 60 * 60) };
const runningProcesses = new Map<string, ChildProcessWithoutNullStreams>();
const progressTimers = new Map<string, NodeJS.Timeout>();
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function logJobEvent(jobId: string, level: "DEBUG" | "INFO" | "WARN" | "ERROR", message: string, data?: Record<string, unknown>) { try { await prisma.jobLog.create({ data: { jobId, level, message, data: data ? JSON.stringify(data) : undefined } }); } catch (error) { console.error(`Failed to log job event: ${error}`); } }
async function updateProgress(jobId: string, data: Record<string, unknown>, force = false) { const write = async () => { progressTimers.delete(jobId); try { await prisma.mediaJob.update({ where: { id: jobId }, data }); } catch (error) { console.error(`Failed to update job progress: ${error}`); } }; if (force) { const timer = progressTimers.get(jobId); if (timer) clearTimeout(timer); await write(); return; } if (progressTimers.has(jobId)) return; progressTimers.set(jobId, setTimeout(() => void write(), PROGRESS_WRITE_MS)); }

async function claimJob() {
  const candidates = await prisma.mediaJob.findMany({ where: { status: "QUEUED" }, orderBy: [{ priority: "desc" }, { createdAt: "asc" }], take: 10 });
  for (const candidate of candidates) {
    if (candidate.dependsOnJobId) { const dependency = await prisma.mediaJob.findUnique({ where: { id: candidate.dependsOnJobId }, select: { status: true } }); if (dependency && dependency.status !== "COMPLETED") { if (dependency.status === "FAILED" || dependency.status === "CANCELLED") await prisma.mediaJob.update({ where: { id: candidate.id }, data: { status: "FAILED", error: "Dependency did not complete" } }); continue; } }
    const result = await prisma.mediaJob.updateMany({ where: { id: candidate.id, status: "QUEUED" }, data: { status: "RUNNING", startedAt: new Date(), phase: "STARTING", message: "Worker claimed job" } });
    if (result.count === 1) return candidate;
  }
  return null;
}

async function createOutput(projectId: string, jobId: string, type: "VIDEO" | "THUMBNAIL" | "CAPTIONS_SRT" | "CAPTIONS_VTT" | "AUDIO", storagePath: string, mimeType: string, preview = false, language?: string) {
  const sizeBytes = await stat(storagePath).then(s => s.size, () => undefined);
  const maxSize = type === "VIDEO" || type === "AUDIO" ? RESOURCE_LIMITS.maxOutputFileSizeBytes : 50 * 1024 * 1024;
  if (sizeBytes !== undefined && sizeBytes > maxSize) throw new Error(`${type} file size ${formatBytes(sizeBytes)} exceeds limit ${formatBytes(maxSize)}`);
  return prisma.output.create({ data: { projectId, jobId, type, preview, storagePath, mimeType, language, sizeBytes } }); }

async function processDownload(job: Awaited<ReturnType<typeof claimJob>>) {
  if (!job?.sourceId) throw new Error("DOWNLOAD job has no source");
  const source = await prisma.source.findUnique({ where: { id: job.sourceId } }); if (!source) throw new Error("Source not found");
  if (source.storagePath) { try { const s = await stat(source.storagePath); if (validateSourceFile(s.size, RESOURCE_LIMITS).valid) { await updateProgress(job.id, { progress: 100, phase: "DOWNLOADED", message: "Source already available" }, true); return; } } catch { /* re-download */ } }
  if (source.type !== "YOUTUBE" || !source.youtubeUrl || !source.youtubeVideoId) throw new Error("Source is not a downloadable YouTube source");
  const storagePath = path.join(MEDIA_ROOT, "sources", job.projectId, `${source.youtubeVideoId}.mp4`);
  await updateProgress(job.id, { phase: "DOWNLOADING", message: "Downloading YouTube source", progress: 0 }, true);
  await downloadYouTubeSource({ videoId: source.youtubeVideoId, url: source.youtubeUrl }, storagePath, async p => { await updateProgress(job.id, { phase: "DOWNLOADING", message: "Downloading YouTube source", progress: Math.round(p.percent), bytesProcessed: p.bytesProcessed, totalBytes: p.totalBytes, speed: p.speed, etaSeconds: p.etaSeconds }); });
  const s = await stat(storagePath); const validation = validateSourceFile(s.size, RESOURCE_LIMITS); if (!validation.valid) { await rm(storagePath, { force: true }); throw new Error(validation.reason); }
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

async function runFfmpegJob(job: Awaited<ReturnType<typeof claimJob>>, type: "VIDEO" | "PREVIEW" | "THUMBNAIL") {
  if (!job) throw new Error("Missing job");
  const project = await prisma.project.findUnique({ where: { id: job.projectId }, include: { sources: true, assets: true } }); if (!project) throw new Error("Project not found");
  const definition = jobDefinition(job, project);
  await mkdir(MEDIA_ROOT, { recursive: true });
  if (type === "THUMBNAIL") {
    const video = await prisma.output.findFirst({ where: { projectId: project.id, type: "VIDEO", preview: false }, orderBy: { createdAt: "desc" } }); if (!video) throw new Error("No completed video available for thumbnail");
    const outputPath = path.join(MEDIA_ROOT, `${project.id}-${job.id}.jpg`); await updateProgress(job.id, { phase: "THUMBNAIL", message: "Extracting thumbnail", progress: 10 }, true); await execFileAsync("ffmpeg", ["-hide_banner", "-y", "-ss", "1", "-i", video.storagePath, "-frames:v", "1", "-q:v", "2", outputPath]); await createOutput(project.id, job.id, "THUMBNAIL", outputPath, "image/jpeg"); await updateProgress(job.id, { status: "COMPLETED", progress: 100, phase: "COMPLETE", message: "Thumbnail ready", completedAt: new Date() }, true); return;
  }
  const sourcePaths = resolveSourcePaths(definition, project.sources); const assetPaths = new Map<string, string>(); for (const asset of project.assets) { assetPaths.set(asset.assetKey, asset.storagePath); assetPaths.set(asset.id, asset.storagePath); assetPaths.set(`/api/projects/${project.id}/assets/${asset.id}`, asset.storagePath); }
  for (const warning of findUnresolvedImageRefs(definition, project.assets)) await logJobEvent(job.id, "WARN", warning);
  // Voiceovers are looked up by id in the whole library (they need not be linked to the project like images do).
  for (const asset of await prisma.asset.findMany({ where: { id: { in: referencedAudioAssetIds(definition) } } })) assetPaths.set(asset.id, asset.storagePath);
  const outputPath = path.join(MEDIA_ROOT, `${project.id}-${job.id}${type === "PREVIEW" ? ".preview" : ""}.mp4`); const captions = readCaptionOptions(job.parameters); const prepared = captions.mode !== "none" ? await prepareCaptions(job.id, definition, outputPath, captions) : null; const captionFiles = prepared?.soft ?? null;
  const plan = buildCompositionRenderPlan(definition, sourcePaths, outputPath, assetPaths, { captions: captionFiles ? { path: captionFiles.srtPath, language: toIso6392(captionFiles.language) } : undefined, burnedCaptions: prepared?.burn ?? undefined });
  if (type === "PREVIEW") {
    // -vf cannot be combined with a -filter_complex output, so the downscale is appended to the graph.
    const graphIndex = plan.args.indexOf("-filter_complex") + 1;
    const videoMapIndex = plan.args.indexOf("-map", graphIndex) + 1;
    plan.args[graphIndex] += `;${plan.args[videoMapIndex]}scale=640:-2[preview]`;
    plan.args[videoMapIndex] = "[preview]";
    plan.args.splice(plan.args.length - 1, 0, "-preset", "ultrafast", "-crf", "30");
  }
  const phase = type === "PREVIEW" ? "PREVIEW_RENDER" : "ENCODING"; const message = type === "PREVIEW" ? "Rendering preview" : "Rendering video"; const totalMs = Math.max(1, Math.round((definition.composition.sourceEndSeconds - definition.composition.sourceStartSeconds) * 1000));
  await updateProgress(job.id, { phase, message, progress: 0, totalMs: BigInt(totalMs) }, true);
  try { await runFfmpegWithProgress(job.id, plan.args, totalMs, { phase, message, from: 0, to: 99, reportSpeed: true }); }
  finally { if (prepared?.burn) void rm(prepared.burn.assPath, { force: true }).catch(() => undefined); }
  await createOutput(project.id, job.id, "VIDEO", outputPath, "video/mp4", type === "PREVIEW", captionFiles?.language);
  if (captionFiles) { await createOutput(project.id, job.id, "CAPTIONS_SRT", captionFiles.srtPath, CAPTION_MIME.srt, type === "PREVIEW", captionFiles.language); await createOutput(project.id, job.id, "CAPTIONS_VTT", captionFiles.vttPath, CAPTION_MIME.vtt, type === "PREVIEW", captionFiles.language); }
  await updateProgress(job.id, { status: "COMPLETED", progress: 100, phase: "COMPLETE", message: `${type === "PREVIEW" ? "Preview" : "Video"} ready`, completedAt: new Date() }, true);
}

type ProgressRange = { phase: string; message: string; from: number; to: number; reportSpeed?: boolean };

/** Runs ffmpeg with -progress output; resolves with stderr (loudnorm prints its measurement there). Progress covers [from, to] percent. */
async function runFfmpegWithProgress(jobId: string, args: string[], totalMs: number, { phase, message, from, to, reportSpeed }: ProgressRange): Promise<string> {
  const withProgress = [...args.slice(0, 2), "-progress", "pipe:1", "-nostats", ...args.slice(2)];
  const child = spawn("ffmpeg", withProgress, { stdio: ["pipe", "pipe", "pipe"] });
  runningProcesses.set(jobId, child);
  let stdoutBuffer = ""; let stderr = "";
  child.stdout.on("data", chunk => { stdoutBuffer += chunk.toString(); const lines = stdoutBuffer.split("\n"); stdoutBuffer = lines.pop() ?? ""; for (const line of lines) { const [key, value] = line.trim().split("="); if (key === "out_time_ms" && value && Number.isFinite(Number(value))) { const currentMs = Number(value) / 1000; const progress = Math.round(from + Math.max(0, Math.min(1, currentMs / totalMs)) * (to - from)); void updateProgress(jobId, { phase, message, progress: Math.min(99, progress), currentMs: BigInt(Math.round(currentMs)), totalMs: BigInt(totalMs) }); } if (reportSpeed && key === "speed" && value) void updateProgress(jobId, { speed: value }); } });
  child.stderr.on("data", chunk => { stderr += chunk.toString(); });
  try { await new Promise<void>((resolve, reject) => { child.on("close", code => code === 0 ? resolve() : reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-2000)}`))); child.on("error", reject); }); } finally { runningProcesses.delete(jobId); }
  return stderr;
}

/** PODCAST job: intro + composition audio + outro as one loudness-normalised MP3/M4A with tags and cover art (see buildPodcastRenderPlan). */
async function runPodcastJob(job: Awaited<ReturnType<typeof claimJob>>) {
  if (!job) throw new Error("Missing job");
  const project = await prisma.project.findUnique({ where: { id: job.projectId }, include: { sources: true } }); if (!project) throw new Error("Project not found");
  const definition = jobDefinition(job, project);
  const settings = readPodcastSettings(definition, job.parameters);
  await mkdir(MEDIA_ROOT, { recursive: true });
  const sourcePaths = resolveSourcePaths(definition, project.sources);
  const audioIds = referencedAudioAssetIds(definition, settings);
  const audioAssets = new Map((await prisma.asset.findMany({ where: { id: { in: audioIds } } })).map(asset => [asset.id, asset]));
  const missing = audioIds.filter(id => !audioAssets.has(id)); if (missing.length) throw new Error(`Audio assets not found in the library: ${missing.join(", ")}`);
  const assetPaths = new Map([...audioAssets].map(([id, asset]) => [id, asset.storagePath]));
  const pickTrack = (assetId?: string) => { const asset = assetId ? audioAssets.get(assetId) : undefined; return asset ? { path: asset.storagePath, durationSeconds: asset.durationMs != null ? asset.durationMs / 1000 : undefined } : undefined; };
  const thumbnails = await prisma.output.findMany({ where: { projectId: project.id, type: "THUMBNAIL" }, orderBy: { createdAt: "desc" }, take: 5 });
  let coverPath: string | undefined; for (const thumbnail of thumbnails) { if (await stat(thumbnail.storagePath).then(() => true, () => false)) { coverPath = thumbnail.storagePath; break; } }
  if (!coverPath) await logJobEvent(job.id, "INFO", "No thumbnail available yet; the podcast gets no cover art");
  const metadata = resolvePodcastMetadata(project, settings);
  const outputPath = path.join(MEDIA_ROOT, `${project.id}-${job.id}.${settings.format}`);
  const planOptions = { settings, intro: pickTrack(settings.introAssetId), outro: pickTrack(settings.outroAssetId), coverPath, metadata };
  const measurePlan = buildPodcastRenderPlan(definition, sourcePaths, outputPath, assetPaths, { ...planOptions, loudness: "measure" });
  const totalMs = Math.max(1, Math.round(measurePlan.durationSeconds * 1000));
  await updateProgress(job.id, { phase: "ANALYSING", message: "Measuring loudness", progress: 0, totalMs: BigInt(totalMs) }, true);
  const measureLog = await runFfmpegWithProgress(job.id, measurePlan.args, totalMs, { phase: "ANALYSING", message: "Measuring loudness", from: 0, to: 40 });
  const measurement = parseLoudnormMeasurement(measureLog);
  // Silent or unmeasurable audio: fall back to single-pass loudnorm rather than failing the job.
  if (!measurement) await logJobEvent(job.id, "WARN", "Loudness measurement failed; using single-pass normalisation");
  else await logJobEvent(job.id, "INFO", `Measured ${measurement.input_i} LUFS, normalising to ${PODCAST_TARGET_LUFS} LUFS`, { ...measurement });
  const plan = buildPodcastRenderPlan(definition, sourcePaths, outputPath, assetPaths, { ...planOptions, loudness: measurement ?? undefined });
  await updateProgress(job.id, { phase: "ENCODING", message: "Encoding podcast", progress: 40 }, true);
  await runFfmpegWithProgress(job.id, plan.args, totalMs, { phase: "ENCODING", message: "Encoding podcast", from: 40, to: 100 });
  await createOutput(project.id, job.id, "AUDIO", outputPath, podcastMimeType(settings.format));
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
};

// See docs/transcription-editor-contract.md, "MediaJob.parameters shape for a TRANSCRIBE job".
function readTranscribeParameters(parameters: unknown): TranscribeParameters {
  const params = (parameters && typeof parameters === "object" ? parameters : {}) as Partial<TranscribeParameters>;
  if (typeof params.rangeStartSeconds !== "number" || typeof params.rangeEndSeconds !== "number" || typeof params.language !== "string") {
    throw new Error("TRANSCRIBE job is missing rangeStartSeconds/rangeEndSeconds/language parameters");
  }
  return { rangeStartSeconds: params.rangeStartSeconds, rangeEndSeconds: params.rangeEndSeconds, language: params.language, auditorJobId: params.auditorJobId, tempClipPath: params.tempClipPath };
}

function serializeTranscribeParameters(params: TranscribeParameters): Record<string, string | number> {
  const result: Record<string, string | number> = { rangeStartSeconds: params.rangeStartSeconds, rangeEndSeconds: params.rangeEndSeconds, language: params.language };
  if (params.auditorJobId) result.auditorJobId = params.auditorJobId;
  if (params.tempClipPath) result.tempClipPath = params.tempClipPath;
  return result;
}

async function cleanupTempClip(tempClipPath: string | undefined) { if (!tempClipPath) return; await rm(tempClipPath, { force: true }).catch(() => undefined); }

async function extractTranscriptionClip(jobId: string, sourceStoragePath: string, rangeStartSeconds: number, rangeEndSeconds: number): Promise<string> {
  const tmpDir = path.join(MEDIA_ROOT, "tmp");
  await mkdir(tmpDir, { recursive: true });
  const tempClipPath = path.join(tmpDir, `${jobId}.wav`);
  // -ss/-to placed after -i so the cut is sample-accurate rather than keyframe-snapped.
  await execFileAsync("ffmpeg", ["-y", "-i", sourceStoragePath, "-ss", String(rangeStartSeconds), "-to", String(rangeEndSeconds), "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", tempClipPath]);
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
    await updateProgress(job.id, { status: "CANCELLED", phase: "CANCELLED", message: "Cancelled before transcription started", completedAt: new Date() }, true);
    return;
  }

  if (!params.auditorJobId) {
    const durationSeconds = source.durationMs != null ? source.durationMs / 1000 : undefined;
    const isPartial = isPartialRange(params.rangeStartSeconds, params.rangeEndSeconds, durationSeconds);
    let filePath = source.storagePath;
    if (isPartial) {
      await updateProgress(job.id, { phase: "EXTRACTING_RANGE", message: "Extracting requested range", progress: 0 }, true);
      const tempClipPath = await extractTranscriptionClip(job.id, source.storagePath, params.rangeStartSeconds, params.rangeEndSeconds);
      params = { ...params, tempClipPath };
      await prisma.mediaJob.update({ where: { id: job.id }, data: { parameters: serializeTranscribeParameters(params) } });
      filePath = tempClipPath;
    }
    await updateProgress(job.id, { phase: "SUBMITTING", message: "Submitting to transcription service", progress: 0 }, true);
    const submission = await client.submitJob(filePath, { language: params.language });
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
    await updateProgress(job.id, { status: "CANCELLED", phase: "CANCELLED", message: "Cancelled", completedAt: new Date() }, true);
    return;
  }
  if (finalStatus.status === "failed") {
    await cleanupTempClip(params.tempClipPath);
    throw new Error(finalStatus.error ?? "Auditor STT job failed");
  }

  const result = await client.getJobResult(auditorJobId);
  const segments = applyRangeOffset(result.segments, params.rangeStartSeconds);

  await createTranscriptionRun({ sourceId: source.id, jobId: job.id, origin: "SERVICE", language: params.language, rangeStartSeconds: params.rangeStartSeconds, rangeEndSeconds: params.rangeEndSeconds, segments });

  await cleanupTempClip(params.tempClipPath);
  await updateProgress(job.id, { status: "COMPLETED", progress: 100, phase: "COMPLETE", message: "Transcription complete", completedAt: new Date() }, true);
}

/**
 * On worker startup, resume watching any TRANSCRIBE job left RUNNING by a
 * prior worker process that already persisted an auditorJobId - the
 * liturgos-auditor-stt job itself is durable, so there is nothing to redo,
 * only to resume polling. Runs once, before the claim loop starts. A RUNNING
 * job with no auditorJobId yet (crashed before submitting) is left as-is,
 * matching the pre-existing orphaning behavior for ffmpeg jobs.
 */
async function resumeInterruptedTranscriptions() {
  const stuck = await prisma.mediaJob.findMany({ where: { type: "TRANSCRIBE", status: "RUNNING" } });
  for (const job of stuck) {
    const params = job.parameters && typeof job.parameters === "object" ? (job.parameters as Record<string, unknown>) : {};
    if (typeof params.auditorJobId !== "string") continue;
    try {
      await processTranscription(job);
    } catch (error) {
      await failJob(job.id, error, "Resumed transcription job failed");
    }
  }
}

async function processJob() { const job = await claimJob(); if (!job) return false; try { if (job.type === "DOWNLOAD") await processDownload(job); else if (job.type === "TRANSCRIBE") await processTranscription(job); else if (job.type === "PODCAST") await runPodcastJob(job); else await runFfmpegJob(job, job.type); } catch (error) { await failJob(job.id, error, "Media job failed", { type: job.type }); } return true; }

const captionPublishDeps: CaptionPublishDeps = {
  findSidecar: (jobId) => prisma.output.findFirst({ where: { jobId, type: "CAPTIONS_SRT", preview: false }, orderBy: { createdAt: "desc" }, select: { storagePath: true, language: true } }),
  getAccessToken: getYouTubeAccessToken,
  upload: uploadCaptionToYouTube,
  log: async (jobId, level, message, data) => { console.warn(`[captions] ${message}`, data ?? ""); if (jobId) await logJobEvent(jobId, level, message, data); },
};

type PublicationRow = { id: string; projectId: string; privacy: string; project: { title: string; preacher: string | null }; output: { storagePath: string; jobId: string | null } };
type PublicationInputs = { thumbnailPath?: string; title: string; description?: string };

/** Facebook Page upload: the token comes from the environment (never the database) and stays out of logs and errors. */
async function runFacebookPublication(publication: PublicationRow, inputs: PublicationInputs) {
  const config = readFacebookConfig();
  if (!config) throw new Error("Facebook is not configured: set FACEBOOK_PAGE_ID and FACEBOOK_PAGE_ACCESS_TOKEN on the worker (see docs/FACEBOOK_SETUP.md)");
  const jobId = publication.output.jobId;
  const sidecar = jobId ? await captionPublishDeps.findSidecar(jobId) : null;
  const log = async (level: "INFO" | "WARN", message: string, data?: Record<string, unknown>) => { console.log(`[facebook] ${message}`, data ?? ""); if (jobId) await logJobEvent(jobId, level, message, data); };
  const result = await publishVideoToFacebook({ filePath: publication.output.storagePath, ...inputs, published: publication.privacy === "PUBLIC", sidecar }, { config, log, client: { pollIntervalMs: Number(process.env.FACEBOOK_STATUS_POLL_MS ?? 5000), timeoutMs: Number(process.env.FACEBOOK_PROCESSING_TIMEOUT_MS ?? 30 * 60_000), retryDelayMs: Number(process.env.FACEBOOK_RETRY_DELAY_MS ?? 1000) } });
  return result.videoId;
}

async function runYouTubePublication(publication: PublicationRow, inputs: PublicationInputs) {
  const result = await uploadToYouTube({ accessToken: await getYouTubeAccessToken(), filePath: publication.output.storagePath, ...inputs, privacyStatus: publication.privacy.toLowerCase() as "private" | "unlisted" | "public" });
  if (result.thumbnailError && publication.output.jobId) await logJobEvent(publication.output.jobId, "WARN", "YouTube thumbnail upload failed; the video itself was published", { videoId: result.videoId, error: result.thumbnailError });
  return result.videoId;
}

async function processPublication() {
  const publication = await prisma.publication.findFirst({ where: { status: "QUEUED" }, orderBy: { createdAt: "asc" }, include: { project: true, output: true } }); if (!publication?.output) return false;
  const claimed = await prisma.publication.updateMany({ where: { id: publication.id, status: "QUEUED" }, data: { status: "UPLOADING" } }); if (!claimed.count) return false;
  const row = { ...publication, output: publication.output };
  try {
    const thumbnail = await prisma.output.findFirst({ where: { projectId: publication.projectId, type: "THUMBNAIL", preview: false }, orderBy: { createdAt: "desc" } });
    const inputs: PublicationInputs = { thumbnailPath: thumbnail?.storagePath, title: publication.project.title, description: publication.project.preacher ? `Preacher: ${publication.project.preacher}` : undefined };
    const externalId = await (publication.provider === "FACEBOOK" ? runFacebookPublication : runYouTubePublication)(row, inputs);
    await prisma.publication.update({ where: { id: publication.id }, data: { status: "COMPLETED", externalId, completedAt: new Date(), error: null } });
    // Facebook uploads its captions as part of publishVideoToFacebook; YouTube captions go up after the video.
    if (publication.provider === "YOUTUBE") await uploadCaptionsAfterVideo({ videoId: externalId, videoOutput: publication.output }, captionPublishDeps);
  } catch (error) { await prisma.publication.update({ where: { id: publication.id }, data: { status: "FAILED", error: error instanceof Error ? error.message : String(error) } }); }
  return true;
}

// No expiry cleanup: project media is persistent (src/lib/prisma.ts clears expiresAt on write and drops expiresAt filters on
// findMany). The former cleanupExpiredMedia() relied on that filter, so it selected *every* source and output and deleted
// their files once a minute.
process.on("SIGTERM", async () => { for (const timer of progressTimers.values()) clearTimeout(timer); for (const proc of runningProcesses.values()) proc.kill("SIGTERM"); process.exit(0); });
async function main() { await resumeInterruptedTranscriptions().catch(error => console.error("Failed to resume interrupted transcriptions:", error)); while (true) { try { const didWork = (await processPublication()) || (await processJob()); if (!didWork) await sleep(POLL_MS); } catch (error) { console.error("Worker loop error:", error); await sleep(POLL_MS); } } }
main().catch(error => { console.error("Fatal error:", error); process.exit(1); });