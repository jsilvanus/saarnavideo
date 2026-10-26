"use client";

import { readChapters } from "@/domain/youtube-chapters";
import { useEffect, useMemo, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useT } from "@/i18n/I18nProvider";
import { SourcePlayer, useSourcePlayer } from "./SourcePlayer";
import { captionKeyAction } from "./CaptionEditorDialog";
import { formatTime, sourceLabel } from "./format";
import type { Source } from "./workspace/types";
import { sectionColor, type Section } from "@/domain/sections";
import { applySectionChange, checkNewSequence, defaultNewRange, moveSequence, neighbourRow, removeWithDescendants, tenth, timelineRows, unplacedRows, type RangePatch, type TimelineRow } from "@/domain/sequence-timeline";
import type { Reframe } from "@/domain/reframe";
import ReframeEditor from "./ReframeEditor";
import type { MessageKey } from "@/i18n/translate";
import styles from "./SequenceTimeline.module.css";

/**
 * Sequences on a timeline under the source video. Click a sequence to select it, drag its
 * left or right edge to change its start or end, click the track to seek. Nested sequences
 * are indented under their parent. Keys: the scheme documented in CaptionEditorDialog.tsx
 * (Ctrl/Shift+arrows seek, Ctrl+Up/Down set start/end to the playhead, Enter selects the next
 * sequence, also one without a range yet). Ctrl+Enter, which creates a caption, has no meaning here.
 *
 * This is the one place sequences are created: name, start, end with "to playhead" buttons (the range defaults
 * to ten seconds from the playhead). A top-level sequence also becomes a clip of the composition (`onAdd`, the same
 * as the old section picker); one made inside another sequence is only a marker inside its parent. A sequence
 * without a range (typed by name on a source of unknown length, or from a template) is listed in a "no range yet"
 * group instead of vanishing; setting its start or end from the playhead gives it a range.
 */
/** What the selected sequence row needs for its reframe (Rajaus) and for moving it to another source. */
export type SequenceExtras = {
  outWidth: number; outHeight: number;
  onSaveReframe: (sectionId: string, reframe: Reframe | undefined) => Promise<void>;
  onChangeSource: (sectionId: string, sourceId: string) => Promise<void> | void;
};

export default function SequenceTimeline({ sources, sections, pendingFiles, extras, onSave, onAdd, onUseChapters }: {
  sources: Source[];
  sections: Section[];
  pendingFiles: Record<string, File>;
  extras: SequenceExtras;
  onSave: (sections: Section[]) => Promise<void>;
  /** Adds a top-level sequence with its clip (the workspace's addSegment). */
  onAdd: (sourceId: string, label: string, start: number, end: number) => Promise<void> | void;
  /** Replaces the source's sequences with its YouTube chapters (the workspace's useYouTubeChapters). */
  onUseChapters: (sourceId: string) => Promise<void> | void;
}) {
  const t = useT();
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const source = sources.find(candidate => candidate.id === sourceId) ?? sources[0];
  if (!source) return null;
  return <div className={styles.wrap}>
    {sources.length > 1 && <label className={styles.sourcePick}>{t("seq.source")}
      <select value={source.id} onChange={e => setSourceId(e.target.value)}>
        {sources.map(item => <option key={item.id} value={item.id}>{sourceLabel(item)}</option>)}
      </select>
    </label>}
    {/* A new source mounts a fresh player and timeline state. */}
    <SourceTimeline key={source.id} source={source} sections={sections} localFile={pendingFiles[source.id]} sources={sources} extras={extras} onSave={onSave} onAdd={onAdd} onUseChapters={onUseChapters} />
  </div>;
}

function SourceTimeline({ source, sections, sources, extras, localFile, onSave, onAdd, onUseChapters }: {
  source: Source; sections: Section[]; sources: Source[]; extras: SequenceExtras; localFile?: File; onSave: (sections: Section[]) => Promise<void>;
  onAdd: (sourceId: string, label: string, start: number, end: number) => Promise<void> | void;
  onUseChapters: (sourceId: string) => Promise<void> | void;
}) {
  const t = useT();
  const chapters = useMemo(() => readChapters(source.chapters), [source.chapters]);
  const sourceSections = sections.filter(section => section.scope === "SOURCE" && section.sourceId === source.id).length;
  function useChapters() {
    // Existing sequences of this source are replaced, so ask first.
    if (sourceSections > 0 && !window.confirm(t("seq.chapters.confirm", { count: sourceSections, chapters: chapters.length }))) return;
    void onUseChapters(source.id);
  }
  const player = useSourcePlayer(source, source.id, localFile, () => undefined);
  const { current, seek } = player;
  const allRows = useMemo(() => timelineRows(sections, source.id), [sections, source.id]);
  // A collapsed sequence hides everything nested in it; the keyboard walks the visible rows only.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const rows = useMemo(() => {
    const hidden = new Set<string>();
    return allRows.filter(row => {
      const parentId = row.section.parentId;
      if (parentId && (collapsed.has(parentId) || hidden.has(parentId))) { hidden.add(row.section.id); return false; }
      return true;
    });
  }, [allRows, collapsed]);
  const toggleCollapsed = (id: string) => setCollapsed(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const pending = useMemo(() => unplacedRows(sections, source.id), [sections, source.id]);
  // Keyboard order: sequences on the timeline, then the ones without a range yet.
  const navRows = useMemo(() => [...rows, ...pending], [rows, pending]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; patch: RangePatch } | null>(null);
  const [note, setNote] = useState("");

  // The track spans the whole source. Without a known duration it spans the sections plus headroom.
  const knownDuration = source.durationMs ? source.durationMs / 1000 : undefined;
  const latestEnd = Math.max(0, ...rows.map(row => row.section.endSeconds ?? 0));
  const span = knownDuration ?? Math.max(60, latestEnd * 1.2);

  const selected = navRows.find(row => row.section.id === selectedId)?.section;
  // Keep the selection on a sequence that still exists on this source.
  useEffect(() => { if (selectedId && !selected) setSelectedId(null); }, [selectedId, selected]);

  function commit(id: string, patch: RangePatch) {
    const result = applySectionChange(sections, id, patch, span);
    if ("error" in result) { setNote(t(`seq.err.${result.error}` as MessageKey)); return; }
    setNote("");
    void onSave(result.sections);
  }

  function timeAt(clientX: number, track: HTMLElement) {
    const rect = track.getBoundingClientRect();
    const seconds = ((clientX - rect.left) / rect.width) * span;
    return tenth(Math.min(span, Math.max(0, seconds)));
  }

  function startDrag(event: ReactPointerEvent<HTMLElement>, row: TimelineRow, edge: "startSeconds" | "endSeconds") {
    event.preventDefault();
    event.stopPropagation();
    const track = (event.currentTarget as HTMLElement).closest<HTMLElement>("[data-track]");
    if (!track) return;
    const id = row.section.id;
    setSelectedId(id);
    let patch: RangePatch = {};
    const onMove = (move: PointerEvent) => {
      patch = { [edge]: timeAt(move.clientX, track) };
      setDrag({ id, patch });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDrag(null);
      if (Object.keys(patch).length) commit(id, patch);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  /** Drags a whole sequence along the track. Its nested sequences come along unless Shift is held. */
  function startMove(event: ReactPointerEvent<HTMLElement>, row: TimelineRow) {
    if ((event.target as HTMLElement).closest("[role=separator]")) return;
    event.preventDefault();
    const track = (event.currentTarget as HTMLElement).closest<HTMLElement>("[data-track]");
    if (!track || row.section.startSeconds === undefined || row.section.endSeconds === undefined) return;
    const { id } = row.section;
    const origin = { start: row.section.startSeconds, end: row.section.endSeconds, x: event.clientX };
    const parent = row.section.parentId ? sections.find(candidate => candidate.id === row.section.parentId) : undefined;
    const lo = parent?.startSeconds ?? 0, hi = Math.min(parent?.endSeconds ?? Infinity, span);
    const width = track.getBoundingClientRect().width || 1;
    let delta = 0;
    setSelectedId(id);
    const onMove = (move: PointerEvent) => {
      delta = tenth(((move.clientX - origin.x) / width) * span);
      const start = tenth(Math.min(Math.max(origin.start + delta, lo), hi - (origin.end - origin.start)));
      setDrag({ id, patch: { startSeconds: start, endSeconds: tenth(start + origin.end - origin.start) } });
    };
    const onUp = (up: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDrag(null);
      if (delta === 0) return;
      const result = moveSequence(sections, id, delta, span, !up.shiftKey);
      if ("error" in result) { setNote(t(`seq.err.${result.error}` as MessageKey)); return; }
      setNote("");
      void onSave(result.sections);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function onTrackClick(event: React.MouseEvent<HTMLElement>) {
    if (event.target !== event.currentTarget) return;
    seek(timeAt(event.clientX, event.currentTarget));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    // Text fields keep their own keys (the rename box, the time boxes are numbers and stay active).
    if (target !== event.currentTarget && (target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && target.type === "text"))) return;
    if (event.altKey || event.metaKey) return;
    const action = captionKeyAction(event.key, { ctrl: event.ctrlKey, shift: event.shiftKey, inText: true });
    if (!action || action.type === "newAfter") return;
    event.preventDefault();
    if (action.type === "seek") seek(Math.min(span, Math.max(0, current + action.seconds)));
    else if (action.type === "setStart" && selected) commit(selected.id, { startSeconds: tenth(current) });
    else if (action.type === "setEnd" && selected) commit(selected.id, { endSeconds: tenth(current) });
    else if (action.type === "next") {
      const next = neighbourRow(navRows, selectedId, 1);
      if (next) setSelectedId(next.section.id);
    } else if (!selected) setNote(t("seq.selectHint"));
  }

  // New sequence: untouched start/end follow the playhead (ten seconds from it), set or typed ones stay.
  const [newLabel, setNewLabel] = useState("");
  const [newParentId, setNewParentId] = useState("");
  const [newStart, setNewStart] = useState<number | null>(null);
  const [newEnd, setNewEnd] = useState<number | null>(null);
  const newParent = newParentId ? sections.find(section => section.id === newParentId) : undefined;
  const suggestion = defaultNewRange(newStart ?? current, { durationSeconds: knownDuration, parent: newParent });
  const startValue = newStart ?? suggestion.start;
  const endValue = newEnd ?? suggestion.end;
  const parentChoices = allRows.map(row => ({ ...row.section, label: `${"\u2003".repeat(row.depth)}${row.section.label}` }));

  async function addSequence() {
    const label = newLabel.trim() || t("seq.new.defaultName");
    const check = checkNewSequence(sections, { label, start: startValue, end: endValue, parentId: newParentId || undefined }, knownDuration);
    if ("error" in check) { setNote(t(`seq.err.${check.error}` as MessageKey)); return; }
    setNote("");
    if (newParentId) {
      const nested: Section = { id: crypto.randomUUID(), label: check.label, scope: "SOURCE", sourceId: source.id, parentId: newParentId, startSeconds: check.start, endSeconds: check.end, origin: "MANUAL" };
      await onSave([...sections, nested]);
      setSelectedId(nested.id);
    } else {
      await onAdd(source.id, check.label, check.start, check.end);
    }
    setNewLabel(""); setNewStart(null); setNewEnd(null);
  }

  const parent = selected?.parentId ? sections.find(section => section.id === selected.parentId) : undefined;
  const playheadPct = Math.min(100, (current / span) * 100);

  return <div className={styles.timeline}>
    <SourcePlayer source={source} player={player} localFile={localFile} remoteSrc={`/api/sources/${source.id}`} onDuration={() => undefined} />
    <p className={`muted ${styles.hint}`}>{t("seq.hint")}</p>
    <p className={`muted ${styles.hint}`}>{t("seq.keys")}</p>
    {!knownDuration && <p className="muted">{t("seq.noDuration")}</p>}
    {source.type === "YOUTUBE" && <div className={styles.chapters}>
      <span className="muted">{chapters.length ? t("seq.chapters.found", { count: chapters.length }) : t(source.storagePath ? "seq.chapters.none" : "seq.chapters.afterDownload")}</span>
      <button type="button" disabled={chapters.length === 0} onClick={useChapters}>{t("seq.chapters.use")}</button>
    </div>}
    <form className={styles.creator} aria-label={t("seq.new.title")} onSubmit={event => { event.preventDefault(); void addSequence(); }}>
      <label>{t("seq.name")}
        <input type="text" value={newLabel} placeholder={t("seq.new.defaultName")} onChange={e => setNewLabel(e.target.value)} />
      </label>
      {parentChoices.length > 0 && <label>{t("seq.new.level")}
        <select value={newParentId} onChange={e => { setNewParentId(e.target.value); setNewStart(null); setNewEnd(null); }}>
          <option value="">{t("sec.topLevel")}</option>
          {parentChoices.map(choice => <option key={choice.id} value={choice.id}>{t("sec.inside", { label: choice.label })}</option>)}
        </select>
      </label>}
      <label>{t("seq.start")}
        <input type="number" step="0.1" min="0" value={startValue} onChange={e => setNewStart(Number(e.target.value))} />
      </label>
      <button type="button" onClick={() => setNewStart(tenth(current))}>{t("seq.startToPlayhead")}</button>
      <label>{t("seq.end")}
        <input type="number" step="0.1" min="0" value={endValue} onChange={e => setNewEnd(Number(e.target.value))} />
      </label>
      <button type="button" onClick={() => setNewEnd(tenth(current))}>{t("seq.endToPlayhead")}</button>
      <button type="submit" className="primary">{t("seq.new.add", { start: formatTime(startValue), end: formatTime(endValue) })}</button>
    </form>
    <div className={styles.board} tabIndex={0} onKeyDown={onKeyDown} aria-label={t("seq.board")}>
      {rows.length === 0 && pending.length === 0 && <p className="muted">{t("seq.empty")}</p>}
      {rows.map(row => {
        const shown = drag && drag.id === row.section.id ? { ...row.section, ...drag.patch } : row.section;
        const start = shown.startSeconds ?? 0;
        const end = shown.endSeconds ?? start;
        const color = sectionColor(sections, row.section);
        const isSelected = row.section.id === selectedId;
        return <div key={row.section.id} className={`${styles.lane}${row.depth ? ` ${styles.nested}` : ""}`}>
          <span className={styles.laneHead} style={{ paddingLeft: 4 + row.depth * 18 }}>
            {sections.some(child => child.parentId === row.section.id)
              ? <button type="button" className={styles.fold} aria-expanded={!collapsed.has(row.section.id)} aria-label={t(collapsed.has(row.section.id) ? "seq.expand" : "seq.collapse")} onClick={() => toggleCollapsed(row.section.id)}>{collapsed.has(row.section.id) ? "▸" : "▾"}</button>
              : <span className={styles.fold} aria-hidden="true" />}
            <button type="button" className={`${styles.laneLabel}${isSelected ? ` ${styles.laneSelected}` : ""}`} onClick={() => setSelectedId(row.section.id)}>
              {row.depth ? "↳ " : ""}{row.section.label}
            </button>
          </span>
          <div className={styles.track} data-track onClick={onTrackClick}>
            <div
              className={`${styles.bar}${row.depth ? ` ${styles.barNested}` : ""}${isSelected ? ` ${styles.barSelected}` : ""}`}
              style={{ left: `${(start / span) * 100}%`, width: `${Math.max(0.5, ((end - start) / span) * 100)}%`, background: color, borderColor: color }}
              onClick={() => setSelectedId(row.section.id)}
              onPointerDown={event => startMove(event, row)}
              title={`${row.section.label} · ${formatTime(start)} → ${formatTime(end)}`}
            >
              <span className={`${styles.handle} ${styles.handleStart}`} role="separator" aria-label={t("seq.start")} onPointerDown={event => startDrag(event, row, "startSeconds")} />
              <span className={styles.barText}>{formatTime(start)} → {formatTime(end)}</span>
              <span className={`${styles.handle} ${styles.handleEnd}`} role="separator" aria-label={t("seq.end")} onPointerDown={event => startDrag(event, row, "endSeconds")} />
            </div>
            <div className={styles.playhead} style={{ left: `${playheadPct}%` }} />
          </div>
        </div>;
      })}
      {pending.length > 0 && <p className={`muted ${styles.pendingHeading}`}>{t("seq.unplaced", { count: pending.length })}</p>}
      {pending.map(row => <div key={row.section.id} className={`${styles.lane}${row.depth ? ` ${styles.nested}` : ""}`}>
        <button type="button" className={`${styles.laneLabel}${row.section.id === selectedId ? ` ${styles.laneSelected}` : ""}`} style={{ paddingLeft: 8 + row.depth * 18 }} onClick={() => setSelectedId(row.section.id)}>
          {row.depth ? "↳ " : ""}{row.section.label}
        </button>
        <div className={`${styles.track} ${styles.noRange}`} onClick={() => setSelectedId(row.section.id)}>{t("seq.noRange")}</div>
      </div>)}
    </div>
    {note && <p className="error" role="status">{note}</p>}
    {selected && <SelectedSequence
      key={`${selected.id}:${selected.label}:${selected.startSeconds}:${selected.endSeconds}:${selected.color ?? ""}`}
      section={selected}
      parentLabel={parent?.label}
      colour={sectionColor(sections, selected)}
      current={current}
      source={source}
      sources={sources}
      extras={extras}
      hasChildren={sections.some(child => child.parentId === selected.id)}
      onCommit={patch => commit(selected.id, patch)}
      onRemove={() => { if (sections.some(child => child.parentId === selected.id) && !window.confirm(t("seq.remove.confirm", { label: selected.label }))) return; setSelectedId(null); void onSave(removeWithDescendants(sections, selected.id)); }}
    />}
  </div>;
}

function SelectedSequence({ section, parentLabel, colour, current, source, sources, extras, hasChildren, onCommit, onRemove }: {
  section: Section; parentLabel?: string; colour: string; current: number; source: Source; sources: Source[]; extras: SequenceExtras; hasChildren: boolean;
  onCommit: (patch: RangePatch) => void; onRemove: () => void;
}) {
  const t = useT();
  const [label, setLabel] = useState(section.label);
  // Empty for a sequence without a range: an empty box must not be saved as 0.
  const [start, setStart] = useState(section.startSeconds === undefined ? "" : String(section.startSeconds));
  const [end, setEnd] = useState(section.endSeconds === undefined ? "" : String(section.endSeconds));
  return <div className={styles.editor}>
    {parentLabel && <span className={`muted ${styles.inside}`}>{t("seq.inside", { label: parentLabel })}</span>}
    <label>{t("seq.name")}
      <input type="text" value={label} onChange={e => setLabel(e.target.value)}
        onBlur={() => { if (label.trim() && label.trim() !== section.label) onCommit({ label }); else setLabel(section.label); }}
        onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} />
    </label>
    <label>{t("seq.color")}
      <input type="color" value={colour} onChange={e => onCommit({ color: e.target.value })} />
    </label>
    <label>{t("seq.start")}
      <input type="number" step="0.1" min="0" value={start} onChange={e => setStart(e.target.value)}
        onBlur={() => { if (start !== "" && Number(start) !== section.startSeconds) onCommit({ startSeconds: Number(start) }); }} />
    </label>
    <button type="button" onClick={() => onCommit({ startSeconds: tenth(current) })}>{t("seq.startToPlayhead")}</button>
    <label>{t("seq.end")}
      <input type="number" step="0.1" min="0" value={end} onChange={e => setEnd(e.target.value)}
        onBlur={() => { if (end !== "" && Number(end) !== section.endSeconds) onCommit({ endSeconds: Number(end) }); }} />
    </label>
    <button type="button" onClick={() => onCommit({ endSeconds: tenth(current) })}>{t("seq.endToPlayhead")}</button>
    {section.startSeconds !== undefined && (
      <span className={styles.reframe}>
        <span className="muted">{t("seq.reframe")}</span>
        <ReframeEditor
          title={t("str.sectionReframe", { label: section.label })}
          current={section.reframe}
          defaultLabel={t("str.projectDefault")}
          source={source}
          atSeconds={section.startSeconds}
          outWidth={extras.outWidth}
          outHeight={extras.outHeight}
          onSave={reframe => extras.onSaveReframe(section.id, reframe)}
        />
      </span>
    )}
    {!section.parentId && sources.length > 1 && (
      <label>{t("sec.source")}
        <select value={section.sourceId ?? ""} onChange={e => void extras.onChangeSource(section.id, e.target.value)}>
          {sources.map(item => <option key={item.id} value={item.id}>{sourceLabel(item)}</option>)}
        </select>
      </label>
    )}
    <button type="button" onClick={onRemove} title={hasChildren ? t("seq.remove.withChildren") : undefined}>{t("common.remove")}</button>
  </div>;
}
