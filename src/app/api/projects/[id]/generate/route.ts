import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/app/api/_lib/http";
import { captionOptionsSchema, wantsBurnedCaptions } from "@/domain/captions";
import { podcastSettingsSchema } from "@/domain/project";
import { validateRenderSettings } from "@/domain/render-settings";
import { computeDurationReport } from "@/lib/duration-report";
import { readPodcastSettings, referencedAudioAssetIds } from "@/worker/podcast";

function findDurationViolations(definition: unknown, sources: Array<{ id: string; durationMs: number | null }>) {
  if (!definition || typeof definition !== "object") return [];
  const semanticSegments = Array.isArray((definition as { semanticSegments?: unknown }).semanticSegments) ? (definition as { semanticSegments: unknown[] }).semanticSegments : [];
  const durations = new Map(sources.filter(s => s.durationMs !== null).map(s => [s.id, s.durationMs!]));
  return semanticSegments.flatMap(segment => { if (!segment || typeof segment !== "object") return []; const value = segment as { id?: unknown; label?: unknown; sourceId?: unknown; endSeconds?: unknown }; if (typeof value.sourceId !== "string" || typeof value.endSeconds !== "number") return []; const durationMs = durations.get(value.sourceId); if (durationMs === undefined || value.endSeconds <= durationMs / 1000) return []; return [{ id: typeof value.id === "string" ? value.id : "unknown", label: typeof value.label === "string" ? value.label : "Section", sourceId: value.sourceId, endSeconds: value.endSeconds, durationSeconds: durationMs / 1000 }]; });
}

function clampDefinition(definition: unknown, sources: Array<{ id: string; durationMs: number | null }>) {
  const cloned = JSON.parse(JSON.stringify(definition ?? {})) as Record<string, any>;
  const durations = new Map(sources.filter(s => s.durationMs !== null).map(s => [s.id, s.durationMs! / 1000]));
  for (const segment of Array.isArray(cloned.semanticSegments) ? cloned.semanticSegments : []) { const duration = typeof segment?.sourceId === "string" ? durations.get(segment.sourceId) : undefined; if (duration !== undefined && typeof segment.endSeconds === "number") segment.endSeconds = Math.min(segment.endSeconds, duration); }
  const composition = cloned.composition;
  if (composition && Array.isArray(composition.items)) { for (const item of composition.items) { if (item?.type !== "source-clip" || typeof item.sourceId !== "string") continue; const duration = durations.get(item.sourceId); if (duration === undefined) continue; if (typeof item.startSeconds === "number" && item.startSeconds >= duration) throw new Error(`Section starts at ${item.startSeconds}s but the source ends at ${duration}s; choose another file or edit the section.`); if (typeof item.endSeconds === "number") item.endSeconds = Math.min(item.endSeconds, duration); } if (typeof composition.sourceEndSeconds === "number") { const referencedDurations = Array.from(durations.values()); if (referencedDurations.length) composition.sourceEndSeconds = Math.min(composition.sourceEndSeconds, Math.max(...referencedDurations)); } }
  return cloned;
}

/** Length warnings for the response; never blocks the render, and a malformed definition just yields none. */
function durationWarnings(definition: Parameters<typeof computeDurationReport>[0]) {
  try { return computeDurationReport(definition).warnings; } catch { return []; }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({})) as { allowClamping?: boolean; preview?: boolean; type?: "VIDEO" | "PREVIEW" | "THUMBNAIL" | "PODCAST"; captions?: unknown; podcast?: unknown };
    const captions = captionOptionsSchema.safeParse(body.captions ?? {});
    if (!captions.success) return NextResponse.json({ error: "Invalid captions options", issues: captions.error.issues }, { status: 400 });
    const podcast = podcastSettingsSchema.partial().safeParse(body.podcast ?? {});
    if (!podcast.success) return NextResponse.json({ error: "Invalid podcast options", issues: podcast.error.issues }, { status: 400 });
    const type = body.type ?? (body.preview ? "PREVIEW" : "VIDEO");
    if (!["VIDEO", "PREVIEW", "THUMBNAIL", "PODCAST"].includes(type)) return jsonError("Unknown generation type", 400);
    const project = await prisma.project.findUnique({ where: { id }, select: { id: true, definition: true, sources: { select: { id: true, originalName: true, status: true, type: true, storagePath: true, youtubeVideoId: true, youtubeUrl: true, durationMs: true, referenceDurationMs: true } } } });
    if (!project) return jsonError("Project not found", 404);
    const settingsIssues = validateRenderSettings(project.definition);
    if (settingsIssues.length) return NextResponse.json({ error: settingsIssues.join(" "), issues: settingsIssues }, { status: 400 });
    const pending = project.sources.filter(source => source.status === "PENDING");
    if (pending.length) return NextResponse.json({ error: "Upload pending local sources before generating.", pendingSources: pending.map(source => ({ id: source.id, originalName: source.originalName })) }, { status: 409 });
    if (captions.data.styleGraphicId && wantsBurnedCaptions(captions.data)) {
      const graphics = (project.definition as { graphics?: Array<{ id?: unknown; layers?: Array<{ type?: unknown }> }> } | null)?.graphics ?? [];
      const style = graphics.find(graphic => graphic?.id === captions.data.styleGraphicId);
      if (!style) return jsonError("Caption style graphic not found in this project", 400);
      if (!style.layers?.some(layer => layer?.type === "caption")) return jsonError("The chosen graphic has no caption layer, so it is not a caption style", 400);
    }
    // Voiceovers (and the podcast intro/outro) must be audio assets of the library.
    const podcastSettings = readPodcastSettings((project.definition ?? {}) as { podcast?: unknown }, { podcast: podcast.data });
    const audioIds = referencedAudioAssetIds((project.definition ?? {}) as Parameters<typeof referencedAudioAssetIds>[0], type === "PODCAST" ? podcastSettings : undefined);
    if (audioIds.length) {
      const found = await prisma.asset.findMany({ where: { id: { in: audioIds }, type: "AUDIO" }, select: { id: true } });
      const missingAudio = audioIds.filter(audioId => !found.some(asset => asset.id === audioId));
      if (missingAudio.length) return jsonError(`Audio asset not found in the library: ${missingAudio.join(", ")}`, 400);
    }
    const violations = findDurationViolations(project.definition, project.sources);
    if (violations.length && !body.allowClamping) return NextResponse.json({ error: "One or more sections extend beyond the selected source file.", code: "SOURCE_DURATION_MISMATCH", violations, message: "The source file is shorter than the recording used to define these sections. No timestamps are silently clamped." }, { status: 409 });
    let renderDefinition = project.definition;
    if (violations.length && body.allowClamping) { try { renderDefinition = clampDefinition(project.definition, project.sources); } catch (error) { return jsonError(error instanceof Error ? error.message : "Cannot clamp the affected sections", 409); } }
    const referencedIds = new Set<string>();
    const composition = (renderDefinition as { composition?: { items?: Array<{ type?: string; sourceId?: string }> } }).composition;
    for (const item of composition?.items ?? []) if (item.type === "source-clip" && item.sourceId) referencedIds.add(item.sourceId);
    let dependencyId: string | undefined;
    for (const source of project.sources.filter(s => referencedIds.has(s.id) && s.type === "YOUTUBE" && !s.storagePath)) {
      const download = await prisma.mediaJob.create({ data: { projectId: id, sourceId: source.id, type: "DOWNLOAD", priority: 100, dependsOnJobId: dependencyId, parameters: { sourceId: source.id } }, select: { id: true } });
      dependencyId = download.id;
    }
    const firstSourceId = [...referencedIds][0];
    const job = await prisma.mediaJob.create({ data: { projectId: id, type, priority: type === "PREVIEW" ? 80 : type === "THUMBNAIL" ? 60 : 50, dependsOnJobId: dependencyId, parameters: { renderDefinition, captions: type === "THUMBNAIL" || type === "PODCAST" ? undefined : captions.data, podcast: type === "PODCAST" ? podcast.data : undefined, thumbnailSourceId: type === "THUMBNAIL" ? firstSourceId : undefined } }, select: { id: true, type: true, status: true, progress: true } });
    if (type === "VIDEO") await prisma.mediaJob.create({ data: { projectId: id, type: "THUMBNAIL", priority: 60, dependsOnJobId: job.id, parameters: { renderDefinition } }, select: { id: true } });
    return NextResponse.json({ ...job, dependencyId, clamped: violations.length > 0, durationWarnings: durationWarnings((renderDefinition ?? {}) as Parameters<typeof computeDurationReport>[0]) });
  } catch (error) { console.error("Media job queue error:", error); return jsonError(error instanceof Error ? error.message : "Could not queue media job", 500); }
}
