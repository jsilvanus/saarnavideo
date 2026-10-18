"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/I18nProvider";
import { errorMessage, requestJsonWithProgress } from "@/components/api";
import { UploadProgress } from "@/components/UploadProgress";
import { formatTime } from "@/components/format";
import { sanitizeAssetKey } from "@/integrations/image-assets";

export type AudioAsset = { id: string; assetKey: string; type: string; mimeType?: string | null; durationMs?: number | null };

const RECORDER_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
const AUDIO_ACCEPT = "audio/mpeg,audio/mp4,audio/wav,audio/ogg,audio/webm,.mp3,.m4a,.wav,.ogg,.webm";

/** Default asset key of a new recording, e.g. `Voiceover_2026-09-29_14-03` (asset keys allow letters, digits, - and _). */
export function defaultVoiceoverName(now = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `Voiceover_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
}
function extensionFor(mimeType: string) { return mimeType.includes("webm") ? "webm" : mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "m4a" : "webm"; }

type Props = {
  /** Where the recording or file is posted as multipart (`file`, `assetKey`, `type=AUDIO`, optional `folderId`): the project or the library upload route. */
  endpoint: string;
  /** Library folder for the new asset (library page only). */
  folderId?: string | null;
  /** Called with the stored asset after a successful save; the recorder is reset before it runs. */
  onSaved: (asset: AudioAsset) => void | Promise<void>;
};

/**
 * Record-and-upload block for audio: the browser recorder (MediaRecorder, preview, re-record) and a file picker, both
 * posted to `endpoint`. Shared by the voiceover panel of a project and the asset library.
 */
export function AudioCapture({ endpoint, folderId, onSaved }: Props) {
  const t = useT();
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
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); stream.current?.getTracks().forEach(track => track.stop()); }, []);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  async function start() {
    setError("");
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

  async function upload(source: Blob | File, key: string, uploadName: string): Promise<boolean> {
    setBusy(true); setUploadProgress(0); setError("");
    try {
      const form = new FormData();
      form.set("file", source, uploadName);
      form.set("assetKey", sanitizeAssetKey(key.trim()) || defaultVoiceoverName());
      form.set("type", "AUDIO");
      if (folderId) form.set("folderId", folderId);
      const asset = await requestJsonWithProgress<AudioAsset>(endpoint, { method: "POST", body: form }, t("vo.uploadFailed"), (value) => setUploadProgress(value));
      setUploadProgress(null);
      await onSaved(asset);
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

  return <div className="audio-capture" style={{ display: "grid", gap: 18 }}>
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
    {error && <p className="error">{error}</p>}
  </div>;
}

export default AudioCapture;
