"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Source = { id: string; type: "UPLOAD" | "YOUTUBE"; status?: "PENDING" | "AVAILABLE"; originalName?: string | null; youtubeUrl?: string | null; youtubeVideoId?: string | null; durationMs?: number | null };
type Graphic = { id: string; name: string; width: number; height: number; backgroundColor?: string; layers: unknown[] };
type Transition = { type: "cut" | "fade" | "crossfade"; durationSeconds: number };
type Item = {
  type: "source-clip" | "overlay" | "slate";
  sourceId?: string;
  graphicId?: string;
  sectionId?: string;
  startSeconds?: number;
  endSeconds?: number;
  template?: string;
  mode?: "standalone" | "overlay";
  durationSeconds?: number;
  kind?: "text" | "rectangle" | "image";
  imageAsset?: string;
  opacity?: number;
  data?: Record<string, string>;
  transitionIn?: Transition;
  transitionOut?: Transition;
};
type Segment = { id: string; label: string; startSeconds: number; endSeconds: number; sourceId?: string };
type Definition = { version?: 1; semanticSegments: Segment[]; graphics?: Graphic[]; composition: { sourceStartSeconds: number; sourceEndSeconds: number; items: Item[] } };
type Props = { definition: Definition; sources: Source[]; onChange: (definition: Definition) => Promise<void> };

type DragPayload = { kind: "graphic" | "source"; id: string };

export default function CompositionEditor({ definition, sources, onChange }: Props) {
  const graphics = definition.graphics ?? [];
  const items = definition.composition.items;
  const sections = useMemo(() => definition.semanticSegments.map(segment => ({
    segment,
    clip: items.find(item => item.type === "source-clip" && item.sourceId === segment.sourceId && item.startSeconds === segment.startSeconds && item.endSeconds === segment.endSeconds),
    overlays: items.filter(item => item.type === "overlay" && item.sectionId === segment.id),
  })), [definition, items]);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const commit = async (nextItems: Item[]) => {
    await onChange({ ...definition, composition: { ...definition.composition, items: nextItems } });
  };

  const payloadFromEvent = (event: React.DragEvent): DragPayload | null => {
    const raw = event.dataTransfer.getData("application/json");
    if (!raw) return null;
    try { return JSON.parse(raw) as DragPayload; } catch { return null; }
  };

  const startDrag = (event: React.DragEvent, payload: DragPayload) => {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/json", JSON.stringify(payload));
  };

  const addGraphicAsSlate = async (graphicId: string, index: number) => {
    const graphic = graphics.find(g => g.id === graphicId);
    if (!graphic) return;
    const slate: Item = { type: "slate", graphicId, template: "rich", mode: "standalone", durationSeconds: 5 };
    const next = [...items];
    next.splice(index, 0, slate);
    await commit(next);
  };

  const addGraphicAsOverlay = async (graphicId: string, section: Segment, relativeStart = 0, relativeEnd = Math.min(5, section.endSeconds - section.startSeconds)) => {
    const overlay: Item = {
      type: "overlay",
      graphicId,
      template: "rich",
      kind: "text",
      sectionId: section.id,
      startSeconds: section.startSeconds + Math.max(0, relativeStart),
      endSeconds: Math.min(section.endSeconds, section.startSeconds + Math.max(relativeStart, relativeEnd)),
      opacity: 1,
    };
    if ((overlay.endSeconds ?? 0) <= (overlay.startSeconds ?? 0)) return;
    await commit([...items, overlay]);
  };

  const handleDropBetween = async (event: React.DragEvent, index: number) => {
    event.preventDefault();
    setDragOver(null);
    const payload = payloadFromEvent(event);
    if (!payload) return;
    if (payload.kind === "graphic") await addGraphicAsSlate(payload.id, index);
  };

  const handleDropInside = async (event: React.DragEvent, section: Segment) => {
    event.preventDefault();
    setDragOver(null);
    const payload = payloadFromEvent(event);
    if (!payload) return;
    if (payload.kind === "graphic") await addGraphicAsOverlay(payload.id, section);
  };

  const moveItem = async (from: number, to: number) => {
    if (from === to) return;
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    await commit(next);
  };

  const removeItem = async (index: number) => commit(items.filter((_, i) => i !== index));

  return <div className="composition-editor">
    <div className="resource-bin">
      <div className="resource-bin-title"><strong>Resource bin</strong><span>Drag resources into the timeline</span></div>
      <div className="resource-bin-grid">
        {sources.map(source => <ResourceTile key={source.id} kind="source" label={source.originalName || source.youtubeUrl || source.id} icon="▶" onDragStart={event => startDrag(event, { kind: "source", id: source.id })} />)}
        {graphics.map(graphic => <ResourceTile key={graphic.id} kind="graphic" label={graphic.name} icon="✦" onDragStart={event => startDrag(event, { kind: "graphic", id: graphic.id })} />)}
        {!sources.length && !graphics.length && <span className="muted">No resources yet.</span>}
      </div>
    </div>

    <div className="composition-timeline">
      <DropZone active={dragOver === "drop-0"} onDragOver={event => { event.preventDefault(); setDragOver("drop-0"); }} onDragLeave={() => setDragOver(null)} onDrop={event => void handleDropBetween(event, 0)} label="Drop here for a standalone slate" />
      {sections.map(({ segment, clip, overlays }, sectionIndex) => {
        const clipIndex = clip ? items.indexOf(clip) : -1;
        return <div key={segment.id} className="composition-section">
          <div className="section-header">
            <div className="section-thumbnail"><SectionThumbnail source={sources.find(s => s.id === segment.sourceId)} projectSectionStart={segment.startSeconds} /></div>
            <div><strong>{segment.label}</strong><small>{formatTime(segment.startSeconds)} → {formatTime(segment.endSeconds)} · {sourceName(sources, segment.sourceId)}</small></div>
          </div>
          <div className="section-body">
            <div className="section-main-track">
              {clip ? <TimelineItemCard item={clip} index={clipIndex} sources={sources} onRemove={() => void removeItem(clipIndex)} onMove={moveItem} /> : <div className="empty-track">No source clip</div>}
            </div>
            <div className={`overlay-track ${dragOver === `inside-${segment.id}` ? "drop-active" : ""}`} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDragOver(`inside-${segment.id}`); }} onDragLeave={() => setDragOver(null)} onDrop={event => void handleDropInside(event, segment)}>
              <div className="track-label">OVERLAYS</div>
              <div className="overlay-track-line">
                {overlays.map(overlay => <OverlayCard key={items.indexOf(overlay)} item={overlay} graphic={graphics.find(g => g.id === overlay.graphicId)} section={segment} onRemove={() => void removeItem(items.indexOf(overlay))} />)}
                {!overlays.length && <span className="overlay-hint">Drop a graphic here · it will be an overlay</span>}
              </div>
            </div>
          </div>
          <DropZone active={dragOver === `drop-${sectionIndex + 1}`} onDragOver={event => { event.preventDefault(); setDragOver(`drop-${sectionIndex + 1}`); }} onDragLeave={() => setDragOver(null)} onDrop={event => void handleDropBetween(event, clipIndex >= 0 ? clipIndex + 1 : items.length)} label="Drop here for a standalone slate" />
        </div>;
      })}
      {!sections.length && <div className="empty-composition">Create sections first, then drag graphics between them or into a section.</div>}
    </div>
  </div>;
}

function ResourceTile({ kind, label, icon, onDragStart }: { kind: "source" | "graphic"; label: string; icon: string; onDragStart: (event: React.DragEvent) => void }) {
  return <div className={`resource-tile ${kind}`} draggable onDragStart={onDragStart} title={label}><span className="resource-icon">{icon}</span><span>{label}</span></div>;
}

function DropZone({ active, label, onDragOver, onDragLeave, onDrop }: { active: boolean; label: string; onDragOver: (event: React.DragEvent) => void; onDragLeave: () => void; onDrop: (event: React.DragEvent) => void }) {
  return <div className={`composition-drop-zone ${active ? "active" : ""}`} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}><span>＋</span>{label}</div>;
}

function TimelineItemCard({ item, index, sources, onRemove, onMove }: { item: Item; index: number; sources: Source[]; onRemove: () => void; onMove: (from: number, to: number) => Promise<void> }) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  return <div className="composition-item-card" draggable onDragStart={() => setDragIndex(index)} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (dragIndex !== null) void onMove(dragIndex, index); setDragIndex(null); }}>
    <span className="item-handle">☷</span><div><strong>Source</strong><small>{sourceName(sources, item.sourceId)}</small><small>{formatTime(item.startSeconds ?? 0)} → {formatTime(item.endSeconds ?? 0)}</small></div><button onClick={onRemove} aria-label="Remove">×</button>
  </div>;
}

function OverlayCard({ item, graphic, section, onRemove }: { item: Item; graphic?: Graphic; section: Segment; onRemove: () => void }) {
  const start = Math.max(0, (item.startSeconds ?? section.startSeconds) - section.startSeconds);
  const end = Math.max(start, (item.endSeconds ?? section.endSeconds) - section.startSeconds);
  const duration = Math.max(.1, section.endSeconds - section.startSeconds);
  const left = `${Math.min(100, (start / duration) * 100)}%`;
  const width = `${Math.max(2, Math.min(100 - (start / duration) * 100, ((end - start) / duration) * 100))}%`;
  return <div className="overlay-card" style={{ left, width }} title={`${graphic?.name ?? "Graphic"}: ${formatTime(start)} → ${formatTime(end)}`}><span>✦ {graphic?.name ?? "Graphic"}</span><button onClick={onRemove} aria-label="Remove">×</button></div>;
}

function SectionThumbnail({ source, projectSectionStart }: { source?: Source; projectSectionStart: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    if (!source) return;
    if (source.type === "YOUTUBE" && source.youtubeVideoId) { setThumb(`https://i.ytimg.com/vi/${source.youtubeVideoId}/hqdefault.jpg`); return; }
    if (source.status === "PENDING") return;
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    const capture = () => {
      if (cancelled || !video.videoWidth || !video.videoHeight) return;
      const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = Math.round(320 * video.videoHeight / video.videoWidth);
      const ctx = canvas.getContext("2d"); if (!ctx) return;
      try { ctx.drawImage(video, 0, 0, canvas.width, canvas.height); if (!cancelled) setThumb(canvas.toDataURL("image/jpeg", .72)); } catch { /* cross-origin sources use the fallback */ }
    };
    const ready = () => { video.currentTime = Math.max(0, projectSectionStart); };
    const seeked = () => capture();
    video.addEventListener("loadedmetadata", ready); video.addEventListener("seeked", seeked); video.load();
    return () => { cancelled = true; video.removeEventListener("loadedmetadata", ready); video.removeEventListener("seeked", seeked); };
  }, [source?.id, source?.type, source?.status, source?.youtubeVideoId, projectSectionStart]);
  return <>{thumb ? <img src={thumb} alt="" /> : <video ref={videoRef} muted preload="metadata" src={source && source.type === "UPLOAD" ? `/api/projects/source/${source.id}` : undefined} />}</>;
}

function sourceName(sources: Source[], id?: string) { return sources.find(s => s.id === id)?.originalName || sources.find(s => s.id === id)?.youtubeUrl || id || "source"; }
function formatTime(seconds: number) { const s = Math.max(0, Math.floor(seconds)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`; }
