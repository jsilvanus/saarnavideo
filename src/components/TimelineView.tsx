"use client";

import { useEffect, useMemo, useState } from "react";
import type { Graphic } from "@/domain/graphics";
import type { Section } from "@/domain/sections";
import type { TimelineItem } from "@/domain/project";
import { layoutTimeline } from "@/renderer/caption-timeline";
import { overlayOutputRange } from "@/renderer/overlay-timing";
import { formatTime, sourceLabel } from "./format";

type Source = { id: string; originalName?: string | null; youtubeUrl?: string | null };
type AudioAsset = { id: string; assetKey: string };
type Props = {
  items: unknown[];
  graphics?: Graphic[];
  sections?: Section[];
  sources: Source[];
  audioAssets?: AudioAsset[];
};
type Orientation = "horizontal" | "vertical";
type Lane = "video" | "graphics" | "audio";
type Block = { key: string; lane: Lane; start: number; end: number; label: string; detail: string; tone: "clip" | "slate" | "graphic" | "audio" | "voice-picture" };

const LANES: Array<{ id: Lane; label: string }> = [{ id: "video", label: "Video" }, { id: "graphics", label: "Grafiikat" }, { id: "audio", label: "Ääni" }];
const STORAGE_KEY = "saarnavideo.timelineOrientation";
/** Narrower than this the timeline opens vertical (lanes as columns), wider it opens horizontal. */
const DESKTOP_QUERY = "(min-width: 760px)";

/**
 * Read-only overview of the finished video: picture, graphics and audio on one output timeline, laid out exactly like the
 * renderer (layoutTimeline). Horizontal lanes on desktop, vertical columns on phones; the viewer can switch, and the choice
 * is remembered in this browser. Editing stays in CompositionEditor.
 */
export default function TimelineView({ items, graphics = [], sections = [], sources, audioAssets = [] }: Props) {
  const [orientation, setOrientation] = useState<Orientation>("horizontal");
  useEffect(() => {
    let saved: string | null = null;
    try { saved = window.localStorage.getItem(STORAGE_KEY); } catch { /* storage unavailable */ }
    if (saved === "horizontal" || saved === "vertical") setOrientation(saved);
    else setOrientation(window.matchMedia(DESKTOP_QUERY).matches ? "horizontal" : "vertical");
  }, []);
  const choose = (next: Orientation) => {
    setOrientation(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* storage unavailable */ }
  };

  const { blocks, total } = useMemo(() => buildBlocks(items as TimelineItem[], graphics, sections, sources, audioAssets), [items, graphics, sections, sources, audioAssets]);

  return <div className="timeline-view" data-testid="timeline-view" data-orientation={orientation}>
    <div className="timeline-view-head">
      <span className="muted">Kesto {formatTime(total)}</span>
      <div role="group" aria-label="Aikajanan suunta" className="segmented">
        <button type="button" aria-pressed={orientation === "horizontal"} onClick={() => choose("horizontal")}>Vaaka</button>
        <button type="button" aria-pressed={orientation === "vertical"} onClick={() => choose("vertical")}>Pysty</button>
      </div>
    </div>
    {!blocks.length ? <p className="muted">Aikajana on tyhjä. Lisää osioita koostukseen alla.</p>
      : orientation === "horizontal" ? <Horizontal blocks={blocks} total={total} /> : <Vertical blocks={blocks} total={total} />}
  </div>;
}

function Horizontal({ blocks, total }: { blocks: Block[]; total: number }) {
  return <div className="timeline-h">
    <div className="timeline-h-ruler" aria-hidden="true">{ticks(total).map(t => <span key={t} style={{ left: `${(t / total) * 100}%` }}>{formatTime(t)}</span>)}</div>
    {LANES.map(lane => <div className="timeline-h-lane" key={lane.id}>
      <span className="timeline-lane-label">{lane.label}</span>
      <div className="timeline-h-track">{blocks.filter(b => b.lane === lane.id).map(b => <BlockView key={b.key} block={b} style={{ left: `${(b.start / total) * 100}%`, width: `${Math.max(0.4, ((b.end - b.start) / total) * 100)}%` }} />)}</div>
    </div>)}
  </div>;
}

function Vertical({ blocks, total }: { blocks: Block[]; total: number }) {
  // Tall enough to read, short enough not to scroll forever on an hour-long service.
  const height = Math.round(Math.min(1400, Math.max(480, total * 1.2)));
  return <div className="timeline-v" style={{ gridTemplateRows: `auto ${height}px` }}>
    <span />{LANES.map(lane => <span className="timeline-lane-label" key={lane.id}>{lane.label}</span>)}
    <div className="timeline-v-ruler" aria-hidden="true">{ticks(total).map(t => <span key={t} style={{ top: `${(t / total) * 100}%` }}>{formatTime(t)}</span>)}</div>
    {LANES.map(lane => <div className="timeline-v-track" key={lane.id}>{blocks.filter(b => b.lane === lane.id).map(b => <BlockView key={b.key} block={b} style={{ top: `${(b.start / total) * 100}%`, height: `${Math.max(0.4, ((b.end - b.start) / total) * 100)}%` }} />)}</div>)}
  </div>;
}

function BlockView({ block, style }: { block: Block; style: React.CSSProperties }) {
  return <div className={`timeline-block tone-${block.tone}`} style={style} title={`${block.label} · ${formatTime(block.start)}–${formatTime(block.end)}${block.detail ? ` · ${block.detail}` : ""}`}>
    <strong>{block.label}</strong>{block.detail && <small>{block.detail}</small>}
  </div>;
}

function ticks(total: number): number[] {
  if (total <= 0) return [];
  const step = [10, 30, 60, 120, 300, 600, 900, 1800].find(s => total / s <= 6) ?? 3600;
  const out: number[] = [];
  for (let t = 0; t < total; t += step) out.push(t);
  return out;
}

/** Blocks on the output timeline, in seconds. Section overlays are placed on their clip exactly as the renderer places them. */
export function buildBlocks(items: TimelineItem[], graphics: Graphic[], sections: Section[], sources: Source[], audioAssets: AudioAsset[]): { blocks: Block[]; total: number } {
  const graphicName = (id?: string) => graphics.find(g => g.id === id)?.name ?? "Grafiikka";
  const audioName = (id?: string) => audioAssets.find(a => a.id === id)?.assetKey ?? "Ääni";
  const sourceName = (id: string) => { const source = sources.find(s => s.id === id); return source ? sourceLabel(source) : "lähde"; };
  const blocks: Block[] = [];
  const slots = layoutTimeline(items);
  slots.forEach(({ item, outputStart, duration }, index) => {
    const start = outputStart, end = outputStart + duration, key = `base-${index}`;
    if (item.type === "source-clip") {
      const section = sections.find(s => s.scope === "SOURCE" && s.sourceId === item.sourceId && s.startSeconds === item.startSeconds && s.endSeconds === item.endSeconds);
      blocks.push({ key, lane: "video", start, end, label: section?.label ?? "Leike", detail: `${sourceName(item.sourceId)} · ${formatTime(duration)}`, tone: "clip" });
    } else if (item.type === "slate") {
      blocks.push({ key, lane: "video", start, end, label: item.graphicId ? graphicName(item.graphicId) : item.data?.title || "Välikuva", detail: `${formatTime(duration)}`, tone: "slate" });
    } else {
      blocks.push({ key, lane: "video", start, end, label: item.graphicId ? graphicName(item.graphicId) : "Taustakuva", detail: "puheen kuva", tone: "voice-picture" });
      blocks.push({ key: `${key}-audio`, lane: "audio", start, end, label: audioName(item.assetId), detail: "oma osio", tone: "audio" });
    }
  });
  items.forEach((item, index) => {
    if (item.type === "overlay" || (item.type === "slate" && item.mode === "overlay")) {
      if (item.startSeconds === undefined || item.endSeconds === undefined) return;
      const range = item.type === "overlay" ? overlayOutputRange(item, items, { sections }) : { startSeconds: item.startSeconds, endSeconds: item.endSeconds };
      if (!range) return;
      blocks.push({ key: `graphic-${index}`, lane: "graphics", start: range.startSeconds, end: range.endSeconds, label: item.graphicId ? graphicName(item.graphicId) : item.data?.title || item.data?.text || "Grafiikka", detail: item.type === "slate" ? "päällä, tausta" : "päällä", tone: "graphic" });
    } else if (item.type === "audio-clip" && item.mode === "mix") {
      const start = item.atSeconds ?? 0;
      blocks.push({ key: `mix-${index}`, lane: "audio", start, end: start + Math.max(0, item.endSeconds - item.startSeconds), label: audioName(item.assetId), detail: item.duckSourceVolume !== undefined && item.duckSourceVolume < 1 ? "miksattu, lähde hiljennetty" : "miksattu", tone: "audio" });
    }
  });
  const total = Math.max(0.001, ...blocks.map(b => b.end));
  return { blocks, total };
}
