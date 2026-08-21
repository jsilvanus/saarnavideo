import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, sources: { select: { id: true, originalName: true, status: true, type: true } } },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const pending = project.sources.filter(source => source.status === "PENDING");
  if (pending.length) {
    return NextResponse.json({
      error: "Upload pending local sources before generating.",
      pendingSources: pending.map(source => ({ id: source.id, originalName: source.originalName })),
    }, { status: 409 });
  }

  const job = await prisma.generationJob.create({
    data: { projectId: id },
    select: { id: true, status: true },
  });

  return NextResponse.json(job, { status: 202 });
}
