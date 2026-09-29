"use client";

import { useEffect, useState } from "react";
import { errorMessage, jsonInit, requestJson } from "@/components/api";
import { formatTime } from "@/components/format";
import { podcastSettingsSchema, type PodcastSettings as DomainPodcastSettings } from "@/domain/project";

type LibraryAudio = { id: string; assetKey: string; type: string; durationMs?: number | null };
type PodcastSettings = Partial<DomainPodcastSettings>;
type Definition = { podcast?: PodcastSettings; [key: string]: unknown };
type Output = { id: string; type: string; createdAt?: string; mimeType?: string };
type Job = { id: string; type?: string | null; status: string; progress: number; phase?: string | null; error?: string | null; errorMessage?: string | null };

const ACTIVE = ["QUEUED", "RUNNING", "ACQUIRING_SOURCE", "PROCESSING", "RENDERING"];

type Props = { projectId: string; projectTitle: string; preacher?: string | null; gospelRef?: string | null; definition: Definition; outputs: Output[]; jobs: Job[]; onSaveDefinition: (definition: Definition) => Promise<void>; onQueued: () => void | Promise<void> };

export default function PodcastPanel({ projectId, projectTitle, preacher, gospelRef, definition, outputs, jobs, onSaveDefinition, onQueued }: Props) {
  const saved = definition.podcast ?? {};
  const [settings, setSettings] = useState<PodcastSettings>(() => ({ ...podcastSettingsSchema.parse({}), ...saved }));
  const [library, setLibrary] = useState<LibraryAudio[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const set = (patch: PodcastSettings) => setSettings(current => ({ ...current, ...patch }));

  useEffect(() => { void requestJson<{ assets?: LibraryAudio[] }>("/api/assets", { cache: "no-store" }, "Could not load the library").then(d => setLibrary((d.assets ?? []).filter(a => a.type === "AUDIO"))).catch(() => undefined); }, []);

  const podcastJobs = jobs.filter(job => job.type === "PODCAST");
  const active = podcastJobs.find(job => ACTIVE.includes(job.status));
  const podcasts = outputs.filter(output => output.type === "AUDIO");
  const clean = (value?: string) => (value?.trim() ? value.trim() : undefined);

  async function generate() {
    setBusy(true); setError(""); setMessage("");
    try {
      const podcast = { introAssetId: settings.introAssetId || undefined, outroAssetId: settings.outroAssetId || undefined, format: settings.format, channels: settings.channels, crossfadeSeconds: settings.crossfadeSeconds, title: clean(settings.title), artist: clean(settings.artist), album: clean(settings.album), date: clean(settings.date), comment: clean(settings.comment) };
      // Saved with the project so the next podcast starts from the same intro/outro and tags.
      await onSaveDefinition({ ...definition, podcast });
      const job = await requestJson<{ id: string }>(`/api/projects/${projectId}/generate`, jsonInit("POST", { type: "PODCAST", podcast }), "Could not queue the podcast");
      setMessage(`Podcast queued (${job.id}).`);
      await onQueued();
    } catch (e) { setError(errorMessage(e, "Could not queue the podcast")); } finally { setBusy(false); }
  }

  const audioSelect = (label: string, key: "introAssetId" | "outroAssetId") => <label>{label}<select data-testid={`podcast-${key}`} value={settings[key] ?? ""} onChange={e => set({ [key]: e.target.value || undefined })}><option value="">None</option>{library.map(asset => <option key={asset.id} value={asset.id}>{asset.assetKey}{asset.durationMs ? ` · ${formatTime(asset.durationMs / 1000)}` : ""}</option>)}</select></label>;

  return <div style={{ display: "grid", gap: 16 }}>
    <p className="muted">The podcast is an audio file only: intro + the composition&apos;s audio + outro, loudness-normalised to about -16 LUFS. Standalone slates are silent and left out; voiceover sections and mixes are included. Intro and outro are used here only, never in the video. Add intro/outro jingles in the Voiceover tab or the audio library.</p>
    <div className="form-grid">
      {audioSelect("Intro", "introAssetId")}
      {audioSelect("Outro", "outroAssetId")}
      <label>Format<select value={settings.format} onChange={e => set({ format: e.target.value as "mp3" | "m4a" })}><option value="mp3">MP3</option><option value="m4a">M4A (AAC)</option></select></label>
      <label>Channels<select value={settings.channels} onChange={e => set({ channels: e.target.value as "mono" | "stereo" })}><option value="mono">Mono (speech)</option><option value="stereo">Stereo</option></select></label>
      <label>Crossfade (seconds, 0 = none)<input type="number" min="0" max="5" step="0.1" value={settings.crossfadeSeconds ?? 0.5} onChange={e => set({ crossfadeSeconds: Math.max(0, Math.min(5, Number(e.target.value) || 0)) })} /></label>
    </div>
    <details>
      <summary>Tags (defaults come from the project)</summary>
      <div className="form-grid" style={{ marginTop: 10 }}>
        <label>Title<input value={settings.title ?? ""} placeholder={projectTitle} onChange={e => set({ title: e.target.value })} /></label>
        <label>Artist (preacher)<input value={settings.artist ?? ""} placeholder={preacher ?? ""} onChange={e => set({ artist: e.target.value })} /></label>
        <label>Album<input value={settings.album ?? ""} onChange={e => set({ album: e.target.value })} /></label>
        <label>Date<input value={settings.date ?? ""} placeholder="today" onChange={e => set({ date: e.target.value })} /></label>
        <label>Comment<input value={settings.comment ?? ""} placeholder={gospelRef ?? "Gospel reference"} onChange={e => set({ comment: e.target.value })} /></label>
      </div>
    </details>
    <div><button data-testid="podcast-generate" className="primary" disabled={busy || !!active} onClick={() => void generate()}>{active ? `Rendering podcast… ${active.progress}%` : "Generate podcast"}</button></div>
    {message && <p className="success">{message}</p>}{error && <p className="error">{error}</p>}
    {podcastJobs[0]?.status === "FAILED" && <p className="error">Last podcast failed: {podcastJobs[0].errorMessage ?? podcastJobs[0].error}</p>}
    <div className="list">
      {podcasts.map(output => <div className="row" key={output.id} style={{ flexWrap: "wrap", gap: 10 }}><span>Podcast · {output.mimeType === "audio/mp4" ? "M4A" : "MP3"}{output.createdAt ? ` · ${new Date(output.createdAt).toLocaleString()}` : ""}</span><audio controls preload="none" src={`/api/outputs/${output.id}`} style={{ height: 34 }} /><a href={`/api/outputs/${output.id}`}>Download ↓</a></div>)}
      {!podcasts.length && <p className="muted">No podcast rendered yet.</p>}
    </div>
  </div>;
}
