"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Source = { id: string; type: "UPLOAD" | "YOUTUBE"; status?: "PENDING" | "AVAILABLE"; originalName?: string | null; youtubeUrl?: string | null; youtubeVideoId?: string | null; durationMs?: number | null; referenceDurationMs?: number | null };
type Job = { id: string; type?: string | null; sourceId?: string | null; status: string; progress: number; phase?: string | null; etaSeconds?: number | null; currentMs?: string | number | null; totalMs?: string | number | null; error?: string | null };
type TranscriptSegment = { id: string; sourceId: string; runId?: string | null; isActive?: boolean; startSeconds: number; endSeconds: number; text: string; confidence?: number | null; createdAt?: string; updatedAt?: string };
type PendingRun = { id: string; origin: "SERVICE" | "UPLOAD" | "MANUAL"; language: string; rangeStartSeconds: number; rangeEndSeconds: number; status: "PENDING"; createdAt: string; error?: string | null; segments: TranscriptSegment[] };
type CaptionsResponse = { active: TranscriptSegment[]; pendingRuns: PendingRun[] };
type ApplyStrategy = "replace_overlap" | "append";

type YouTubePlayer = { getCurrentTime: () => number; seekTo: (seconds: number, allowSeekAhead: boolean) => void; destroy: () => void };
type YTWindow = Window & { YT?: { Player: new (element: HTMLElement, options: { videoId: string; events?: { onReady?: () => void } }) => YouTubePlayer }; onYouTubeIframeAPIReady?: () => void };

type Props = {
  projectId: string;
  sources: Source[];
  pendingFiles?: Record<string, File>;
  jobs?: Job[];
  onProjectRefresh?: () => void;
};

const TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

export default function TranscriptionEditor({ projectId, sources, pendingFiles = {}, jobs = [], onProjectRefresh }: Props) {
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [current, setCurrent] = useState(0);
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

  const videoRef = useRef<HTMLVideoElement>(null);
  const ytRef = useRef<YouTubePlayer | null>(null);
  const ytHostRef = useRef<HTMLDivElement>(null);
  const localUrlRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const source = sources.find(s => s.id === sourceId) || sources[0];

  useEffect(() => { if (sources.length && !sources.some(s => s.id === sourceId)) setSourceId(sources[0].id); }, [sources, sourceId]);

  // Reset player + range state when the selected source changes.
  useEffect(() => {
    setRangeStart(0); setRangeEnd(60); setCurrent(0);
    ytRef.current?.destroy(); ytRef.current = null;
    if (localUrlRef.current) { URL.revokeObjectURL(localUrlRef.current); localUrlRef.current = null; }
  }, [sourceId]);

  // YouTube iframe player wiring (same pattern as SectionPicker in page.tsx).
  useEffect(() => {
    if (source?.type !== "YOUTUBE" || !source.youtubeVideoId || !ytHostRef.current) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;
    const win = window as YTWindow;
    const create = () => {
      if (cancelled || !win.YT || !ytHostRef.current || !source.youtubeVideoId) return;
      ytRef.current?.destroy();
      ytRef.current = new win.YT.Player(ytHostRef.current, { videoId: source.youtubeVideoId, events: { onReady: () => { timer = setInterval(() => setCurrent(ytRef.current?.getCurrentTime() ?? 0), 250); } } });
    };
    if (win.YT) create();
    else {
      const existing = document.getElementById("youtube-iframe-api");
      if (!existing) { const script = document.createElement("script"); script.id = "youtube-iframe-api"; script.src = "https://www.youtube.com/iframe_api"; document.body.appendChild(script); }
      const previous = win.onYouTubeIframeAPIReady;
      win.onYouTubeIframeAPIReady = () => { previous?.(); create(); };
    }
    return () => { cancelled = true; if (timer) clearInterval(timer); ytRef.current?.destroy(); ytRef.current = null; };
  }, [source?.type, source?.youtubeVideoId, sourceId]);

  const localFile = source ? pendingFiles[source.id] : undefined;
  useEffect(() => {
    if (source?.status === "PENDING" && localFile) {
      if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current);
      localUrlRef.current = URL.createObjectURL(localFile);
      setCurrent(0); setRangeStart(0); setRangeEnd(60);
    }
    return () => { if (localUrlRef.current) { URL.revokeObjectURL(localUrlRef.current); localUrlRef.current = null; } };
  }, [source?.id, source?.status, localFile]);

  const seek = (seconds: number) => {
    const n = Math.max(0, seconds);
    setCurrent(n);
    if (source?.type === "YOUTUBE") ytRef.current?.seekTo(n, true);
    else if (videoRef.current) videoRef.current.currentTime = n;
  };

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
        if (data.status === "COMPLETED") { setMessage("Transcription finished."); await loadCaptions(); }
        else if (data.status === "FAILED") { setError(data.error || "Transcription failed."); }
        else { setMessage("Transcription cancelled."); }
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
  useEffect(() => { void loadCaptions(); }, [source?.id]);

  async function startTranscription() {
    if (!source) return;
    setError(""); setMessage(""); setStartBusy(true);
    try {
      const body: { language: string; rangeStartSeconds?: number; rangeEndSeconds?: number } = { language };
      if (mode === "range") {
        if (!(rangeEnd > rangeStart)) throw new Error("End must be greater than start.");
        body.rangeStartSeconds = rangeStart; body.rangeEndSeconds = rangeEnd;
      }
      const r = await fetch(`/api/projects/${projectId}/source/${source.id}/transcription-jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await r.json().catch(() => ({})) as { id?: string; status?: string; progress?: number; error?: string };
      if (!r.ok || !data.id) throw new Error(data.error ?? "Could not start transcription");
      setJob({ id: data.id, type: "TRANSCRIBE", sourceId: source.id, status: data.status ?? "QUEUED", progress: data.progress ?? 0 });
      startPolling(data.id);
      setMessage("Transcription queued.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not start transcription"); }
    finally { setStartBusy(false); }
  }

  async function abortJob() {
    if (!job) return;
    setError("");
    try {
      const r = await fetch(`/api/projects/${projectId}/jobs/${job.id}/cancel`, { method: "POST" });
      const data = await r.json().catch(() => ({})) as { error?: string };
      if (!r.ok) throw new Error(data.error ?? "Could not cancel transcription");
      setMessage("Cancellation requested.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not cancel transcription"); }
  }

  async function uploadVtt() {
    if (!source || !vttFile) return;
    setError(""); setMessage(""); setUploadBusy(true);
    try {
      const form = new FormData();
      form.set("file", vttFile);
      form.set("language", language);
      if (mode === "range") {
        if (!(rangeEnd > rangeStart)) throw new Error("End must be greater than start.");
        form.set("rangeStartSeconds", String(rangeStart));
        form.set("rangeEndSeconds", String(rangeEnd));
      }
      const r = await fetch(`/api/sources/${source.id}/transcription-runs/upload`, { method: "POST", body: form });
      const data = await r.json().catch(() => ({})) as { error?: string };
      if (!r.ok) throw new Error(data.error ?? "Could not import the .vtt file");
      setVttFile(null);
      setMessage("Transcript imported.");
      await loadCaptions();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not import the .vtt file"); }
    finally { setUploadBusy(false); }
  }

  async function applyRun(runId: string, strategy: ApplyStrategy) {
    if (!source) return;
    setApplyBusyId(runId); setRunErrors(prev => ({ ...prev, [runId]: "" })); setError("");
    try {
      const r = await fetch(`/api/sources/${source.id}/transcription-runs/${runId}/apply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ strategy }) });
      const data = await r.json().catch(() => ({})) as { active?: TranscriptSegment[]; error?: string; conflicts?: string[] };
      if (r.status === 409) {
        setRunErrors(prev => ({ ...prev, [runId]: `Blocked: this run overlaps ${data.conflicts?.length ?? "existing"} already-active line(s). Choose "Replace overlapping lines" to redo that stretch, or edit/remove the conflicting lines first.` }));
        return;
      }
      if (!r.ok) throw new Error(data.error ?? "Could not apply this run");
      setMessage("Run applied.");
      await loadCaptions();
    } catch (e) { setRunErrors(prev => ({ ...prev, [runId]: e instanceof Error ? e.message : "Could not apply this run" })); }
    finally { setApplyBusyId(null); }
  }

  async function discardRun(runId: string) {
    if (!source) return;
    setApplyBusyId(runId); setRunErrors(prev => ({ ...prev, [runId]: "" })); setError("");
    try {
      const r = await fetch(`/api/sources/${source.id}/transcription-runs/${runId}/discard`, { method: "POST" });
      if (!r.ok) { const data = await r.json().catch(() => ({})) as { error?: string }; throw new Error(data.error ?? "Could not discard this run"); }
      setMessage("Run discarded.");
      await loadCaptions();
    } catch (e) { setRunErrors(prev => ({ ...prev, [runId]: e instanceof Error ? e.message : "Could not discard this run" })); }
    finally { setApplyBusyId(null); }
  }

  async function saveSegment(id: string, patch: Partial<Pick<TranscriptSegment, "text" | "startSeconds" | "endSeconds">>) {
    setError("");
    try {
      const r = await fetch(`/api/transcript-segments/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const data = await r.json().catch(() => ({})) as Partial<TranscriptSegment> & { error?: string };
      if (!r.ok) throw new Error(data.error ?? "Could not save the caption line");
      setCaptions(prev => prev ? { ...prev, active: prev.active.map(s => s.id === id ? { ...s, ...data } : s) } : prev);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save the caption line"); }
  }

  async function deleteSegment(id: string) {
    setError("");
    try {
      const r = await fetch(`/api/transcript-segments/${id}`, { method: "DELETE" });
      if (!r.ok) { const data = await r.json().catch(() => ({})) as { error?: string }; throw new Error(data.error ?? "Could not delete the caption line"); }
      setCaptions(prev => prev ? { ...prev, active: prev.active.filter(s => s.id !== id) } : prev);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not delete the caption line"); }
  }

  async function addSegment() {
    if (!source) return;
    if (!(newEnd > newStart)) { setError("End must be greater than start."); return; }
    setError("");
    try {
      const r = await fetch(`/api/sources/${source.id}/transcript-segments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ startSeconds: newStart, endSeconds: newEnd, text: newText }) });
      const data = await r.json().catch(() => ({})) as { error?: string };
      if (!r.ok) throw new Error(data.error ?? "Could not add the caption line");
      setNewText(""); setMessage("Line added.");
      await loadCaptions();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not add the caption line"); }
  }

  const sortedActive = useMemo(() => [...(captions?.active ?? [])].sort((a, b) => a.startSeconds - b.startSeconds), [captions]);
  const jobRunning = !!job && !TERMINAL_STATUSES.has(job.status);

  if (!source) return <p className="muted">Add a source first.</p>;

  return <div className="transcription-editor">
    <div className="picker-controls">
      <label>Source<select value={source.id} onChange={e => setSourceId(e.target.value)}>{sources.map(s => <option key={s.id} value={s.id}>{s.type} · {s.originalName || s.youtubeUrl || s.id}{s.status === "PENDING" ? " · upload later" : ""}</option>)}</select></label>
      <label>Language<select value={language} onChange={e => setLanguage(e.target.value)}><option value="fi">Finnish</option><option value="en">English</option><option value="sv">Swedish</option><option value="auto">Auto detect</option></select></label>
    </div>

    <div className="picker-player">
      {source.type === "YOUTUBE" && source.youtubeVideoId ? <div ref={ytHostRef} />
        : source.status === "PENDING" && localFile ? <video ref={videoRef} src={localUrlRef.current ?? undefined} controls onTimeUpdate={e => setCurrent(e.currentTarget.currentTime)} />
        : source.status === "PENDING" ? <div className="muted">Choose the local file in Sources to preview it.</div>
        : <video ref={videoRef} src={`/api/sources/${source.id}`} controls preload="metadata" onTimeUpdate={e => setCurrent(e.currentTarget.currentTime)} onLoadedMetadata={e => { if (e.currentTarget.duration && rangeEnd === 60) setRangeEnd(Math.min(60, e.currentTarget.duration)); }} />}
    </div>
    <div className="picker-time">
      <strong>{formatTime(current)}</strong>
      <div className="picker-buttons">
        <button type="button" onClick={() => seek(current - 30)}>−30s</button>
        <button type="button" onClick={() => seek(current - 5)}>−5s</button>
        <button type="button" onClick={() => seek(current + 5)}>+5s</button>
        <button type="button" onClick={() => seek(current + 30)}>+30s</button>
      </div>
    </div>

    <div className="transcription-mode-toggle">
      <button type="button" className={mode === "whole" ? "mode-active" : ""} onClick={() => setMode("whole")}>Whole video</button>
      <button type="button" className={mode === "range" ? "mode-active" : ""} onClick={() => setMode("range")}>Selected range only</button>
    </div>
    {mode === "range" && <div className="range-inputs">
      <label>Start<input type="number" min="0" step=".1" value={rangeStart} onChange={e => { const n = Number(e.target.value); setRangeStart(n); seek(n); }} /></label>
      <label>End<input type="number" min=".1" step=".1" value={rangeEnd} onChange={e => setRangeEnd(Number(e.target.value))} /></label>
      <div className="picker-buttons"><button type="button" onClick={() => setRangeStart(current)}>Set start</button><button type="button" onClick={() => setRangeEnd(current)}>Set end</button></div>
    </div>}

    <div className="transcription-start-row">
      <button className="primary" disabled={startBusy || (source.status === "PENDING" && source.type === "UPLOAD" && !localFile)} onClick={() => void startTranscription()}>{startBusy ? "Starting…" : "Start transcription"}</button>
      {source.status === "PENDING" && source.type === "UPLOAD" && !localFile && <small className="muted">Upload this source's file first (Sources tab).</small>}
      <div className="transcription-upload">
        <span className="muted">— or upload your own .vtt —</span>
        <input type="file" accept=".vtt,text/vtt" onChange={e => setVttFile(e.target.files?.[0] ?? null)} />
        <button type="button" disabled={uploadBusy || !vttFile} onClick={() => void uploadVtt()}>{uploadBusy ? "Importing…" : "Import .vtt"}</button>
      </div>
    </div>

    {job && <div className="job-progress">
      <div className="job-status-line">
        <strong>{job.status}</strong>
        {job.phase && <span> · {job.phase}</span>}
        <span> · {job.progress}%</span>
        {job.etaSeconds != null && <span> · ETA {formatTime(job.etaSeconds)}</span>}
      </div>
      <div className="progress-bar"><div style={{ width: `${Math.min(100, Math.max(0, job.progress))}%` }} /></div>
      {job.error && <p className="error">{job.error}</p>}
      {jobRunning && <button className="stop-button" onClick={() => void abortJob()}>Abort</button>}
    </div>}

    {message && <p className="success">{message}</p>}
    {error && <p className="error">{error}</p>}

    {!!captions?.pendingRuns.length && <div className="run-list">
      <h3>Pending transcription runs</h3>
      {captions.pendingRuns.map(run => <PendingRunCard key={run.id} run={run} busy={applyBusyId === run.id} conflict={runErrors[run.id]} onApply={strategy => void applyRun(run.id, strategy)} onDiscard={() => void discardRun(run.id)} />)}
    </div>}

    {!!sortedActive.length && <div className="downloads">
      <a href={`/api/sources/${source.id}/captions.vtt`} download>Download VTT ↓</a>
      <a href={`/api/sources/${source.id}/captions.srt`} download>Download SRT ↓</a>
    </div>}

    <div className="segment-list-head"><h3>Caption lines</h3>{captionsLoading && <span className="muted">Loading…</span>}</div>
    <div className="segment-list">
      {sortedActive.map(seg => <SegmentRow key={seg.id} segment={seg} current={current} onSeek={seek} onSave={saveSegment} onDelete={deleteSegment} />)}
      {!sortedActive.length && !captionsLoading && <p className="muted">No active caption lines yet. Start a transcription, import a .vtt, or add a line manually below.</p>}
    </div>

    <div className="add-line">
      <h4>Add a line manually</h4>
      <div className="add-line-fields">
        <label>Start<input type="number" min="0" step=".1" value={newStart} onChange={e => setNewStart(Number(e.target.value))} /></label>
        <label>End<input type="number" min="0" step=".1" value={newEnd} onChange={e => setNewEnd(Number(e.target.value))} /></label>
      </div>
      <textarea rows={2} placeholder="Caption text" value={newText} onChange={e => setNewText(e.target.value)} />
      <button type="button" disabled={!newText.trim()} onClick={() => void addSegment()}>＋ Add line</button>
    </div>
  </div>;
}

function PendingRunCard({ run, busy, conflict, onApply, onDiscard }: { run: PendingRun; busy: boolean; conflict?: string; onApply: (strategy: ApplyStrategy) => void; onDiscard: () => void }) {
  const [strategy, setStrategy] = useState<ApplyStrategy>("replace_overlap");
  return <div className="run-card">
    <div className="run-card-head">
      <strong>{run.origin}</strong>
      <span className="muted">{run.language} · {formatTime(run.rangeStartSeconds)} → {formatTime(run.rangeEndSeconds)}</span>
      <span className="muted">{new Date(run.createdAt).toLocaleString()}</span>
    </div>
    {run.error && <p className="error">{run.error}</p>}
    <p className="muted">{run.segments.length} line{run.segments.length === 1 ? "" : "s"}</p>
    <div className="run-card-actions">
      <select value={strategy} onChange={e => setStrategy(e.target.value as ApplyStrategy)}>
        <option value="replace_overlap">Replace overlapping lines</option>
        <option value="append">Append (fails if it overlaps)</option>
      </select>
      <button className="primary" disabled={busy} onClick={() => onApply(strategy)}>{busy ? "Applying…" : "Apply"}</button>
      <button disabled={busy} onClick={onDiscard}>Discard</button>
    </div>
    {conflict && <p className="error">{conflict}</p>}
  </div>;
}

function SegmentRow({ segment, current, onSeek, onSave, onDelete }: { segment: TranscriptSegment; current: number; onSeek: (seconds: number) => void; onSave: (id: string, patch: Partial<Pick<TranscriptSegment, "text" | "startSeconds" | "endSeconds">>) => void; onDelete: (id: string) => void }) {
  const [text, setText] = useState(segment.text);
  const [start, setStart] = useState(segment.startSeconds);
  const [end, setEnd] = useState(segment.endSeconds);
  useEffect(() => { setText(segment.text); setStart(segment.startSeconds); setEnd(segment.endSeconds); }, [segment.id, segment.text, segment.startSeconds, segment.endSeconds]);
  const isCurrent = isWithinSegment(current, segment);
  return <div className={`segment-row${isCurrent ? " segment-current" : ""}`}>
    <div className="segment-times">
      <button type="button" className="segment-seek" onClick={() => onSeek(segment.startSeconds)} title="Jump the player to this line">▶ {formatTime(segment.startSeconds)}</button>
      <label>Start<input type="number" min="0" step=".1" value={start} onChange={e => setStart(Number(e.target.value))} onBlur={() => { if (!(end > start)) { setStart(segment.startSeconds); return; } if (start !== segment.startSeconds) onSave(segment.id, { startSeconds: start }); }} /></label>
      <label>End<input type="number" min="0" step=".1" value={end} onChange={e => setEnd(Number(e.target.value))} onBlur={() => { if (!(end > start)) { setEnd(segment.endSeconds); return; } if (end !== segment.endSeconds) onSave(segment.id, { endSeconds: end }); }} /></label>
    </div>
    <textarea rows={2} value={text} onChange={e => setText(e.target.value)} onBlur={() => { if (text !== segment.text) onSave(segment.id, { text }); }} />
    <button type="button" className="segment-delete" aria-label="Delete line" onClick={() => onDelete(segment.id)}>🗑</button>
  </div>;
}

export function isWithinSegment(current: number, segment: { startSeconds: number; endSeconds: number }) {
  return current >= segment.startSeconds && current < segment.endSeconds;
}

export function formatTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}
