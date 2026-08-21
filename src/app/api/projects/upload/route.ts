import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createProjectDefinition } from "@/domain/project";

const fieldsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  preacher: z.string().trim().max(200).optional().default(""),
  gospelStart: z.coerce.number().nonnegative(),
  gospelEnd: z.coerce.number().positive(),
  sermonStart: z.coerce.number().nonnegative(),
  sermonEnd: z.coerce.number().positive(),
});

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "A source file is required" }, { status: 400 });

    const fields = fieldsSchema.parse({ title: form.get("title"), preacher: form.get("preacher") ?? "", gospelStart: form.get("gospelStart"), gospelEnd: form.get("gospelEnd"), sermonStart: form.get("sermonStart"), sermonEnd: form.get("sermonEnd") });
    const projectId = crypto.randomUUID();
    const mediaRoot = process.env.MEDIA_ROOT ?? "/data/media";
    const projectDir = path.join(mediaRoot, "sources", projectId);
    await mkdir(projectDir, { recursive: true });
    const safeName = path.basename(file.name).replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = path.join(projectDir, safeName || "source-video");
    await writeFile(storagePath, Buffer.from(await file.arrayBuffer()));

    const segments = [
      { id: "gospel", label: "Gospel", startSeconds: fields.gospelStart, endSeconds: fields.gospelEnd },
      { id: "sermon", label: "Sermon", startSeconds: fields.sermonStart, endSeconds: fields.sermonEnd },
    ];

    const project = await prisma.project.create({
      data: {
        id: projectId,
        title: fields.title,
        preacher: fields.preacher || null,
        templateKey: "sermon",
        definition: {},
        sources: { create: [{ type: "UPLOAD", originalName: file.name, storagePath, mimeType: file.type || "application/octet-stream", sizeBytes: file.size }] },
      },
      include: { sources: true },
    });

    const sourceId = project.sources[0]?.id;
    const definition = createProjectDefinition({
      semanticSegments: segments,
      composition: {
        sourceStartSeconds: Math.min(...segments.map((s) => s.startSeconds)),
        sourceEndSeconds: Math.max(...segments.map((s) => s.endSeconds)),
        items: sourceId ? segments.map((s) => ({ type: "source-clip" as const, sourceId, startSeconds: s.startSeconds, endSeconds: s.endSeconds })) : [],
      },
    });

    const updatedProject = await prisma.project.update({ where: { id: projectId }, data: { definition }, select: { id: true } });
    return NextResponse.json(updatedProject, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid upload" }, { status: 400 });
    console.error(error);
    return NextResponse.json({ error: "Unable to create uploaded project" }, { status: 500 });
  }
}
