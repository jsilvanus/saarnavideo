import type { FC } from "react";
import { useT } from "@/i18n/I18nProvider";
import type { Asset, Layer } from "./types";
import { layerLabel } from "./layer-label";

/**
 * Left column of the graphics editor: the layers of the graphic, top-most first. Click selects, Shift+click adds to
 * the selection, the arrows change the stacking order (the last layer in the array is drawn on top).
 */
export const GraphicsEditorLayerList: FC<{
  layers: Layer[]; selectedIds: Set<string>; primaryId: string | null; assets: Asset[];
  onSelect: (id: string, additive: boolean) => void;
  onMove: (id: string, direction: "up" | "down") => void;
}> = ({ layers, selectedIds, primaryId, assets, onSelect, onMove }) => {
  const t = useT();
  const rows = [...layers].reverse();
  return (
    <nav className="ge-layers" aria-label={t("ge.layers")}>
      <b>{t("ge.layers")}</b>
      <ul>
        {rows.map((layer, row) => (
          <li key={layer.id} className={`${selectedIds.has(layer.id) ? "ge-layer-selected" : ""} ${layer.id === primaryId ? "ge-layer-primary" : ""}`}>
            <button className="ge-layer-pick" onClick={e => onSelect(layer.id, e.shiftKey)} title={layer.id}>
              <span aria-hidden="true" className="ge-layer-icon">{layerIcon(layer)}</span>
              <span className="ge-layer-name">{layerLabel(layer, assets, t)}</span>
            </button>
            <span className="ge-layer-order">
              <button disabled={row === 0} aria-label={t("ge.layerUp")} title={t("ge.layerUp")} onClick={() => onMove(layer.id, "up")}>↑</button>
              <button disabled={row === rows.length - 1} aria-label={t("ge.layerDown")} title={t("ge.layerDown")} onClick={() => onMove(layer.id, "down")}>↓</button>
            </span>
          </li>
        ))}
        {!rows.length && <li className="ge-layer-empty">{t("ge.noLayers")}</li>}
      </ul>
    </nav>
  );
};

function layerIcon(layer: Layer): string {
  switch (layer.type) {
    case "text": return "T";
    case "rect": return "▭";
    case "ellipse": return "◯";
    case "image": return "🖼";
    case "caption": return "CC";
  }
}
