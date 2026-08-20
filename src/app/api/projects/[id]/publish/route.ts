import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const schema = z.object({ privacy: z.enum(["PRIVATE", "UNLISTED", "PUBLIC"]).default("PRIVATE") });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const input = schema.parse(await request.json().catch(() => ({})));
  const output = await prisma.output.findFirst({ where: { projectId: id, type: "VIDEO", expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
  if (!output) return NextResponse.json({ error: "No retained generated video is available" }, { status: 404 });
  const publication = await prisma.publication.create({ data: { projectId: id, outputId: output.id, provider: "YOUTUBE", privacy: input.privacy, status: "QUEUED" } });
  return NextResponse.json(publication, { status: 202 });
}
