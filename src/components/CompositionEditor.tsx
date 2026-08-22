"use client";

import { useEffect, useRef, useState } from "react";

type Source = { id: string; type: "UPLOAD" | "YOUTUBE"; status?: "PENDING" | "AVAILABLE"; originalName?: string | null; youtubeUrl?: string | null; youtubeVideoId?: string | null; durationMs?: number | null };
type Graphic = { id: string; name: string; width: number; height: number; backgroundColor?: string; layers: unknown[] };
type Transition = { type: "cut" | "fade" | "crossfade"; durationSeconds: number };
type Item = { type: "source-clip" | "overlay" | "slate"; sourceId?: string; graphicId?: string; sectionId?: string; startSeconds?: number; endSeconds?: number; template?: string; mode?: "standalone" | "overlay"; durationSeconds?: number; kind?: "text" | "rectangle" | "image"; imageAsset?: string; opacity?: number; data?: Record<string, string>; transitionIn?: Transition; transitionOut?: Transition };
type Segment = { id: string; label: string; startSeconds: number; endSeconds: number; sourceId?: string };
type Definition = { version?: 1; semanticSegments: Segment[]; graphics?: Graphic[]; composition: { sourceStartSeconds: number; sourceEndSeconds: number; items: Item[] } };
type Props = { projectId: string; definition: Definition; sources: Source[]; onChange: (definition: Definition) => Promise<void> };
type DragPayload = { kind: "graphic" | "source"; id: string };

export default function CompositionEditor({ projectId, definition, sources, onChange }: Props) {
  const graphics = definition.graphics ?? [];
  const items = definition.composition.items;
  const sections = definition.semanticSegments;
  const [dragOver, setDragOver] = useState<string | null>(null);
  const commit = async (nextItems: Item[]) => onChange({ ...definition, composition: { ...definition.composition, items: nextItems } });
  const payloadFromEvent = (event: React.DragEvent): DragPayload | null => { const raw = event.dataTransfer.getData("application/json"); if (!raw) return null; try { return JSON.parse(raw) as DragPayload; } catch { return null; } };
  const startDrag = (event: React.DragEvent, payload: DragPayload) => { event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData("application/json", JSON.stringify(payload)); };
  const addGraphicAsSlate = async (graphicId: string, index: number) => { if (!graphics.some(g => g.id === graphicId)) return; const next = [...items]; next.splice(Math.max(0, Math.min(index, next.length)), 0, { type: "slate", graphicId, template: "rich", mode: "standalone", durationSeconds: 5 }); await commit(next); };
  const addGraphicAsOverlay = async (graphicId: string, section: Segment) => { if (!graphics.some(g => g.id === graphicId)) return; const overlay: Item = { type: "overlay", graphicId, template: "rich", kind: "text", sectionId: section.id, startSeconds: section.startSeconds, endSeconds: Math.min(section.endSeconds, section.startSeconds + 5), opacity: 1 }; if ((overlay.endSeconds ?? 0) <= (overlay.startSeconds ?? 0)) return; await commit([...items, overlay]); };
  const handleDropBetween = async (event: React.DragEvent, index: number) => { event.preventDefault(); setDragOver(null); const payload = payloadFromEvent(event); if (payload?.kind === "graphic") await addGraphicAsSlate(payload.id, index); };
  const handleDropInside = async (event: React.DragEvent, section: Segment) => { event.preventDefault(); setDragOver(null); const payload = payloadFromEvent(event); if (payload?.kind === "graphic") await addGraphicAsOverlay(payload.id, section); };
  const removeItem = async (index: number) => commit(items.filter((_, i) => i !== index));

  return <div className="composition-editor">
    <div className="resource-bin"><div className="resource-bin-title"><strong>Resource bin</strong><span>Drag a graphic between sections for a SLATE, or into a section for an OVERLAY.</span></div><div className="resource-bin-grid">
      {sources.map(source => <ResourceTile key={source.id} kind="source" label={source.originalName || source.youtubeUrl || source.id} icon="▶" onDragStart={event => startDrag(event, { kind: "source", id: source.id })} />)}
      {graphics.map(graphic => <ResourceTile key={graphic.id} kind="graphic" label={graphic.name} icon="✦" onDragStart={event => startDrag(event, { kind: "graphic", id: graphic.id })} />)}
      {!sources.length && !graphics.length && <span className="muted">No resources yet.</span>}
    </div></div>

    <div className="composition-timeline">
      <DropZone active={dragOver === "drop-0"} onDragOver={event => { event.preventDefault(); setDragOver("drop-0"); }} onDragLeave={() => setDragOver(null)} onDrop={event => void handleDropBetween(event, 0)} label="Drop graphic here for a standalone slate" />
      {items.map((item, itemIndex) => {
        if (item.type === "slate" && item.mode !== "overlay") {
          const graphic = graphics.find(g => g.id === item.graphicId);
          return <div key={`slate-${itemIndex}`} className="standalone-section"><div className="slate-section-card"><span className="slate-icon">✦</span><div><strong>SLATE · {graphic?.name ?? "Graphic"}</strong><small>{item.durationSeconds ?? 5}s standalone section</small></div><button onClick={() => void removeItem(itemIndex)} aria-label="Remove">×</button></div><DropZone active={dragOver === `drop-${itemIndex + 1}`} onDragOver={event => { event.preventDefault(); setDragOver(`drop-${itemIndex + 1}`); }} onDragLeave={() => setDragOver(null)} onDrop={event => void handleDropBetween(event, itemIndex + 1)} label="Drop graphic here for another standalone slate" /></div>;
        }
        if (item.type !== "source-clip") return null;
        const section = sections.find(s => s.sourceId === item.sourceId && s.startSeconds === item.startSeconds && s.endSeconds === item.endSeconds);
        if (!section) return null;
        const overlays = items.filter(overlay => overlay.type === "overlay" && overlay.sectionId === section.id);
        return <div key={`section-${section.id}`} className="composition-section">
          <div className="section-header"><div className="section-thumbnail"><SectionThumbnail projectId={projectId} source={sources.find(s => s.id === section.sourceId)} projectSectionStart={section.startSeconds} /></div><div><strong>{section.label}</strong><small>{formatTime(section.startSeconds)} → {formatTime(section.endSeconds)} · {sourceName(sources, section.sourceId)}</small></div></div>
          <div className="section-body"><div className="section-main-track"><TimelineItemCard item={item} sources={sources} onRemove={() => void removeItem(itemIndex)} /></div>
            <div className={`overlay-track ${dragOver === `inside-${section.id}` ? "drop-active" : ""}`} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDragOver(`inside-${section.id}`); }} onDragLeave={() => setDragOver(null)} onDrop={event => void handleDropInside(event, section)}><div className="track-label">OVERLAYS · IN-SECTION TIMELINE</div><div className="overlay-track-line">{overlays.map(overlay => <OverlayCard key={items.indexOf(overlay)} item={overlay} graphic={graphics.find(g => g.id === overlay.graphicId)} section={section} onRemove={() => void removeItem(items.indexOf(overlay))} />)}{!overlays.length&&<span className="overlay-hint">Drop a graphic here · it becomes an overlay</span>}</div></div>
          </div><DropZone active={dragOver === `drop-${itemIndex + 1}`} onDragOver={event => { event.preventDefault(); setDragOver(`drop-${itemIndex + 1}`); }} onDragLeave={() => setDragOver(null)} onDrop={event => void handleDropBetween(event, itemIndex + 1)} label="Drop graphic here for a standalone slate" />
        </div>;
      })}
      {!items.some(item => item.type === "source-clip" || (item.type === "slate" && item.mode !== "overlay")) && <div className="empty-composition">Create sections first, then drag graphics between them or into a section.</div>}
    </div>
  </div>;
}

function ResourceTile({ kind, label, icon, onDragStart }: { kind: "source" | "graphic"; label: string; icon: string; onDragStart: (event: React.DragEvent) => void }) { return <div className={`resource-tile ${kind}`} draggable onDragStart={onDragStart} title={label}><span className="resource-icon">{icon}</span><span>{label}</span></div>; }
function DropZone({ active, label, onDragOver, onDragLeave, onDrop }: { active: boolean; label: string; onDragOver: (event: React.DragEvent) => void; onDragLeave: () => void; onDrop: (event: React.DragEvent) => void }) { return <div className={`composition-drop-zone ${active ? "active" : ""}`} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}><span>＋</span>{label}</div>; }
function TimelineItemCard({ item, sources, onRemove }: { item: Item; sources: Source[]; onRemove: () => void }) { return <div className="composition-item-card"><span className="item-handle">☷</span><div><strong>SOURCE</strong><small>{sourceName(sources, item.sourceId)}</small><small>{formatTime(item.startSeconds ?? 0)} → {formatTime(item.endSeconds ?? 0)}</small></div><button onClick={onRemove} aria-label="Remove">×</button></div>; }
function OverlayCard({ item, graphic, section, onRemove }: { item: Item; graphic?: Graphic; section: Segment; onRemove: () => void }) { const start=Math.max(0,(item.startSeconds??section.startSeconds)-section.startSeconds),end=Math.max(start,(item.endSeconds??section.endSeconds)-section.startSeconds),duration=Math.max(.1,section.endSeconds-section.startSeconds),left=`${Math.min(100,start/duration*100)}%`,width=`${Math.max(2,Math.min(100-start/duration*100,(end-start)/duration*100))}%`;return <div className="overlay-card" style={{left,width}} title={`${graphic?.name??"Graphic"}: ${formatTime(start)} → ${formatTime(end)}`}><span>✦ {graphic?.name??"Graphic"}</span><button onClick={onRemove} aria-label="Remove">×</button></div>; }
function SectionThumbnail({ projectId, source, projectSectionStart }: { projectId: string; source?: Source; projectSectionStart: number }) { const videoRef=useRef<HTMLVideoElement>(null);const [thumb,setThumb]=useState<string|null>(null);useEffect(()=>{if(!source)return;if(source.type==="YOUTUBE"&&source.youtubeVideoId){setThumb(`https://i.ytimg.com/vi/${source.youtubeVideoId}/hqdefault.jpg`);return}if(source.status==="PENDING")return;const video=videoRef.current;if(!video)return;let cancelled=false;const capture=()=>{if(cancelled||!video.videoWidth||!video.videoHeight)return;const canvas=document.createElement("canvas");canvas.width=320;canvas.height=Math.round(320*video.videoHeight/video.videoWidth);const ctx=canvas.getContext("2d");if(!ctx)return;try{ctx.drawImage(video,0,0,canvas.width,canvas.height);if(!cancelled)setThumb(canvas.toDataURL("image/jpeg",.72))}catch{}};const ready=()=>{video.currentTime=Math.max(0,projectSectionStart)};const seeked=()=>capture();video.addEventListener("loadedmetadata",ready);video.addEventListener("seeked",seeked);video.load();return()=>{cancelled=true;video.removeEventListener("loadedmetadata",ready);video.removeEventListener("seeked",seeked)}},[source?.id,source?.type,source?.status,source?.youtubeVideoId,projectSectionStart]);return <>{thumb?<img src={thumb} alt=""/>:<video ref={videoRef} muted preload="metadata" src={source&&source.type==="UPLOAD"?`/api/projects/${projectId}/source/${source.id}`:undefined}/>}</>; }
function sourceName(sources: Source[], id?: string) { const source=sources.find(s=>s.id===id); return source?.originalName||source?.youtubeUrl||id||"source"; }
function formatTime(seconds:number){const s=Math.max(0,Math.floor(seconds));const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;return h?`${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`:`${m}:${String(sec).padStart(2,"0")}`;}
