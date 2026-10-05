import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assetFileResponse } from "@/app/api/_lib/assets";
import { jsonError } from "@/app/api/_lib/http";
import { removeStoredFile } from "@/app/api/_lib/files";
import { validateAssetKey } from "@/integrations/image-assets";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const asset = await prisma.asset.findUnique({ where: { id } });
  if (!asset) return jsonError("Asset not found", 404);
  return assetFileResponse(asset, request);
}

const patchSchema = z.object({ folderId: z.string().nullable().optional(), assetKey: z.string().optional() });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const asset = await prisma.asset.findUnique({ where: { id } });
    if (!asset) return jsonError("Asset not found", 404);
    const parsed = patchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("Invalid request body", 400);
    const body = parsed.data;
    const assetKey = body.assetKey?.trim();
    if (assetKey !== undefined) {
      const validation = validateAssetKey(assetKey);
      if (!validation.valid) return jsonError(validation.reason!, 400);
      if (assetKey !== asset.assetKey && await prisma.asset.findFirst({ where: { assetKey, id: { not: id } }, select: { id: true } })) return jsonError(`Another library asset is already named "${assetKey}"`, 409);
    }
    if (body.folderId && !(await prisma.assetFolder.findUnique({ where: { id: body.folderId } }))) return jsonError("Folder not found", 404);
    const updated = await prisma.asset.update({ where: { id }, data: { ...(body.folderId !== undefined ? { folderId: body.folderId } : {}), ...(assetKey !== undefined ? { assetKey } : {}) } });
    return NextResponse.json({ id: updated.id, assetKey: updated.assetKey, folderId: updated.folderId });
  } catch (error) {
    console.error("Asset update error:", error);
    return jsonError("Failed to update asset", 500);
  }
}

/**
 * Deletes a library asset. Refused with 409 while projects still link it (`?force=1` deletes anyway; graphics that
 * still refer to it then render without the image). The content-addressed file is removed only when no other Asset row
 * points at the same storagePath.
 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const asset = await prisma.asset.findUnique({ where: { id }, select: { id: true, assetKey: true, storagePath: true, projects: { select: { id: true, title: true } } } });
    if (!asset) return jsonError("Asset not found", 404);
    const count = asset.projects.length;
    if (count > 0 && new URL(request.url).searchParams.get("force") !== "1") {
      const names = asset.projects.slice(0, 5).map(p => p.title).join(", ") + (count > 5 ? ", ..." : "");
      return NextResponse.json({ error: `"${asset.assetKey}" is still used in ${count} project${count === 1 ? "" : "s"} (${names}). Remove it from them first, or delete it anyway.`, projectCount: count }, { status: 409 });
    }
    await prisma.asset.delete({ where: { id } });
    if (asset.storagePath && await prisma.asset.count({ where: { storagePath: asset.storagePath } }) === 0) await removeStoredFile(asset.storagePath);
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Asset delete error:", error);
    return jsonError("Failed to delete asset", 500);
  }
}
