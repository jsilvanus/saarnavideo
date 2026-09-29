"use client";

import { useEffect, useRef, useState } from "react";
import { errorMessage, requestJson } from "@/components/api";
import { formatTime } from "@/components/format";

export type AudioAsset = { id: string; assetKey: string; type: string; mimeType?: string | null; durationMs?: number | null };
type Item = { type: string; assetId?: string; mode?: string; startSeconds?: number; endSeconds?: number; [key: string]: unknown };
type Definition = { composition: { items: Item[]; [key: string]: unknown }; [key: string]: unknown };

const RECORDER_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
const AUDIO_ACCEPT = "audio/mpeg,audio/mp4,audio/wav,audio/ogg,audio/webm,.mp3,.m4a,.wav,.ogg,.webm";

/** Default asset key of a new recording, e.g. `Voiceover_2026-09-29_14-03` (asset keys allow letters, digits, - and _). */
export function defaultVoiceoverName(now = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `Voiceover_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
}
export function assetKeyFromName(name: string) { return name.trim().replace(/[^a-z0-9_-]/gi, "_").slice(0, 64); }
function extensionFor(mimeType: string) { return mimeType.includes("webm") ? "webm" : mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "m4a" : "webm"; }

/** Trim window of a new timeline clip for a whole asset; assets without a known duration get 10 s. */
export function audioClipFor(asset: AudioAsset, mode: "standalone" | "mix"): Item {
  const seconds = asset.durationMs ? Math.max(0.1, asset.durationMs / 1000) : 10;
  return { type: "audio-clip", assetId: asset.id, mode, startSeconds: 0, endSeconds: Math.round(seconds * 1000) / 1000, volume: 1, ...(mode === "mix" ? { atSeconds: 0, duckSourceVolume: 0.25 } : {}) };
}

type Props = { projectId: string; assets: AudioAsset[]; definition: Definition; onSaveDefinition: (definition: Definition) => Promise<void>; onChanged: () => void | Promise<void> };

export default function VoiceoverPanel({ projectId, assets, definition, onSaveDefinition, onChanged }: Props) {
  const [state, setState] = useState<"idle" | "recording" | "recorded">("idle");
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [name, setName] = useState(defaultVoiceoverName);
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); stream.current?.getTracks().forEach(track => track.stop()); }, []);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  async function start() {
    setError(""); setMessage("");
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) { setError("This browser cannot record audio. Upload an audio file instead."); return; }
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = media;
      const mimeType = RECORDER_TYPES.find(type => MediaRecorder.isTypeSupported(type));
      const rec = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      rec.onstop = () => {
        media.getTracks().forEach(track => track.stop());
        if (timer.current) clearInterval(timer.current);
        const recorded = new Blob(chunks, { type: rec.mimeType || mimeType || "audio/webm" });
        setBlob(recorded); setPreviewUrl(URL.createObjectURL(recorded)); setState("recorded");
      };
      recorder.current = rec;
      rec.start();
      setSeconds(0); setState("recording");
      const startedAt = Date.now();
      timer.current = setInterval(() => setSeconds((Date.now() - startedAt) / 1000), 200);
    } catch (e) {
      setError(e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError") ? "Microphone access was denied. Allow the microphone in the browser and try again." : errorMessage(e, "Could not start recording"));
    }
  }
  function stop() { if (recorder.current?.state === "recording") recorder.current.stop(); }
  function discard() { setBlob(null); setPreviewUrl(null); setState("idle"); setSeconds(0); }

  async function upload(source: Blob | File, key: string, uploadName: string) {
    setBusy(true); setError(""); setMessage("");
    try {
      const form = new FormData();
      form.set("file", source, uploadName);
      form.set("assetKey", assetKeyFromName(key) || defaultVoiceoverName());
      form.set("type", "AUDIO");
      const asset = await requestJson<AudioAsset>(`/api/projects/${projectId}/assets`, { method: "POST", body: form }, "Upload failed");
      setMessage(`Saved “${asset.assetKey}” to the library and this project.`);
      await onChanged();
      return true;
    } catch (e) { setError(errorMessage(e, "Upload failed")); return false; } finally { setBusy(false); }
  }
  async function saveRecording() {
    if (!blob) return;
    const type = blob.type.split(";")[0] || "audio/webm";
    if (await upload(new File([blob], `${assetKeyFromName(name) || "voiceover"}.${extensionFor(type)}`, { type }), name, `voiceover.${extensionFor(type)}`)) { discard(); setName(defaultVoiceoverName()); }
  }
  async function saveFile() {
    if (!file) return;
    if (await upload(file, fileName || file.name.replace(/\.[^.]+$/, ""), file.name)) { setFile(null); setFileName(""); }
  }
  async function addToComposition(asset: AudioAsset, mode: "standalone" | "mix") {
    setError(""); setMessage("");
    try { await onSaveDefinition({ ...definition, composition: { ...definition.composition, items: [...definition.composition.items, audioClipFor(asset, mode)] } }); setMessage(mode === "standalone" ? "Added as a section at the end of the composition." : "Added as a mix over the start of the video; adjust its position in Composition."); }
    catch (e) { setError(errorMessage(e, "Could not update the composition")); }
  }
  const usage = (assetId: string) => definition.composition.items.filter(item => item.type === "audio-clip" && item.assetId === assetId).length;

  return <div className="voiceover-panel" style={{ display: "grid", gap: 18 }}>
    <div style={{ display: "grid", gap: 10, padding: 14, border: "1px solid #e5e7eb", borderRadius: 10 }}>
      <strong>Record a voiceover</strong>
      <label>Name<input aria-label="Recording name" value={name} onChange={e => setName(e.target.value)} disabled={state === "recording"} /></label>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {state === "idle" && <button data-testid="record-start" className="primary" onClick={() => void start()}>● Record</button>}
        {state === "recording" && <><button data-testid="record-stop" className="dangerButton" onClick={stop}>■ Stop</button><span data-testid="record-time" role="timer">Recording {formatTime(seconds)}</span></>}
        {state === "recorded" && <><button data-testid="record-save" className="primary" disabled={busy} onClick={() => void saveRecording()}>Save to project</button><button data-testid="record-again" disabled={busy} onClick={() => { discard(); void start(); }}>Re-record</button><button disabled={busy} onClick={discard}>Discard</button></>}
      </div>
      {state === "recorded" && previewUrl && <audio data-testid="record-preview" controls src={previewUrl} style={{ width: "100%" }} />}
      <small className="muted">The browser asks for microphone permission. Recordings are saved in the audio library and linked to this project.</small>
    </div>

    <div style={{ display: "grid", gap: 10, padding: 14, border: "1px solid #e5e7eb", borderRadius: 10 }}>
      <strong>Upload an audio file</strong>
      <div className="form-grid">
        <label>Audio file (MP3, M4A, WAV, OGG, WebM)<input data-testid="audio-file" type="file" accept={AUDIO_ACCEPT} onChange={e => { const f = e.target.files?.[0] ?? null; setFile(f); if (f) setFileName(f.name.replace(/\.[^.]+$/, "")); }} /></label>
        <label>Name<input value={fileName} onChange={e => setFileName(e.target.value)} placeholder="intro-jingle" /></label>
      </div>
      <div><button data-testid="audio-upload" disabled={busy || !file} onClick={() => void saveFile()}>Upload audio</button></div>
    </div>

    {message && <p className="success">{message}</p>}{error && <p className="error">{error}</p>}

    <div>
      <strong>Project audio</strong>
      <div className="list" style={{ marginTop: 8 }}>
        {assets.map(asset => <div className="row" key={asset.id} style={{ flexWrap: "wrap", gap: 10 }}>
          <span><strong>{asset.assetKey}</strong><small style={{ display: "block" }}>{asset.durationMs ? formatTime(asset.durationMs / 1000) : "unknown length"}{usage(asset.id) ? ` · used ${usage(asset.id)}×` : ""}</small></span>
          <audio controls preload="none" src={`/api/projects/${projectId}/assets/${asset.id}`} style={{ height: 34 }} />
          <span style={{ display: "flex", gap: 6 }}><button onClick={() => void addToComposition(asset, "standalone")} title="A section in sequence: voice-only in the podcast, over the template background in the video">Add as section</button><button onClick={() => void addToComposition(asset, "mix")} title="Layered over the video; the source audio is lowered while it plays">Mix over video</button></span>
        </div>)}
        {!assets.length && <p className="muted">No audio yet. Record or upload a voiceover above.</p>}
      </div>
    </div>
  </div>;
}
