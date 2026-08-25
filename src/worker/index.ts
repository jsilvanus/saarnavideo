import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { buildCompositionRenderPlan } from "@/renderer/composition";
import type { ProjectDefinition } from "@/domain/project";
import { resolveSourcePaths } from "@/worker/source-resolution";
import { downloadYouTubeSource, uploadToYouTube } from "@/integrations/youtube";
import { getYouTubeAccessToken } from "@/integrations/youtube-oauth";
import { validateSourceFile, formatBytes, type ResourceLimits } from "@/domain/validation";

const execFileAsync = promisify(execFile);
const MIN_POLL_MS = 500;
const MAX_POLL_MS = 2000;
const DEFAULT_POLL_MS = 750;
const POLL_MS = Math.min(Math.max(Number(process.env.WORKER_POLL_MS ?? DEFAULT_POLL_MS), MIN_POLL_MS), MAX_POLL_MS);
const PROGRESS_WRITE_MS = 750;
const MEDIA_ROOT = process.env.MEDIA_ROOT ?? "/data/media";
const RETENTION_MS = Number(process.env.MEDIA_RETENTION_DAYS ?? 7) * 24 * 60 * 60 * 1000;
const RESOURCE_LIMITS: ResourceLimits = { maxSourceFileSizeBytes: Number(process.env.MAX_SOURCE_SIZE_BYTES ?? 50 * 1024 * 1024 * 1024), maxOutputFileSizeBytes: Number(process.env.MAX_OUTPUT_SIZE_BYTES ?? 100 * 1024 * 1024 * 1024), maxDurationSeconds: Number(process.env.MAX_DURATION_SECONDS ?? 12 * 60 * 60), maxConcurrentJobs: Number(process.env.MAX_CONCURRENT_JOBS ?? 2), requestTimeoutSeconds: Number(process.env.REQUEST_TIMEOUT_SECONDS ?? 60 * 60) };
const runningProcesses = new Map<string, ChildProcessWithoutNullStreams>();
const progressTimers = new Map<string, NodeJS.Timeout>();

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

async function createOutput(projectId: string, jobId: string, type: "VIDEO" | "THUMBNAIL", storagePath: string, mimeType: string, preview = false) { let sizeBytes: number | undefined; try { sizeBytes = (await stat(storagePath)).size; const maxSize = type === "VIDEO" ? RESOURCE_LIMITS.maxOutputFileSizeBytes : 50 * 1024 * 1024; if (sizeBytes > maxSize) throw new Error(`${type} file size ${formatBytes(sizeBytes)} exceeds limit ${formatBytes(maxSize)}`); } catch (error) { if (error instanceof Error && error.message.includes("exceeds limit")) throw error; } return prisma.output.create({ data: { projectId, jobId, type, preview, storagePath, mimeType, sizeBytes, expiresAt: new Date(Date.now() + RETENTION_MS) } }); }

async function processDownload(job: Awaited<ReturnType<typeof claimJob>>) {
  if (!job?.sourceId) throw new Error("DOWNLOAD job has no source");
  const source = await prisma.source.findUnique({ where: { id: job.sourceId } }); if (!source) throw new Error("Source not found");
  if (source.storagePath) { try { const s = await stat(source.storagePath); if (validateSourceFile(s.size, RESOURCE_LIMITS).valid) { await updateProgress(job.id, { progress: 100, phase: "DOWNLOADED", message: "Source already available" }, true); return; } } catch { /* re-download */ } }
  if (source.type !== "YOUTUBE" || !source.youtubeUrl || !source.youtubeVideoId) throw new Error("Source is not a downloadable YouTube source");
  const storagePath = path.join(MEDIA_ROOT, "sources", job.projectId, `${source.youtubeVideoId}.mp4`);
  await updateProgress(job.id, { phase: "DOWNLOADING", message: "Downloading YouTube source", progress: 0 }, true);
  await downloadYouTubeSource({ videoId: source.youtubeVideoId, url: source.youtubeUrl }, storagePath, async p => { await updateProgress(job.id, { phase: "DOWNLOADING", message: "Downloading YouTube source", progress: Math.round(p.percent), bytesProcessed: p.bytesProcessed, totalBytes: p.totalBytes, speed: p.speed, etaSeconds: p.etaSeconds }); });
  const s = await stat(storagePath); const validation = validateSourceFile(s.size, RESOURCE_LIMITS); if (!validation.valid) { await rm(storagePath, { force: true }); throw new Error(validation.reason); }
  await prisma.source.update({ where: { id: source.id }, data: { storagePath, mimeType: "video/mp4", sizeBytes: BigInt(s.size), expiresAt: new Date(Date.now() + RETENTION_MS) } });
  await updateProgress(job.id, { progress: 100, phase: "DOWNLOADED", message: "Download complete", bytesProcessed: BigInt(s.size), totalBytes: BigInt(s.size) }, true);
}

async function runFfmpegJob(job: Awaited<ReturnType<typeof claimJob>>, type: "VIDEO" | "PREVIEW" | "THUMBNAIL") {
  if (!job) throw new Error("Missing job");
  const project = await prisma.project.findUnique({ where: { id: job.projectId }, include: { sources: true, assets: true } }); if (!project) throw new Error("Project not found");
  const definition = (job.parameters && typeof job.parameters === "object" && "renderDefinition" in (job.parameters as Record<string, unknown>) ? (job.parameters as { renderDefinition: ProjectDefinition }).renderDefinition : project.definition) as unknown as ProjectDefinition;
  await mkdir(MEDIA_ROOT, { recursive: true });
  if (type === "THUMBNAIL") {
    const video = await prisma.output.findFirst({ where: { projectId: project.id, type: "VIDEO", preview: false }, orderBy: { createdAt: "desc" } }); if (!video) throw new Error("No completed video available for thumbnail");
    const outputPath = path.join(MEDIA_ROOT, `${project.id}-${job.id}.jpg`); await updateProgress(job.id, { phase: "THUMBNAIL", message: "Extracting thumbnail", progress: 10 }, true); await execFileAsync("ffmpeg", ["-hide_banner", "-y", "-ss", "1", "-i", video.storagePath, "-frames:v", "1", "-q:v", "2", outputPath]); await createOutput(project.id, job.id, "THUMBNAIL", outputPath, "image/jpeg"); await updateProgress(job.id, { status: "COMPLETED", progress: 100, phase: "COMPLETE", message: "Thumbnail ready", completedAt: new Date() }, true); return;
  }
  const sourcePaths = resolveSourcePaths(definition, project.sources); const assetPaths = new Map<string, string>(); for (const asset of project.assets) { assetPaths.set(asset.assetKey, asset.storagePath); assetPaths.set(asset.id, asset.storagePath); assetPaths.set(`/api/projects/${project.id}/assets/${asset.id}`, asset.storagePath); }
  const outputPath = path.join(MEDIA_ROOT, `${project.id}-${job.id}${type === "PREVIEW" ? ".preview" : ""}.mp4`); const plan = buildCompositionRenderPlan(definition, sourcePaths, outputPath, assetPaths); const outputIndex = plan.args.length - 1; if (type === "PREVIEW") plan.args.splice(outputIndex, 0, "-vf", "scale=640:-2", "-preset", "ultrafast", "-crf", "30");
  const totalMs = Math.max(1, Math.round((definition.composition.sourceEndSeconds - definition.composition.sourceStartSeconds) * 1000)); plan.args.splice(plan.args.length - 1, 0, "-progress", "pipe:1", "-nostats");
  await updateProgress(job.id, { phase: type === "PREVIEW" ? "PREVIEW_RENDER" : "ENCODING", message: type === "PREVIEW" ? "Rendering preview" : "Rendering video", progress: 0, totalMs: BigInt(totalMs) }, true);
  const ffmpegProcess = spawn("ffmpeg", plan.args, { stdio: ["pipe", "pipe", "pipe"] }); runningProcesses.set(job.id, ffmpegProcess); let stdoutBuffer = ""; let stderr = "";
  ffmpegProcess.stdout.on("data", chunk => { stdoutBuffer += chunk.toString(); const lines = stdoutBuffer.split("\n"); stdoutBuffer = lines.pop() ?? ""; for (const line of lines) { const [key, value] = line.trim().split("="); if (key === "out_time_ms" && value) { const currentMs = Number(value) / 1000; const progress = Math.max(0, Math.min(99, Math.round((currentMs / totalMs) * 100))); void updateProgress(job.id, { phase: type === "PREVIEW" ? "PREVIEW_RENDER" : "ENCODING", message: `Rendering ${type.toLowerCase()}`, progress, currentMs: BigInt(Math.round(currentMs)), totalMs: BigInt(totalMs) }); } if (key === "speed" && value) void updateProgress(job.id, { speed: value }); } });
  ffmpegProcess.stderr.on("data", chunk => { stderr += chunk.toString(); });
  await new Promise<void>((resolve, reject) => { ffmpegProcess.on("close", code => code === 0 ? resolve() : reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-2000)}`))); ffmpegProcess.on("error", reject); }); runningProcesses.delete(job.id);
  await createOutput(project.id, job.id, "VIDEO", outputPath, "video/mp4", type === "PREVIEW"); await updateProgress(job.id, { status: "COMPLETED", progress: 100, phase: "COMPLETE", message: `${type === "PREVIEW" ? "Preview" : "Video"} ready`, completedAt: new Date() }, true);
}

async function processJob() { const job = await claimJob(); if (!job) return false; try { if (job.type === "DOWNLOAD") await processDownload(job); else await runFfmpegJob(job, job.type); } catch (error) { const message = error instanceof Error ? error.message : String(error); await updateProgress(job.id, { status: "FAILED", phase: "FAILED", message, error: message }, true); await logJobEvent(job.id, "ERROR", "Media job failed", { error: message, type: job.type }); } return true; }

async function processPublication() { const publication = await prisma.publication.findFirst({ where: { status: "QUEUED" }, orderBy: { createdAt: "asc" }, include: { project: true, output: true } }); if (!publication?.output) return false; const claimed = await prisma.publication.updateMany({ where: { id: publication.id, status: "QUEUED" }, data: { status: "UPLOADING" } }); if (!claimed.count) return false; try { const thumbnail = await prisma.output.findFirst({ where: { projectId: publication.projectId, type: "THUMBNAIL", preview: false, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }); const result = await uploadToYouTube({ accessToken: await getYouTubeAccessToken(), filePath: publication.output.storagePath, thumbnailPath: thumbnail?.storagePath, title: publication.project.title, description: publication.project.preacher ? `Preacher: ${publication.project.preacher}` : undefined, privacyStatus: publication.privacy.toLowerCase() as "private" | "unlisted" | "public" }); await prisma.publication.update({ where: { id: publication.id }, data: { status: "COMPLETED", externalId: result.videoId, completedAt: new Date() } }); } catch (error) { await prisma.publication.update({ where: { id: publication.id }, data: { status: "FAILED", error: error instanceof Error ? error.message : String(error) } }); } return true; }

async function cleanupExpiredMedia() { const now = new Date(); const [sources, outputs] = await Promise.all([prisma.source.findMany({ where: { expiresAt: { not: null, lt: now }, storagePath: { not: null } }, select: { id: true, storagePath: true } }), prisma.output.findMany({ where: { expiresAt: { not: null, lt: now } }, select: { id: true, storagePath: true } })]); for (const source of sources) { if (source.storagePath) await rm(source.storagePath, { force: true }).catch(() => undefined); await prisma.source.update({ where: { id: source.id }, data: { storagePath: null } }).catch(() => undefined); } for (const output of outputs) { await rm(output.storagePath, { force: true }).catch(() => undefined); await prisma.output.delete({ where: { id: output.id } }).catch(() => undefined); } }
process.on("SIGTERM", async () => { for (const timer of progressTimers.values()) clearTimeout(timer); for (const proc of runningProcesses.values()) proc.kill("SIGTERM"); process.exit(0); });
async function main() { let lastCleanup = 0; while (true) { try { if (Date.now() - lastCleanup > 60000) { await cleanupExpiredMedia(); lastCleanup = Date.now(); } const didWork = (await processPublication()) || (await processJob()); if (!didWork) await new Promise(resolve => setTimeout(resolve, POLL_MS)); } catch (error) { console.error("Worker loop error:", error); await new Promise(resolve => setTimeout(resolve, POLL_MS)); } } }
main().catch(error => { console.error("Fatal error:", error); process.exit(1); });