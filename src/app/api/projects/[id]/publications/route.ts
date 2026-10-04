import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonSafe } from "@/app/api/_lib/http";

/** Publications of a project, newest first: the small payload the publish panel polls while an upload runs. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const project = await prisma.project.findUnique({ where: { id }, select: { id: true } });
  if (!project) return jsonError("Project not found", 404);
  const publications = await prisma.publication.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" } });
  return NextResponse.json(jsonSafe({ publications }));
}
