import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createProjectDefinition, type ProjectDefinition } from "@/domain/project";
import { applySavedTemplate, savedTemplateSchema, type SavedTemplate } from "@/domain/saved-templates";
import { addSourceSection, applyTemplateByKey, type TemplateContext } from "@/domain/templates";
import { jsonError, jsonSafe } from "@/app/api/_lib/http";
import { extractYouTubeId } from "@/app/api/_lib/youtube";

const segmentSchema = z.object({ id: z.string().min(1), label: z.string().min(1), startSeconds: z.number().nonnegative(), endSeconds: z.number().positive() }).refine((v) => v.endSeconds > v.startSeconds, "Segment end must be after start");
const requestSchema = z.object({ title: z.string().trim().min(1).max(200), preacher: z.string().trim().max(200).optional().default(""), gospelRef: z.string().trim().max(200).optional().default(""), gospelText: z.string().optional().default(""), templateKey: z.string().min(1).default("sermon"), userTemplateId: z.string().min(1).optional(), sourceUrl: z.string().url().optional(), segments: z.array(segmentSchema).default([]), semanticSegments: z.array(segmentSchema).default([]) });

const defaultTemplate = (key: string) => ({ key, width: 1920, height: 1080, fps: 30, backgroundColor: "black", textColor: "white" });

function definitionFor(segments: z.infer<typeof segmentSchema>[], templateKey: string, sourceId: string | undefined) {
  // Without a source there is nothing to cut yet: keep the segments but leave the timeline empty.
  const hasClips = sourceId !== undefined && segments.length > 0;
  return createProjectDefinition({
    template: defaultTemplate(templateKey),
    semanticSegments: segments,
    composition: {
      sourceStartSeconds: hasClips ? Math.min(...segments.map((s) => s.startSeconds)) : 0,
      sourceEndSeconds: hasClips ? Math.max(...segments.map((s) => s.endSeconds)) : 0.001,
      items: sourceId ? segments.map((segment) => ({ type: "source-clip" as const, sourceId, startSeconds: segment.startSeconds, endSeconds: segment.endSeconds })) : [],
    },
  });
}

/** The template's definition (built-in by key or saved by id), with the given segments cut into sections; null when no template applies. */
function templatedDefinition(input: z.infer<typeof requestSchema>, saved: SavedTemplate | null, segments: z.infer<typeof segmentSchema>[], sourceId: string | undefined): ProjectDefinition | null {
  const context: TemplateContext = { title: input.title, preacher: input.preacher, gospelRef: input.gospelRef };
  let definition: ProjectDefinition | null = saved ? applySavedTemplate(saved, context) : applyTemplateByKey(input.templateKey, context);
  if (!definition) return null;
  for (const segment of segments) {
    if (sourceId) definition = addSourceSection(definition, { id: segment.id, label: segment.label, sourceId, startSeconds: segment.startSeconds, endSeconds: segment.endSeconds });
    else definition = { ...definition, semanticSegments: [...definition.semanticSegments, segment] };
  }
  return definition;
}

export async function GET() {
  const projects = await prisma.project.findMany({
    orderBy: { updatedAt: "desc" },
    include: { sources: true, jobs: { orderBy: { createdAt: "desc" }, take: 1 }, outputs: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  return NextResponse.json(jsonSafe(projects));
}

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());

    // Use semanticSegments if provided, otherwise fall back to segments (backward compatibility)
    const segments = input.semanticSegments.length > 0 ? input.semanticSegments : input.segments;

    const savedRow = input.userTemplateId ? await prisma.userTemplate.findUnique({ where: { id: input.userTemplateId } }) : null;
    if (input.userTemplateId && !savedRow) return jsonError("Template not found", 404);
    const saved = savedRow ? savedTemplateSchema.parse(savedRow.definition) : null;

    const youtubeVideoId = input.sourceUrl ? extractYouTubeId(input.sourceUrl) : undefined;
    if (input.sourceUrl && !youtubeVideoId) return jsonError("Unsupported YouTube URL", 400);
    const sourceData = youtubeVideoId ? { type: "YOUTUBE" as const, youtubeVideoId, youtubeUrl: input.sourceUrl } : undefined;

    const project = await prisma.project.create({
      data: {
        title: input.title,
        preacher: input.preacher || null,
        gospelRef: input.gospelRef || null,
        gospelText: input.gospelText || null,
        templateKey: input.templateKey,
        definition: {},
        sources: sourceData ? { create: [sourceData] } : undefined,
      },
      include: { sources: true },
    });

    const definition = (templatedDefinition(input, saved, segments, project.sources[0]?.id)) ?? definitionFor(segments, input.templateKey, project.sources[0]?.id);

    const updatedProject = await prisma.project.update({
      where: { id: project.id },
      data: { definition },
      include: { sources: true },
    });
    return NextResponse.json(jsonSafe(updatedProject), { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return jsonError(error.issues[0]?.message ?? "Invalid request", 400);
    console.error(error); return jsonError("Unable to create project", 500);
  }
}
