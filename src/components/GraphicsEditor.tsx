"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { applyVariables, type ProjectVariable } from "@/domain/variables";
import { KEYFRAMES } from "./graphics-editor/constants";
import { GraphicsEditorToolbar } from "./graphics-editor/GraphicsEditorToolbar";
import { GraphicsEditorCanvas } from "./graphics-editor/GraphicsEditorCanvas";
import { GraphicsEditorProperties } from "./graphics-editor/GraphicsEditorProperties";
import { GraphicsEditorLayerList } from "./graphics-editor/GraphicsEditorLayerList";
import { moveInFrame, resizeInFrame } from "./graphics-editor/geometry";
import { boxToFrame, frameLayout } from "@/domain/frame-layout";
import type { Asset, Item, Layer } from "./graphics-editor/types";
import { createCaptionLayer } from "@/domain/caption-style";
import AssetPicker from "./AssetPicker";
import { useT } from "@/i18n/I18nProvider";
import { requestJson } from "./api";

/** Parses a serialised layer list; undefined when missing or not a valid array (old/simple graphic). */
export function parseLayers<T = Layer>(raw: string | undefined): T[] | undefined {
  if (!raw) return undefined;
  try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : undefined; } catch { return undefined; }
}

function defaultLayers(item: Item, title: string): Layer[] {
  const stored = parseLayers(item.data?.layers);
  if (stored) return stored;
  const text = item.data?.text ?? item.data?.title ?? title;
  return [{ id: "title", type: "text", x: 160, y: 300, width: 1600, height: 180, text, style: { "font-size": "92px", "font-weight": "700", color: "#ffffff", "text-align": "center", "text-shadow": "0 3px 10px #000" } }];
}

export default function GraphicsEditor({ projectId, graphicId, item, assets, title, variables = [], outputWidth = 1920, outputHeight = 1080, onChange, onAssetsChanged }: { projectId: string; /** Output size of the project: the frame the graphic is shown in. */ outputWidth?: number; outputHeight?: number; graphicId: string; item: Item; assets: Asset[]; title: string; variables?: ProjectVariable[]; onChange: (item: Item) => void; onAssetsChanged?: () => void | Promise<void> }) {
  const t = useT();
  const [layers, setLayers] = useState<Layer[]>(() => defaultLayers(item, title));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(layers[0] ? [layers[0].id] : []));
  const [primaryId, setPrimaryId] = useState<string | null>(layers[0]?.id ?? null);
  const [grid, setGrid] = useState(false);
  const [safe, setSafe] = useState(false);
  const [aspectLock, setAspectLock] = useState(true);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [showValues, setShowValues] = useState(true);
  const [scale, setScale] = useState(0.5);
  // The stage is the output frame plus a margin, so content outside the frame stays visible (dimmed) and editable.
  const layout = useMemo(() => frameLayout({ width: outputWidth, height: outputHeight }), [outputWidth, outputHeight]);
  const margin = Math.round(Math.max(outputWidth, outputHeight) * 0.08);
  const stageWidth = outputWidth + 2 * margin;
  const lastEmitted = useRef<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const artboardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<any>(null);
  const layersRef = useRef(layers);
  layersRef.current = layers;

  // The stage is laid out at its real size (output frame + margin, in output pixels) and scaled to fit. Layers are drawn where the renderer puts them (frame-layout.ts); stored coordinates stay design pixels.
  useEffect(() => {
    const el = canvasRef.current; if (!el) return;
    const update = () => { const w = el.clientWidth; if (w) setScale(w / stageWidth); };
    update();
    const observer = new ResizeObserver(update); observer.observe(el);
    return () => observer.disconnect();
  }, [stageWidth]);

  useEffect(() => {
    // Our own save echoes back as a new item; re-initialising then would reset the selection after every edit.
    if (item.data?.layers !== undefined && item.data.layers === lastEmitted.current) return;
    const next = defaultLayers(item, title);
    setLayers(next);
    setSelectedIds(next[0] ? new Set([next[0].id]) : new Set());
    setPrimaryId(next[0]?.id ?? null);
  }, [item, title]);

  const emit = (next: Layer[]) => { lastEmitted.current = JSON.stringify(next); onChange({ ...item, template: "rich", data: { ...(item.data ?? {}), layers: JSON.stringify(next) } }); };
  const commit = (next: Layer[]) => { setLayers(next); emit(next); };
  const selectOnly = (id: string | null | undefined) => { setSelectedIds(new Set(id ? [id] : [])); setPrimaryId(id ?? null); };

  function updateLayer(id: string, patch: Partial<Layer>) { const next = layers.map(l => l.id === id ? { ...l, ...patch } : l); commit(next); }
  function updateStyle(id: string, key: string, value: string | number) { const l = layers.find(x => x.id === id); if (!l) return; const style = { ...(l.style ?? {}) }; if (value === "") delete style[key]; else style[key] = value; updateLayer(id, { style }); }
  function addLayer(type: Layer["type"]) { const id = `${type}-${Date.now()}`; const base: Layer = type === "caption" ? createCaptionLayer(id) as Layer : type === "text" ? { id, type, x: 220, y: 360, width: 1480, height: 160, text: "Text", style: { "font-size": "72px", color: "#ffffff", "font-weight": "700", "text-align": "center" } } : type === "image" ? { id, type, x: 460, y: 300, width: 1000, height: 560 } : { id, type, x: 460, y: 320, width: 1000, height: 440, style: { background: type === "ellipse" ? "#ffffff" : "#000000" } }; commit([...layers, base]); selectOnly(id); }
  function removeSelected() { if (!selectedIds.size) return; const next = layers.filter(l => !selectedIds.has(l.id)); commit(next); selectOnly(next[0]?.id); }
  function duplicateSelected() { const selected = layers.filter(l => selectedIds.has(l.id)); if (!selected.length) return; const copies = selected.map(l => ({ ...l, id: `${l.type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, x: l.x + 30, y: l.y + 30 })); commit([...layers, ...copies]); setSelectedIds(new Set(copies.map(l => l.id))); setPrimaryId(copies[0].id); }

  function beginPointer(e: React.PointerEvent, layerId: string, kind: string, handle?: string) {
    e.stopPropagation(); const layer = layersRef.current.find(l => l.id === layerId); if (!layer) return;
    const rect = artboardRef.current?.getBoundingClientRect(); if (!rect || !rect.width) return; const scale = rect.width / stageWidth;
    if (kind === "select") { const next = e.shiftKey ? new Set(selectedIds) : new Set<string>(); if (e.shiftKey && next.has(layerId)) next.delete(layerId); else next.add(layerId); setSelectedIds(next); setPrimaryId(layerId); return; }
    dragRef.current = { kind, layerId, handle, startX: e.clientX, startY: e.clientY, layer: { ...layer }, display: boxToFrame(layer, layout), scale, artboardLeft: rect.left, artboardTop: rect.top };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function pointerMove(e: React.PointerEvent) {
    const d = dragRef.current; if (!d) return; const dx = (e.clientX - d.startX) / d.scale, dy = (e.clientY - d.startY) / d.scale; if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    let next = layersRef.current.map(l => ({ ...l })); const idx = next.findIndex(l => l.id === d.layerId); if (idx < 0) return;
    // Dragging happens in the frame (what the user sees); the result goes back to design pixels.
    const disp = d.display as { x: number; y: number; width: number; height: number };
    if (d.kind === "move") next[idx] = { ...next[idx], ...moveInFrame(disp, dx, dy, layout, grid) };
    else if (d.kind === "resize") next[idx] = { ...next[idx], ...resizeInFrame(d.handle, disp, dx, dy, layout, aspectLock) };
    else if (d.kind === "rotate") { const cx = disp.x + disp.width / 2, cy = disp.y + disp.height / 2; const px = (e.clientX - d.artboardLeft) / d.scale - margin, py = (e.clientY - d.artboardTop) / d.scale - margin; let angle = Math.atan2(py - cy, px - cx) * 180 / Math.PI + 90; if (grid) angle = Math.round(angle / 15) * 15; next[idx] = { ...next[idx], rotation: Math.round(angle) }; }
    setLayers(next);
  }

  function pointerUp() { const d = dragRef.current; dragRef.current = null; if (d) emit(layersRef.current); }
  const primary = layers.find(l => l.id === primaryId) ?? null;
  function chooseAsset(assetId: string) { if (!primary || primary.type !== "image") return; updateLayer(primary.id, { src: `/api/projects/${projectId}/assets/${assetId}` }); }

  /** Uploads an image into the library, links it to the project and puts it into the selected image layer. */
  async function uploadImage(file: File) {
    if (!primary || primary.type !== "image") return;
    const layerId = primary.id;
    setUploading(true); setUploadError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("assetKey", file.name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 60) || "image");
      const created = await requestJson<{ id: string }>(`/api/projects/${projectId}/assets`, { method: "POST", body: form }, t("ge.uploadFailed"));
      updateLayer(layerId, { src: `/api/projects/${projectId}/assets/${created.id}` });
      await onAssetsChanged?.();
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : t("ge.uploadFailed"));
    } finally { setUploading(false); }
  }

  function moveLayer(id: string, direction: "up" | "down") {
    const i = layers.findIndex(l => l.id === id), j = direction === "up" ? i + 1 : i - 1;
    if (i < 0 || j < 0 || j >= layers.length) return;
    const next = [...layers]; [next[i], next[j]] = [next[j], next[i]]; commit(next);
  }
  function selectFromList(id: string, additive: boolean) {
    if (!additive) { selectOnly(id); return; }
    const next = new Set(selectedIds); if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next); setPrimaryId(id);
  }

  async function chooseLibraryAsset(asset: { id: string }) {
    if (!primary || primary.type !== "image") return;
    updateLayer(primary.id, { src: `/api/projects/${projectId}/assets/${asset.id}` });
    setLibraryOpen(false);
    await onAssetsChanged?.();
  }

  return <div className="graphics-editor">
    {libraryOpen && <AssetPicker projectId={projectId} kind="image" title={t("ge.pickFromLibrary")} linkedIds={assets.map(a => a.id)} onPick={chooseLibraryAsset} onClose={() => setLibraryOpen(false)} />}
    <style>{KEYFRAMES}</style>
    <GraphicsEditorToolbar grid={grid} safe={safe} onAdd={addLayer} onDuplicate={duplicateSelected} onDelete={removeSelected} showValues={showValues} hasVariables={variables.length > 0} onToggleValues={() => setShowValues(v => !v)} onToggleGrid={() => setGrid(v => !v)} onToggleSafe={() => setSafe(v => !v)} />
    <div className="ge-layout"><GraphicsEditorLayerList layers={layers} selectedIds={selectedIds} primaryId={primaryId} assets={assets} onSelect={selectFromList} onMove={moveLayer} /><GraphicsEditorCanvas layout={layout} margin={margin} scale={scale} variables={showValues ? variables : []} canvasRef={canvasRef} artboardRef={artboardRef} layers={layers} selectedIds={selectedIds} grid={grid} safe={safe} background={item.data?.backgroundColor ?? "#111"} onPointerMove={pointerMove} onPointerUp={pointerUp} onCanvasPointerDown={() => selectOnly(null)} onLayerPointerDown={beginPointer} /><GraphicsEditorProperties variables={variables} onInsertVariable={name => { if (primary && (primary.type === "text" || primary.type === "caption")) updateLayer(primary.id, { text: `${primary.text ?? ""}{{${name}}}` }); }} projectId={projectId} graphicId={graphicId} item={item} assets={assets} primary={primary} uploading={uploading} uploadError={uploadError} aspectLock={aspectLock} onLayer={updateLayer} onStyle={updateStyle} onChooseAsset={chooseAsset} onUploadImage={file => void uploadImage(file)} onOpenLibrary={() => setLibraryOpen(true)} onAspectLock={setAspectLock} /></div>
    <style jsx global>{`.graphics-editor{background:#111827;color:#e5e7eb;border-radius:10px;overflow:hidden;border:1px solid #263244}.ge-toolbar{display:flex;gap:6px;padding:9px;background:#0b1220;border-bottom:1px solid #263244;flex-wrap:wrap}.ge-toolbar button,.ge-properties button{background:#1f2937;color:#e5e7eb;border:1px solid #374151;border-radius:5px;padding:7px 10px;cursor:pointer}.ge-toolbar button.ge-active{background:#164e63}.ge-spacer{flex:1}.ge-layout{display:grid;grid-template-columns:190px minmax(0,1fr) 300px;min-height:620px}.ge-layers{padding:10px 8px;background:#0b1220;border-right:1px solid #263244;overflow:auto}.ge-layers ul{list-style:none;margin:8px 0 0;padding:0;display:grid;gap:3px}.ge-layers li{display:flex;gap:2px;align-items:center;border-radius:5px;border:1px solid transparent}.ge-layers li.ge-layer-selected{background:#1e293b;border-color:#334155}.ge-layers li.ge-layer-primary{border-color:#60a5fa}.ge-layer-pick{flex:1;min-width:0;display:flex;gap:6px;align-items:center;background:none;border:0;color:inherit;padding:6px;cursor:pointer;text-align:left}.ge-layer-icon{width:20px;text-align:center;opacity:.8;font-size:12px}.ge-layer-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ge-layer-order{display:flex}.ge-layer-order button{background:none;border:0;color:inherit;cursor:pointer;padding:4px 5px}.ge-layer-order button:disabled{opacity:.25;cursor:default}.ge-layer-empty{opacity:.6;padding:6px;font-size:13px}.ge-thumbs{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.ge-thumb{padding:3px!important;aspect-ratio:1;display:flex;align-items:center;justify-content:center;background:repeating-conic-gradient(#374151 0 25%,#1f2937 0 50%) 50%/12px 12px!important}.ge-thumb img{max-width:100%;max-height:100%;object-fit:contain}.ge-thumb.ge-active{outline:2px solid #60a5fa}.ge-canvas-wrap{padding:18px;display:flex;align-items:flex-start;justify-content:center;background:#0f172a;overflow:auto}.ge-canvas{width:min(100%,960px);aspect-ratio:16/9;position:relative;touch-action:none}.ge-artboard{position:absolute;left:0;top:0;width:1920px;height:1080px;transform-origin:0 0;overflow:hidden;background:#111}.ge-grid{position:absolute;inset:0;background-image:linear-gradient(#38bdf822 1px,transparent 1px),linear-gradient(90deg,#38bdf822 1px,transparent 1px);background-size:${100/96}% ${100/54}%;pointer-events:none}.ge-safe{position:absolute;pointer-events:none;border:1px dashed rgba(255,255,0,.6);z-index:1000}.safe90{left:5%;right:5%;top:5%;bottom:5%}.safe80{left:10%;right:10%;top:10%;bottom:10%;border-color:rgba(255,140,0,.6)}.ge-handle{position:absolute;width:calc(12px*var(--ge-inv,1));height:calc(12px*var(--ge-inv,1));background:#38bdf8;border:calc(2px*var(--ge-inv,1)) solid #fff;border-radius:2px;transform:translate(-50%,-50%);z-index:20}.ge-rotate{position:absolute;width:calc(12px*var(--ge-inv,1));height:calc(12px*var(--ge-inv,1));background:#f472b6;border:calc(2px*var(--ge-inv,1)) solid #fff;border-radius:50%;transform:translate(-50%,-50%);z-index:20}.ge-properties{padding:10px 14px;background:#111827;border-left:1px solid #263244;overflow:auto}.ge-section{display:grid;gap:8px;padding:10px 0;border-bottom:1px solid #263244}.ge-section>b{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8}.ge-section label{display:grid;gap:4px;font-size:12px;color:#94a3b8}.ge-section input,.ge-section select,.ge-section textarea{width:100%;box-sizing:border-box;background:#0b1220;color:#e5e7eb;border:1px solid #374151;border-radius:5px;padding:7px}.ge-section textarea{min-height:90px;resize:vertical}.ge-two{display:grid;grid-template-columns:1fr 1fr;gap:7px}.ge-section span{color:#cbd5e1}details.ge-fold{border-bottom:1px solid #263244}details.ge-fold>summary{cursor:pointer;padding:9px 0;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;list-style:none;display:flex;justify-content:space-between}details.ge-fold>summary::after{content:"▸"}details.ge-fold[open]>summary::after{content:"▾"}details.ge-fold>.ge-section{border-bottom:0;padding-top:0}.ge-chips{display:flex;flex-wrap:wrap;gap:5px}.ge-chips button{padding:3px 8px!important;font-size:12px}@media(max-width:850px){.ge-layout{grid-template-columns:1fr}.ge-layers{border-right:0;border-bottom:1px solid #263244;max-height:180px}.ge-properties{border-left:0;border-top:1px solid #263244}.ge-canvas-wrap{min-height:400px}}`}</style>
  </div>;
}
