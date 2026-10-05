import type { Asset, PrismaClient } from "@prisma/client";
import { assetIdFromRef, collectImageRefs, type AssetRef } from "@/domain/asset-usage";

/**
 * One link policy for every asset type: a library asset that a project's definition refers to (by id, by key or by its
 * project URL) gets linked to the project automatically, so a render never silently drops an image that exists in the
 * library. Returns the assets that were linked just now; references that match nothing in the library stay unresolved.
 */
export async function linkReferencedAssets(db: PrismaClient, projectId: string, definition: unknown, linked: readonly AssetRef[], audioIds: readonly string[] = []): Promise<Asset[]> {
  const refs = collectImageRefs(definition);
  const ids = new Set<string>(audioIds);
  for (const ref of refs) { const id = assetIdFromRef(ref); if (id) ids.add(id); }
  if (!ids.size && !refs.length) return [];
  const already = new Set(linked.map(asset => asset.id));
  const candidates = await db.asset.findMany({ where: { OR: [{ id: { in: [...ids, ...refs] } }, { assetKey: { in: refs } }] } });
  const fresh = candidates.filter(asset => !already.has(asset.id));
  if (fresh.length) await db.project.update({ where: { id: projectId }, data: { assets: { connect: fresh.map(asset => ({ id: asset.id })) } } });
  return fresh;
}
