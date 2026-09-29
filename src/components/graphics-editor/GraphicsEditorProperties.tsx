import type { FC } from "react";
import { ANIMATIONS } from "./constants";
import { parsePx, styleValue } from "./geometry";
import type { Asset, Item, Layer } from "./types";

async function exportGraphic(projectId: string, graphicId: string) {
  const response = await fetch(`/api/projects/${projectId}/graphics/${graphicId}/export`);
  if (!response.ok) { alert("Could not export graphic"); return; }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = `${graphicId}.svgraphic`; link.click(); URL.revokeObjectURL(url);
}

async function importGraphic(projectId: string, file: File) {
  try {
    const text = await file.text();
    const response = await fetch(`/api/projects/${projectId}/graphics/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: text });
    if (!response.ok) { const data = await response.json().catch(() => null); alert(data?.error ?? "Could not import graphic"); return; }
    window.location.reload();
  } catch { alert("Could not import graphic"); }
}

export const GraphicsEditorProperties: FC<{
  projectId: string; graphicId: string; item: Item; assets: Asset[]; primary: Layer | null; assetPicker: boolean;
  aspectLock: boolean;
  onLayer: (id: string, patch: Partial<Layer>) => void;
  onStyle: (id: string, key: string, value: string | number) => void;
  onChooseAsset: (key: string) => void; onToggleAssetPicker: () => void;
  onAspectLock: (value: boolean) => void;
}> = ({ projectId, graphicId, item, assets, primary, assetPicker, aspectLock, onLayer, onStyle, onChooseAsset, onToggleAssetPicker, onAspectLock }) => (
  <aside className="ge-properties">
    <div className="ge-section"><b>Graphic package</b><button onClick={() => void exportGraphic(projectId, graphicId)}>Export .svgraphic</button><label>Import graphic<input type="file" accept=".svgraphic,application/vnd.saarnavideo.graphic+json,application/json" onChange={e => { const file = e.target.files?.[0]; if (file) void importGraphic(projectId, file); e.currentTarget.value = ""; }} /></label></div>
    {primary && <div className="ge-section"><b>Layer: {primary.id}</b><label>Type<span>{primary.type}</span></label>{primary.type === "caption" && <small>Caption style: this box is where burned-in captions appear. The text below is only a preview sample; the real text comes from the transcript. Long cues are wrapped to the box width and split by Max lines.</small>}{(primary.type === "text" || primary.type === "caption") && <label>{primary.type === "caption" ? "Sample text" : "Text"}<textarea value={primary.text ?? ""} onChange={e => onLayer(primary.id, { text: e.target.value })} /></label>}{primary.type === "image" && <label>Image<button onClick={onToggleAssetPicker}>{primary.src ? "Change image" : "Choose image"}</button></label>}
      <div className="ge-two"><label>X<input type="number" value={primary.x} onChange={e => onLayer(primary.id, { x: Number(e.target.value) })} /></label><label>Y<input type="number" value={primary.y} onChange={e => onLayer(primary.id, { y: Number(e.target.value) })} /></label></div>
      <div className="ge-two"><label>Width<input type="number" min="20" value={primary.width} onChange={e => onLayer(primary.id, { width: Number(e.target.value) })} /></label><label>Height<input type="number" min="20" value={primary.height} onChange={e => onLayer(primary.id, { height: Number(e.target.value) })} /></label></div>
      <label>Rotation<input type="number" value={primary.rotation ?? 0} onChange={e => onLayer(primary.id, { rotation: Number(e.target.value) })} /></label>
      <label>Opacity<input type="range" min="0" max="1" step="0.01" value={parsePx(primary.style?.opacity, 1)} onChange={e => onStyle(primary.id, "opacity", e.target.value)} /></label>
      {(primary.type === "text" || primary.type === "caption") && <>
        <label>Font family<input value={styleValue(primary, "font-family", "Arial, sans-serif")} onChange={e => onStyle(primary.id, "font-family", e.target.value)} /></label>
        <label>Font size<input value={styleValue(primary, "font-size", "72px")} onChange={e => onStyle(primary.id, "font-size", e.target.value)} /></label>
        <div className="ge-two"><label>Weight<select value={styleValue(primary, "font-weight", "700")} onChange={e => onStyle(primary.id, "font-weight", e.target.value)}><option>normal</option><option>bold</option><option>400</option><option>500</option><option>600</option><option>700</option><option>800</option><option>900</option></select></label><label>Align<select value={styleValue(primary, "text-align", "center")} onChange={e => onStyle(primary.id, "text-align", e.target.value)}><option>left</option><option>center</option><option>right</option></select></label></div>
        <label>Color<input type="text" value={styleValue(primary, "color", "#fff")} onChange={e => onStyle(primary.id, "color", e.target.value)} /></label>
        <label>Text shadow<input value={styleValue(primary, "text-shadow")} onChange={e => onStyle(primary.id, "text-shadow", e.target.value)} placeholder="0 3px 10px #000" /></label>
        <label>Text stroke<input value={styleValue(primary, "-webkit-text-stroke")} onChange={e => onStyle(primary.id, "-webkit-text-stroke", e.target.value)} placeholder="1px #000" /></label>
      </>}
      {primary.type === "caption" && <>
        <div className="ge-two"><label>Vertical align<select value={styleValue(primary, "vertical-align", "bottom")} onChange={e => onStyle(primary.id, "vertical-align", e.target.value)}><option value="top">top</option><option value="middle">middle</option><option value="bottom">bottom</option></select></label><label>Max lines<input type="number" min="1" max="6" value={styleValue(primary, "max-lines", "2")} onChange={e => onStyle(primary.id, "max-lines", Number(e.target.value))} /></label></div>
        <label>Background box<input type="text" value={styleValue(primary, "background")} onChange={e => onStyle(primary.id, "background", e.target.value)} placeholder="rgba(0,0,0,0.6) or empty" /></label>
        <label>Padding<input value={styleValue(primary, "padding", "12px")} onChange={e => onStyle(primary.id, "padding", e.target.value)} /></label>
      </>}
      {(primary.type === "rect" || primary.type === "ellipse") && <label>Background<input type="text" value={styleValue(primary, "background", primary.type === "ellipse" ? "#fff" : "#000")} onChange={e => onStyle(primary.id, "background", e.target.value)} /></label>}
      <label>Animation<select value={(primary.animation ?? "").split(" ")[0]} onChange={e => onLayer(primary.id, { animation: e.target.value ? `${e.target.value} 1s ease 0s 1 normal forwards` : undefined })}>{ANIMATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label><span>Aspect lock</span><input type="checkbox" checked={aspectLock} onChange={e => onAspectLock(e.target.checked)} /></label>
    </div>}
    {assetPicker && <div className="ge-section"><b>Assets</b>{assets.filter(a => a.type !== "FONT").map(a => <button key={a.id} onClick={() => onChooseAsset(a.assetKey)}>{a.assetKey}</button>)}{!assets.length && <span>No image assets yet.</span>}</div>}
  </aside>
);
