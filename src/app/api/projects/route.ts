import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createProjectDefinition } from "@/domain/project";

const segmentSchema = z.object({ id: z.string().min(1), label: z.string().min(1), startSeconds: z.number().nonnegative(), endSeconds: z.number().positive() }).refine((v) => v.endSeconds > v.startSeconds, "Segment end must be after start");
const requestSchema = z.object({ title: z.string().trim().min(1).max(200), preacher: z.string().trim().max(200).optional().default(""), gospelRef: z.string().trim().max(200).optional().default(""), gospelText: z.string().optional().default(""), templateKey: z.string().min(1).default("sermon"), sourceUrl: z.string().url().optional(), segments: z.array(segmentSchema).default([]), semanticSegments: z.array(segmentSchema).default([]) });

function extractYouTubeId(urlString: string): string | null {
  const url = new URL(urlString);
  if (url.hostname === "youtu.be") return url.pathname.slice(1) || null;
  if (url.hostname.endsWith("youtube.com")) {
    if (url.pathname === "/watch") return url.searchParams.get("v");
    if (url.pathname.startsWith("/shorts/")) return url.pathname.split("/")[2] ?? null;
    if (url.pathname.startsWith("/live/")) return url.pathname.split("/")[2] ?? null;
  }
  return null;
}

function jsonSafe(value: unknown) { return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item)); }

function definitionFor(segments: z.infer<typeof segmentSchema>[], sourceId: string, templateKey: string = "sermon") {
  return createProjectDefinition({ 
    template: { 
      key: templateKey,
      width: 1920,
      height: 1080,
      fps: 30,
      backgroundColor: "black",
      textColor: "white",
    },
    semanticSegments: segments, 
    composition: {
      items: segments.map((segment) => ({ type: "source-clip" as const, sourceId, startSeconds: segment.startSeconds, endSeconds: segment.endSeconds })),
    }
  });
}

export async function GET() {
  const projects = await prisma.project.findMany({ orderBy: { updatedAt: "desc" }, include: { sources: true, jobs: { orderBy: { createdAt: "desc" }, take: 1 }, outputs: { orderBy: { createdAt: "desc" }, take: 1 } } });
  return NextResponse.json(jsonSafe(projects));
}

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    
    // Use semanticSegments if provided, otherwise fall back to segments (backward compatibility)
    const segments = input.semanticSegments.length > 0 ? input.semanticSegments : input.segments;
    
    const sourceData = input.sourceUrl ? (() => {
      const youtubeVideoId = extractYouTubeId(input.sourceUrl!);
      if (!youtubeVideoId) throw new Error("Unsupported YouTube URL");
      return { type: "YOUTUBE" as const, youtubeVideoId, youtubeUrl: input.sourceUrl };
    })() : undefined;
    
    const project = await prisma.project.create({ data: {
      title: input.title, 
      preacher: input.preacher || null, 
      gospelRef: input.gospelRef || null, 
      gospelText: input.gospelText || null, 
      templateKey: input.templateKey,
      definition: {},
      sources: sourceData ? { create: [sourceData] } : undefined,
    }, include: { sources: true } });
    
    // Create definition with the first source (if available)
    let definition = createProjectDefinition({ 
      template: { 
        key: input.templateKey,
        width: 1920,
        height: 1080,
        fps: 30,
        backgroundColor: "black",
        textColor: "white",
      },
      semanticSegments: segments, 
      composition: { items: [] }
    });
    if (project.sources.length > 0) {
      definition = definitionFor(segments, project.sources[0].id, input.templateKey);
    }
    
    const updatedProject = await prisma.project.update({ where: { id: project.id }, data: { definition, templateKey: input.templateKey }, include: { sources: true } });
    return NextResponse.json(jsonSafe(updatedProject), { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
    if (error instanceof Error && error.message === "Unsupported YouTube URL") return NextResponse.json({ error: error.message }, { status: 400 });
    console.error(error); return NextResponse.json({ error: "Unable to create project" }, { status: 500 });
  }
}
