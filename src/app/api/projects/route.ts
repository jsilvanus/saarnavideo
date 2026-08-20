import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createProjectDefinition } from "@/domain/project";

const requestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  preacher: z.string().trim().max(200).optional().default(""),
  sourceUrl: z.string().url(),
  segments: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    startSeconds: z.number().nonnegative(),
    endSeconds: z.number().positive(),
  })).min(1),
});

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

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    const youtubeVideoId = extractYouTubeId(input.sourceUrl);
    if (!youtubeVideoId) {
      return NextResponse.json({ error: "Unsupported YouTube URL" }, { status: 400 });
    }

    const definition = createProjectDefinition({
      semanticSegments: input.segments,
      composition: {
        sourceStartSeconds: Math.min(...input.segments.map((s) => s.startSeconds)),
        sourceEndSeconds: Math.max(...input.segments.map((s) => s.endSeconds)),
        items: input.segments.map((segment) => ({
          type: "source-clip" as const,
          startSeconds: segment.startSeconds,
          endSeconds: segment.endSeconds,
        })),
      },
    });

    const project = await prisma.project.create({
      data: {
        title: input.title,
        preacher: input.preacher || null,
        templateKey: "sermon",
        definition,
        source: {
          create: {
            type: "YOUTUBE",
            youtubeVideoId,
            youtubeUrl: input.sourceUrl,
          },
        },
      },
      select: { id: true },
    });

    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
    }
    console.error(error);
    return NextResponse.json({ error: "Unable to create project" }, { status: 500 });
  }
}
