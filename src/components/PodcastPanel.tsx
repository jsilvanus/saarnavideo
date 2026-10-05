"use client";

import { useEffect, useState } from "react";
import { useT } from "@/i18n/I18nProvider";
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
  const t = useT();
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
  const rangeProblem = start === undefined || end === undefined ? t("podcast.setRange") : end <= start ? t("podcast.endAfterStart") : body !== undefined && start >= body ? t("podcast.startAfterAudio", { end: formatTime(body) }) : "";

  useEffect(() => { void requestJson<{ assets?: LibraryAudio[] }>("/api/assets?type=AUDIO", { cache: "no-store" }, t("podcast.libraryFailed")).then(d => setLibrary((d.assets ?? []).filter(a => a.type === "AUDIO"))).catch(() => undefined); }, []);

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
      const job = await requestJson<{ id: string }>(`/api/projects/${projectId}/generate`, jsonInit("POST", { type: "PODCAST", podcast }), t("podcast.queueFailed"));
      setMessage(t("podcast.queued", { id: job.id }));
      await onQueued();
    } catch (e) { setError(errorMessage(e, t("podcast.queueFailed"))); } finally { setBusy(false); }
  }

  const audioSelect = (label: string, key: "introAssetId" | "outroAssetId") => <label>{label}<select data-testid={`podcast-${key}`} value={settings[key] ?? ""} onChange={e => set({ [key]: e.target.value || undefined })}><option value="">{t("podcast.none")}</option>{library.map(asset => <option key={asset.id} value={asset.id}>{asset.assetKey}{asset.durationMs ? ` · ${formatTime(asset.durationMs / 1000)}` : ""}</option>)}</select></label>;

  return <div style={{ display: "grid", gap: 16 }}>
    <p className="muted">{t("podcast.help")}</p>
    <div className="podcast-range" data-testid="podcast-range">
      <label>{t("podcast.start")}<input data-testid="podcast-start" className="mono" inputMode="numeric" placeholder="m:ss" value={startText} onChange={e => setStartText(e.target.value)} /></label>
      <label>{t("podcast.end")}<input data-testid="podcast-end" className="mono" inputMode="numeric" placeholder="m:ss" value={endText} onChange={e => setEndText(e.target.value)} /></label>
      {body !== undefined && <button type="button" onClick={() => { setStartText(formatTime(0)); setEndText(formatTime(body)); }}>{t("podcast.wholeAudio", { end: formatTime(body) })}</button>}
      {body !== undefined && start !== undefined && end !== undefined && end > start && <div className="podcast-range-bar" aria-hidden="true"><div style={{ left: `${Math.min(100, (start / Math.max(body, 0.001)) * 100)}%`, width: `${Math.max(0, Math.min(100, ((Math.min(end, body) - start) / Math.max(body, 0.001)) * 100))}%` }} /></div>}
      <small className={rangeProblem ? "error" : "muted"}>{rangeProblem || t("podcast.rangeInfo", { length: formatTime(Math.min(end!, body ?? end!) - start!) })}</small>
    </div>
    <div className="form-grid">
      {audioSelect(t("podcast.intro"), "introAssetId")}
      {audioSelect(t("podcast.outro"), "outroAssetId")}
      <label>{t("podcast.format")}<select value={settings.format} onChange={e => set({ format: e.target.value as "mp3" | "m4a" })}><option value="mp3">MP3</option><option value="m4a">M4A (AAC)</option></select></label>
      <label>{t("podcast.channels")}<select value={settings.channels} onChange={e => set({ channels: e.target.value as "mono" | "stereo" })}><option value="mono">{t("podcast.mono")}</option><option value="stereo">{t("podcast.stereo")}</option></select></label>
      <label>{t("podcast.crossfade")}<input type="number" min="0" max="5" step="0.1" value={settings.crossfadeSeconds ?? 0.5} onChange={e => set({ crossfadeSeconds: Math.max(0, Math.min(5, Number(e.target.value) || 0)) })} /></label>
    </div>
    <details>
      <summary>{t("podcast.tags")}</summary>
      <div className="form-grid" style={{ marginTop: 10 }}>
        <label>{t("podcast.tagTitle")}<input value={settings.title ?? ""} placeholder={projectTitle} onChange={e => set({ title: e.target.value })} /></label>
        <label>{t("podcast.tagArtist")}<input value={settings.artist ?? ""} placeholder={preacher ?? ""} onChange={e => set({ artist: e.target.value })} /></label>
        <label>{t("podcast.tagAlbum")}<input value={settings.album ?? ""} onChange={e => set({ album: e.target.value })} /></label>
        <label>{t("podcast.tagDate")}<input value={settings.date ?? ""} placeholder={t("podcast.today")} onChange={e => set({ date: e.target.value })} /></label>
        <label>{t("podcast.tagComment")}<input value={settings.comment ?? ""} placeholder={gospelRef ?? ""} onChange={e => set({ comment: e.target.value })} /></label>
      </div>
    </details>
    <div><button data-testid="podcast-generate" className="primary" disabled={busy || !!active || !!rangeProblem} onClick={() => void generate()}>{active ? t("podcast.generating", { progress: active.progress }) : t("podcast.generate")}</button></div>
    {message && <p className="success">{message}</p>}{error && <p className="error">{error}</p>}
    {podcastJobs[0]?.status === "FAILED" && <p className="error">{t("podcast.lastFailed", { error: podcastJobs[0].errorMessage ?? podcastJobs[0].error ?? "" })}</p>}
    <div className="list">
      {podcasts.map(output => <div className="row" key={output.id} style={{ flexWrap: "wrap", gap: 10 }}><span>{t("podcast.outputLabel", { format: output.mimeType === "audio/mp4" ? "M4A" : "MP3" })}{output.createdAt ? ` · ${new Date(output.createdAt).toLocaleString()}` : ""}</span><audio controls preload="none" src={`/api/outputs/${output.id}?inline=1`} style={{ height: 34 }} /><a href={`/api/outputs/${output.id}`}>{t("podcast.download")}</a></div>)}
      {!podcasts.length && <p className="muted">{t("podcast.noneYet")}</p>}
    </div>
  </div>;
}
