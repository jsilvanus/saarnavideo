"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { KEYFRAMES, WIDTH } from "./graphics-editor/constants";
import { GraphicsEditorToolbar } from "./graphics-editor/GraphicsEditorToolbar";
import { GraphicsEditorCanvas } from "./graphics-editor/GraphicsEditorCanvas";
import { GraphicsEditorProperties } from "./graphics-editor/GraphicsEditorProperties";
import { resizeLayer, snap } from "./graphics-editor/geometry";
import type { Asset, Item, Layer } from "./graphics-editor/types";
import { createCaptionLayer } from "@/domain/caption-style";
import AssetPicker from "./AssetPicker";
import { useT } from "@/i18n/I18nProvider";

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

export default function GraphicsEditor({ projectId, graphicId, item, assets, title, onChange, onAssetsChanged }: { projectId: string; graphicId: string; item: Item; assets: Asset[]; title: string; onChange: (item: Item) => void; onAssetsChanged?: () => void | Promise<void> }) {
  const t = useT();
  const [layers, setLayers] = useState<Layer[]>(() => defaultLayers(item, title));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(layers[0] ? [layers[0].id] : []));
  const [primaryId, setPrimaryId] = useState<string | null>(layers[0]?.id ?? null);
  const [grid, setGrid] = useState(false);
  const [safe, setSafe] = useState(false);
  const [aspectLock, setAspectLock] = useState(true);
  const [assetPicker, setAssetPicker] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const artboardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<any>(null);
  const layersRef = useRef(layers);
  layersRef.current = layers;

  useEffect(() => {
    const next = defaultLayers(item, title);
    setLayers(next);
    setSelectedIds(next[0] ? new Set([next[0].id]) : new Set());
    setPrimaryId(next[0]?.id ?? null);
  }, [item, title]);

  const emit = (next: Layer[]) => onChange({ ...item, template: "rich", data: { ...(item.data ?? {}), layers: JSON.stringify(next) } });
  const commit = (next: Layer[]) => { setLayers(next); emit(next); };
  const selectOnly = (id: string | null | undefined) => { setSelectedIds(new Set(id ? [id] : [])); setPrimaryId(id ?? null); };

  function updateLayer(id: string, patch: Partial<Layer>) { const next = layers.map(l => l.id === id ? { ...l, ...patch } : l); commit(next); }
  function updateStyle(id: string, key: string, value: string | number) { const l = layers.find(x => x.id === id); if (!l) return; const style = { ...(l.style ?? {}) }; if (value === "") delete style[key]; else style[key] = value; updateLayer(id, { style }); }
  function addLayer(type: Layer["type"]) { const id = `${type}-${Date.now()}`; const base: Layer = type === "caption" ? createCaptionLayer(id) as Layer : type === "text" ? { id, type, x: 220, y: 360, width: 1480, height: 160, text: "Text", style: { "font-size": "72px", color: "#ffffff", "font-weight": "700", "text-align": "center" } } : type === "image" ? { id, type, x: 460, y: 300, width: 1000, height: 560 } : { id, type, x: 460, y: 320, width: 1000, height: 440, style: { background: type === "ellipse" ? "#ffffff" : "#000000" } }; commit([...layers, base]); selectOnly(id); }
  function removeSelected() { if (!selectedIds.size) return; const next = layers.filter(l => !selectedIds.has(l.id)); commit(next); selectOnly(next[0]?.id); }
  function duplicateSelected() { const selected = layers.filter(l => selectedIds.has(l.id)); if (!selected.length) return; const copies = selected.map(l => ({ ...l, id: `${l.type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, x: l.x + 30, y: l.y + 30 })); commit([...layers, ...copies]); setSelectedIds(new Set(copies.map(l => l.id))); setPrimaryId(copies[0].id); }

  function beginPointer(e: React.PointerEvent, layerId: string, kind: string, handle?: string) {
    e.stopPropagation(); const layer = layersRef.current.find(l => l.id === layerId); if (!layer) return;
    const rect = artboardRef.current?.getBoundingClientRect(); if (!rect || !rect.width) return; const scale = rect.width / WIDTH;
    if (kind === "select") { const next = e.shiftKey ? new Set(selectedIds) : new Set<string>(); if (e.shiftKey && next.has(layerId)) next.delete(layerId); else next.add(layerId); setSelectedIds(next); setPrimaryId(layerId); return; }
    dragRef.current = { kind, layerId, handle, startX: e.clientX, startY: e.clientY, layer: { ...layer }, scale, artboardLeft: rect.left, artboardTop: rect.top };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function pointerMove(e: React.PointerEvent) {
    const d = dragRef.current; if (!d) return; const dx = (e.clientX - d.startX) / d.scale, dy = (e.clientY - d.startY) / d.scale; if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    let next = layersRef.current.map(l => ({ ...l })); const idx = next.findIndex(l => l.id === d.layerId); if (idx < 0) return;
    if (d.kind === "move") { let x = d.layer.x + dx, y = d.layer.y + dy; if (grid) { x = snap(x); y = snap(y); } next[idx] = { ...next[idx], x: Math.round(x), y: Math.round(y) }; }
    else if (d.kind === "resize") { const r = resizeLayer(d.handle, d.layer, dx, dy); if (aspectLock && d.layer.width && d.layer.height) { const ratio = d.layer.width / d.layer.height; if (["e", "w"].includes(d.handle)) r.height = Math.max(20, Math.round(r.width / ratio)); else if (["n", "s"].includes(d.handle)) r.width = Math.max(20, Math.round(r.height * ratio)); } next[idx] = { ...next[idx], ...r }; }
    else if (d.kind === "rotate") { const cx = d.layer.x + d.layer.width / 2, cy = d.layer.y + d.layer.height / 2; const px = (e.clientX - d.artboardLeft) / d.scale, py = (e.clientY - d.artboardTop) / d.scale; let angle = Math.atan2(py - cy, px - cx) * 180 / Math.PI + 90; if (grid) angle = Math.round(angle / 15) * 15; next[idx] = { ...next[idx], rotation: Math.round(angle) }; }
    setLayers(next);
  }

  function pointerUp() { const d = dragRef.current; dragRef.current = null; if (d) emit(layersRef.current); }
  const primary = layers.find(l => l.id === primaryId) ?? null;
  const assetMap = useMemo(() => new Map(assets.map(a => [a.assetKey, a])), [assets]);
  function chooseAsset(key: string) { if (!primary || primary.type !== "image") return; updateLayer(primary.id, { src: `/api/projects/${projectId}/assets/${assetMap.get(key)?.id ?? ""}` }); setAssetPicker(false); }

  async function chooseLibraryAsset(asset: { id: string }) {
    if (!primary || primary.type !== "image") return;
    updateLayer(primary.id, { src: `/api/projects/${projectId}/assets/${asset.id}` });
    setLibraryOpen(false); setAssetPicker(false);
    await onAssetsChanged?.();
  }

  return <div className="graphics-editor">
    {libraryOpen && <AssetPicker projectId={projectId} kind="image" title={t("ge.pickFromLibrary")} linkedIds={assets.map(a => a.id)} onPick={chooseLibraryAsset} onClose={() => setLibraryOpen(false)} />}
    <style>{KEYFRAMES}</style>
    <GraphicsEditorToolbar grid={grid} safe={safe} onAdd={addLayer} onDuplicate={duplicateSelected} onDelete={removeSelected} onToggleGrid={() => setGrid(v => !v)} onToggleSafe={() => setSafe(v => !v)} />
    <div className="ge-layout"><GraphicsEditorCanvas canvasRef={canvasRef} artboardRef={artboardRef} layers={layers} selectedIds={selectedIds} grid={grid} safe={safe} background={item.data?.backgroundColor ?? "#111"} onPointerMove={pointerMove} onPointerUp={pointerUp} onCanvasPointerDown={() => selectOnly(null)} onLayerPointerDown={beginPointer} /><GraphicsEditorProperties projectId={projectId} graphicId={graphicId} item={item} assets={assets} primary={primary} assetPicker={assetPicker} aspectLock={aspectLock} onLayer={updateLayer} onStyle={updateStyle} onChooseAsset={chooseAsset} onToggleAssetPicker={() => setAssetPicker(v => !v)} onOpenLibrary={() => setLibraryOpen(true)} onAspectLock={setAspectLock} /></div>
    <style jsx global>{`.graphics-editor{background:#111827;color:#e5e7eb;border-radius:10px;overflow:hidden;border:1px solid #263244}.ge-toolbar{display:flex;gap:6px;padding:9px;background:#0b1220;border-bottom:1px solid #263244;flex-wrap:wrap}.ge-toolbar button,.ge-properties button{background:#1f2937;color:#e5e7eb;border:1px solid #374151;border-radius:5px;padding:7px 10px;cursor:pointer}.ge-toolbar button.ge-active{background:#164e63}.ge-spacer{flex:1}.ge-layout{display:grid;grid-template-columns:minmax(0,1fr) 300px;min-height:620px}.ge-canvas-wrap{padding:18px;display:flex;align-items:flex-start;justify-content:center;background:#0f172a;overflow:auto}.ge-canvas{width:min(100%,960px);aspect-ratio:16/9;position:relative;touch-action:none}.ge-artboard{position:absolute;inset:0;overflow:hidden;background:#111}.ge-grid{position:absolute;inset:0;background-image:linear-gradient(#38bdf822 1px,transparent 1px),linear-gradient(90deg,#38bdf822 1px,transparent 1px);background-size:${100/96}% ${100/54}%;pointer-events:none}.ge-safe{position:absolute;pointer-events:none;border:1px dashed rgba(255,255,0,.6);z-index:1000}.safe90{left:5%;right:5%;top:5%;bottom:5%}.safe80{left:10%;right:10%;top:10%;bottom:10%;border-color:rgba(255,140,0,.6)}.ge-handle{position:absolute;width:12px;height:12px;background:#38bdf8;border:2px solid #fff;border-radius:2px;transform:translate(-50%,-50%);z-index:20}.ge-rotate{position:absolute;width:12px;height:12px;background:#f472b6;border:2px solid #fff;border-radius:50%;transform:translate(-50%,-50%);z-index:20}.ge-properties{padding:14px;background:#111827;border-left:1px solid #263244;overflow:auto}.ge-section{display:grid;gap:8px;padding:10px 0;border-bottom:1px solid #263244}.ge-section>b{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8}.ge-section label{display:grid;gap:4px;font-size:12px;color:#94a3b8}.ge-section input,.ge-section select,.ge-section textarea{width:100%;box-sizing:border-box;background:#0b1220;color:#e5e7eb;border:1px solid #374151;border-radius:5px;padding:7px}.ge-section textarea{min-height:90px;resize:vertical}.ge-two{display:grid;grid-template-columns:1fr 1fr;gap:7px}.ge-section span{color:#cbd5e1}@media(max-width:850px){.ge-layout{grid-template-columns:1fr}.ge-properties{border-left:0;border-top:1px solid #263244}.ge-canvas-wrap{min-height:400px}}`}</style>
  </div>;
}
