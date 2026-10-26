"use client";

import { useEffect, useMemo, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { Graphic } from "@/domain/graphics";
import type { Section } from "@/domain/sections";
import type { TimelineItem } from "@/domain/project";
import { useT } from "@/i18n/I18nProvider";
import { makeT, type TFunction, type MessageKey } from "@/i18n/translate";
import { layoutTimeline } from "@/domain/timeline";
import { overlayOutputBounds, overlayOutputRange, overlayStoredRange } from "@/renderer/overlay-timing";
import { editRange, snapTime, type RangeEdit, type TimeRange } from "@/domain/range-edit";
import { dropOnTimeline, laneAccepts, type DropLane, type DropPayload } from "@/domain/timeline-drop";
import { RESOURCE_TYPE_PREFIX } from "./ResourceBin";
import PodcastSlots, { type PodcastSlot } from "./PodcastSlots";
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
  /** Writes new start/end seconds onto the timeline item at `index` (source seconds for a section overlay, output seconds otherwise). Without it the view is read-only. */
  onChange?: (index: number, patch: { startSeconds: number; endSeconds: number }) => void;
  /** Receives the composition items after a resource from the resource bin was dropped on a lane. Without it the lanes accept no drops. */
  onItemsChange?: (items: TimelineItem[]) => void;
  /** The podcast intro and outro (library audio asset ids). With `onPodcastSlot` they show as two slots at the ends of the audio lane. */
  podcast?: { introAssetId?: string; outroAssetId?: string };
  onPodcastSlot?: (slot: PodcastSlot, assetId: string | undefined) => void;
  /** Receives all sections after a sequence of the finished video (a COMPOSITION section) was added, moved, renamed or removed. Without it the sequences lane is read-only and hidden when empty. */
  onSections?: (sections: Section[]) => void;
};
type Orientation = "horizontal" | "vertical";
type Lane = "video" | "graphics" | "audio" | "sequences";
type Block = {
  key: string; lane: Lane; start: number; end: number; label: string; detail: string; tone: "clip" | "slate" | "graphic" | "audio" | "voice-picture" | "sequence";
  /** An overlay or overlay slate: its start and end can be edited. `itemIndex` is its place in the composition items. */
  itemIndex?: number;
  /** A sequence: the id of its COMPOSITION section. */
  sectionId?: string;
  editable?: boolean;
  /** Output seconds the block must stay inside (its clip, or the whole picture timeline). */
  bounds?: TimeRange;
};

const LANES: Array<{ id: Lane; labelKey: MessageKey }> = [{ id: "video", labelKey: "tl.lane.video" }, { id: "graphics", labelKey: "tl.lane.graphics" }, { id: "audio", labelKey: "tl.lane.audio" }, { id: "sequences", labelKey: "tl.lane.sequences" }];
const STORAGE_KEY = "saarnavideo.timelineOrientation";
/** Narrower than this the timeline opens vertical (lanes as columns), wider it opens horizontal. */
const DESKTOP_QUERY = "(min-width: 760px)";

/**
 * Overview of the finished video: picture, graphics and audio on one output timeline, laid out exactly like the
 * renderer (layoutTimeline). Horizontal lanes on desktop, vertical columns on phones; the viewer can switch, and the choice
 * is remembered in this browser. Graphics blocks (overlays and overlay slates) can be edited when `onChange` is given: drag
 * an edge or the block (0.1 s steps, at least 0.5 s, inside the clip), or click it for exact start and end; arrow keys nudge
 * the focused block (Shift = 1 s, Alt = the end edge). Everything else is edited in CompositionEditor.
 */
export default function TimelineView({ items, graphics = [], sections = [], sources, audioAssets = [], onChange, onItemsChange, podcast, onPodcastSlot, onSections }: Props) {
  const t = useT();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ key: string; range: TimeRange } | null>(null);
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

  const [dropMark, setDropMark] = useState<{ lane: Lane; fraction: number } | null>(null);
  /** Drop handling for one lane's track: a marker while a fitting resource is dragged over, the drop itself on release. */
  function dropProps(lane: Lane, axis: "h" | "v", length: number): React.HTMLAttributes<HTMLElement> {
    if (!onItemsChange || lane === "sequences") return {};
    const kindOf = (event: React.DragEvent): DropPayload["kind"] | undefined => (["graphic", "audio"] as const).find(kind => event.dataTransfer.types.includes(`${RESOURCE_TYPE_PREFIX}${kind}`));
    const fractionOf = (event: React.DragEvent<HTMLElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const size = axis === "h" ? rect.width : rect.height;
      return Math.min(1, Math.max(0, size ? ((axis === "h" ? event.clientX - rect.left : event.clientY - rect.top) / size) : 0));
    };
    return {
      onDragOver: event => {
        const kind = kindOf(event);
        if (!kind || !laneAccepts(kind, lane)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDropMark({ lane, fraction: fractionOf(event) });
      },
      onDragLeave: () => setDropMark(null),
      onDrop: event => {
        setDropMark(null);
        const kind = kindOf(event);
        if (!kind || !laneAccepts(kind, lane)) return;
        event.preventDefault();
        let id = "";
        try { id = (JSON.parse(event.dataTransfer.getData("application/json")) as { id?: string }).id ?? ""; } catch { return; }
        const next = dropOnTimeline(items as TimelineItem[], { payload: { kind, id }, lane: lane as DropLane, time: fractionOf(event) * length, graphics, sections, audioAssets });
        if (next) onItemsChange(next);
      },
    };
  }

  const editing = (onChange || onSections) ? blocks.find(b => b.key === selectedKey && b.editable) : undefined;

  /** Writes a block's new output range back as the item stores it. */
  function commitRange(block: Block, range: TimeRange) {
    if (block.sectionId !== undefined) {
      if (onSections && !(range.start === block.start && range.end === block.end)) onSections(sections.map(s => s.id === block.sectionId ? { ...s, startSeconds: range.start, endSeconds: range.end } : s));
      return;
    }
    if (!onChange || block.itemIndex === undefined) return;
    const item = (items as TimelineItem[])[block.itemIndex];
    if (!item || (range.start === block.start && range.end === block.end)) return;
    const output = { startSeconds: range.start, endSeconds: range.end };
    const stored = item.type === "overlay" ? overlayStoredRange(item, output, items as TimelineItem[], { sections }) : output;
    if (stored) onChange(block.itemIndex, stored);
  }

  const horizontal = orientation === "horizontal";
  function startDrag(event: ReactPointerEvent<HTMLElement>, block: Block, mode: "start" | "end" | "move") {
    if (!block.editable || !(onChange || onSections)) return;
    const track = event.currentTarget.closest<HTMLElement>("[data-track]");
    if (!track) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedKey(block.key);
    const rect = track.getBoundingClientRect();
    const size = horizontal ? rect.width : rect.height;
    const origin = horizontal ? event.clientX : event.clientY;
    const from = { start: block.start, end: block.end };
    const bounds = block.bounds ?? { start: 0, end: total };
    let latest = from;
    const onMove = (move: PointerEvent) => {
      const delta = (((horizontal ? move.clientX : move.clientY) - origin) / size) * total;
      const edit: RangeEdit = mode === "move" ? { edge: "move", by: delta } : { edge: mode, to: (mode === "start" ? from.start : from.end) + delta };
      latest = editRange(from, edit, bounds);
      setDrag({ key: block.key, range: latest });
    };
    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      setDrag(null);
      if (commit) commitRange(block, latest);
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  }

  function onBlockKey(event: KeyboardEvent<HTMLElement>, block: Block) {
    if (!block.editable || !(onChange || onSections)) return;
    const back = event.key === "ArrowLeft" || event.key === "ArrowUp";
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    if (!back && !forward) return;
    event.preventDefault();
    const step = (event.shiftKey ? 1 : 0.1) * (back ? -1 : 1);
    const from = { start: block.start, end: block.end };
    const edit: RangeEdit = event.altKey ? { edge: "end", to: block.end + step } : { edge: "move", by: step };
    commitRange(block, editRange(from, edit, block.bounds ?? { start: 0, end: total }));
  }

  const droppable = Boolean(onItemsChange);
  const hasSequences = blocks.some(b => b.lane === "sequences");
  const lanes = LANES.filter(l => l.id !== "sequences" || onSections || hasSequences);
  const addSequence = () => {
    if (!onSections) return;
    const at = Math.min(Math.max(0, total - 10), Math.max(0, ...sections.filter(s => s.scope === "COMPOSITION" && s.endSeconds !== undefined).map(s => s.endSeconds as number)));
    const id = `seq-${Date.now().toString(36)}`;
    onSections([...sections, { id, label: t("tl.sequence.new"), scope: "COMPOSITION", origin: "MANUAL", startSeconds: snapTime(at), endSeconds: snapTime(Math.min(Math.max(at + 10, 1), Math.max(total, 10))) } as Section]);
    setSelectedKey(`sequence-${id}`);
  };
  // An empty composition still shows the lanes when resources can be dropped, so the first item can be placed.
  const shownTotal = blocks.length ? total : 30;
  const view = { total: shownTotal, drag, selectedKey, canEdit: Boolean(onChange || onSections), lanes, startDrag, onBlockKey, select: setSelectedKey, dropProps, dropMark };

  return <div className={styles["timeline-view"]} data-testid="timeline-view" data-orientation={orientation}>
    <div className={styles["timeline-view-head"]}>
      <span className="muted">{t("tl.duration", { time: formatTime(total) })}</span>
      <div role="group" aria-label={t("tl.orientation")} className={styles["segmented"]}>
        <button type="button" aria-pressed={orientation === "horizontal"} onClick={() => choose("horizontal")}>{t("tl.horizontal")}</button>
        <button type="button" aria-pressed={orientation === "vertical"} onClick={() => choose("vertical")}>{t("tl.vertical")}</button>
      </div>
    </div>
    {!blocks.length && !droppable ? <p className="muted">{t("tl.empty")}</p>
      : orientation === "horizontal" ? <Horizontal blocks={blocks} view={view} /> : <Vertical blocks={blocks} view={view} />}
    {onPodcastSlot && <PodcastSlots introAssetId={podcast?.introAssetId} outroAssetId={podcast?.outroAssetId} audioAssets={audioAssets} onChange={onPodcastSlot} />}
    {onSections && <p><button type="button" onClick={addSequence}>{t("tl.sequence.add")}</button></p>}
    {(onChange || onSections) && blocks.some(b => b.editable) && !editing && <p className="muted">{t("tl.edit.hint")}</p>}
    {editing && <GraphicTimes key={`${editing.key}:${editing.start}:${editing.end}`} block={editing} total={total} onCommit={range => commitRange(editing, range)} onClose={() => setSelectedKey(null)}
      onRename={editing.sectionId && onSections ? label => onSections(sections.map(s => s.id === editing.sectionId ? { ...s, label } : s)) : undefined}
      onRemove={editing.sectionId && onSections ? () => { setSelectedKey(null); onSections(sections.filter(s => s.id !== editing.sectionId && s.parentId !== editing.sectionId)); } : undefined} />}
  </div>;
}

type View = {
  total: number;
  drag: { key: string; range: TimeRange } | null;
  selectedKey: string | null;
  canEdit: boolean;
  lanes: typeof LANES;
  startDrag: (event: ReactPointerEvent<HTMLElement>, block: Block, mode: "start" | "end" | "move") => void;
  onBlockKey: (event: KeyboardEvent<HTMLElement>, block: Block) => void;
  select: (key: string | null) => void;
  dropProps: (lane: Lane, axis: "h" | "v", length: number) => React.HTMLAttributes<HTMLElement>;
  dropMark: { lane: Lane; fraction: number } | null;
};

/** Where a block sits on its track: the range being dragged while it is dragged. */
function placement(block: Block, view: View, axis: "h" | "v"): React.CSSProperties {
  const range = view.drag?.key === block.key ? view.drag.range : { start: block.start, end: block.end };
  const from = `${(range.start / view.total) * 100}%`;
  const size = `${Math.max(0.4, ((range.end - range.start) / view.total) * 100)}%`;
  return axis === "h" ? { left: from, width: size } : { top: from, height: size };
}

function Horizontal({ blocks, view }: { blocks: Block[]; view: View }) {
  const t = useT();
  const { total } = view;
  return <div className={styles["timeline-h"]}>
    <div className={styles["timeline-h-ruler"]} aria-hidden="true">{ticks(total).map(tick => <span key={tick} style={{ left: `${(tick / total) * 100}%` }}>{formatTime(tick)}</span>)}</div>
    {view.lanes.map(lane => <div className={styles["timeline-h-lane"]} key={lane.id}>
      <span className={styles["timeline-lane-label"]}>{t(lane.labelKey)}</span>
      <div className={styles["timeline-h-track"]} data-track onClick={() => view.select(null)} {...view.dropProps(lane.id, "h", total)}>{blocks.filter(b => b.lane === lane.id).map(b => <BlockView key={b.key} block={b} view={view} style={placement(b, view, "h")} />)}{view.dropMark?.lane === lane.id && <span className={styles["drop-mark"]} style={{ left: `${view.dropMark.fraction * 100}%` }} aria-hidden="true" />}</div>
    </div>)}
  </div>;
}

function Vertical({ blocks, view }: { blocks: Block[]; view: View }) {
  const t = useT();
  const { total } = view;
  // Tall enough to read, short enough not to scroll forever on an hour-long service.
  const height = Math.round(Math.min(1400, Math.max(480, total * 1.2)));
  return <div className={styles["timeline-v"]} style={{ gridTemplateRows: `auto ${height}px`, gridTemplateColumns: `48px repeat(${view.lanes.length}, minmax(0, 1fr))` }}>
    <span />{view.lanes.map(lane => <span className={styles["timeline-lane-label"]} key={lane.id}>{t(lane.labelKey)}</span>)}
    <div className={styles["timeline-v-ruler"]} aria-hidden="true">{ticks(total).map(tick => <span key={tick} style={{ top: `${(tick / total) * 100}%` }}>{formatTime(tick)}</span>)}</div>
    {view.lanes.map(lane => <div className={styles["timeline-v-track"]} data-track key={lane.id} onClick={() => view.select(null)} {...view.dropProps(lane.id, "v", total)}>{blocks.filter(b => b.lane === lane.id).map(b => <BlockView key={b.key} block={b} view={view} style={placement(b, view, "v")} />)}{view.dropMark?.lane === lane.id && <span className={styles["drop-mark"]} style={{ top: `${view.dropMark.fraction * 100}%` }} aria-hidden="true" />}</div>)}
  </div>;
}

function BlockView({ block, view, style }: { block: Block; view: View; style: React.CSSProperties }) {
  const t = useT();
  const editable = Boolean(block.editable && view.canEdit);
  const shown = view.drag?.key === block.key ? view.drag.range : { start: block.start, end: block.end };
  const classes = [styles["timeline-block"], styles[`tone-${block.tone}`], editable ? styles["editable"] : "", editable && view.selectedKey === block.key ? styles["selected"] : ""].filter(Boolean).join(" ");
  const title = `${block.label} · ${formatTime(shown.start)}–${formatTime(shown.end)}${block.detail ? ` · ${block.detail}` : ""}`;
  if (!editable) return <div className={classes} style={style} title={title}><strong>{block.label}</strong>{block.detail && <small>{block.detail}</small>}</div>;
  return <div className={classes} style={style} title={title} role="button" tabIndex={0} aria-pressed={view.selectedKey === block.key}
    onPointerDown={event => view.startDrag(event, block, "move")} onClick={event => event.stopPropagation()} onKeyDown={event => view.onBlockKey(event, block)}>
    <span className={`${styles["handle"]} ${styles["handle-start"]}`} role="separator" aria-label={t("tl.edit.handleStart")} onPointerDown={event => view.startDrag(event, block, "start")} />
    <strong>{block.label}</strong>{block.detail && <small>{block.detail}</small>}
    <span className={`${styles["handle"]} ${styles["handle-end"]}`} role="separator" aria-label={t("tl.edit.handleEnd")} onPointerDown={event => view.startDrag(event, block, "end")} />
  </div>;
}

/** Exact start and end (output seconds) of the selected graphics block. */
function GraphicTimes({ block, total, onCommit, onClose, onRename, onRemove }: { block: Block; total: number; onCommit: (range: TimeRange) => void; onClose: () => void; onRename?: (label: string) => void; onRemove?: () => void }) {
  const t = useT();
  const bounds = block.bounds ?? { start: 0, end: total };
  const [start, setStart] = useState(String(Number(block.start.toFixed(2))));
  const [end, setEnd] = useState(String(Number(block.end.toFixed(2))));
  const from = { start: block.start, end: block.end };
  const apply = (edge: "start" | "end", value: string) => {
    const n = Number(value);
    if (value.trim() === "" || !Number.isFinite(n)) return;
    onCommit(editRange(from, { edge, to: snapTime(n) }, bounds));
  };
  return <div className={styles["time-editor"]}>
    {onRename ? <input aria-label={t("tl.sequence.name")} defaultValue={block.label} onBlur={e => { const v = e.target.value.trim(); if (v && v !== block.label) onRename(v); }} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} /> : <strong>{block.label}</strong>}
    <label>{t("tl.edit.start")}<input type="number" step="0.1" min={bounds.start} max={bounds.end} value={start} onChange={e => setStart(e.target.value)} onBlur={() => apply("start", start)} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} /></label>
    <label>{t("tl.edit.end")}<input type="number" step="0.1" min={bounds.start} max={bounds.end} value={end} onChange={e => setEnd(e.target.value)} onBlur={() => apply("end", end)} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} /></label>
    <span className="muted">{t("tl.edit.within", { start: formatTime(bounds.start), end: formatTime(bounds.end) })}</span>
    {onRemove && <button type="button" onClick={onRemove}>{t("tl.sequence.remove")}</button>}
    <button type="button" onClick={onClose}>{t("tl.edit.close")}</button>
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
  const pictureEnd = Math.max(0, ...slots.map(slot => slot.outputStart + slot.duration));
  items.forEach((item, index) => {
    if (item.type === "overlay" || (item.type === "slate" && item.mode === "overlay")) {
      if (item.startSeconds === undefined || item.endSeconds === undefined) return;
      const range = item.type === "overlay" ? overlayOutputRange(item, items, { sections }) : { startSeconds: item.startSeconds, endSeconds: item.endSeconds };
      if (!range) return;
      // A section overlay stays in its clip; any other graphic stays on the picture timeline (and where it already is).
      const clip = item.type === "overlay" ? overlayOutputBounds(item, items, { sections }) : undefined;
      const bounds = clip ? { start: clip.startSeconds, end: clip.endSeconds } : { start: 0, end: Math.max(pictureEnd, range.endSeconds) };
      blocks.push({ key: `graphic-${index}`, lane: "graphics", start: range.startSeconds, end: range.endSeconds, label: item.graphicId ? graphicName(item.graphicId) : item.data?.title || item.data?.text || t("tl.graphic"), detail: item.type === "slate" ? t("tl.overlayBackground") : t("tl.overlay"), tone: "graphic", itemIndex: index, editable: true, bounds });
    } else if (item.type === "feed-overlay") {
      blocks.push({ key: `feed-${index}`, lane: "graphics", start: item.startSeconds, end: item.endSeconds, label: t("tl.feedGraphics"), detail: t("tl.feedGraphicsDetail"), tone: "graphic" });
    } else if (item.type === "audio-clip" && item.mode === "mix") {
      const start = item.atSeconds ?? 0;
      blocks.push({ key: `mix-${index}`, lane: "audio", start, end: start + Math.max(0, item.endSeconds - item.startSeconds), label: audioName(item.assetId), detail: item.duckSourceVolume !== undefined && item.duckSourceVolume < 1 ? t("tl.mixedDucked") : t("tl.mixed"), tone: "audio" });
    }
  });
  const total = Math.max(0.001, ...blocks.map(b => b.end));
  // Sequences of the finished video: COMPOSITION sections with a range, kept inside the timeline.
  sections.forEach(section => {
    if (section.scope !== "COMPOSITION" || section.startSeconds === undefined || section.endSeconds === undefined) return;
    blocks.push({ key: `sequence-${section.id}`, lane: "sequences", start: section.startSeconds, end: section.endSeconds, label: section.label, detail: formatTime(section.endSeconds - section.startSeconds), tone: "sequence", sectionId: section.id, editable: true, bounds: { start: 0, end: Math.max(total, section.endSeconds) } });
  });
  return { blocks, total: Math.max(total, ...blocks.map(b => b.end)) };
}
