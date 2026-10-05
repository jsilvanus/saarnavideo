"use client";

import { useEffect, useMemo, useState } from "react";
import type { Graphic } from "@/domain/graphics";
import type { Section } from "@/domain/sections";
import type { TimelineItem } from "@/domain/project";
import { useT } from "@/i18n/I18nProvider";
import { makeT, type TFunction, type MessageKey } from "@/i18n/translate";
import { layoutTimeline } from "@/domain/timeline";
import { overlayOutputRange } from "@/renderer/overlay-timing";
import { formatTime, sourceLabel } from "./format";
import styles from "./TimelineView.module.css";

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

const LANES: Array<{ id: Lane; labelKey: MessageKey }> = [{ id: "video", labelKey: "tl.lane.video" }, { id: "graphics", labelKey: "tl.lane.graphics" }, { id: "audio", labelKey: "tl.lane.audio" }];
const STORAGE_KEY = "saarnavideo.timelineOrientation";
/** Narrower than this the timeline opens vertical (lanes as columns), wider it opens horizontal. */
const DESKTOP_QUERY = "(min-width: 760px)";

/**
 * Read-only overview of the finished video: picture, graphics and audio on one output timeline, laid out exactly like the
 * renderer (layoutTimeline). Horizontal lanes on desktop, vertical columns on phones; the viewer can switch, and the choice
 * is remembered in this browser. Editing stays in CompositionEditor.
 */
export default function TimelineView({ items, graphics = [], sections = [], sources, audioAssets = [] }: Props) {
  const t = useT();
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

  const { blocks, total } = useMemo(() => buildBlocks(items as TimelineItem[], graphics, sections, sources, audioAssets, t), [items, graphics, sections, sources, audioAssets, t]);

  return <div className={styles["timeline-view"]} data-testid="timeline-view" data-orientation={orientation}>
    <div className={styles["timeline-view-head"]}>
      <span className="muted">{t("tl.duration", { time: formatTime(total) })}</span>
      <div role="group" aria-label={t("tl.orientation")} className={styles["segmented"]}>
        <button type="button" aria-pressed={orientation === "horizontal"} onClick={() => choose("horizontal")}>{t("tl.horizontal")}</button>
        <button type="button" aria-pressed={orientation === "vertical"} onClick={() => choose("vertical")}>{t("tl.vertical")}</button>
      </div>
    </div>
    {!blocks.length ? <p className="muted">{t("tl.empty")}</p>
      : orientation === "horizontal" ? <Horizontal blocks={blocks} total={total} /> : <Vertical blocks={blocks} total={total} />}
  </div>;
}

function Horizontal({ blocks, total }: { blocks: Block[]; total: number }) {
  const t = useT();
  return <div className={styles["timeline-h"]}>
    <div className={styles["timeline-h-ruler"]} aria-hidden="true">{ticks(total).map(tick => <span key={tick} style={{ left: `${(tick / total) * 100}%` }}>{formatTime(tick)}</span>)}</div>
    {LANES.map(lane => <div className={styles["timeline-h-lane"]} key={lane.id}>
      <span className={styles["timeline-lane-label"]}>{t(lane.labelKey)}</span>
      <div className={styles["timeline-h-track"]}>{blocks.filter(b => b.lane === lane.id).map(b => <BlockView key={b.key} block={b} style={{ left: `${(b.start / total) * 100}%`, width: `${Math.max(0.4, ((b.end - b.start) / total) * 100)}%` }} />)}</div>
    </div>)}
  </div>;
}

function Vertical({ blocks, total }: { blocks: Block[]; total: number }) {
  const t = useT();
  // Tall enough to read, short enough not to scroll forever on an hour-long service.
  const height = Math.round(Math.min(1400, Math.max(480, total * 1.2)));
  return <div className={styles["timeline-v"]} style={{ gridTemplateRows: `auto ${height}px` }}>
    <span />{LANES.map(lane => <span className={styles["timeline-lane-label"]} key={lane.id}>{t(lane.labelKey)}</span>)}
    <div className={styles["timeline-v-ruler"]} aria-hidden="true">{ticks(total).map(tick => <span key={tick} style={{ top: `${(tick / total) * 100}%` }}>{formatTime(tick)}</span>)}</div>
    {LANES.map(lane => <div className={styles["timeline-v-track"]} key={lane.id}>{blocks.filter(b => b.lane === lane.id).map(b => <BlockView key={b.key} block={b} style={{ top: `${(b.start / total) * 100}%`, height: `${Math.max(0.4, ((b.end - b.start) / total) * 100)}%` }} />)}</div>)}
  </div>;
}

function BlockView({ block, style }: { block: Block; style: React.CSSProperties }) {
  return <div className={`${styles["timeline-block"]} ${styles[`tone-${block.tone}`]}`} style={style} title={`${block.label} · ${formatTime(block.start)}–${formatTime(block.end)}${block.detail ? ` · ${block.detail}` : ""}`}>
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
export function buildBlocks(items: TimelineItem[], graphics: Graphic[], sections: Section[], sources: Source[], audioAssets: AudioAsset[], t: TFunction = makeT("fi")): { blocks: Block[]; total: number } {
  const graphicName = (id?: string) => graphics.find(g => g.id === id)?.name ?? t("tl.graphic");
  const audioName = (id?: string) => audioAssets.find(a => a.id === id)?.assetKey ?? t("tl.audio");
  const sourceName = (id: string) => { const source = sources.find(s => s.id === id); return source ? sourceLabel(source) : t("tl.source"); };
  const blocks: Block[] = [];
  const slots = layoutTimeline(items);
  slots.forEach(({ item, outputStart, duration }, index) => {
    const start = outputStart, end = outputStart + duration, key = `base-${index}`;
    if (item.type === "source-clip") {
      const section = sections.find(s => s.scope === "SOURCE" && s.sourceId === item.sourceId && s.startSeconds === item.startSeconds && s.endSeconds === item.endSeconds);
      blocks.push({ key, lane: "video", start, end, label: section?.label ?? t("tl.clip"), detail: `${sourceName(item.sourceId)} · ${formatTime(duration)}`, tone: "clip" });
    } else if (item.type === "slate") {
      blocks.push({ key, lane: "video", start, end, label: item.graphicId ? graphicName(item.graphicId) : item.data?.title || t("tl.slate"), detail: `${formatTime(duration)}`, tone: "slate" });
    } else {
      blocks.push({ key, lane: "video", start, end, label: item.graphicId ? graphicName(item.graphicId) : t("tl.voicePicture"), detail: t("tl.voicePictureDetail"), tone: "voice-picture" });
      blocks.push({ key: `${key}-audio`, lane: "audio", start, end, label: audioName(item.assetId), detail: t("tl.ownSection"), tone: "audio" });
    }
  });
  items.forEach((item, index) => {
    if (item.type === "overlay" || (item.type === "slate" && item.mode === "overlay")) {
      if (item.startSeconds === undefined || item.endSeconds === undefined) return;
      const range = item.type === "overlay" ? overlayOutputRange(item, items, { sections }) : { startSeconds: item.startSeconds, endSeconds: item.endSeconds };
      if (!range) return;
      blocks.push({ key: `graphic-${index}`, lane: "graphics", start: range.startSeconds, end: range.endSeconds, label: item.graphicId ? graphicName(item.graphicId) : item.data?.title || item.data?.text || t("tl.graphic"), detail: item.type === "slate" ? t("tl.overlayBackground") : t("tl.overlay"), tone: "graphic" });
    } else if (item.type === "audio-clip" && item.mode === "mix") {
      const start = item.atSeconds ?? 0;
      blocks.push({ key: `mix-${index}`, lane: "audio", start, end: start + Math.max(0, item.endSeconds - item.startSeconds), label: audioName(item.assetId), detail: item.duckSourceVolume !== undefined && item.duckSourceVolume < 1 ? t("tl.mixedDucked") : t("tl.mixed"), tone: "audio" });
    }
  });
  const total = Math.max(0.001, ...blocks.map(b => b.end));
  return { blocks, total };
}
