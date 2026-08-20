import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const project = await prisma.project.findUnique({ where: { id }, select: { id: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const job = await prisma.generationJob.create({
    data: { projectId: id },
    select: { id: true, status: true },
  });

  return NextResponse.json(job, { status: 202 });
}
