import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function findDurationViolations(definition: unknown, sources: Array<{ id: string; durationMs: number | null }>) {
  if (!definition || typeof definition !== "object") return [];
  const semanticSegments = Array.isArray((definition as { semanticSegments?: unknown }).semanticSegments)
    ? (definition as { semanticSegments: unknown[] }).semanticSegments
    : [];
  const durations = new Map(sources.filter(s => s.durationMs !== null).map(s => [s.id, s.durationMs!]));
  return semanticSegments.flatMap(segment => {
    if (!segment || typeof segment !== "object") return [];
    const value = segment as { id?: unknown; label?: unknown; sourceId?: unknown; endSeconds?: unknown };
    if (typeof value.sourceId !== "string" || typeof value.endSeconds !== "number") return [];
    const durationMs = durations.get(value.sourceId);
    if (durationMs === undefined || value.endSeconds <= durationMs / 1000) return [];
    return [{
      id: typeof value.id === "string" ? value.id : "unknown",
      label: typeof value.label === "string" ? value.label : "Section",
      sourceId: value.sourceId,
      endSeconds: value.endSeconds,
      durationSeconds: durationMs / 1000,
    }];
  });
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, definition: true, sources: { select: { id: true, originalName: true, status: true, type: true, durationMs: true, referenceDurationMs: true } } },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const pending = project.sources.filter(source => source.status === "PENDING");
  if (pending.length) {
    return NextResponse.json({
      error: "Upload pending local sources before generating.",
      pendingSources: pending.map(source => ({ id: source.id, originalName: source.originalName })),
    }, { status: 409 });
  }

  const violations = findDurationViolations(project.definition, project.sources);
  if (violations.length) {
    return NextResponse.json({
      error: "One or more sections extend beyond the selected source file.",
      code: "SOURCE_DURATION_MISMATCH",
      violations,
      message: "The source file is shorter than the recording used to define these sections. No timestamps are silently clamped.",
    }, { status: 409 });
  }

  const job = await prisma.generationJob.create({
    data: { projectId: id },
    select: { id: true, status: true },
  });

  return NextResponse.json(job, { status: 202 });
}
