"use client";

import { useEffect, useRef, useState } from "react";
import type { Section as SemanticSection } from "@/domain/sections";
import type { Graphic } from "@/domain/graphics";
import { isBaseItem, type TimelineItem } from "@/domain/project";
import { layoutTimeline } from "@/domain/timeline";
import { useT } from "@/i18n/I18nProvider";
import type { TFunction } from "@/i18n/translate";
import { formatTime, sourceLabel } from "./format";
import ReframeEditor from "./ReframeEditor";
import type { Reframe } from "@/domain/reframe";

type Source = { id: string; type: "UPLOAD" | "YOUTUBE"; status?: "PENDING" | "AVAILABLE"; storagePath?: string | null; originalName?: string | null; youtubeUrl?: string | null; youtubeVideoId?: string | null; durationMs?: number | null };
type Transition = { type: "cut" | "fade" | "crossfade"; durationSeconds: number };
type AudioAsset = { id: string; assetKey: string; durationMs?: number | null };
type Item = { type: "source-clip" | "overlay" | "slate" | "audio-clip"; assetId?: string; volume?: number; atSeconds?: number; duckSourceVolume?: number; backgroundImage?: string; sourceId?: string; graphicId?: string; sectionId?: string; startSeconds?: number; endSeconds?: number; template?: string; mode?: "standalone" | "overlay" | "mix"; durationSeconds?: number; kind?: "text" | "rectangle" | "image"; imageAsset?: string; opacity?: number; data?: Record<string, string>; transitionIn?: Transition; transitionOut?: Transition; reframe?: Reframe };
type Segment = { id: string; label: string; startSeconds: number; endSeconds: number; sourceId?: string };
type Definition = { version?: 1; template?: { width: number; height: number }; semanticSegments: Segment[]; sections?: SemanticSection[]; graphics?: Graphic[]; composition: { sourceStartSeconds: number; sourceEndSeconds: number; items: Item[] } };
type Props = { definition: Definition; sources: Source[]; audioAssets?: AudioAsset[]; onChange: (definition: Definition) => Promise<void> };
type DragPayload = { kind: "graphic" | "source" | "audio"; id: string };

export default function CompositionEditor({ definition, sources, audioAssets = [], onChange }: Props) {
  const t = useT();
  const graphics = definition.graphics ?? [];
  const items = definition.composition.items;
  const sections: Segment[] = (definition.sections?.filter(section => section.scope === "SOURCE" && section.startSeconds !== undefined && section.endSeconds !== undefined).map(section => ({ id: section.id, label: section.label, sourceId: section.sourceId, startSeconds: section.startSeconds!, endSeconds: section.endSeconds! })) ?? definition.semanticSegments);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const commit = async (nextItems: Item[]) => onChange({ ...definition, composition: { ...definition.composition, items: nextItems } });
  const payloadFromEvent = (event: React.DragEvent): DragPayload | null => { const raw = event.dataTransfer.getData("application/json"); if (!raw) return null; try { return JSON.parse(raw) as DragPayload; } catch { return null; } };
  const startDrag = (event: React.DragEvent, payload: DragPayload) => { event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData("application/json", JSON.stringify(payload)); };
  const addGraphicAsSlate = async (graphicId: string, index: number) => { if (!graphics.some(g => g.id === graphicId)) return; const next = [...items]; next.splice(Math.max(0, Math.min(index, next.length)), 0, { type: "slate", graphicId, template: "rich", mode: "standalone", durationSeconds: 5 }); await commit(next); };
  const addGraphicAsOverlay = async (graphicId: string, section: Segment) => { if (!graphics.some(g => g.id === graphicId)) return; const overlay: Item = { type: "overlay", graphicId, template: "rich", kind: "text", sectionId: section.id, startSeconds: section.startSeconds, endSeconds: Math.min(section.endSeconds, section.startSeconds + 5), opacity: 1 }; if ((overlay.endSeconds ?? 0) <= (overlay.startSeconds ?? 0)) return; await commit([...items, overlay]); };
  const audioWindow = (asset: AudioAsset, maxSeconds?: number) => Math.round(Math.max(0.1, Math.min(asset.durationMs ? asset.durationMs / 1000 : 10, maxSeconds ?? Infinity)) * 1000) / 1000;
  const addAudioAsSection = async (assetId: string, index: number) => { const asset = audioAssets.find(a => a.id === assetId); if (!asset) return; const next = [...items]; next.splice(Math.max(0, Math.min(index, next.length)), 0, { type: "audio-clip", assetId, mode: "standalone", startSeconds: 0, endSeconds: audioWindow(asset), volume: 1 }); await commit(next); };
  /** Output-timeline start (seconds) of a source-clip item, where a voiceover dropped on its section is mixed in. */
  const outputStartOf = (item: Item) => layoutTimeline(items as unknown as TimelineItem[]).find(slot => (slot.item as unknown as Item) === item)?.outputStart ?? 0;
  const addAudioAsMix = async (assetId: string, item: Item, section: Segment) => { const asset = audioAssets.find(a => a.id === assetId); if (!asset) return; await commit([...items, { type: "audio-clip", assetId, mode: "mix", startSeconds: 0, endSeconds: audioWindow(asset, section.endSeconds - section.startSeconds), atSeconds: Math.round(outputStartOf(item) * 1000) / 1000, volume: 1, duckSourceVolume: 0.25 }]); };
  const handleDropBetween = async (event: React.DragEvent, index: number) => { event.preventDefault(); setDragOver(null); const payload = payloadFromEvent(event); if (payload?.kind === "graphic") await addGraphicAsSlate(payload.id, index); else if (payload?.kind === "audio") await addAudioAsSection(payload.id, index); };
  const handleDropInside = async (event: React.DragEvent, section: Segment, item: Item) => { event.preventDefault(); setDragOver(null); const payload = payloadFromEvent(event); if (payload?.kind === "graphic") await addGraphicAsOverlay(payload.id, section); else if (payload?.kind === "audio") await addAudioAsMix(payload.id, item, section); };
  const dropBetween = (index: number, label: string) => <DropZone active={dragOver === `drop-${index}`} onDragOver={event => { event.preventDefault(); setDragOver(`drop-${index}`); }} onDragLeave={() => setDragOver(null)} onDrop={event => void handleDropBetween(event, index)} label={label} />;
  const updateItem = async (index: number, patch: Partial<Item>, dropUndefined = false) => commit(items.map((item, i) => { if (i !== index) return item; const next = { ...item, ...patch }; if (dropUndefined) for (const key of Object.keys(patch) as Array<keyof Item>) if (patch[key] === undefined) delete next[key]; return next; }));
  const outW = definition.template?.width ?? 1920, outH = definition.template?.height ?? 1080;
  const reframeButton = (title: string, current: Reframe | undefined, defaultLabel: string, source: Source | undefined, atSeconds: number, onSave: (reframe: Reframe | undefined) => Promise<void>) => <ReframeEditor title={title} current={current} defaultLabel={defaultLabel} source={source} atSeconds={atSeconds} outWidth={outW} outHeight={outH} onSave={onSave} />;
  const saveSectionReframe = async (id: string, reframe: Reframe | undefined) => onChange({ ...definition, sections: (definition.sections ?? []).map(s => { if (s.id !== id) return s; const { reframe: _old, ...rest } = s; return reframe ? { ...rest, reframe } : rest; }) });
  const removeItem = async (index: number) => commit(items.filter((_, i) => i !== index));

  return <div className="composition-editor">
    <div className="resource-bin"><div className="resource-bin-title"><strong>{t("comp.binTitle")}</strong><span>{t("comp.binHelp")}</span></div><div className="resource-bin-grid">
      {sources.map(source => <ResourceTile key={source.id} kind="source" label={sourceLabel(source)} icon="▶" onDragStart={event => startDrag(event, { kind: "source", id: source.id })} />)}
      {graphics.map(graphic => <ResourceTile key={graphic.id} kind="graphic" label={graphic.name} icon="✦" onDragStart={event => startDrag(event, { kind: "graphic", id: graphic.id })} />)}
      {audioAssets.map(asset => <ResourceTile key={asset.id} kind="audio" label={asset.assetKey} icon="🎙" onDragStart={event => startDrag(event, { kind: "audio", id: asset.id })} />)}
      {!sources.length && !graphics.length && !audioAssets.length && <span className="muted">{t("comp.noResources")}</span>}
    </div></div>

    <div className="composition-timeline">
      {dropBetween(0, t("comp.dropSlate"))}
      {items.map((item, itemIndex) => {
        if (item.type === "slate" && item.mode !== "overlay") {
          const graphic = graphics.find(g => g.id === item.graphicId);
          return <div key={`slate-${itemIndex}`} className="standalone-section"><div className="slate-section-card"><span className="slate-icon">✦</span><div><strong>{t("comp.slate", { name: graphic?.name ?? t("comp.graphic") })}</strong><small>{t("comp.slateInfo", { seconds: item.durationSeconds ?? 5 })}</small></div><button onClick={() => void removeItem(itemIndex)} aria-label={t("comp.remove")}>×</button></div>{dropBetween(itemIndex + 1, t("comp.dropSlateAnother"))}</div>;
        }
        if (item.type === "audio-clip") {
          const asset = audioAssets.find(a => a.id === item.assetId);
          const length = Math.max(0, (item.endSeconds ?? 0) - (item.startSeconds ?? 0));
          if (item.mode === "mix") return <div key={`audio-${itemIndex}`} className="standalone-section"><AudioClipCard t={t} item={item} name={asset?.assetKey} length={length} mix onChange={patch => void updateItem(itemIndex, patch)} onRemove={() => void removeItem(itemIndex)} /></div>;
          return <div key={`audio-${itemIndex}`} className="standalone-section"><AudioClipCard t={t} item={item} name={asset?.assetKey} length={length} maxSeconds={asset?.durationMs ? asset.durationMs / 1000 : undefined} graphics={graphics} onChange={patch => void updateItem(itemIndex, patch)} onRemove={() => void removeItem(itemIndex)} />{dropBetween(itemIndex + 1, t("comp.dropGraphicOrVoice"))}</div>;
        }
        if (item.type !== "source-clip") return null;
        const section = sections.find(s => s.sourceId === item.sourceId && s.startSeconds === item.startSeconds && s.endSeconds === item.endSeconds);
        if (!section) return null;
        const overlays = items.map((candidate, index) => ({ candidate, index })).filter(x => x.candidate.type === "overlay" && x.candidate.sectionId === section.id);
        return <div key={`section-${section.id}`} className="composition-section">
          <div className="section-header"><div className="section-thumbnail"><SectionThumbnail source={sources.find(s => s.id === section.sourceId)} projectSectionStart={section.startSeconds} /></div><div><strong>{section.label}</strong><small>{formatTime(section.startSeconds)} → {formatTime(section.endSeconds)} · {sourceName(sources, section.sourceId, t)}</small></div><span style={{ display: "flex", gap: 6, alignItems: "center", marginLeft: 12 }}>{reframeButton(t("comp.sectionReframe", { label: section.label }), definition.sections?.find(s => s.id === section.id)?.reframe, t("comp.useProjectDefault"), sources.find(s => s.id === section.sourceId), section.startSeconds, reframe => saveSectionReframe(section.id, reframe))}</span></div>
          <div className="section-body"><div className="section-main-track"><TimelineItemCard item={item} t={t} sources={sources} onRemove={() => void removeItem(itemIndex)} extra={reframeButton(t("comp.clipReframe", { label: section.label }), item.reframe, t("comp.useSectionSetting"), sources.find(s => s.id === item.sourceId), item.startSeconds ?? 0, reframe => updateItem(itemIndex, { reframe }, true))} /></div>
            <div className={`overlay-track ${dragOver === `inside-${section.id}` ? "drop-active" : ""}`} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDragOver(`inside-${section.id}`); }} onDragLeave={() => setDragOver(null)} onDrop={event => void handleDropInside(event, section, item)}><div className="track-label">{t("comp.overlayTrack")}</div><div className="overlay-track-line">{overlays.map(({candidate:overlay,index}) => <OverlayCard key={index} t={t} item={overlay} graphic={graphics.find(g => g.id === overlay.graphicId)} section={section} onChange={patch => void updateItem(index,patch)} onRemove={() => void removeItem(index)} />)}{!overlays.length&&<span className="overlay-hint">{t("comp.overlayHint")}</span>}</div></div>
          </div>{dropBetween(itemIndex + 1, t("comp.dropSlate"))}
        </div>;
      })}
      {!(items as TimelineItem[]).some(isBaseItem) && <div className="empty-composition">{t("comp.empty")}</div>}
    </div>
  </div>;
}

function ResourceTile({ kind, label, icon, onDragStart }: { kind: "source" | "graphic" | "audio"; label: string; icon: string; onDragStart: (event: React.DragEvent) => void }) { return <div className={`resource-tile ${kind}`} draggable onDragStart={onDragStart} title={label}><span className="resource-icon">{icon}</span><span>{label}</span></div>; }
function DropZone({ active, label, onDragOver, onDragLeave, onDrop }: { active: boolean; label: string; onDragOver: (event: React.DragEvent) => void; onDragLeave: () => void; onDrop: (event: React.DragEvent) => void }) { return <div className={`composition-drop-zone ${active ? "active" : ""}`} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}><span>＋</span>{label}</div>; }
function TimelineItemCard({ item, sources, onRemove, extra, t }: { t: TFunction; item: Item; sources: Source[]; onRemove: () => void; extra?: React.ReactNode }) { return <div className="composition-item-card"><span className="item-handle">☷</span><div><strong>{t("comp.source")}</strong><small>{sourceName(sources, item.sourceId, t)}</small><small>{formatTime(item.startSeconds ?? 0)} → {formatTime(item.endSeconds ?? 0)}</small>{extra && <span style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>{extra}</span>}</div><button onClick={onRemove} aria-label={t("comp.remove")}>×</button></div>; }
function OverlayCard({ t, item, graphic, section, onChange, onRemove }: { t: TFunction; item: Item; graphic?: Graphic; section: Segment; onChange: (patch: Partial<Item>) => void; onRemove: () => void }) { const start=Math.max(0,(item.startSeconds??section.startSeconds)-section.startSeconds),end=Math.max(start,(item.endSeconds??section.endSeconds)-section.startSeconds),duration=Math.max(.1,section.endSeconds-section.startSeconds),left=`${Math.min(100,start/duration*100)}%`,width=`${Math.max(8,Math.min(100-start/duration*100,(end-start)/duration*100))}%`;return <div className="overlay-card" style={{left,width}} title={`${graphic?.name??t("comp.graphic")}: ${formatTime(start)} → ${formatTime(end)}`}><span>✦ {graphic?.name??t("comp.graphic")}</span><div className="overlay-times"><input aria-label={t("comp.overlayStart")} type="number" min="0" max={duration} step=".1" value={Number(start.toFixed(1))} onChange={e=>{const n=Math.max(0,Math.min(duration,Number(e.target.value)));onChange({startSeconds:section.startSeconds+n})}}/><span>→</span><input aria-label={t("comp.overlayEnd")} type="number" min="0" max={duration} step=".1" value={Number(end.toFixed(1))} onChange={e=>{const n=Math.max(start,Math.min(duration,Number(e.target.value)));onChange({endSeconds:section.startSeconds+n})}}/></div><button onClick={onRemove} aria-label={t("comp.remove")}>×</button></div>; }
// eslint-disable-next-line react-hooks/exhaustive-deps -- the effect reads only the listed fields of `source`; depending on the object would reload the video on every refresh
function SectionThumbnail({ source, projectSectionStart }: { source?: Source; projectSectionStart: number }) { const videoRef=useRef<HTMLVideoElement>(null);const [thumb,setThumb]=useState<string|null>(null);useEffect(()=>{if(!source)return;if(source.type==="YOUTUBE"&&source.youtubeVideoId){setThumb(`https://i.ytimg.com/vi/${source.youtubeVideoId}/hqdefault.jpg`);return}if(source.status==="PENDING")return;const video=videoRef.current;if(!video)return;let cancelled=false;const capture=()=>{if(cancelled||!video.videoWidth||!video.videoHeight)return;const canvas=document.createElement("canvas");canvas.width=320;canvas.height=Math.round(320*video.videoHeight/video.videoWidth);const ctx=canvas.getContext("2d");if(!ctx)return;try{ctx.drawImage(video,0,0,canvas.width,canvas.height);if(!cancelled)setThumb(canvas.toDataURL("image/jpeg",.72))}catch{}};const ready=()=>{video.currentTime=Math.max(0,projectSectionStart)};const seeked=()=>capture();video.addEventListener("loadedmetadata",ready);video.addEventListener("seeked",seeked);video.load();return()=>{cancelled=true;video.removeEventListener("loadedmetadata",ready);video.removeEventListener("seeked",seeked)}},[source?.id,source?.type,source?.status,source?.youtubeVideoId,projectSectionStart]);const hasFile = source && source.type === "UPLOAD" && source.status === "AVAILABLE" && !!source.storagePath;
return <>{thumb?<img src={thumb} alt=""/>:<video ref={videoRef} muted preload="metadata" src={hasFile ? `/api/sources/${source.id}` : undefined}/>}</>; }function sourceName(sources: Source[], id: string | undefined, t: TFunction) { const source=sources.find(s=>s.id===id); return source ? sourceLabel(source) : id || t("comp.sourceFallback"); }

/** A voiceover on the timeline: a standalone section (trim, background graphic) or a mix over the video (position, level, ducking). */
function AudioClipCard({ t, item, name, length, mix, maxSeconds, graphics = [], onChange, onRemove }: { t: TFunction; item: Item; name?: string; length: number; mix?: boolean; maxSeconds?: number; graphics?: Graphic[]; onChange: (patch: Partial<Item>) => void; onRemove: () => void }) {
  const start = item.startSeconds ?? 0, end = item.endSeconds ?? start + 1;
  const num = (value: string, min: number, max = Infinity) => Math.max(min, Math.min(max, Number(value) || 0));
  return <div className="slate-section-card audio-clip-card" style={{ flexWrap: "wrap", gap: 10, alignItems: "center" }}>
    <span className="slate-icon">🎙</span>
    <div><strong>{mix ? t("comp.voiceMix") : t("comp.voice")} · {name ?? t("comp.audioFallback")}</strong><small>{mix ? t("comp.mixInfo", { time: formatTime(item.atSeconds ?? 0) }) : t("comp.standaloneInfo")} · {length.toFixed(1)}s</small></div>
    <label style={{ fontSize: 12 }}>{t("comp.from")} <input aria-label={t("comp.audioStart")} type="number" min="0" step=".1" value={Number(start.toFixed(2))} onChange={e => { const v = num(e.target.value, 0, end - 0.1); onChange({ startSeconds: v }); }} style={{ width: 64 }} /></label>
    <label style={{ fontSize: 12 }}>{t("comp.to")} <input aria-label={t("comp.audioEnd")} type="number" min="0.1" step=".1" value={Number(end.toFixed(2))} onChange={e => { const v = num(e.target.value, start + 0.1, maxSeconds); onChange({ endSeconds: v }); }} style={{ width: 64 }} /></label>
    {mix && <label style={{ fontSize: 12 }}>{t("comp.at")} <input aria-label={t("comp.mixPosition")} type="number" min="0" step=".1" value={Number((item.atSeconds ?? 0).toFixed(2))} onChange={e => onChange({ atSeconds: num(e.target.value, 0) })} style={{ width: 64 }} /></label>}
    {mix && <label style={{ fontSize: 12 }}>{t("comp.duck")} <input aria-label={t("comp.duckLabel")} type="number" min="0" max="1" step=".05" value={item.duckSourceVolume ?? 1} onChange={e => onChange({ duckSourceVolume: num(e.target.value, 0, 1) })} style={{ width: 56 }} /></label>}
    <label style={{ fontSize: 12 }}>{t("comp.volume")} <input aria-label={t("comp.volumeLabel")} type="number" min="0" max="4" step=".1" value={item.volume ?? 1} onChange={e => onChange({ volume: num(e.target.value, 0, 4) })} style={{ width: 56 }} /></label>
    {!mix && <label style={{ fontSize: 12 }}>{t("comp.videoBackground")} <select aria-label={t("comp.backgroundLabel")} value={item.graphicId ?? ""} onChange={e => onChange({ graphicId: e.target.value || undefined })}><option value="">{t("comp.templateBackground")}</option>{graphics.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>}
    <button onClick={onRemove} aria-label={t("comp.remove")}>×</button>
  </div>;
}
