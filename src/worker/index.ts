import { execFile } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { buildSourceRenderPlan } from "@/renderer/ffmpeg";
import type { ProjectDefinition } from "@/domain/project";
import { downloadYouTubeSource, uploadToYouTube } from "@/integrations/youtube";
import { getYouTubeAccessToken } from "@/integrations/youtube-oauth";

const execFileAsync = promisify(execFile);
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 3000);
const MEDIA_ROOT = process.env.MEDIA_ROOT ?? "/data/media";
const RETENTION_MS = Number(process.env.MEDIA_RETENTION_DAYS ?? 7) * 24 * 60 * 60 * 1000;

async function claimJob() {
  const candidate = await prisma.generationJob.findFirst({ where: { status: "QUEUED" }, orderBy: { createdAt: "asc" } });
  if (!candidate) return null;
  const result = await prisma.generationJob.updateMany({ where: { id: candidate.id, status: "QUEUED" }, data: { status: "ACQUIRING_SOURCE", startedAt: new Date(), progress: 5 } });
  return result.count === 1 ? candidate : null;
}

async function createOutput(projectId: string, jobId: string, type: "VIDEO" | "THUMBNAIL", storagePath: string, mimeType: string) {
  let sizeBytes: number | undefined;
  try { sizeBytes = (await stat(storagePath)).size; } catch { /* recorded below */ }
  return prisma.output.create({ data: { projectId, jobId, type, storagePath, mimeType, sizeBytes, expiresAt: new Date(Date.now() + RETENTION_MS) } });
}

async function acquireSource(project: { id: string; source: { id: string; type: "UPLOAD" | "YOUTUBE"; storagePath: string | null; youtubeVideoId: string | null; youtubeUrl: string | null } | null }): Promise<string> {
  if (!project.source) throw new Error("Project has no source");
  if (project.source.storagePath) return project.source.storagePath;
  if (project.source.type !== "YOUTUBE" || !project.source.youtubeUrl || !project.source.youtubeVideoId) throw new Error("Source has no usable media or YouTube URL");
  const directory = path.join(MEDIA_ROOT, "sources", project.id);
  const storagePath = path.join(directory, `${project.source.youtubeVideoId}.mp4`);
  await downloadYouTubeSource({ videoId: project.source.youtubeVideoId, url: project.source.youtubeUrl }, storagePath);
  const sizeBytes = (await stat(storagePath)).size;
  await prisma.source.update({ where: { id: project.source.id }, data: { storagePath, mimeType: "video/mp4", sizeBytes, expiresAt: new Date(Date.now() + RETENTION_MS) } });
  return storagePath;
}

async function processJob() {
  const job = await claimJob();
  if (!job) return false;
  try {
    const project = await prisma.project.findUnique({ where: { id: job.projectId }, include: { source: true } });
    if (!project) throw new Error("Project not found");
    const sourcePath = await acquireSource(project);
    await prisma.generationJob.update({ where: { id: job.id }, data: { status: "RENDERING", progress: 25 } });
    await mkdir(MEDIA_ROOT, { recursive: true });
    const definition = project.definition as unknown as ProjectDefinition;
    const outputPath = path.join(MEDIA_ROOT, `${project.id}-${job.id}.mp4`);
    const thumbnailPath = path.join(MEDIA_ROOT, `${project.id}-${job.id}.jpg`);
    await execFileAsync("ffmpeg", buildSourceRenderPlan(definition, sourcePath, outputPath).args);
    const videoOutput = await createOutput(project.id, job.id, "VIDEO", outputPath, "video/mp4");
    await prisma.generationJob.update({ where: { id: job.id }, data: { progress: 85 } });
    await execFileAsync("ffmpeg", ["-hide_banner", "-y", "-ss", "1", "-i", outputPath, "-frames:v", "1", "-q:v", "2", thumbnailPath]);
    await createOutput(project.id, job.id, "THUMBNAIL", thumbnailPath, "image/jpeg");

    const publication = await prisma.publication.findFirst({ where: { projectId: project.id, outputId: videoOutput.id, status: "QUEUED" } });
    if (publication) {
      await prisma.publication.update({ where: { id: publication.id }, data: { status: "UPLOADING" } });
      try {
        const accessToken = await getYouTubeAccessToken();
        const result = await uploadToYouTube({ accessToken, filePath: outputPath, thumbnailPath, title: project.title, description: project.preacher ? `Preacher: ${project.preacher}` : undefined, privacyStatus: publication.privacy.toLowerCase() as "private" | "unlisted" | "public" });
        await prisma.publication.update({ where: { id: publication.id }, data: { status: "COMPLETED", externalId: result.videoId, completedAt: new Date() } });
      } catch (error) {
        await prisma.publication.update({ where: { id: publication.id }, data: { status: "FAILED", error: error instanceof Error ? error.message : String(error) } });
      }
    }
    await prisma.generationJob.update({ where: { id: job.id }, data: { status: "COMPLETED", progress: 100, completedAt: new Date() } });
  } catch (error) {
    await prisma.generationJob.update({ where: { id: job.id }, data: { status: "FAILED", error: error instanceof Error ? error.message : String(error) } });
  }
  return true;
}

async function cleanupExpiredMedia() {
  const now = new Date();
  const [sources, outputs] = await Promise.all([
    prisma.source.findMany({ where: { expiresAt: { not: null, lt: now }, storagePath: { not: null } }, select: { id: true, storagePath: true } }),
    prisma.output.findMany({ where: { expiresAt: { not: null, lt: now } }, select: { id: true, storagePath: true } }),
  ]);
  for (const source of sources) { if (source.storagePath) await rm(source.storagePath, { force: true }).catch(() => undefined); await prisma.source.update({ where: { id: source.id }, data: { storagePath: null } }).catch(() => undefined); }
  for (const output of outputs) { await rm(output.storagePath, { force: true }).catch(() => undefined); await prisma.output.delete({ where: { id: output.id } }).catch(() => undefined); }
}

async function main() {
  console.log("SaarnaVideo worker started");
  let lastCleanup = 0;
  while (true) {
    if (Date.now() - lastCleanup > 60_000) { await cleanupExpiredMedia(); lastCleanup = Date.now(); }
    const didWork = await processJob();
    if (!didWork) await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
