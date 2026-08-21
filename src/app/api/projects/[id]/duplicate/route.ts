import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function jsonSafe(value: unknown) {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item));
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const source = await prisma.project.findUnique({
    where: { id },
    include: { sources: true, assets: true },
  });
  if (!source) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const copy = await prisma.project.create({
    data: {
      title: `${source.title} (copy)`,
      preacher: source.preacher,
      gospelRef: source.gospelRef,
      gospelText: source.gospelText,
      templateKey: source.templateKey,
      definition: source.definition,
      sources: { connect: source.sources.map((item) => ({ id: item.id })) },
      assets: { connect: source.assets.map((item) => ({ id: item.id })) },
    },
    include: { sources: true, assets: true },
  });

  return NextResponse.json(jsonSafe(copy), { status: 201 });
}
