import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { buildSourceRenderPlan } from "@/renderer/ffmpeg";
import type { ProjectDefinition } from "@/domain/project";
import { downloadYouTubeSource, uploadToYouTube } from "@/integrations/youtube";
import { getYouTubeAccessToken } from "@/integrations/youtube-oauth";
import { validateSourceFile, validateDuration, formatBytes, formatDuration, type ResourceLimits } from "@/domain/validation";

const execFileAsync = promisify(execFile);
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 3000);
const MEDIA_ROOT = process.env.MEDIA_ROOT ?? "/data/media";
const RETENTION_MS = Number(process.env.MEDIA_RETENTION_DAYS ?? 7) * 24 * 60 * 60 * 1000;

// Resource limits
const RESOURCE_LIMITS: ResourceLimits = {
  maxSourceFileSizeBytes: Number(process.env.MAX_SOURCE_SIZE_BYTES ?? 50 * 1024 * 1024 * 1024),
  maxOutputFileSizeBytes: Number(process.env.MAX_OUTPUT_SIZE_BYTES ?? 100 * 1024 * 1024 * 1024),
  maxDurationSeconds: Number(process.env.MAX_DURATION_SECONDS ?? 12 * 60 * 60),
  maxConcurrentJobs: Number(process.env.MAX_CONCURRENT_JOBS ?? 2),
  requestTimeoutSeconds: Number(process.env.REQUEST_TIMEOUT_SECONDS ?? 60 * 60),
};

// Track running processes for cancellation
const runningProcesses = new Map<string, ChildProcessWithoutNullStreams>();

/**
 * Log a job event to the database for structured auditing.
 */
async function logJobEvent(
  jobId: string,
  level: "DEBUG" | "INFO" | "WARN" | "ERROR",
  message: string,
  data?: Record<string, unknown>
) {
  try {
    await prisma.jobLog.create({
      data: {
        jobId,
        level,
        message,
        data: data ? JSON.stringify(data) : undefined,
      },
    });
  } catch (error) {
    console.error(`Failed to log job event: ${error}`);
  }
}

/**
 * Claim the next queued job, atomically transitioning to ACQUIRING_SOURCE state.
 */
async function claimJob() {
  const candidate = await prisma.generationJob.findFirst({
    where: { status: "QUEUED" },
    orderBy: { createdAt: "asc" },
  });
  if (!candidate) return null;

  const result = await prisma.generationJob.updateMany({
    where: { id: candidate.id, status: "QUEUED" },
    data: { status: "ACQUIRING_SOURCE", startedAt: new Date(), progress: 5 },
  });

  return result.count === 1 ? candidate : null;
}

/**
 * Check if a job has been cancelled by the user.
 */
async function checkCancellation(jobId: string): Promise<boolean> {
  const job = await prisma.generationJob.findUnique({ where: { id: jobId } });
  return job?.cancellationRequested ?? false;
}

/**
 * Create an output record and validate file size.
 */
async function createOutput(
  projectId: string,
  jobId: string,
  type: "VIDEO" | "THUMBNAIL",
  storagePath: string,
  mimeType: string
) {
  let sizeBytes: number | undefined;
  try {
    sizeBytes = (await stat(storagePath)).size;
    const maxSize = type === "VIDEO" ? RESOURCE_LIMITS.maxOutputFileSizeBytes : 50 * 1024 * 1024; // 50 MB for thumbs
    if (sizeBytes > maxSize) {
      throw new Error(
        `${type} file size ${formatBytes(sizeBytes)} exceeds limit ${formatBytes(maxSize)}`
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("exceeds limit")) throw error;
    // File stat errors are recorded but non-fatal
    await logJobEvent(jobId, "WARN", `Could not determine file size for ${type}`, { storagePath });
  }

  return prisma.output.create({
    data: {
      projectId,
      jobId,
      type,
      storagePath,
      mimeType,
      sizeBytes,
      expiresAt: new Date(Date.now() + RETENTION_MS),
    },
  });
}

/**
 * Acquire source file (upload or YouTube download) with validation and resumption support.
 */
async function acquireSource(
  jobId: string,
  project: {
    id: string;
    source: { id: string; type: "UPLOAD" | "YOUTUBE"; storagePath: string | null; youtubeVideoId: string | null; youtubeUrl: string | null } | null;
  }
): Promise<string> {
  if (!project.source) throw new Error("Project has no source");

  // Existing file: verify it still exists and is within retention window
  if (project.source.storagePath) {
    try {
      const stats = await stat(project.source.storagePath);
      const validation = validateSourceFile(stats.size, RESOURCE_LIMITS);
      if (!validation.valid) throw new Error(validation.reason);
      await logJobEvent(jobId, "INFO", "Using existing source file", { path: project.source.storagePath, sizeBytes: stats.size });
      return project.source.storagePath;
    } catch (error) {
      await logJobEvent(jobId, "WARN", "Existing source file unavailable, will retry acquisition", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  // YouTube source: download with resumable retry logic
  if (project.source.type === "YOUTUBE") {
    if (!project.source.youtubeUrl || !project.source.youtubeVideoId) {
      throw new Error("YouTube source missing URL or video ID");
    }

    if (await checkCancellation(jobId)) {
      throw new Error("Job cancelled during source acquisition");
    }

    const directory = path.join(MEDIA_ROOT, "sources", project.id);
    const storagePath = path.join(directory, `${project.source.youtubeVideoId}.mp4`);

    await logJobEvent(jobId, "INFO", "Starting YouTube source download", {
      videoId: project.source.youtubeVideoId,
      url: project.source.youtubeUrl,
    });

    try {
      await downloadYouTubeSource(
        { videoId: project.source.youtubeVideoId, url: project.source.youtubeUrl },
        storagePath
      );

      const stats = await stat(storagePath);
      const validation = validateSourceFile(stats.size, RESOURCE_LIMITS);
      if (!validation.valid) {
        await rm(storagePath, { force: true }).catch(() => undefined);
        throw new Error(validation.reason);
      }

      await prisma.source.update({
        where: { id: project.source.id },
        data: {
          storagePath,
          mimeType: "video/mp4",
          sizeBytes: BigInt(stats.size),
          expiresAt: new Date(Date.now() + RETENTION_MS),
        },
      });

      await logJobEvent(jobId, "INFO", "YouTube source acquired", { sizeBytes: stats.size });
      return storagePath;
    } catch (error) {
      await logJobEvent(jobId, "ERROR", "YouTube source download failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  throw new Error("Source has no usable media or YouTube URL");
}

/**
 * Process publication: upload output to YouTube.
 */
async function processPublication() {
  const publication = await prisma.publication.findFirst({
    where: { status: "QUEUED" },
    orderBy: { createdAt: "asc" },
    include: { project: true, output: true },
  });

  if (!publication || !publication.output) return false;

  const output = publication.output;
  if (output.expiresAt && output.expiresAt <= new Date()) {
    await prisma.publication.update({
      where: { id: publication.id },
      data: { status: "FAILED", error: "Output has expired" },
    });
    return true;
  }

  const claimed = await prisma.publication.updateMany({
    where: { id: publication.id, status: "QUEUED" },
    data: { status: "UPLOADING" },
  });

  if (!claimed.count) return false;

  try {
    const thumbnail = await prisma.output.findFirst({
      where: {
        projectId: publication.projectId,
        type: "THUMBNAIL",
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    const result = await uploadToYouTube({
      accessToken: await getYouTubeAccessToken(),
      filePath: output.storagePath,
      thumbnailPath: thumbnail?.storagePath,
      title: publication.project.title,
      description: publication.project.preacher ? `Preacher: ${publication.project.preacher}` : undefined,
      privacyStatus: publication.privacy.toLowerCase() as "private" | "unlisted" | "public",
    });

    await prisma.publication.update({
      where: { id: publication.id },
      data: { status: "COMPLETED", externalId: result.videoId, completedAt: new Date() },
    });
  } catch (error) {
    await prisma.publication.update({
      where: { id: publication.id },
      data: { status: "FAILED", error: error instanceof Error ? error.message : String(error) },
    });
  }

  return true;
}

/**
 * Process a generation job: acquire source, render, and create outputs.
 */
async function processJob() {
  const job = await claimJob();
  if (!job) return false;

  try {
    const project = await prisma.project.findUnique({
      where: { id: job.projectId },
      include: { source: true },
    });

    if (!project) {
      throw new Error("Project not found");
    }

    if (await checkCancellation(job.id)) {
      await prisma.generationJob.update({
        where: { id: job.id },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
      await logJobEvent(job.id, "INFO", "Job cancelled by user");
      return true;
    }

    // Acquire source
    const sourcePath = await acquireSource(job.id, project);

    await prisma.generationJob.update({
      where: { id: job.id },
      data: { status: "PROCESSING", progress: 25 },
    });

    await mkdir(MEDIA_ROOT, { recursive: true });

    const definition = project.definition as unknown as ProjectDefinition;
    const outputPath = path.join(MEDIA_ROOT, `${project.id}-${job.id}.mp4`);
    const thumbnailPath = path.join(MEDIA_ROOT, `${project.id}-${job.id}.jpg`);

    // Render main video
    await logJobEvent(job.id, "INFO", "Starting FFmpeg render", { outputPath });

    const plan = buildSourceRenderPlan(definition, sourcePath, outputPath);
    const ffmpegProcess = spawn("ffmpeg", plan.args, { stdio: ["pipe", "pipe", "pipe"] });
    runningProcesses.set(job.id, ffmpegProcess);

    try {
      await new Promise<void>((resolve, reject) => {
        ffmpegProcess.on("close", (code) => {
          runningProcesses.delete(job.id);
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`FFmpeg exited with code ${code}`));
          }
        });
        ffmpegProcess.on("error", reject);
      });

      // Create video output
      await createOutput(project.id, job.id, "VIDEO", outputPath, "video/mp4");

      await prisma.generationJob.update({
        where: { id: job.id },
        data: { progress: 85 },
      });

      // Generate thumbnail
      await logJobEvent(job.id, "INFO", "Generating thumbnail");

      await execFileAsync("ffmpeg", [
        "-hide_banner",
        "-y",
        "-ss",
        "1",
        "-i",
        outputPath,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        thumbnailPath,
      ]);

      await createOutput(project.id, job.id, "THUMBNAIL", thumbnailPath, "image/jpeg");

      await prisma.generationJob.update({
        where: { id: job.id },
        data: { status: "COMPLETED", progress: 100, completedAt: new Date() },
      });

      await logJobEvent(job.id, "INFO", "Job completed successfully");
    } finally {
      // Ensure process is terminated
      if (ffmpegProcess && !ffmpegProcess.killed) {
        ffmpegProcess.kill("SIGTERM");
        runningProcesses.delete(job.id);
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await prisma.generationJob.update({
      where: { id: job.id },
      data: { status: "FAILED", error: errorMessage },
    });
    await logJobEvent(job.id, "ERROR", "Job failed", { error: errorMessage });
  }

  return true;
}

/**
 * Cleanup expired media files and database records.
 */
async function cleanupExpiredMedia() {
  const now = new Date();
  const [sources, outputs] = await Promise.all([
    prisma.source.findMany({
      where: { expiresAt: { not: null, lt: now }, storagePath: { not: null } },
      select: { id: true, storagePath: true },
    }),
    prisma.output.findMany({
      where: { expiresAt: { not: null, lt: now } },
      select: { id: true, storagePath: true },
    }),
  ]);

  let deletedSources = 0;
  let deletedOutputs = 0;

  for (const source of sources) {
    if (source.storagePath) {
      await rm(source.storagePath, { force: true }).catch(() => undefined);
    }
    await prisma.source.update({
      where: { id: source.id },
      data: { storagePath: null },
    }).catch(() => undefined);
    deletedSources++;
  }

  for (const output of outputs) {
    await rm(output.storagePath, { force: true }).catch(() => undefined);
    await prisma.output.delete({ where: { id: output.id } }).catch(() => undefined);
    deletedOutputs++;
  }

  if (deletedSources > 0 || deletedOutputs > 0) {
    console.log(`Cleanup: removed ${deletedSources} expired sources, ${deletedOutputs} expired outputs`);
  }
}

/**
 * Handle process termination gracefully.
 */
process.on("SIGTERM", async () => {
  console.log("Received SIGTERM, shutting down gracefully...");
  // Terminate all running FFmpeg processes
  for (const [jobId, proc] of runningProcesses) {
    console.log(`Terminating FFmpeg for job ${jobId}`);
    proc.kill("SIGTERM");
  }
  process.exit(0);
});

/**
 * Main worker loop.
 */
async function main() {
  console.log("SaarnaVideo worker started", { resourceLimits: RESOURCE_LIMITS });
  let lastCleanup = 0;

  while (true) {
    try {
      if (Date.now() - lastCleanup > 60_000) {
        await cleanupExpiredMedia();
        lastCleanup = Date.now();
      }

      const didWork = (await processPublication()) || (await processJob());

      if (!didWork) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    } catch (error) {
      console.error("Worker loop error:", error);
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
