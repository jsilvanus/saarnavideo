import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prisma } from "@/lib/prisma";
import { buildSourceRenderPlan } from "@/renderer/ffmpeg";
import type { ProjectDefinition } from "@/domain/project";

const execFileAsync = promisify(execFile);
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 3000);

async function claimJob() {
  const candidate = await prisma.generationJob.findFirst({
    where: { status: "QUEUED" },
    orderBy: { createdAt: "asc" },
  });
  if (!candidate) return null;

  const result = await prisma.generationJob.updateMany({
    where: { id: candidate.id, status: "QUEUED" },
    data: { status: "PROCESSING", startedAt: new Date(), progress: 5 },
  });
  return result.count === 1 ? candidate : null;
}

async function processJob() {
  const job = await claimJob();
  if (!job) return false;

  try {
    const project = await prisma.project.findUnique({
      where: { id: job.projectId },
      include: { source: true },
    });
    if (!project?.source?.storagePath) {
      throw new Error("Project source has no local storage path; source acquisition is not implemented yet");
    }

    await prisma.generationJob.update({
      where: { id: job.id },
      data: { status: "RENDERING", progress: 25 },
    });

    const definition = project.definition as unknown as ProjectDefinition;
    const outputPath = `${process.env.MEDIA_ROOT ?? "/data/media"}/${project.id}-${job.id}.mp4`;
    const plan = buildSourceRenderPlan(definition, project.source.storagePath, outputPath);

    await execFileAsync("ffmpeg", plan.args);

    await prisma.output.create({
      data: {
        projectId: project.id,
        jobId: job.id,
        type: "VIDEO",
        storagePath: outputPath,
        mimeType: "video/mp4",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    await prisma.generationJob.update({
      where: { id: job.id },
      data: { status: "COMPLETED", progress: 100, completedAt: new Date() },
    });
  } catch (error) {
    await prisma.generationJob.update({
      where: { id: job.id },
      data: { status: "FAILED", error: error instanceof Error ? error.message : String(error) },
    });
  }

  return true;
}

async function main() {
  console.log("SaarnaVideo worker started");
  while (true) {
    const didWork = await processJob();
    if (!didWork) await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
