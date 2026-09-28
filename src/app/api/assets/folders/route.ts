import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/app/api/_lib/http";

const folderSchema = z.object({ name: z.string().trim().min(1).max(120), parentId: z.string().nullable().optional() });

export async function GET() {
  const folders = await prisma.assetFolder.findMany({
    select: { id: true, name: true, parentId: true, _count: { select: { assets: true, children: true } } },
    orderBy: [{ parentId: "asc" }, { name: "asc" }],
  });
  return NextResponse.json({ folders });
}

export async function POST(request: Request) {
  try {
    const parsed = folderSchema.safeParse(await request.json());
    if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Invalid folder", 400);
    if (parsed.data.parentId) {
      const parent = await prisma.assetFolder.findUnique({ where: { id: parsed.data.parentId } });
      if (!parent) return jsonError("Parent folder not found", 404);
    }
    const folder = await prisma.assetFolder.create({ data: { name: parsed.data.name, parentId: parsed.data.parentId ?? null } });
    return NextResponse.json(folder, { status: 201 });
  } catch (error) {
    console.error("Asset folder creation error:", error);
    return jsonError("Failed to create folder", 500);
  }
}
