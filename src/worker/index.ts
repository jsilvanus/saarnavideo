import { execFile } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { buildSourceRenderPlan } from "@/renderer/ffmpeg";
import { migrateProjectDefinition } from "@/domain/project";
import { downloadYouTubeSource, uploadToYouTube } from "@/integrations/youtube";
import { getYouTubeAccessToken } from "@/integrations/youtube-oauth";
import { acquireRequiredSources, resolveRequiredSourceIds } from "./sources";

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
  let sizeBytes: number | undefined; try { sizeBytes = (await stat(storagePath)).size; } catch { /* recorded below */ }
  return prisma.output.create({ data: { projectId, jobId, type, storagePath, mimeType, sizeBytes, expiresAt: new Date(Date.now() + RETENTION_MS) } });
}

async function processPublication() {
  const publication = await prisma.publication.findFirst({ where: { status: "QUEUED" }, orderBy: { createdAt: "asc" }, include: { project: true, output: true } });
  if (!publication || !publication.output) return false;
  const output = publication.output;
  if (output.expiresAt && output.expiresAt <= new Date()) { await prisma.publication.update({ where: { id: publication.id }, data: { status: "FAILED", error: "Output has expired" } }); return true; }
  const claimed = await prisma.publication.updateMany({ where: { id: publication.id, status: "QUEUED" }, data: { status: "UPLOADING" } });
  if (!claimed.count) return false;
  try {
    const thumbnail = await prisma.output.findFirst({ where: { projectId: publication.projectId, type: "THUMBNAIL", expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
    const result = await uploadToYouTube({ accessToken: await getYouTubeAccessToken(), filePath: output.storagePath, thumbnailPath: thumbnail?.storagePath, title: publication.project.title, description: publication.project.preacher ? `Preacher: ${publication.project.preacher}` : undefined, privacyStatus: publication.privacy.toLowerCase() as "private" | "unlisted" | "public" });
    await prisma.publication.update({ where: { id: publication.id }, data: { status: "COMPLETED", externalId: result.videoId, completedAt: new Date() } });
  } catch (error) {
    await prisma.publication.update({ where: { id: publication.id }, data: { status: "FAILED", error: error instanceof Error ? error.message : String(error) } });
  }
  return true;
}

async function processJob() {
  const job = await claimJob(); if (!job) return false;
  try {
    const project = await prisma.project.findUnique({ where: { id: job.projectId }, include: { sources: true } });
    if (!project) throw new Error("Project not found");
    if (project.sources.length === 0) throw new Error("Project has no sources");

    const definition = migrateProjectDefinition(project.definition, project.sources.length === 1 ? project.sources[0].id : undefined);
    const requiredSourceIds = resolveRequiredSourceIds(definition, project.sources);
    const sourcePaths = await acquireRequiredSources({
      projectId: project.id,
      sources: project.sources,
      requiredSourceIds,
      mediaRoot: MEDIA_ROOT,
      retentionMs: RETENTION_MS,
      downloadYouTubeSource,
      updateSource: async (sourceId, data) => {
        await prisma.source.update({ where: { id: sourceId }, data });
      },
    });

    await prisma.project.update({ where: { id: project.id }, data: { definition } });
    await prisma.generationJob.update({ where: { id: job.id }, data: { status: "RENDERING", progress: 25 } });
    await mkdir(MEDIA_ROOT, { recursive: true });
    const outputPath = path.join(MEDIA_ROOT, `${project.id}-${job.id}.mp4`);
    const thumbnailPath = path.join(MEDIA_ROOT, `${project.id}-${job.id}.jpg`);
    await execFileAsync("ffmpeg", buildSourceRenderPlan(definition, sourcePaths, outputPath).args);
    await createOutput(project.id, job.id, "VIDEO", outputPath, "video/mp4");
    await prisma.generationJob.update({ where: { id: job.id }, data: { progress: 85 } });
    await execFileAsync("ffmpeg", ["-hide_banner", "-y", "-ss", "1", "-i", outputPath, "-frames:v", "1", "-q:v", "2", thumbnailPath]);
    await createOutput(project.id, job.id, "THUMBNAIL", thumbnailPath, "image/jpeg");
    await prisma.generationJob.update({ where: { id: job.id }, data: { status: "COMPLETED", progress: 100, completedAt: new Date() } });
  } catch (error) { await prisma.generationJob.update({ where: { id: job.id }, data: { status: "FAILED", error: error instanceof Error ? error.message : String(error) } }); }
  return true;
}
async function cleanupExpiredMedia() {
  const now = new Date();
  const [sources, outputs] = await Promise.all([prisma.source.findMany({ where: { expiresAt: { not: null, lt: now }, storagePath: { not: null } }, select: { id: true, storagePath: true } }), prisma.output.findMany({ where: { expiresAt: { not: null, lt: now } }, select: { id: true, storagePath: true } })]);
  for (const source of sources) { if (source.storagePath) await rm(source.storagePath, { force: true }).catch(() => undefined); await prisma.source.update({ where: { id: source.id }, data: { storagePath: null } }).catch(() => undefined); }
  for (const output of outputs) { await rm(output.storagePath, { force: true }).catch(() => undefined); await prisma.output.delete({ where: { id: output.id } }).catch(() => undefined); }
}
async function main() {
  console.log("SaarnaVideo worker started"); let lastCleanup = 0;
  while (true) { if (Date.now() - lastCleanup > 60_000) { await cleanupExpiredMedia(); lastCleanup = Date.now(); } const didWork = (await processPublication()) || (await processJob()); if (!didWork) await new Promise((resolve) => setTimeout(resolve, POLL_MS)); }
}

if (process.env.NODE_ENV !== "test") {
  main().catch((error) => { console.error(error); process.exit(1); });
}
