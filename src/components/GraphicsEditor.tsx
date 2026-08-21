"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Asset = { id: string; assetKey: string; type: string; mimeType?: string | null; width?: number | null; height?: number | null };
type GraphicKind = "slate" | "overlay";
type Layer = {
  id: string;
  type: "text" | "rect" | "ellipse" | "image";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  text?: string;
  src?: string;
  animation?: string;
  style?: Record<string, string | number>;
};
type Item = {
  type: GraphicKind;
  template?: string;
  mode?: "standalone" | "overlay";
  durationSeconds?: number;
  startSeconds?: number;
  endSeconds?: number;
  opacity?: number;
  backgroundImage?: string;
  data?: Record<string, string>;
};

const WIDTH = 1920;
const HEIGHT = 1080;
const GRID = 20;
const SNAP = 10;
const HANDLE_LIST = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const ANIMATIONS = [
  ["", "None"], ["lcyt-fadeIn", "Fade In"], ["lcyt-fadeOut", "Fade Out"],
  ["lcyt-slideInLeft", "Slide In ←"], ["lcyt-slideInRight", "Slide In →"],
  ["lcyt-slideInUp", "Slide In ↑"], ["lcyt-slideInDown", "Slide In ↓"],
  ["lcyt-zoomIn", "Zoom In"], ["lcyt-zoomOut", "Zoom Out"],
  ["lcyt-pulse", "Pulse"], ["lcyt-blink", "Blink"], ["lcyt-typewriter", "Typewriter"],
];

const KEYFRAMES = `
@keyframes lcyt-fadeIn{from{opacity:0}to{opacity:1}}
@keyframes lcyt-fadeOut{from{opacity:1}to{opacity:0}}
@keyframes lcyt-slideInLeft{from{transform:translateX(-100%)}to{transform:translateX(0)}}
@keyframes lcyt-slideInRight{from{transform:translateX(100%)}to{transform:translateX(0)}}
@keyframes lcyt-slideInUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
@keyframes lcyt-slideInDown{from{transform:translateY(-100%)}to{transform:translateY(0)}}
@keyframes lcyt-zoomIn{from{transform:scale(0);opacity:0}to{transform:scale(1);opacity:1}}
@keyframes lcyt-zoomOut{from{transform:scale(1);opacity:1}to{transform:scale(0);opacity:0}}
@keyframes lcyt-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}
@keyframes lcyt-blink{0%,100%{opacity:1}50%{opacity:0}}
@keyframes lcyt-typewriter{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}`;

function defaultLayers(item: Item, title: string): Layer[] {
  const stored = item.data?.layers;
  if (stored) {
    try { const parsed = JSON.parse(stored); if (Array.isArray(parsed)) return parsed; } catch { /* old/simple graphic */ }
  }
  const text = item.data?.text ?? item.data?.title ?? title;
  return [{ id: "title", type: "text", x: 160, y: 300, width: 1600, height: 180, text, style: { "font-size": "92px", "font-weight": "700", color: "#ffffff", "text-align": "center", "text-shadow": "0 3px 10px #000" } }];
}

function serialiseLayers(layers: Layer[]) { return JSON.stringify(layers); }

function parsePx(value: unknown, fallback = 0) {
  const n = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }

function anchor(handle: string, l: Layer) {
  const x = l.x, y = l.y, w = l.width, h = l.height;
  return { left: handle.includes("e") ? x + w : handle.includes("w") ? x : x + w / 2, top: handle.includes("s") ? y + h : handle.includes("n") ? y : y + h / 2 };
}

function resizeLayer(handle: string, start: Layer, dx: number, dy: number) {
  let { x, y, width, height } = start;
  if (handle.includes("e")) width += dx;
  if (handle.includes("w")) { x += dx; width -= dx; }
  if (handle.includes("s")) height += dy;
  if (handle.includes("n")) { y += dy; height -= dy; }
  return { x: Math.round(x), y: Math.round(y), width: Math.max(20, Math.round(width)), height: Math.max(20, Math.round(height)) };
}

function snap(v: number) { return Math.round(v / GRID) * GRID; }

function styleValue(l: Layer, key: string, fallback = "") { return String(l.style?.[key] ?? fallback); }

function layerStyle(l: Layer, selected: boolean): React.CSSProperties {
  const style = l.style ?? {};
  const css: React.CSSProperties = {};
  for (const [key, value] of Object.entries(style)) (css as Record<string, unknown>)[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  return {
    position: "absolute", left: l.x, top: l.y, width: l.width, height: l.height,
    boxSizing: "border-box", userSelect: "none", cursor: "move", outline: selected ? "3px solid #38bdf8" : undefined,
    animation: l.animation || undefined, transform: l.rotation ? `rotate(${l.rotation}deg)` : undefined,
    ...css,
  };
}

export default function GraphicsEditor({ projectId, item, assets, title, onChange }: { projectId: string; item: Item; assets: Asset[]; title: string; onChange: (item: Item) => void }) {
  const [layers, setLayers] = useState<Layer[]>(() => defaultLayers(item, title));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(layers[0] ? [layers[0].id] : []));
  const [primaryId, setPrimaryId] = useState(layers[0]?.id ?? null);
  const [grid, setGrid] = useState(false);
  const [safe, setSafe] = useState(false);
  const [aspectLock, setAspectLock] = useState(true);
  const [history, setHistory] = useState<Layer[][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [assetPicker, setAssetPicker] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<any>(null);
  const layersRef = useRef(layers);
  layersRef.current = layers;

  useEffect(() => {
    setLayers(defaultLayers(item, title));
    const next = defaultLayers(item, title);
    setSelectedIds(next[0] ? new Set([next[0].id]) : new Set());
    setPrimaryId(next[0]?.id ?? null);
  }, [item]); // the parent replaces item when selecting another graphic

  const pushHistory = (next: Layer[]) => {
    setHistory(prev => [...prev.slice(0, historyIndex + 1), layersRef.current].slice(-50));
    setHistoryIndex(prev => Math.min(prev + 1, 49));
    setLayers(next);
    onChange({ ...item, template: "rich", data: { ...(item.data ?? {}), layers: serialiseLayers(next) } });
  };

  function updateLayer(id: string, patch: Partial<Layer>) {
    const next = layers.map(l => l.id === id ? { ...l, ...patch } : l);
    pushHistory(next);
  }
  function updateStyle(id: string, key: string, value: string | number) {
    const l = layers.find(x => x.id === id); if (!l) return;
    const style = { ...(l.style ?? {}) };
    if (value === "") delete style[key]; else style[key] = value;
    updateLayer(id, { style });
  }
  function addLayer(type: Layer["type"]) {
    const id = `${type}-${Date.now()}`;
    const base: Layer = type === "text"
      ? { id, type, x: 220, y: 360, width: 1480, height: 160, text: "Text", style: { "font-size": "72px", color: "#ffffff", "font-weight": "700", "text-align": "center" } }
      : type === "image"
        ? { id, type, x: 460, y: 300, width: 1000, height: 560 }
        : { id, type, x: 460, y: 320, width: 1000, height: 440, style: { background: type === "ellipse" ? "#ffffff" : "#000000" } };
    const next = [...layers, base]; pushHistory(next); setSelectedIds(new Set([id])); setPrimaryId(id);
  }
  function removeSelected() {
    if (!selectedIds.size) return;
    const next = layers.filter(l => !selectedIds.has(l.id)); pushHistory(next);
    const first = next[0]; setSelectedIds(first ? new Set([first.id]) : new Set()); setPrimaryId(first?.id ?? null);
  }
  function duplicateSelected() {
    const selected = layers.filter(l => selectedIds.has(l.id)); if (!selected.length) return;
    const copies = selected.map(l => ({ ...l, id: `${l.type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, x: l.x + 30, y: l.y + 30 }));
    pushHistory([...layers, ...copies]); setSelectedIds(new Set(copies.map(l => l.id))); setPrimaryId(copies[0].id);
  }

  function beginPointer(e: React.PointerEvent, layerId: string, kind: string, handle?: string) {
    e.stopPropagation();
    const layer = layersRef.current.find(l => l.id === layerId); if (!layer) return;
    const rect = canvasRef.current?.getBoundingClientRect(); if (!rect) return;
    const scale = rect.width / WIDTH;
    if (kind === "select") {
      const next = e.shiftKey ? new Set(selectedIds) : new Set<string>();
      if (e.shiftKey && next.has(layerId)) next.delete(layerId); else next.add(layerId);
      setSelectedIds(next); setPrimaryId(layerId); return;
    }
    dragRef.current = { kind, layerId, handle, startX: e.clientX, startY: e.clientY, layer: { ...layer }, scale, history: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function pointerMove(e: React.PointerEvent) {
    const d = dragRef.current; if (!d) return;
    const dx = (e.clientX - d.startX) / d.scale, dy = (e.clientY - d.startY) / d.scale;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    let next = layersRef.current.map(l => ({ ...l }));
    const idx = next.findIndex(l => l.id === d.layerId); if (idx < 0) return;
    if (d.kind === "move") {
      let x = d.layer.x + dx, y = d.layer.y + dy;
      if (grid) { x = snap(x); y = snap(y); }
      next[idx] = { ...next[idx], x: Math.round(x), y: Math.round(y) };
    } else if (d.kind === "resize") {
      const r = resizeLayer(d.handle, d.layer, dx, dy);
      if (aspectLock && d.layer.width && d.layer.height) {
        const ratio = d.layer.width / d.layer.height;
        if (["e", "w"].includes(d.handle)) r.height = Math.max(20, Math.round(r.width / ratio));
        else if (["n", "s"].includes(d.handle)) r.width = Math.max(20, Math.round(r.height * ratio));
      }
      next[idx] = { ...next[idx], ...r };
    } else if (d.kind === "rotate") {
      const cx = d.layer.x + d.layer.width / 2, cy = d.layer.y + d.layer.height / 2;
      const px = e.clientX / d.scale, py = e.clientY / d.scale;
      let angle = Math.atan2(py - cy, px - cx) * 180 / Math.PI + 90;
      if (grid) angle = Math.round(angle / 15) * 15;
      next[idx] = { ...next[idx], rotation: Math.round(angle) };
    }
    setLayers(next);
  }

  function pointerUp() {
    const d = dragRef.current; dragRef.current = null; if (!d) return;
    if (d.kind === "move" || d.kind === "resize" || d.kind === "rotate") onChange({ ...item, template: "rich", data: { ...(item.data ?? {}), layers: serialiseLayers(layersRef.current) } });
  }

  const primary = layers.find(l => l.id === primaryId) ?? null;
  const assetMap = useMemo(() => new Map(assets.map(a => [a.assetKey, a])), [assets]);

  function chooseAsset(key: string) {
    if (!primary || primary.type !== "image") return;
    updateLayer(primary.id, { src: `/api/projects/${projectId}/assets/${assetMap.get(key)?.id ?? ""}` });
    setAssetPicker(false);
  }

  function setItemField(patch: Partial<Item>) { onChange({ ...item, ...patch, template: "rich", data: { ...(item.data ?? {}), layers: serialiseLayers(layers) } }); }

  return <div className="graphics-editor">
    <style>{KEYFRAMES}</style>
    <div className="ge-toolbar">
      <button onClick={() => addLayer("text")}>＋ Text</button><button onClick={() => addLayer("rect")}>＋ Rectangle</button><button onClick={() => addLayer("ellipse")}>＋ Ellipse</button><button onClick={() => addLayer("image")}>＋ Image</button>
      <span className="ge-spacer" /><button onClick={duplicateSelected}>Duplicate</button><button onClick={removeSelected}>Delete</button><button className={grid ? "ge-active" : ""} onClick={() => setGrid(v => !v)}>Grid</button><button className={safe ? "ge-active" : ""} onClick={() => setSafe(v => !v)}>Safe area</button>
    </div>
    <div className="ge-layout">
      <div className="ge-canvas-wrap">
        <div ref={canvasRef} className="ge-canvas" onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerLeave={pointerUp} onPointerDown={() => { setSelectedIds(new Set()); setPrimaryId(null); }}>
          <div className="ge-artboard" style={{ background: item.data?.backgroundColor ?? "#111" }}>
            {grid && <div className="ge-grid" />}
            {layers.map(l => <div key={l.id} style={layerStyle(l, selectedIds.has(l.id))} onPointerDown={e => beginPointer(e, l.id, "move")}>
              {l.type === "text" && <div style={{ width: "100%", height: "100%", pointerEvents: "none", overflow: "hidden" }}>{l.text}</div>}
              {l.type === "rect" && null}
              {l.type === "ellipse" && <div style={{ width: "100%", height: "100%", borderRadius: "50%", pointerEvents: "none" }} />}
              {l.type === "image" && <img src={l.src || ""} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }} />}
              {selectedIds.has(l.id) && <>
                {HANDLE_LIST.map(h => { const a = anchor(h, l); return <span key={h} className="ge-handle" style={{ left: a.left, top: a.top, cursor: `${h}-resize` }} onPointerDown={e => beginPointer(e, l.id, "resize", h)} />; })}
                <span className="ge-rotate" style={{ left: l.x + l.width / 2, top: l.y - 32 }} onPointerDown={e => beginPointer(e, l.id, "rotate")} />
              </>}
            </div>)}
            {safe && <><div className="ge-safe safe90" /><div className="ge-safe safe80" /></>}
          </div>
        </div>
      </div>
      <aside className="ge-properties">
        <div className="ge-section"><b>Graphic</b><label>Type<select value={item.type} onChange={e => setItemField({ type: e.target.value as GraphicKind })}><option value="slate">Slate</option><option value="overlay">Overlay</option></select></label>{item.type === "slate" ? <label>Mode<select value={item.mode ?? "standalone"} onChange={e => setItemField({ mode: e.target.value as Item["mode"] })}><option value="standalone">Standalone</option><option value="overlay">Overlay</option></select></label> : null}</div>
        <div className="ge-section"><b>Timing</b>{item.type === "slate" && item.mode !== "overlay" ? <label>Duration (s)<input type="number" min="0.1" step="0.1" value={item.durationSeconds ?? 5} onChange={e => setItemField({ durationSeconds: Number(e.target.value) })} /></label> : <div className="ge-two"><label>Start<input type="number" min="0" step="0.1" value={item.startSeconds ?? 0} onChange={e => setItemField({ startSeconds: Number(e.target.value) })} /></label><label>End<input type="number" min="0.1" step="0.1" value={item.endSeconds ?? 10} onChange={e => setItemField({ endSeconds: Number(e.target.value) })} /></label></div>}</div>
        {primary && <div className="ge-section"><b>Layer: {primary.id}</b><label>Type<span>{primary.type}</span></label>{primary.type === "text" && <label>Text<textarea value={primary.text ?? ""} onChange={e => updateLayer(primary.id, { text: e.target.value })} /></label>}{primary.type === "image" && <label>Image<button onClick={() => setAssetPicker(v => !v)}>{primary.src ? "Change image" : "Choose image"}</button></label>}
          <div className="ge-two"><label>X<input type="number" value={primary.x} onChange={e => updateLayer(primary.id, { x: Number(e.target.value) })} /></label><label>Y<input type="number" value={primary.y} onChange={e => updateLayer(primary.id, { y: Number(e.target.value) })} /></label></div>
          <div className="ge-two"><label>Width<input type="number" min="20" value={primary.width} onChange={e => updateLayer(primary.id, { width: Number(e.target.value) })} /></label><label>Height<input type="number" min="20" value={primary.height} onChange={e => updateLayer(primary.id, { height: Number(e.target.value) })} /></label></div>
          <label>Rotation<input type="number" value={primary.rotation ?? 0} onChange={e => updateLayer(primary.id, { rotation: Number(e.target.value) })} /></label>
          <label>Opacity<input type="range" min="0" max="1" step="0.01" value={parsePx(primary.style?.opacity, 1)} onChange={e => updateStyle(primary.id, "opacity", e.target.value)} /></label>
          {primary.type === "text" && <>
            <label>Font family<input value={styleValue(primary, "font-family", "Arial, sans-serif")} onChange={e => updateStyle(primary.id, "font-family", e.target.value)} /></label>
            <label>Font size<input value={styleValue(primary, "font-size", "72px")} onChange={e => updateStyle(primary.id, "font-size", e.target.value)} /></label>
            <div className="ge-two"><label>Weight<select value={styleValue(primary, "font-weight", "700")} onChange={e => updateStyle(primary.id, "font-weight", e.target.value)}><option>normal</option><option>bold</option><option>400</option><option>500</option><option>600</option><option>700</option><option>800</option><option>900</option></select></label><label>Align<select value={styleValue(primary, "text-align", "center")} onChange={e => updateStyle(primary.id, "text-align", e.target.value)}><option>left</option><option>center</option><option>right</option></select></label></div>
            <label>Color<input type="text" value={styleValue(primary, "color", "#fff")} onChange={e => updateStyle(primary.id, "color", e.target.value)} /></label>
            <label>Text shadow<input value={styleValue(primary, "text-shadow")} onChange={e => updateStyle(primary.id, "text-shadow", e.target.value)} placeholder="0 3px 10px #000" /></label>
            <label>Text stroke<input value={styleValue(primary, "-webkit-text-stroke")} onChange={e => updateStyle(primary.id, "-webkit-text-stroke", e.target.value)} placeholder="1px #000" /></label>
          </>}
          {primary.type === "rect" && <label>Background<input type="text" value={styleValue(primary, "background", "#000")} onChange={e => updateStyle(primary.id, "background", e.target.value)} /></label>}
          {primary.type === "ellipse" && <label>Background<input type="text" value={styleValue(primary, "background", "#fff")} onChange={e => updateStyle(primary.id, "background", e.target.value)} /></label>}
          <label>Animation<select value={(primary.animation ?? "").split(" ")[0]} onChange={e => updateLayer(primary.id, { animation: e.target.value ? `${e.target.value} 1s ease 0s 1 normal forwards` : undefined })}>{ANIMATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label><span>Aspect lock</span><input type="checkbox" checked={aspectLock} onChange={e => setAspectLock(e.target.checked)} /></label>
        </div>}
        {assetPicker && <div className="ge-section"><b>Assets</b>{assets.filter(a => a.type !== "FONT").map(a => <button key={a.id} onClick={() => chooseAsset(a.assetKey)}>{a.assetKey}</button>)}{!assets.length && <span>No image assets yet.</span>}</div>}
      </aside>
    </div>
    <style jsx>{`@keyframes lcyt-fadeIn{from{opacity:0}to{opacity:1}}.graphics-editor{background:#111827;color:#e5e7eb;border-radius:10px;overflow:hidden;border:1px solid #263244}.ge-toolbar{display:flex;gap:6px;padding:9px;background:#0b1220;border-bottom:1px solid #263244;flex-wrap:wrap}.ge-toolbar button,.ge-properties button{background:#1f2937;color:#e5e7eb;border:1px solid #374151;border-radius:5px;padding:7px 10px;cursor:pointer}.ge-toolbar button.ge-active{background:#164e63}.ge-spacer{flex:1}.ge-layout{display:grid;grid-template-columns:minmax(0,1fr) 300px;min-height:620px}.ge-canvas-wrap{padding:18px;display:flex;align-items:flex-start;justify-content:center;background:#0f172a;overflow:auto}.ge-canvas{width:min(100%,960px);aspect-ratio:16/9;position:relative;touch-action:none}.ge-artboard{position:absolute;inset:0;overflow:hidden;background:#111}.ge-grid{position:absolute;inset:0;background-image:linear-gradient(#38bdf822 1px,transparent 1px),linear-gradient(90deg,#38bdf822 1px,transparent 1px);background-size:${100/96}% ${100/54}%;pointer-events:none}.ge-safe{position:absolute;pointer-events:none;border:1px dashed rgba(255,255,0,.6);z-index:1000}.safe90{left:5%;right:5%;top:5%;bottom:5%}.safe80{left:10%;right:10%;top:10%;bottom:10%;border-color:rgba(255,140,0,.6)}.ge-handle{position:absolute;width:12px;height:12px;background:#38bdf8;border:2px solid #fff;border-radius:2px;transform:translate(-50%,-50%);z-index:20}.ge-rotate{position:absolute;width:12px;height:12px;background:#f472b6;border:2px solid #fff;border-radius:50%;transform:translate(-50%,-50%);z-index:20}.ge-properties{padding:14px;background:#111827;border-left:1px solid #263244;overflow:auto}.ge-section{display:grid;gap:8px;padding:10px 0;border-bottom:1px solid #263244}.ge-section>b{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8}.ge-section label{display:grid;gap:4px;font-size:12px;color:#94a3b8}.ge-section input,.ge-section select,.ge-section textarea{width:100%;box-sizing:border-box;background:#0b1220;color:#e5e7eb;border:1px solid #374151;border-radius:5px;padding:7px}.ge-section textarea{min-height:90px;resize:vertical}.ge-two{display:grid;grid-template-columns:1fr 1fr;gap:7px}.ge-section span{color:#cbd5e1}@media(max-width:850px){.ge-layout{grid-template-columns:1fr}.ge-properties{border-left:0;border-top:1px solid #263244}.ge-canvas-wrap{min-height:400px}}`}</style>
  </div>;
}
