"use client";

import { useEffect, useState } from "react";
import { errorMessage, jsonInit, requestJson } from "@/components/api";
import { formatTime, parseClock } from "@/components/format";
import { podcastSettingsSchema, type PodcastSettings as DomainPodcastSettings } from "@/domain/project";
import { podcastBodySeconds } from "@/lib/duration-report";

type LibraryAudio = { id: string; assetKey: string; type: string; durationMs?: number | null };
type PodcastSettings = Partial<DomainPodcastSettings>;
type Definition = { podcast?: PodcastSettings; composition?: { items: unknown[] }; [key: string]: unknown };
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
  const [startText, setStartText] = useState(saved.startSeconds !== undefined ? formatTime(saved.startSeconds) : "");
  const [endText, setEndText] = useState(saved.endSeconds !== undefined ? formatTime(saved.endSeconds) : "");
  const body = (() => { try { return definition.composition ? podcastBodySeconds(definition as Parameters<typeof podcastBodySeconds>[0]) : undefined; } catch { return undefined; } })();
  const start = parseClock(startText), end = parseClock(endText);
  // The episode is cut from the composition audio by hand; nothing is picked automatically.
  const rangeProblem = start === undefined || end === undefined ? "Aseta jakson alku ja loppu." : end <= start ? "Lopun pitää olla alun jälkeen." : body !== undefined && start >= body ? `Alku on äänen lopun (${formatTime(body)}) jälkeen.` : "";

  useEffect(() => { void requestJson<{ assets?: LibraryAudio[] }>("/api/assets?type=AUDIO", { cache: "no-store" }, "Could not load the library").then(d => setLibrary((d.assets ?? []).filter(a => a.type === "AUDIO"))).catch(() => undefined); }, []);

  const podcastJobs = jobs.filter(job => job.type === "PODCAST");
  const active = podcastJobs.find(job => ACTIVE.includes(job.status));
  const podcasts = outputs.filter(output => output.type === "AUDIO");
  const clean = (value?: string) => (value?.trim() ? value.trim() : undefined);

  async function generate() {
    setBusy(true); setError(""); setMessage("");
    try {
      if (rangeProblem) throw new Error(rangeProblem);
      const podcast = { startSeconds: start, endSeconds: body !== undefined ? Math.min(end!, body) : end, introAssetId: settings.introAssetId || undefined, outroAssetId: settings.outroAssetId || undefined, format: settings.format, channels: settings.channels, crossfadeSeconds: settings.crossfadeSeconds, title: clean(settings.title), artist: clean(settings.artist), album: clean(settings.album), date: clean(settings.date), comment: clean(settings.comment) };
      // Saved with the project so the next podcast starts from the same intro/outro and tags.
      await onSaveDefinition({ ...definition, podcast });
      const job = await requestJson<{ id: string }>(`/api/projects/${projectId}/generate`, jsonInit("POST", { type: "PODCAST", podcast }), "Podcastia ei voitu lisätä jonoon");
      setMessage(`Podcast-jakso jonossa (${job.id}).`);
      await onQueued();
    } catch (e) { setError(errorMessage(e, "Podcastia ei voitu lisätä jonoon")); } finally { setBusy(false); }
  }

  const audioSelect = (label: string, key: "introAssetId" | "outroAssetId") => <label>{label}<select data-testid={`podcast-${key}`} value={settings[key] ?? ""} onChange={e => set({ [key]: e.target.value || undefined })}><option value="">Ei mitään</option>{library.map(asset => <option key={asset.id} value={asset.id}>{asset.assetKey}{asset.durationMs ? ` · ${formatTime(asset.durationMs / 1000)}` : ""}</option>)}</select></label>;

  return <div style={{ display: "grid", gap: 16 }}>
    <p className="muted">Podcast on äänitiedosto: valitsemasi kohta koostuksen äänestä, halutessasi alku- ja lopputunnuksen kanssa, äänenvoimakkuus tasattuna noin -16 LUFS:iin. Erilliset välikuvat ovat äänettömiä ja jäävät pois.</p>
    <div className="podcast-range" data-testid="podcast-range">
      <label>Alku<input data-testid="podcast-start" className="mono" inputMode="numeric" placeholder="m:ss" value={startText} onChange={e => setStartText(e.target.value)} /></label>
      <label>Loppu<input data-testid="podcast-end" className="mono" inputMode="numeric" placeholder="m:ss" value={endText} onChange={e => setEndText(e.target.value)} /></label>
      {body !== undefined && <button type="button" onClick={() => { setStartText(formatTime(0)); setEndText(formatTime(body)); }}>Koko ääni (0:00–{formatTime(body)})</button>}
      {body !== undefined && start !== undefined && end !== undefined && end > start && <div className="podcast-range-bar" aria-hidden="true"><div style={{ left: `${Math.min(100, (start / Math.max(body, 0.001)) * 100)}%`, width: `${Math.max(0, Math.min(100, ((Math.min(end, body) - start) / Math.max(body, 0.001)) * 100))}%` }} /></div>}
      <small className={rangeProblem ? "error" : "muted"}>{rangeProblem || `Jaksoon tulee ${formatTime(Math.min(end!, body ?? end!) - start!)} koostuksen äänestä.`}</small>
    </div>
    <div className="form-grid">
      {audioSelect("Alkutunnus", "introAssetId")}
      {audioSelect("Lopputunnus", "outroAssetId")}
      <label>Muoto<select value={settings.format} onChange={e => set({ format: e.target.value as "mp3" | "m4a" })}><option value="mp3">MP3</option><option value="m4a">M4A (AAC)</option></select></label>
      <label>Kanavat<select value={settings.channels} onChange={e => set({ channels: e.target.value as "mono" | "stereo" })}><option value="mono">Mono (puhe)</option><option value="stereo">Stereo</option></select></label>
      <label>Ristihäivytys (s, 0 = ei)<input type="number" min="0" max="5" step="0.1" value={settings.crossfadeSeconds ?? 0.5} onChange={e => set({ crossfadeSeconds: Math.max(0, Math.min(5, Number(e.target.value) || 0)) })} /></label>
    </div>
    <details>
      <summary>Tiedoston tiedot (oletukset projektista)</summary>
      <div className="form-grid" style={{ marginTop: 10 }}>
        <label>Otsikko<input value={settings.title ?? ""} placeholder={projectTitle} onChange={e => set({ title: e.target.value })} /></label>
        <label>Esittäjä<input value={settings.artist ?? ""} placeholder={preacher ?? ""} onChange={e => set({ artist: e.target.value })} /></label>
        <label>Albumi<input value={settings.album ?? ""} onChange={e => set({ album: e.target.value })} /></label>
        <label>Päivämäärä<input value={settings.date ?? ""} placeholder="tänään" onChange={e => set({ date: e.target.value })} /></label>
        <label>Kommentti<input value={settings.comment ?? ""} placeholder={gospelRef ?? ""} onChange={e => set({ comment: e.target.value })} /></label>
      </div>
    </details>
    <div><button data-testid="podcast-generate" className="primary" disabled={busy || !!active || !!rangeProblem} onClick={() => void generate()}>{active ? `Tehdään podcastia… ${active.progress}%` : "Tee podcast-jakso"}</button></div>
    {message && <p className="success">{message}</p>}{error && <p className="error">{error}</p>}
    {podcastJobs[0]?.status === "FAILED" && <p className="error">Edellinen podcast epäonnistui: {podcastJobs[0].errorMessage ?? podcastJobs[0].error}</p>}
    <div className="list">
      {podcasts.map(output => <div className="row" key={output.id} style={{ flexWrap: "wrap", gap: 10 }}><span>Podcast · {output.mimeType === "audio/mp4" ? "M4A" : "MP3"}{output.createdAt ? ` · ${new Date(output.createdAt).toLocaleString()}` : ""}</span><audio controls preload="none" src={`/api/outputs/${output.id}?inline=1`} style={{ height: 34 }} /><a href={`/api/outputs/${output.id}`}>Lataa ↓</a></div>)}
      {!podcasts.length && <p className="muted">Podcastia ei ole vielä tehty.</p>}
    </div>
  </div>;
}
