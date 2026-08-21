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

function clampDefinition(definition: unknown, sources: Array<{ id: string; durationMs: number | null }>) {
  const cloned = JSON.parse(JSON.stringify(definition ?? {})) as Record<string, any>;
  const durations = new Map(sources.filter(s => s.durationMs !== null).map(s => [s.id, s.durationMs! / 1000]));
  const violations = findDurationViolations(cloned, sources);

  for (const segment of Array.isArray(cloned.semanticSegments) ? cloned.semanticSegments : []) {
    const duration = typeof segment?.sourceId === "string" ? durations.get(segment.sourceId) : undefined;
    if (duration !== undefined && typeof segment.endSeconds === "number") segment.endSeconds = Math.min(segment.endSeconds, duration);
  }

  const composition = cloned.composition;
  if (composition && Array.isArray(composition.items)) {
    for (const item of composition.items) {
      if (item?.type !== "source-clip" || typeof item.sourceId !== "string") continue;
      const duration = durations.get(item.sourceId);
      if (duration === undefined) continue;
      if (typeof item.startSeconds === "number" && item.startSeconds >= duration) {
        throw new Error(`Section starts at ${item.startSeconds}s but the source ends at ${duration}s; choose another file or edit the section.`);
      }
      if (typeof item.endSeconds === "number") item.endSeconds = Math.min(item.endSeconds, duration);
    }
    if (typeof composition.sourceEndSeconds === "number") {
      const referencedDurations = Array.from(durations.values());
      if (referencedDurations.length) composition.sourceEndSeconds = Math.min(composition.sourceEndSeconds, Math.max(...referencedDurations));
    }
  }

  return { definition: cloned, violations };
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({})) as { allowClamping?: boolean };
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
  if (violations.length && !body.allowClamping) {
    return NextResponse.json({
      error: "One or more sections extend beyond the selected source file.",
      code: "SOURCE_DURATION_MISMATCH",
      violations,
      message: "The source file is shorter than the recording used to define these sections. No timestamps are silently clamped.",
    }, { status: 409 });
  }

  let renderDefinition = project.definition;
  if (violations.length && body.allowClamping) {
    try {
      renderDefinition = clampDefinition(project.definition, project.sources).definition;
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Cannot clamp the affected sections" }, { status: 409 });
    }
  }

  const job = await prisma.generationJob.create({
    data: {
      projectId: id,
      renderDefinition: violations.length ? renderDefinition : undefined,
    },
    select: { id: true, status: true },
  });

  return NextResponse.json({ ...job, clamped: violations.length > 0 });
}
