import type { FC } from "react";
import { useT } from "@/i18n/I18nProvider";
import type { MessageKey, TFunction } from "@/i18n/translate";
import { ANIMATIONS } from "./constants";
import { parsePx, styleValue } from "./geometry";
import type { Asset, Item, Layer } from "./types";

async function exportGraphic(projectId: string, graphicId: string, t: TFunction) {
  const response = await fetch(`/api/projects/${projectId}/graphics/${graphicId}/export`);
  if (!response.ok) { alert(t("ge.exportFailed")); return; }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = `${graphicId}.svgraphic`; link.click(); URL.revokeObjectURL(url);
}

async function importGraphic(projectId: string, file: File, t: TFunction) {
  try {
    const text = await file.text();
    const response = await fetch(`/api/projects/${projectId}/graphics/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: text });
    if (!response.ok) { const data = await response.json().catch(() => null); alert(data?.error ?? t("ge.importFailed")); return; }
    window.location.reload();
  } catch { alert(t("ge.importFailed")); }
}

export const GraphicsEditorProperties: FC<{
  projectId: string; graphicId: string; item: Item; assets: Asset[]; primary: Layer | null; assetPicker: boolean;
  aspectLock: boolean;
  onLayer: (id: string, patch: Partial<Layer>) => void;
  onStyle: (id: string, key: string, value: string | number) => void;
  onChooseAsset: (key: string) => void; onToggleAssetPicker: () => void; onOpenLibrary?: () => void;
  onAspectLock: (value: boolean) => void;
}> = ({ projectId, graphicId, item, assets, primary, assetPicker, aspectLock, onLayer, onStyle, onChooseAsset, onToggleAssetPicker, onOpenLibrary, onAspectLock }) => {
  const t = useT();
  return (
  <aside className="ge-properties">
    <div className="ge-section"><b>{t("ge.package")}</b><button onClick={() => void exportGraphic(projectId, graphicId, t)}>{t("ge.export")}</button><label>{t("ge.import")}<input type="file" accept=".svgraphic,application/vnd.saarnavideo.graphic+json,application/json" onChange={e => { const file = e.target.files?.[0]; if (file) void importGraphic(projectId, file, t); e.currentTarget.value = ""; }} /></label></div>
    {primary && <div className="ge-section"><b>{t("ge.layer", { id: primary.id })}</b><label>{t("ge.type")}<span>{primary.type}</span></label>{primary.type === "caption" && <small>{t("ge.captionHelp")}</small>}{(primary.type === "text" || primary.type === "caption") && <label>{primary.type === "caption" ? t("ge.sampleText") : t("ge.text")}<textarea value={primary.text ?? ""} onChange={e => onLayer(primary.id, { text: e.target.value })} /></label>}{primary.type === "image" && <label>{t("ge.image")}<button onClick={onToggleAssetPicker}>{primary.src ? t("ge.changeImage") : t("ge.chooseImage")}</button></label>}
      <div className="ge-two"><label>X<input type="number" value={primary.x} onChange={e => onLayer(primary.id, { x: Number(e.target.value) })} /></label><label>Y<input type="number" value={primary.y} onChange={e => onLayer(primary.id, { y: Number(e.target.value) })} /></label></div>
      <div className="ge-two"><label>{t("ge.width")}<input type="number" min="20" value={primary.width} onChange={e => onLayer(primary.id, { width: Number(e.target.value) })} /></label><label>{t("ge.height")}<input type="number" min="20" value={primary.height} onChange={e => onLayer(primary.id, { height: Number(e.target.value) })} /></label></div>
      <label>{t("ge.rotation")}<input type="number" value={primary.rotation ?? 0} onChange={e => onLayer(primary.id, { rotation: Number(e.target.value) })} /></label>
      <label>{t("ge.opacity")}<input type="range" min="0" max="1" step="0.01" value={parsePx(primary.style?.opacity, 1)} onChange={e => onStyle(primary.id, "opacity", e.target.value)} /></label>
      {(primary.type === "text" || primary.type === "caption") && <>
        <label>{t("ge.fontFamily")}<input value={styleValue(primary, "font-family", "Arial, sans-serif")} onChange={e => onStyle(primary.id, "font-family", e.target.value)} /></label>
        <label>{t("ge.fontSize")}<input value={styleValue(primary, "font-size", "72px")} onChange={e => onStyle(primary.id, "font-size", e.target.value)} /></label>
        <div className="ge-two"><label>{t("ge.weight")}<select value={styleValue(primary, "font-weight", "700")} onChange={e => onStyle(primary.id, "font-weight", e.target.value)}><option>normal</option><option>bold</option><option>400</option><option>500</option><option>600</option><option>700</option><option>800</option><option>900</option></select></label><label>{t("ge.align")}<select value={styleValue(primary, "text-align", "center")} onChange={e => onStyle(primary.id, "text-align", e.target.value)}><option>left</option><option>center</option><option>right</option></select></label></div>
        <label>{t("ge.color")}<input type="text" value={styleValue(primary, "color", "#fff")} onChange={e => onStyle(primary.id, "color", e.target.value)} /></label>
        <label>{t("ge.textShadow")}<input value={styleValue(primary, "text-shadow")} onChange={e => onStyle(primary.id, "text-shadow", e.target.value)} placeholder="0 3px 10px #000" /></label>
        <label>{t("ge.textStroke")}<input value={styleValue(primary, "-webkit-text-stroke")} onChange={e => onStyle(primary.id, "-webkit-text-stroke", e.target.value)} placeholder="1px #000" /></label>
      </>}
      {primary.type === "caption" && <>
        <div className="ge-two"><label>{t("ge.verticalAlign")}<select value={styleValue(primary, "vertical-align", "bottom")} onChange={e => onStyle(primary.id, "vertical-align", e.target.value)}><option value="top">{t("ge.top")}</option><option value="middle">{t("ge.middle")}</option><option value="bottom">{t("ge.bottom")}</option></select></label><label>{t("ge.maxLines")}<input type="number" min="1" max="6" value={styleValue(primary, "max-lines", "2")} onChange={e => onStyle(primary.id, "max-lines", Number(e.target.value))} /></label></div>
        <label>{t("ge.backgroundBox")}<input type="text" value={styleValue(primary, "background")} onChange={e => onStyle(primary.id, "background", e.target.value)} placeholder={t("ge.backgroundBoxPlaceholder")} /></label>
        <label>{t("ge.padding")}<input value={styleValue(primary, "padding", "12px")} onChange={e => onStyle(primary.id, "padding", e.target.value)} /></label>
      </>}
      {(primary.type === "rect" || primary.type === "ellipse") && <label>{t("ge.background")}<input type="text" value={styleValue(primary, "background", primary.type === "ellipse" ? "#fff" : "#000")} onChange={e => onStyle(primary.id, "background", e.target.value)} /></label>}
      <label>{t("ge.animation")}<select value={(primary.animation ?? "").split(" ")[0]} onChange={e => onLayer(primary.id, { animation: e.target.value ? `${e.target.value} 1s ease 0s 1 normal forwards` : undefined })}>{ANIMATIONS.map(v => <option key={v} value={v}>{t(`ge.anim.${v || "none"}` as MessageKey)}</option>)}</select></label>
      <label><span>{t("ge.aspectLock")}</span><input type="checkbox" checked={aspectLock} onChange={e => onAspectLock(e.target.checked)} /></label>
    </div>}
    {assetPicker && <div className="ge-section"><b>{t("ge.assets")}</b>{assets.filter(a => a.type !== "FONT" && a.type !== "AUDIO").map(a => <button key={a.id} onClick={() => onChooseAsset(a.assetKey)}>{a.assetKey}</button>)}{!assets.some(a => a.type !== "FONT" && a.type !== "AUDIO") && <span>{t("ge.noAssets")}</span>}{onOpenLibrary && <button data-testid="choose-from-library" onClick={onOpenLibrary}>{t("ge.fromLibrary")}</button>}</div>}
  </aside>
);
};
