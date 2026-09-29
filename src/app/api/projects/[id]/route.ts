import { rm } from "node:fs/promises";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { validateRenderSettings } from "@/domain/render-settings";
import { jsonError, jsonSafe } from "@/app/api/_lib/http";

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  preacher: z.string().trim().max(200).nullable().optional(),
  gospelRef: z.string().trim().max(200).nullable().optional(),
  gospelText: z.string().nullable().optional(),
  templateKey: z.string().trim().min(1).max(100).optional(),
  definition: z.record(z.string(), z.any()).optional(),
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: { sources: true, jobs: { orderBy: { createdAt: "desc" }, take: 10 }, outputs: { orderBy: { createdAt: "desc" } }, publications: { orderBy: { createdAt: "desc" } }, assets: true },
  });
  if (!project) return jsonError("Project not found", 404);
  return NextResponse.json(jsonSafe(project));
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const input = patchSchema.parse(await request.json());
    const settingsIssues = validateRenderSettings(input.definition);
    if (settingsIssues.length) return jsonError(settingsIssues.join(" "), 400);
    const data = Object.fromEntries(Object.entries(input).filter(([_, value]) => value !== undefined)) as Partial<typeof input>;
    const project = await prisma.project.update({ where: { id }, data, select: { id: true, title: true, preacher: true, gospelRef: true, gospelText: true, templateKey: true, definition: true, updatedAt: true } });
    return NextResponse.json(jsonSafe(project));
  } catch (error) {
    if (error instanceof z.ZodError) return jsonError(error.issues[0]?.message ?? "Invalid request", 400);
    return jsonError("Project not found", 404);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const project = await prisma.project.findUnique({ where: { id }, include: { sources: true, assets: true } });
    if (!project) return jsonError("Project not found", 404);

    await prisma.project.delete({ where: { id } });

    // The project's own links are gone now, so a source still linked is used by another project.
    // Assets are library items managed from the asset library, so they are kept.
    const sourceIds = project.sources.map((source) => source.id);
    const shared = await prisma.source.findMany({ where: { id: { in: sourceIds }, projects: { some: {} } }, select: { id: true } });
    const sharedIds = new Set(shared.map((source) => source.id));
    const orphans = project.sources.filter((source) => !sharedIds.has(source.id));

    await prisma.source.deleteMany({ where: { id: { in: orphans.map((source) => source.id) } } });
    // Duplicated projects get their own Source rows that share the file, so only remove files no row references.
    const orphanPaths = [...new Set(orphans.flatMap((source) => (source.storagePath ? [source.storagePath] : [])))];
    const referenced = await prisma.source.findMany({ where: { storagePath: { in: orphanPaths } }, select: { storagePath: true } });
    const referencedPaths = new Set(referenced.map((source) => source.storagePath));
    for (const storagePath of orphanPaths) {
      if (!referencedPaths.has(storagePath)) await rm(storagePath, { force: true }).catch(() => undefined);
    }

    return new Response(null, { status: 204 });
  } catch {
    return jsonError("Project deletion failed", 500);
  }
}
