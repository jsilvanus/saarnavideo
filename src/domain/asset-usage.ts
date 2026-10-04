/** Finds where a project definition refers to an asset (graphic layers, composition items, podcast intro/outro). */
export type AssetRef = { id: string; assetKey: string };

type LooseDefinition = {
  graphics?: Array<{ id?: string; name?: string; layers?: Array<{ src?: string; type?: string }> }>;
  composition?: { items?: Array<Record<string, unknown>> };
  podcast?: { introAssetId?: string; outroAssetId?: string };
};

/** True when `value` names the asset by id, by key or by its project URL (`/api/projects/<p>/assets/<id>`). */
export function refersToAsset(value: unknown, asset: AssetRef): boolean {
  if (typeof value !== "string" || !value) return false;
  return value === asset.id || value === asset.assetKey || value.endsWith(`/assets/${asset.id}`);
}

/** Human readable usage descriptions, empty when the definition does not use the asset. */
export function findAssetUsage(definition: unknown, asset: AssetRef): string[] {
  const def = (definition ?? {}) as LooseDefinition;
  const usage: string[] = [];
  for (const graphic of def.graphics ?? []) {
    if ((graphic.layers ?? []).some(layer => refersToAsset(layer.src, asset))) usage.push(`graphic "${graphic.name ?? graphic.id ?? "?"}"`);
  }
  (def.composition?.items ?? []).forEach((item, index) => {
    const label = `composition item ${index + 1} (${String(item.type ?? "?")})`;
    if (refersToAsset(item.imageAsset, asset) || refersToAsset(item.backgroundImage, asset) || (item.type === "audio-clip" && refersToAsset(item.assetId, asset))) usage.push(label);
  });
  if (refersToAsset(def.podcast?.introAssetId, asset)) usage.push("podcast intro");
  if (refersToAsset(def.podcast?.outroAssetId, asset)) usage.push("podcast outro");
  return usage;
}

/**
 * Image references (overlay `imageAsset`, slate/audio `backgroundImage`, image layers of graphics) that name no asset
 * linked to the project. The renderer skips such references silently, so they are reported before and during a render.
 */
export function findUnresolvedImageRefs(definition: unknown, linked: readonly AssetRef[]): string[] {
  const def = (definition ?? {}) as LooseDefinition;
  const resolves = (value: string) => linked.some(asset => refersToAsset(value, asset));
  const missing: string[] = [];
  for (const graphic of def.graphics ?? []) {
    for (const layer of graphic.layers ?? []) {
      if (layer.type === "image" && typeof layer.src === "string" && layer.src && !resolves(layer.src)) missing.push(`graphic "${graphic.name ?? graphic.id ?? "?"}" uses image "${layer.src}"`);
    }
  }
  (def.composition?.items ?? []).forEach((item, index) => {
    for (const field of ["imageAsset", "backgroundImage"] as const) {
      const value = item[field];
      if (typeof value === "string" && value && !resolves(value)) missing.push(`composition item ${index + 1} (${String(item.type ?? "?")}) uses image "${value}"`);
    }
  });
  return missing.map(entry => `${entry}, which is not linked to this project and will be left out of the render`);
}
