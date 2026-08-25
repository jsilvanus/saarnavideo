import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const updateSchema = z.object({ name: z.string().trim().min(1).max(120).optional(), parentId: z.string().nullable().optional() });

async function isDescendant(folderId: string, possibleParentId: string): Promise<boolean> {
  let currentId: string | null = possibleParentId;
  const seen = new Set<string>();
  while (currentId) {
    if (currentId === folderId) return true;
    if (seen.has(currentId)) return true;
    seen.add(currentId);
    const current = await prisma.assetFolder.findUnique({ where: { id: currentId }, select: { parentId: true } });
    currentId = current?.parentId ?? null;
  }
  return false;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const folder = await prisma.assetFolder.findUnique({ where: { id } });
    if (!folder) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid folder update" }, { status: 400 });
    if (parsed.data.parentId === id) return NextResponse.json({ error: "A folder cannot contain itself" }, { status: 400 });
    if (parsed.data.parentId) {
      const parent = await prisma.assetFolder.findUnique({ where: { id: parsed.data.parentId } });
      if (!parent) return NextResponse.json({ error: "Parent folder not found" }, { status: 404 });
      if (await isDescendant(id, parsed.data.parentId)) return NextResponse.json({ error: "A folder cannot be moved into its own descendant" }, { status: 400 });
    }
    const updated = await prisma.assetFolder.update({ where: { id }, data: { ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}), ...(parsed.data.parentId !== undefined ? { parentId: parsed.data.parentId } : {}) } });
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Asset folder update error:", error);
    return NextResponse.json({ error: "Failed to update folder" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const folder = await prisma.assetFolder.findUnique({ where: { id }, select: { id: true, parentId: true } });
    if (!folder) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    await prisma.$transaction(async tx => {
      await tx.asset.updateMany({ where: { folderId: id }, data: { folderId: folder.parentId } });
      await tx.assetFolder.updateMany({ where: { parentId: id }, data: { parentId: folder.parentId } });
      await tx.assetFolder.delete({ where: { id } });
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Asset folder deletion error:", error);
    return NextResponse.json({ error: "Failed to delete folder" }, { status: 500 });
  }
}
