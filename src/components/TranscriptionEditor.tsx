"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/i18n/I18nProvider";
import { errorMessage, jsonInit, requestJson } from "./api";
import { formatTime, sourceLabel } from "./format";
import { SourcePlayer, useSourcePlayer } from "./SourcePlayer";

type Source = { id: string; type: "UPLOAD" | "YOUTUBE"; status?: "PENDING" | "AVAILABLE"; originalName?: string | null; youtubeUrl?: string | null; youtubeVideoId?: string | null; durationMs?: number | null; referenceDurationMs?: number | null };
type Job = { id: string; type?: string | null; sourceId?: string | null; status: string; progress: number; phase?: string | null; etaSeconds?: number | null; currentMs?: string | number | null; totalMs?: string | number | null; error?: string | null };
type TranscriptSegment = { id: string; sourceId: string; runId?: string | null; isActive?: boolean; startSeconds: number; endSeconds: number; text: string; confidence?: number | null; createdAt?: string; updatedAt?: string };
type PendingRun = { id: string; origin: "SERVICE" | "UPLOAD" | "MANUAL"; language: string; rangeStartSeconds: number; rangeEndSeconds: number; status: "PENDING"; createdAt: string; error?: string | null; segments: TranscriptSegment[] };
type CaptionsResponse = { active: TranscriptSegment[]; pendingRuns: PendingRun[] };
type ApplyStrategy = "replace_overlap" | "append";

type Props = {
  projectId: string;
  sources: Source[];
  pendingFiles?: Record<string, File>;
  jobs?: Job[];
  onProjectRefresh?: () => void;
  /** Sections of the project (source scope); those with a source and a time range can be picked as the plain-text range. */
  sections?: Array<{ id: string; label: string; scope?: string; sourceId?: string; startSeconds?: number; endSeconds?: number }>;
};

/** URL of the plain-text/HTML transcript route. Empty start/end mean the whole recording. */
export function transcriptTextUrl(sourceId: string, extension: "txt" | "html", range: { start?: number | ""; end?: number | ""; title?: string } = {}) {
  const params = new URLSearchParams();
  if (range.start !== undefined && range.start !== "" && range.start > 0) params.set("start", String(range.start));
  if (range.end !== undefined && range.end !== "") params.set("end", String(range.end));
  if (range.title?.trim()) params.set("title", range.title.trim());
  const query = params.toString();
  return `/api/sources/${encodeURIComponent(sourceId)}/transcript.${extension}${query ? `?${query}` : ""}`;
}

const TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

export default function TranscriptionEditor({ projectId, sources, pendingFiles = {}, jobs = [], onProjectRefresh, sections = [] }: Props) {
  const t = useT();
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [mode, setMode] = useState<"whole" | "range">("whole");
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(60);
  const [language, setLanguage] = useState("fi");
  const [startBusy, setStartBusy] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [vttFile, setVttFile] = useState<File | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [captions, setCaptions] = useState<CaptionsResponse | null>(null);
  const [captionsLoading, setCaptionsLoading] = useState(false);
  const [applyBusyId, setApplyBusyId] = useState<string | null>(null);
  const [runErrors, setRunErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [newStart, setNewStart] = useState(0);
  const [newEnd, setNewEnd] = useState(2);
  const [newText, setNewText] = useState("");
  const [textStart, setTextStart] = useState<number | "">(0);
  const [textEnd, setTextEnd] = useState<number | "">("");
  const [textTitle, setTextTitle] = useState("");
  const [textSectionId, setTextSectionId] = useState("");
  const [textPreview, setTextPreview] = useState("");
  const [textStatus, setTextStatus] = useState("");

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const source = sources.find(s => s.id === sourceId) || sources[0];

  useEffect(() => { if (sources.length && !sources.some(s => s.id === sourceId)) setSourceId(sources[0].id); }, [sources, sourceId]);

  const localFile = source ? pendingFiles[source.id] : undefined;
  const player = useSourcePlayer(source, sourceId, localFile, () => { setRangeStart(0); setRangeEnd(60); });
  const { current, seek } = player;

  function stopPolling() { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } }
  function startPolling(jobId: string) { stopPolling(); pollRef.current = setInterval(() => { void pollJob(jobId); }, 2000); }
  useEffect(() => () => stopPolling(), []);

  async function pollJob(jobId: string) {
    try {
      const r = await fetch(`/api/projects/${projectId}/jobs/${jobId}`, { cache: "no-store" });
      if (!r.ok) return;
      const data = await r.json() as Job;
      setJob(data);
      if (TERMINAL_STATUSES.has(data.status)) {
        stopPolling();
        if (data.status === "COMPLETED") { setMessage(t("tr.finished")); await loadCaptions(); }
        else if (data.status === "FAILED") { setError(data.error || t("tr.failed")); }
        else { setMessage(t("tr.cancelled")); }
        onProjectRefresh?.();
      }
    } catch { /* transient poll failure, try again next tick */ }
  }

  // Pick up a job that was already running against this source (e.g. after a page reload).
  useEffect(() => {
    const existing = jobs.find(j => j.type === "TRANSCRIBE" && j.sourceId === source?.id && (j.status === "QUEUED" || j.status === "RUNNING"));
    if (existing) { setJob(existing); startPolling(existing.id); } else { setJob(null); stopPolling(); }
    // Intentionally only re-run when the selected source changes, not on every `jobs` prop update,
    // so the live-polled job state below isn't clobbered by a stale project reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.id]);

  async function loadCaptions() {
    if (!source) { setCaptions(null); return; }
    setCaptionsLoading(true);
    try {
      const r = await fetch(`/api/sources/${source.id}/captions`, { cache: "no-store" });
      if (!r.ok) { setCaptions({ active: [], pendingRuns: [] }); return; }
      setCaptions(await r.json() as CaptionsResponse);
    } catch { setCaptions({ active: [], pendingRuns: [] }); }
    finally { setCaptionsLoading(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when another source is selected
  useEffect(() => { void loadCaptions(); }, [source?.id]);

  async function startTranscription() {
    if (!source) return;
    setError(""); setMessage(""); setStartBusy(true);
    try {
      const body: { language: string; rangeStartSeconds?: number; rangeEndSeconds?: number } = { language };
      if (mode === "range") {
        if (!(rangeEnd > rangeStart)) throw new Error(t("tr.endAfterStart"));
        body.rangeStartSeconds = rangeStart; body.rangeEndSeconds = rangeEnd;
      }
      const data = await requestJson<{ id?: string; status?: string; progress?: number }>(`/api/projects/${projectId}/source/${source.id}/transcription-jobs`, jsonInit("POST", body), t("tr.startFailed"));
      if (!data.id) throw new Error(data.error ?? t("tr.startFailed"));
      setJob({ id: data.id, type: "TRANSCRIBE", sourceId: source.id, status: data.status ?? "QUEUED", progress: data.progress ?? 0 });
      startPolling(data.id);
      setMessage(t("tr.queued"));
    } catch (e) { setError(errorMessage(e, t("tr.startFailed"))); }
    finally { setStartBusy(false); }
  }

  async function abortJob() {
    if (!job) return;
    setError("");
    try {
      await requestJson(`/api/projects/${projectId}/jobs/${job.id}/cancel`, { method: "POST" }, t("tr.cancelFailed"));
      setMessage(t("tr.cancelRequested"));
    } catch (e) { setError(errorMessage(e, t("tr.cancelFailed"))); }
  }

  async function uploadVtt() {
    if (!source || !vttFile) return;
    setError(""); setMessage(""); setUploadBusy(true);
    try {
      const form = new FormData();
      form.set("file", vttFile);
      form.set("language", language);
      if (mode === "range") {
        if (!(rangeEnd > rangeStart)) throw new Error(t("tr.endAfterStart"));
        form.set("rangeStartSeconds", String(rangeStart));
        form.set("rangeEndSeconds", String(rangeEnd));
      }
      await requestJson(`/api/sources/${source.id}/transcription-runs/upload`, { method: "POST", body: form }, t("tr.vttFailed"));
      setVttFile(null);
      setMessage(t("tr.imported"));
      await loadCaptions();
    } catch (e) { setError(errorMessage(e, t("tr.vttFailed"))); }
    finally { setUploadBusy(false); }
  }

  async function applyRun(runId: string, strategy: ApplyStrategy) {
    if (!source) return;
    setApplyBusyId(runId); setRunErrors(prev => ({ ...prev, [runId]: "" })); setError("");
    try {
      const r = await fetch(`/api/sources/${source.id}/transcription-runs/${runId}/apply`, jsonInit("POST", { strategy }));
      const data = await r.json().catch(() => ({})) as { active?: TranscriptSegment[]; error?: string; conflicts?: string[] };
      if (r.status === 409) {
        setRunErrors(prev => ({ ...prev, [runId]: t("tr.blocked", { count: data.conflicts?.length ?? t("tr.blockedExisting") }) }));
        return;
      }
      if (!r.ok) throw new Error(data.error ?? t("tr.applyFailed"));
      setMessage(t("tr.applied"));
      await loadCaptions();
    } catch (e) { setRunErrors(prev => ({ ...prev, [runId]: errorMessage(e, t("tr.applyFailed")) })); }
    finally { setApplyBusyId(null); }
  }

  async function discardRun(runId: string) {
    if (!source) return;
    setApplyBusyId(runId); setRunErrors(prev => ({ ...prev, [runId]: "" })); setError("");
    try {
      await requestJson(`/api/sources/${source.id}/transcription-runs/${runId}/discard`, { method: "POST" }, t("tr.discardFailed"));
      setMessage(t("tr.discarded"));
      await loadCaptions();
    } catch (e) { setRunErrors(prev => ({ ...prev, [runId]: errorMessage(e, t("tr.discardFailed")) })); }
    finally { setApplyBusyId(null); }
  }

  async function saveSegment(id: string, patch: Partial<Pick<TranscriptSegment, "text" | "startSeconds" | "endSeconds">>) {
    setError("");
    try {
      const data = await requestJson<Partial<TranscriptSegment>>(`/api/transcript-segments/${id}`, jsonInit("PATCH", patch), t("tr.saveLineFailed"));
      setCaptions(prev => prev ? { ...prev, active: prev.active.map(s => s.id === id ? { ...s, ...data } : s) } : prev);
    } catch (e) { setError(errorMessage(e, t("tr.saveLineFailed"))); }
  }

  async function deleteSegment(id: string) {
    setError("");
    try {
      await requestJson(`/api/transcript-segments/${id}`, { method: "DELETE" }, t("tr.deleteLineFailed"));
      setCaptions(prev => prev ? { ...prev, active: prev.active.filter(s => s.id !== id) } : prev);
    } catch (e) { setError(errorMessage(e, t("tr.deleteLineFailed"))); }
  }

  async function addSegment() {
    if (!source) return;
    if (!(newEnd > newStart)) { setError(t("tr.endAfterStart")); return; }
    setError("");
    try {
      await requestJson(`/api/sources/${source.id}/transcript-segments`, jsonInit("POST", { startSeconds: newStart, endSeconds: newEnd, text: newText }), t("tr.addLineFailed"));
      setNewText(""); setMessage(t("tr.lineAdded"));
      await loadCaptions();
    } catch (e) { setError(errorMessage(e, t("tr.addLineFailed"))); }
  }

  // Plain-text export: the range defaults to the whole recording and follows the source.
  useEffect(() => { setTextStart(0); setTextEnd(source?.durationMs != null ? Math.round(source.durationMs / 100) / 10 : ""); setTextSectionId(""); }, [source?.id, source?.durationMs]);
  const textRangeError = textStart !== "" && textEnd !== "" && !(textEnd > textStart) ? t("tr.endAfterStart") : "";
  useEffect(() => {
    if (!source || textRangeError) { setTextPreview(""); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(transcriptTextUrl(source.id, "txt", { start: textStart, end: textEnd }), { cache: "no-store", signal: controller.signal })
        .then(r => r.ok ? r.text() : Promise.reject(new Error("preview failed")))
        .then(setTextPreview)
        .catch(() => { if (!controller.signal.aborted) setTextPreview(""); });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.id, textStart, textEnd, textRangeError, captions]);
  const textSections = sections.filter(x => x.sourceId === source?.id && x.startSeconds !== undefined && x.endSeconds !== undefined);
  function pickTextSection(id: string) {
    setTextSectionId(id);
    const picked = textSections.find(x => x.id === id);
    if (picked) { setTextStart(picked.startSeconds!); setTextEnd(picked.endSeconds!); }
    else { setTextStart(0); setTextEnd(source?.durationMs != null ? Math.round(source.durationMs / 100) / 10 : ""); }
  }
  async function copyText() {
    try { await navigator.clipboard.writeText(textPreview); setTextStatus(t("tr.copied")); } catch { setTextStatus(t("tr.copyFailed")); }
  }

  const sortedActive = useMemo(() => [...(captions?.active ?? [])].sort((a, b) => a.startSeconds - b.startSeconds), [captions]);
  const jobRunning = !!job && !TERMINAL_STATUSES.has(job.status);

  if (!source) return <p className="muted">{t("tr.addSource")}</p>;

  return <div className="transcription-editor">
    <div className="picker-controls">
      <label>{t("tr.source")}<select value={source.id} onChange={e => setSourceId(e.target.value)}>{sources.map(s => <option key={s.id} value={s.id}>{s.type} · {sourceLabel(s)}{s.status === "PENDING" ? t("tr.uploadLater") : ""}</option>)}</select></label>
      <label>{t("tr.language")}<select value={language} onChange={e => setLanguage(e.target.value)}><option value="fi">{t("tr.lang.fi")}</option><option value="en">{t("tr.lang.en")}</option><option value="sv">{t("tr.lang.sv")}</option><option value="auto">{t("tr.lang.auto")}</option></select></label>
    </div>

    <SourcePlayer source={source} player={player} localFile={localFile} remoteSrc={`/api/sources/${source.id}`} onDuration={d => { if (rangeEnd === 60) setRangeEnd(Math.min(60, d)); }} />

    <div className="transcription-mode-toggle">
      <button type="button" className={mode === "whole" ? "mode-active" : ""} onClick={() => setMode("whole")}>{t("tr.whole")}</button>
      <button type="button" className={mode === "range" ? "mode-active" : ""} onClick={() => setMode("range")}>{t("tr.range")}</button>
    </div>
    {mode === "range" && <div className="range-inputs">
      <label>{t("tr.start")}<input type="number" min="0" step=".1" value={rangeStart} onChange={e => { const n = Number(e.target.value); setRangeStart(n); seek(n); }} /></label>
      <label>{t("tr.end")}<input type="number" min=".1" step=".1" value={rangeEnd} onChange={e => setRangeEnd(Number(e.target.value))} /></label>
      <div className="picker-buttons"><button type="button" onClick={() => setRangeStart(current)}>{t("tr.setStart")}</button><button type="button" onClick={() => setRangeEnd(current)}>{t("tr.setEnd")}</button></div>
    </div>}

    <div className="transcription-start-row">
      <button className="primary" disabled={startBusy || (source.status === "PENDING" && source.type === "UPLOAD" && !localFile)} onClick={() => void startTranscription()}>{startBusy ? t("tr.starting") : t("tr.startBtn")}</button>
      {source.status === "PENDING" && source.type === "UPLOAD" && !localFile && <small className="muted">{t("tr.uploadFirst")}</small>}
      <div className="transcription-upload">
        <span className="muted">{t("tr.orVtt")}</span>
        <input type="file" accept=".vtt,text/vtt" onChange={e => setVttFile(e.target.files?.[0] ?? null)} />
        <button type="button" disabled={uploadBusy || !vttFile} onClick={() => void uploadVtt()}>{uploadBusy ? t("tr.importing") : t("tr.importVtt")}</button>
      </div>
    </div>

    {job && <div className="job-progress">
      <div className="job-status-line">
        <strong>{job.status}</strong>
        {job.phase && <span> · {job.phase}</span>}
        <span> · {job.progress}%</span>
        {job.etaSeconds != null && <span> · {t("tr.eta", { time: formatTime(job.etaSeconds) })}</span>}
      </div>
      <div className="progress-bar"><div style={{ width: `${Math.min(100, Math.max(0, job.progress))}%` }} /></div>
      {job.error && <p className="error">{job.error}</p>}
      {jobRunning && <button className="stop-button" onClick={() => void abortJob()}>{t("tr.abort")}</button>}
    </div>}

    {message && <p className="success">{message}</p>}
    {error && <p className="error">{error}</p>}

    {!!captions?.pendingRuns.length && <div className="run-list">
      <h3>{t("tr.pendingRuns")}</h3>
      {captions.pendingRuns.map(run => <PendingRunCard key={run.id} run={run} busy={applyBusyId === run.id} conflict={runErrors[run.id]} onApply={strategy => void applyRun(run.id, strategy)} onDiscard={() => void discardRun(run.id)} />)}
    </div>}

    {!!sortedActive.length && <div className="downloads">
      <a href={`/api/sources/${source.id}/captions.vtt`} download>{t("tr.downloadVtt")}</a>
      <a href={`/api/sources/${source.id}/captions.srt`} download>{t("tr.downloadSrt")}</a>
    </div>}

    {!!sortedActive.length && <div className="plain-text-export">
      <h3>{t("tr.plainText")}</h3>
      <p className="muted">{t("tr.plainHelp")}</p>
      <div className="range-inputs">
        <label>{t("tr.startS")}<input type="number" min="0" step=".1" value={textStart} onChange={e => { setTextSectionId(""); setTextStart(e.target.value === "" ? "" : Number(e.target.value)); }} /></label>
        <label>{t("tr.endS")}<input type="number" min="0" step=".1" value={textEnd} onChange={e => { setTextSectionId(""); setTextEnd(e.target.value === "" ? "" : Number(e.target.value)); }} /></label>
        <label>{t("tr.section")}<select value={textSectionId} onChange={e => pickTextSection(e.target.value)}><option value="">{t("tr.wholeRecording")}</option>{textSections.map(x => <option key={x.id} value={x.id}>{x.label} ({formatTime(x.startSeconds!)}–{formatTime(x.endSeconds!)})</option>)}</select></label>
        <label>{t("tr.titleOptional")}<input value={textTitle} onChange={e => setTextTitle(e.target.value)} /></label>
      </div>
      {textRangeError && <p className="error">{textRangeError}</p>}
      <textarea readOnly rows={8} aria-label={t("tr.previewLabel")} value={textPreview} placeholder={t("tr.noText")} />
      <div className="downloads">
        <button type="button" disabled={!textPreview} onClick={() => void copyText()}>{t("tr.copy")}</button>
        <a href={transcriptTextUrl(source.id, "txt", { start: textStart, end: textEnd, title: textTitle })} download aria-disabled={!!textRangeError}>{t("tr.downloadTxt")}</a>
        <a href={transcriptTextUrl(source.id, "html", { start: textStart, end: textEnd, title: textTitle })} download aria-disabled={!!textRangeError}>{t("tr.downloadHtml")}</a>
        {textStatus && <span className="muted" role="status">{textStatus}</span>}
      </div>
    </div>}

    <div className="segment-list-head"><h3>{t("tr.lines")}</h3>{captionsLoading && <span className="muted">{t("tr.loading")}</span>}</div>
    <div className="segment-list">
      {sortedActive.map(seg => <SegmentRow key={seg.id} segment={seg} current={current} onSeek={seek} onSave={saveSegment} onDelete={deleteSegment} />)}
      {!sortedActive.length && !captionsLoading && <p className="muted">{t("tr.noLines")}</p>}
    </div>

    <div className="add-line">
      <h4>{t("tr.addLine")}</h4>
      <div className="add-line-fields">
        <label>{t("tr.start")}<input type="number" min="0" step=".1" value={newStart} onChange={e => setNewStart(Number(e.target.value))} /></label>
        <label>{t("tr.end")}<input type="number" min="0" step=".1" value={newEnd} onChange={e => setNewEnd(Number(e.target.value))} /></label>
      </div>
      <textarea rows={2} placeholder={t("tr.captionText")} value={newText} onChange={e => setNewText(e.target.value)} />
      <button type="button" disabled={!newText.trim()} onClick={() => void addSegment()}>{t("tr.addLineBtn")}</button>
    </div>
  </div>;
}

function PendingRunCard({ run, busy, conflict, onApply, onDiscard }: { run: PendingRun; busy: boolean; conflict?: string; onApply: (strategy: ApplyStrategy) => void; onDiscard: () => void }) {
  const t = useT();
  const [strategy, setStrategy] = useState<ApplyStrategy>("replace_overlap");
  return <div className="run-card">
    <div className="run-card-head">
      <strong>{run.origin}</strong>
      <span className="muted">{run.language} · {formatTime(run.rangeStartSeconds)} → {formatTime(run.rangeEndSeconds)}</span>
      <span className="muted">{new Date(run.createdAt).toLocaleString()}</span>
    </div>
    {run.error && <p className="error">{run.error}</p>}
    <p className="muted">{t("tr.runLines", { count: run.segments.length })}</p>
    <div className="run-card-actions">
      <select value={strategy} onChange={e => setStrategy(e.target.value as ApplyStrategy)}>
        <option value="replace_overlap">{t("tr.replaceOverlap")}</option>
        <option value="append">{t("tr.append")}</option>
      </select>
      <button className="primary" disabled={busy} onClick={() => onApply(strategy)}>{busy ? t("tr.applying") : t("tr.apply")}</button>
      <button disabled={busy} onClick={onDiscard}>{t("tr.discard")}</button>
    </div>
    {conflict && <p className="error">{conflict}</p>}
  </div>;
}

function SegmentRow({ segment, current, onSeek, onSave, onDelete }: { segment: TranscriptSegment; current: number; onSeek: (seconds: number) => void; onSave: (id: string, patch: Partial<Pick<TranscriptSegment, "text" | "startSeconds" | "endSeconds">>) => void; onDelete: (id: string) => void }) {
  const t = useT();
  const [text, setText] = useState(segment.text);
  const [start, setStart] = useState(segment.startSeconds);
  const [end, setEnd] = useState(segment.endSeconds);
  useEffect(() => { setText(segment.text); setStart(segment.startSeconds); setEnd(segment.endSeconds); }, [segment.id, segment.text, segment.startSeconds, segment.endSeconds]);
  const isCurrent = isWithinSegment(current, segment);
  return <div className={`segment-row${isCurrent ? " segment-current" : ""}`}>
    <div className="segment-times">
      <button type="button" className="segment-seek" onClick={() => onSeek(segment.startSeconds)} title={t("tr.jump")}>▶ {formatTime(segment.startSeconds)}</button>
      <label>{t("tr.start")}<input type="number" min="0" step=".1" value={start} onChange={e => setStart(Number(e.target.value))} onBlur={() => { if (!(end > start)) { setStart(segment.startSeconds); return; } if (start !== segment.startSeconds) onSave(segment.id, { startSeconds: start }); }} /></label>
      <label>{t("tr.end")}<input type="number" min="0" step=".1" value={end} onChange={e => setEnd(Number(e.target.value))} onBlur={() => { if (!(end > start)) { setEnd(segment.endSeconds); return; } if (end !== segment.endSeconds) onSave(segment.id, { endSeconds: end }); }} /></label>
    </div>
    <textarea rows={2} value={text} onChange={e => setText(e.target.value)} onBlur={() => { if (text !== segment.text) onSave(segment.id, { text }); }} />
    <button type="button" className="segment-delete" aria-label={t("tr.deleteLine")} onClick={() => onDelete(segment.id)}>🗑</button>
  </div>;
}

export function isWithinSegment(current: number, segment: { startSeconds: number; endSeconds: number }) {
  return current >= segment.startSeconds && current < segment.endSeconds;
}
