import type { TFunction } from "@/i18n/translate";
import type { Asset, Layer } from "./types";

const MAX_LABEL = 28;

/** The asset id a project image layer points at (`/api/projects/<id>/assets/<assetId>`), if any. */
export function layerAssetId(src: string | undefined): string | undefined {
  return src?.match(/\/assets\/([^/?#]+)/)?.[1];
}

/** Short name of a layer for the layer list: its text, the key of its image, else the layer kind. */
export function layerLabel(layer: Layer, assets: Asset[], t: TFunction): string {
  const clip = (s: string) => (s.length > MAX_LABEL ? `${s.slice(0, MAX_LABEL - 1)}…` : s);
  if ((layer.type === "text" || layer.type === "caption") && layer.text?.trim()) return clip(layer.text.trim().replace(/\s+/g, " "));
  if (layer.type === "image") {
    const asset = assets.find(a => a.id === layerAssetId(layer.src));
    return asset ? clip(asset.assetKey) : t("ge.layerName.imageEmpty");
  }
  return t(`ge.layerName.${layer.type}` as Parameters<TFunction>[0]);
}
