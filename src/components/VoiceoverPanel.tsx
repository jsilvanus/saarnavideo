"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/I18nProvider";
import { errorMessage, requestJson, requestJsonWithProgress } from "@/components/api";
import { UploadProgress } from "@/components/UploadProgress";
import { formatTime } from "@/components/format";
import AssetPicker from "@/components/AssetPicker";
import { sanitizeAssetKey } from "@/integrations/image-assets";

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
function extensionFor(mimeType: string) { return mimeType.includes("webm") ? "webm" : mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "m4a" : "webm"; }

/** Trim window of a new timeline clip for a whole asset; assets without a known duration get 10 s. */
export function audioClipFor(asset: AudioAsset, mode: "standalone" | "mix"): Item {
  const seconds = asset.durationMs ? Math.max(0.1, asset.durationMs / 1000) : 10;
  return { type: "audio-clip", assetId: asset.id, mode, startSeconds: 0, endSeconds: Math.round(seconds * 1000) / 1000, volume: 1, ...(mode === "mix" ? { atSeconds: 0, duckSourceVolume: 0.25 } : {}) };
}

type Props = { projectId: string; assets: AudioAsset[]; definition: Definition; onSaveDefinition: (definition: Definition) => Promise<void>; onChanged: () => void | Promise<void> };

export default function VoiceoverPanel({ projectId, assets, definition, onSaveDefinition, onChanged }: Props) {
  const t = useT();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [state, setState] = useState<"idle" | "recording" | "recorded">("idle");
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [name, setName] = useState(defaultVoiceoverName);
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); stream.current?.getTracks().forEach(track => track.stop()); }, []);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  async function start() {
    setError(""); setMessage("");
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) { setError(t("vo.noRecording")); return; }
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
      setError(e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError") ? t("vo.micDenied") : errorMessage(e, t("vo.startFailed")));
    }
  }
  function stop() { if (recorder.current?.state === "recording") recorder.current.stop(); }
  function discard() { setBlob(null); setPreviewUrl(null); setState("idle"); setSeconds(0); }

  async function upload(source: Blob | File, key: string, uploadName: string) {
    setBusy(true); setUploadProgress(0); setError(""); setMessage("");
    try {
      const form = new FormData();
      form.set("file", source, uploadName);
      form.set("assetKey", sanitizeAssetKey(key.trim()) || defaultVoiceoverName());
      form.set("type", "AUDIO");
      const asset = await requestJsonWithProgress<AudioAsset>(`/api/projects/${projectId}/assets`, { method: "POST", body: form }, t("vo.uploadFailed"), (value) => setUploadProgress(value));
      setUploadProgress(null);
      setMessage(t("vo.saved", { name: asset.assetKey }));
      await onChanged();
      return true;
    } catch (e) { setUploadProgress(null); setError(errorMessage(e, t("vo.uploadFailed"))); return false; } finally { setBusy(false); }
  }
  async function saveRecording() {
    if (!blob) return;
    const type = blob.type.split(";")[0] || "audio/webm";
    if (await upload(new File([blob], `${sanitizeAssetKey(name.trim()) || "voiceover"}.${extensionFor(type)}`, { type }), name, `voiceover.${extensionFor(type)}`)) { discard(); setName(defaultVoiceoverName()); }
  }
  async function saveFile() {
    if (!file) return;
    if (await upload(file, fileName || file.name.replace(/\.[^.]+$/, ""), file.name)) { setFile(null); setFileName(""); }
  }
  async function addToComposition(asset: AudioAsset, mode: "standalone" | "mix") {
    setError(""); setMessage("");
    try { await onSaveDefinition({ ...definition, composition: { ...definition.composition, items: [...definition.composition.items, audioClipFor(asset, mode)] } }); setMessage(mode === "standalone" ? t("vo.addedSection") : t("vo.addedMix")); }
    catch (e) { setError(errorMessage(e, t("vo.updateFailed"))); }
  }
  const usage = (assetId: string) => definition.composition.items.filter(item => item.type === "audio-clip" && item.assetId === assetId).length;

  return <div className="voiceover-panel" style={{ display: "grid", gap: 18 }}>
    <div style={{ display: "grid", gap: 10, padding: 14, border: "1px solid #e5e7eb", borderRadius: 10 }}>
      <strong>{t("vo.recordTitle")}</strong>
      <label>{t("vo.name")}<input aria-label={t("vo.recordingName")} value={name} onChange={e => setName(e.target.value)} disabled={state === "recording"} /></label>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {state === "idle" && <button data-testid="record-start" className="primary" onClick={() => void start()}>{t("vo.record")}</button>}
        {state === "recording" && <><button data-testid="record-stop" className="dangerButton" onClick={stop}>{t("vo.stop")}</button><span data-testid="record-time" role="timer">{t("vo.recording", { time: formatTime(seconds) })}</span></>}
        {state === "recorded" && <><button data-testid="record-save" className="primary" disabled={busy} onClick={() => void saveRecording()}>{t("vo.saveToProject")}</button><button data-testid="record-again" disabled={busy} onClick={() => { discard(); void start(); }}>{t("vo.reRecord")}</button><button disabled={busy} onClick={discard}>{t("vo.discard")}</button></>}
      </div>
      {state === "recorded" && previewUrl && <audio data-testid="record-preview" controls src={previewUrl} style={{ width: "100%" }} />}
      {uploadProgress !== null && <UploadProgress progress={uploadProgress} label={t("common.uploading")} />}
      <small className="muted">{t("vo.micNote")}</small>
    </div>

    <div style={{ display: "grid", gap: 10, padding: 14, border: "1px solid #e5e7eb", borderRadius: 10 }}>
      <strong>{t("vo.uploadTitle")}</strong>
      <div className="form-grid">
        <label>{t("vo.audioFile")}<input data-testid="audio-file" type="file" accept={AUDIO_ACCEPT} onChange={e => { const f = e.target.files?.[0] ?? null; setFile(f); if (f) setFileName(f.name.replace(/\.[^.]+$/, "")); }} /></label>
        <label>{t("vo.name")}<input value={fileName} onChange={e => setFileName(e.target.value)} placeholder={t("vo.uploadPlaceholder")} /></label>
      </div>
      <div><button data-testid="audio-upload" disabled={busy || !file} onClick={() => void saveFile()}>{t("vo.upload")}</button></div>
      {uploadProgress !== null && <UploadProgress progress={uploadProgress} label={t("common.uploading")} />}
    </div>

    {message && <p className="success">{message}</p>}{error && <p className="error">{error}</p>}

    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}><strong>{t("vo.projectAudio")}</strong><button data-testid="audio-from-library" onClick={() => setLibraryOpen(true)}>{t("vo.fromLibrary")}</button></div>
      {libraryOpen && <AssetPicker projectId={projectId} kind="audio" title={t("vo.pickerTitle")} linkedIds={assets.map(a => a.id)} pickLinked={false} onPick={async () => { await onChanged(); setMessage(t("vo.pickerAdded")); }} onClose={() => setLibraryOpen(false)} />}
      <div className="list" style={{ marginTop: 8 }}>
        {assets.map(asset => <div className="row" key={asset.id} style={{ flexWrap: "wrap", gap: 10 }}>
          <span><strong>{asset.assetKey}</strong><small style={{ display: "block" }}>{asset.durationMs ? formatTime(asset.durationMs / 1000) : t("vo.unknownLength")}{usage(asset.id) ? t("vo.usedTimes", { count: usage(asset.id) }) : ""}</small></span>
          <audio controls preload="none" src={`/api/projects/${projectId}/assets/${asset.id}`} style={{ height: 34 }} />
          <span style={{ display: "flex", gap: 6 }}><button onClick={() => void addToComposition(asset, "standalone")} title={t("vo.addSectionTitle")}>{t("vo.addSection")}</button><button onClick={() => void addToComposition(asset, "mix")} title={t("vo.mixTitle")}>{t("vo.mix")}</button></span>
        </div>)}
        {!assets.length && <p className="muted">{t("vo.none")}</p>}
      </div>
    </div>
  </div>;
}
