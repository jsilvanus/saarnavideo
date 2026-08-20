import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  preacher: z.string().trim().max(200).nullable().optional(),
  gospelRef: z.string().trim().max(200).nullable().optional(),
  gospelText: z.string().nullable().optional(),
  templateKey: z.string().trim().min(1).max(100).optional(),
  definition: z.record(z.string(), z.any()).optional(),
});

function jsonSafe(value: unknown) {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item));
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const project = await prisma.project.findUnique({ where: { id }, include: { source: true, jobs: { orderBy: { createdAt: "desc" }, take: 10 }, outputs: { orderBy: { createdAt: "desc" } }, publications: { orderBy: { createdAt: "desc" } } } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  return NextResponse.json(jsonSafe(project));
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const input = patchSchema.parse(await request.json());
    // Filter out undefined definition to avoid Prisma type issues
    const data = Object.fromEntries(
      Object.entries(input).filter(([_, v]) => v !== undefined)
    ) as Partial<typeof input>;
    const project = await prisma.project.update({ where: { id }, data, select: { id: true, title: true, preacher: true, gospelRef: true, gospelText: true, templateKey: true, definition: true, updatedAt: true } });
    return NextResponse.json(jsonSafe(project));
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try { await prisma.project.delete({ where: { id } }); return new Response(null, { status: 204 }); }
  catch { return NextResponse.json({ error: "Project not found" }, { status: 404 }); }
}
