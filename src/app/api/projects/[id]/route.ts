import { rm } from "node:fs/promises";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
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

    for (const source of project.sources) {
      const remaining = await prisma.source.count({ where: { projects: { some: { id: { not: id } } } } });
      if (remaining === 0) {
        if (source.storagePath) await rm(source.storagePath, { force: true }).catch(() => undefined);
        await prisma.source.delete({ where: { id: source.id } }).catch(() => undefined);
      }
    }

    for (const asset of project.assets) {
      const remaining = await prisma.asset.count({ where: { projects: { some: { id: { not: id } } } } });
      if (remaining === 0) {
        if (asset.storagePath) await rm(asset.storagePath, { force: true }).catch(() => undefined);
        await prisma.asset.delete({ where: { id: asset.id } }).catch(() => undefined);
      }
    }

    return new Response(null, { status: 204 });
  } catch {
    return jsonError("Project deletion failed", 500);
  }
}
