"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useT } from "@/i18n/I18nProvider";
import { SourcePlayer, type SourcePlayerState } from "./SourcePlayer";
import { formatTime } from "./format";
import styles from "./CaptionEditorDialog.module.css";

/*
 * Keyboard scheme for time-based editing. The caption editor uses it now; the
 * sequence timeline (drag a sequence's start and end under the video) uses the same
 * keys, so one player behaves the same everywhere:
 *   Ctrl+Left / Ctrl+Right   back / forward 10 s
 *   Shift+Left / Shift+Right back / forward 3 s (Shift wins over Ctrl)
 *   Ctrl+Down                set the end of the current item to the playhead
 *   Ctrl+Up                  set the start of the current item to the playhead
 *   Enter (in a text field)  next item, or a new one after the last
 *   Shift+Enter              new line inside the text
 *   Ctrl+Enter               new item right after the current one
 * Plain arrows keep their normal meaning, so typing and text selection still work.
 * The sequence timeline (SequenceTimeline.tsx) uses the same keys: there Enter selects the
 * next sequence and Ctrl+Enter does nothing. Keep this table and captionKeyAction in step
 * when the scheme changes.
 */
export type CaptionKeyAction =
  | { type: "seek"; seconds: number }
  | { type: "setStart" }
  | { type: "setEnd" }
  | { type: "next" }
  | { type: "newAfter" };

export function captionKeyAction(key: string, mods: { ctrl: boolean; shift: boolean; inText: boolean }): CaptionKeyAction | null {
  if (key === "ArrowLeft" || key === "ArrowRight") {
    if (!mods.ctrl && !mods.shift) return null;
    const step = mods.shift ? 3 : 10;
    return { type: "seek", seconds: key === "ArrowRight" ? step : -step };
  }
  if (mods.ctrl && key === "ArrowDown") return { type: "setEnd" };
  if (mods.ctrl && key === "ArrowUp") return { type: "setStart" };
  if (key === "Enter" && mods.inText) {
    if (mods.ctrl) return { type: "newAfter" };
    if (mods.shift) return null;
    return { type: "next" };
  }
  return null;
}

export type CaptionSegment = { id: string; startSeconds: number; endSeconds: number; text: string };
type Source = Parameters<typeof SourcePlayer>[0]["source"];

export function isWithinSegment(current: number, segment: { startSeconds: number; endSeconds: number }) {
  return current >= segment.startSeconds && current < segment.endSeconds;
}

/** Seconds rounded to a tenth, as the caption editor stores them. */
const tenth = (n: number) => Math.round(n * 10) / 10;

export default function CaptionEditorDialog({ source, player, localFile, remoteSrc, segments, onSave, onDelete, onCreate }: {
  source: Source; player: SourcePlayerState; localFile?: File; remoteSrc: string;
  /** Captions sorted by start time. */
  segments: CaptionSegment[];
  onSave: (id: string, patch: Partial<Pick<CaptionSegment, "text" | "startSeconds" | "endSeconds">>) => void;
  onDelete: (id: string) => void;
  /** Creates a caption and resolves to its id, or null when the request failed. */
  onCreate: (startSeconds: number, endSeconds: number, text: string) => Promise<string | null>;
}) {
  const t = useT();
  const { current, seek } = player;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const textRefs = useRef(new Map<string, HTMLTextAreaElement>());

  const active = segments.find(s => s.id === activeId) ?? segments.find(s => isWithinSegment(current, s));

  // After a keyboard jump or a new caption, move focus to that caption's text.
  useEffect(() => {
    if (!focusId) return;
    const el = textRefs.current.get(focusId);
    if (el) { el.focus(); setFocusId(null); }
  }, [focusId, segments]);

  function setEdge(edge: "start" | "end") {
    if (!active) { setNote(t("tr.noActiveCaption")); return; }
    const playhead = tenth(current);
    if (edge === "end" && playhead <= active.startSeconds) { setNote(t("tr.endAfterStart")); return; }
    if (edge === "start" && playhead >= active.endSeconds) { setNote(t("tr.endAfterStart")); return; }
    setNote("");
    onSave(active.id, edge === "end" ? { endSeconds: playhead } : { startSeconds: playhead });
  }

  async function createAfterActive() {
    // Start after the active caption, or at the playhead when it is already past that caption.
    const start = tenth(active ? Math.max(active.endSeconds, current) : current);
    const id = await onCreate(start, tenth(start + 2), "");
    if (id) { setActiveId(id); setFocusId(id); }
  }

  function nextOrCreate() {
    const index = active ? segments.findIndex(s => s.id === active.id) : -1;
    const next = index >= 0 ? segments[index + 1] : undefined;
    if (next) { setActiveId(next.id); setFocusId(next.id); return; }
    void createAfterActive();
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.altKey || e.metaKey) return;
    const action = captionKeyAction(e.key, { ctrl: e.ctrlKey, shift: e.shiftKey, inText: e.target instanceof HTMLTextAreaElement });
    if (!action) return;
    e.preventDefault();
    if (action.type === "seek") seek(Math.max(0, current + action.seconds));
    else if (action.type === "setStart") setEdge("start");
    else if (action.type === "setEnd") setEdge("end");
    else if (action.type === "next") nextOrCreate();
    else void createAfterActive();
  }

  return <div className={styles.editor} onKeyDown={onKeyDown}>
    <p className={`muted ${styles.help}`}>{t("tr.captionsHelp")}</p>
    <div className={styles.player}>
      <SourcePlayer source={source} player={player} localFile={localFile} remoteSrc={remoteSrc} onDuration={() => undefined}>
        <button type="button" onClick={() => void createAfterActive()}>＋ {t("tr.newCaption")}</button>
      </SourcePlayer>
    </div>
    {note && <p className="error" role="status">{note}</p>}
    <div className={styles.list}>
      {segments.map(seg => <CaptionRow
        key={seg.id}
        segment={seg}
        active={active?.id === seg.id}
        current={current}
        registerText={el => { if (el) textRefs.current.set(seg.id, el); else textRefs.current.delete(seg.id); }}
        onFocus={() => setActiveId(seg.id)}
        onSeek={seek}
        onSave={onSave}
        onDelete={onDelete}
      />)}
      {!segments.length && <p className="muted">{t("tr.noLines")}</p>}
    </div>
  </div>;
}

function CaptionRow({ segment, active, current, registerText, onFocus, onSeek, onSave, onDelete }: {
  segment: CaptionSegment; active: boolean; current: number;
  registerText: (el: HTMLTextAreaElement | null) => void;
  onFocus: () => void; onSeek: (seconds: number) => void;
  onSave: (id: string, patch: Partial<Pick<CaptionSegment, "text" | "startSeconds" | "endSeconds">>) => void;
  onDelete: (id: string) => void;
}) {
  const t = useT();
  const [text, setText] = useState(segment.text);
  const [start, setStart] = useState(segment.startSeconds);
  const [end, setEnd] = useState(segment.endSeconds);
  // Keep the inputs in step with the stored caption (keyboard edits and reloads change it).
  useEffect(() => { setText(segment.text); setStart(segment.startSeconds); setEnd(segment.endSeconds); }, [segment.id, segment.text, segment.startSeconds, segment.endSeconds]);
  const playing = isWithinSegment(current, segment);
  return <div className={`${styles.row}${active ? ` ${styles.active}` : ""}${playing ? ` ${styles.playing}` : ""}`} onFocus={onFocus}>
    <button type="button" className={styles.seek} onClick={() => onSeek(segment.startSeconds)} title={t("tr.jump")}>▶ {formatTime(segment.startSeconds)}</button>
    <input aria-label={t("tr.start")} type="number" min="0" step=".1" value={start} onChange={e => setStart(Number(e.target.value))}
      onBlur={() => { if (!(end > start)) { setStart(segment.startSeconds); return; } if (start !== segment.startSeconds) onSave(segment.id, { startSeconds: start }); }} />
    <input aria-label={t("tr.end")} type="number" min="0" step=".1" value={end} onChange={e => setEnd(Number(e.target.value))}
      onBlur={() => { if (!(end > start)) { setEnd(segment.endSeconds); return; } if (end !== segment.endSeconds) onSave(segment.id, { endSeconds: end }); }} />
    <textarea ref={registerText} rows={2} aria-label={t("tr.captionText")} value={text} onChange={e => setText(e.target.value)}
      onBlur={() => { if (text !== segment.text) onSave(segment.id, { text }); }} />
    <button type="button" className={styles.delete} aria-label={t("tr.deleteLine")} onClick={() => onDelete(segment.id)}>🗑</button>
  </div>;
}
