"use client";

import { useEffect, useMemo, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useT } from "@/i18n/I18nProvider";
import { SourcePlayer, useSourcePlayer } from "./SourcePlayer";
import { captionKeyAction } from "./CaptionEditorDialog";
import { formatTime, sourceLabel } from "./format";
import type { Source } from "./workspace/types";
import { sectionColor, type Section } from "@/domain/sections";
import { applySectionChange, neighbourRow, tenth, timelineRows, type RangePatch, type TimelineRow } from "@/domain/sequence-timeline";
import type { MessageKey } from "@/i18n/translate";
import styles from "./SequenceTimeline.module.css";

/**
 * Sequences on a timeline under the source video. Click a sequence to select it, drag its
 * left or right edge to change its start or end, click the track to seek. Nested sequences
 * are indented under their parent. Keys: the scheme documented in CaptionEditorDialog.tsx
 * (Ctrl/Shift+arrows seek, Ctrl+Up/Down set start/end to the playhead, Enter selects the next
 * sequence). Ctrl+Enter, which creates a caption, has no meaning here.
 */
export default function SequenceTimeline({ sources, sections, pendingFiles, onSave }: {
  sources: Source[];
  sections: Section[];
  pendingFiles: Record<string, File>;
  onSave: (sections: Section[]) => Promise<void>;
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
    <SourceTimeline key={source.id} source={source} sections={sections} localFile={pendingFiles[source.id]} onSave={onSave} />
  </div>;
}

function SourceTimeline({ source, sections, localFile, onSave }: {
  source: Source; sections: Section[]; localFile?: File; onSave: (sections: Section[]) => Promise<void>;
}) {
  const t = useT();
  const player = useSourcePlayer(source, source.id, localFile, () => undefined);
  const { current, seek } = player;
  const rows = useMemo(() => timelineRows(sections, source.id), [sections, source.id]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; patch: RangePatch } | null>(null);
  const [note, setNote] = useState("");

  // The track spans the whole source. Without a known duration it spans the sections plus headroom.
  const knownDuration = source.durationMs ? source.durationMs / 1000 : undefined;
  const latestEnd = Math.max(0, ...rows.map(row => row.section.endSeconds ?? 0));
  const span = knownDuration ?? Math.max(60, latestEnd * 1.2);

  const selected = rows.find(row => row.section.id === selectedId)?.section;
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
      const next = neighbourRow(rows, selectedId, 1);
      if (next) setSelectedId(next.section.id);
    } else if (!selected) setNote(t("seq.selectHint"));
  }

  const unplaced = sections.filter(section => section.scope === "SOURCE" && section.sourceId === source.id && (section.startSeconds === undefined || section.endSeconds === undefined)).length;
  const parent = selected?.parentId ? sections.find(section => section.id === selected.parentId) : undefined;
  const playheadPct = Math.min(100, (current / span) * 100);

  return <div className={styles.timeline}>
    <SourcePlayer source={source} player={player} localFile={localFile} remoteSrc={`/api/sources/${source.id}`} onDuration={() => undefined} />
    <p className={`muted ${styles.hint}`}>{t("seq.hint")}</p>
    <p className={`muted ${styles.hint}`}>{t("seq.keys")}</p>
    {!knownDuration && <p className="muted">{t("seq.noDuration")}</p>}
    <div className={styles.board} tabIndex={0} onKeyDown={onKeyDown} aria-label={t("seq.board")}>
      {rows.length === 0 && <p className="muted">{t("seq.empty")}</p>}
      {rows.map(row => {
        const shown = drag && drag.id === row.section.id ? { ...row.section, ...drag.patch } : row.section;
        const start = shown.startSeconds ?? 0;
        const end = shown.endSeconds ?? start;
        const color = sectionColor(sections, row.section);
        const isSelected = row.section.id === selectedId;
        return <div key={row.section.id} className={`${styles.lane}${row.depth ? ` ${styles.nested}` : ""}`}>
          <button type="button" className={`${styles.laneLabel}${isSelected ? ` ${styles.laneSelected}` : ""}`} style={{ paddingLeft: 8 + row.depth * 18 }} onClick={() => setSelectedId(row.section.id)}>
            {row.depth ? "↳ " : ""}{row.section.label}
          </button>
          <div className={styles.track} data-track onClick={onTrackClick}>
            <div
              className={`${styles.bar}${row.depth ? ` ${styles.barNested}` : ""}${isSelected ? ` ${styles.barSelected}` : ""}`}
              style={{ left: `${(start / span) * 100}%`, width: `${Math.max(0.5, ((end - start) / span) * 100)}%`, background: color, borderColor: color }}
              onClick={() => setSelectedId(row.section.id)}
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
    </div>
    {unplaced > 0 && <p className="muted">{t("seq.unplaced", { count: unplaced })}</p>}
    {note && <p className="error" role="status">{note}</p>}
    {selected && <SelectedSequence
      key={`${selected.id}:${selected.label}:${selected.startSeconds}:${selected.endSeconds}:${selected.color ?? ""}`}
      section={selected}
      parentLabel={parent?.label}
      colour={sectionColor(sections, selected)}
      current={current}
      onCommit={patch => commit(selected.id, patch)}
    />}
  </div>;
}

function SelectedSequence({ section, parentLabel, colour, current, onCommit }: {
  section: Section; parentLabel?: string; colour: string; current: number; onCommit: (patch: RangePatch) => void;
}) {
  const t = useT();
  const [label, setLabel] = useState(section.label);
  const [start, setStart] = useState(String(section.startSeconds ?? 0));
  const [end, setEnd] = useState(String(section.endSeconds ?? 0));
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
        onBlur={() => { if (Number(start) !== section.startSeconds) onCommit({ startSeconds: Number(start) }); }} />
    </label>
    <button type="button" onClick={() => onCommit({ startSeconds: tenth(current) })}>{t("seq.startToPlayhead")}</button>
    <label>{t("seq.end")}
      <input type="number" step="0.1" min="0" value={end} onChange={e => setEnd(e.target.value)}
        onBlur={() => { if (Number(end) !== section.endSeconds) onCommit({ endSeconds: Number(end) }); }} />
    </label>
    <button type="button" onClick={() => onCommit({ endSeconds: tenth(current) })}>{t("seq.endToPlayhead")}</button>
  </div>;
}
