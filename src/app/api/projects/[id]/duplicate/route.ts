import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonSafe } from "@/app/api/_lib/http";

const SOURCE_RETENTION_MS = Number(process.env.MEDIA_RETENTION_DAYS ?? 7) * 24 * 60 * 60 * 1000;

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const source = await prisma.project.findUnique({
    where: { id },
    include: { sources: true, assets: true },
  });
  if (!source) return jsonError("Project not found", 404);

  // A duplicate is a new project instance: source records are copied so each
  // project can later change/remove its own source without affecting the
  // original. The underlying file is deliberately shared by storagePath.
  const copy = await prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        title: `${source.title} (copy)`,
        preacher: source.preacher,
        gospelRef: source.gospelRef,
        gospelText: source.gospelText,
        templateKey: source.templateKey,
        definition: source.definition === null ? Prisma.JsonNull : source.definition,
        assets: { connect: source.assets.map((item) => ({ id: item.id })) },
      },
    });

    for (const item of source.sources) {
      await tx.source.create({
        data: {
          type: item.type,
          status: item.status,
          youtubeVideoId: item.youtubeVideoId,
          youtubeUrl: item.youtubeUrl,
          originalName: item.originalName,
          storagePath: item.storagePath,
          mimeType: item.mimeType,
          sizeBytes: item.sizeBytes,
          durationMs: item.durationMs,
          referenceDurationMs: item.referenceDurationMs,
          expiresAt: item.storagePath ? new Date(Date.now() + SOURCE_RETENTION_MS) : null,
          projects: { connect: { id: project.id } },
        },
      });
    }

    return tx.project.findUniqueOrThrow({
      where: { id: project.id },
      include: { sources: true, assets: true },
    });
  });

  return NextResponse.json(jsonSafe(copy), { status: 201 });
}
