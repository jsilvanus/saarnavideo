import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/app/api/_lib/http";

const schema = z.object({ privacy: z.enum(["PRIVATE", "UNLISTED", "PUBLIC"]).default("PRIVATE") });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const input = schema.parse(await request.json().catch(() => ({})));
  const connection = await prisma.youTubeConnection.findUnique({ where: { provider: "youtube" }, select: { id: true } });
  if (!connection) return jsonError("Connect a YouTube account before publishing.", 409);
  const output = await prisma.output.findFirst({ where: { projectId: id, type: "VIDEO", preview: false, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
  if (!output) return jsonError("No retained generated video is available", 404);
  const publication = await prisma.publication.create({ data: { projectId: id, outputId: output.id, provider: "YOUTUBE", privacy: input.privacy, status: "QUEUED" } });
  return NextResponse.json(publication, { status: 202 });
}
