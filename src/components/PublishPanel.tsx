"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/I18nProvider";
import { MESSAGES, type MessageKey } from "@/i18n/translate";
import { errorMessage, jsonInit, requestJson } from "./api";
import styles from "./PublishPanel.module.css";

export type Publication = { id: string; provider: "YOUTUBE" | "FACEBOOK"; status: "QUEUED" | "UPLOADING" | "COMPLETED" | "FAILED"; privacy: string; externalId?: string | null; error?: string | null; warning?: string | null; progress?: number | null; options?: { publishAt?: string } | null; createdAt?: string };
type Playlist = { id: string; title: string; privacyStatus?: string };
const PLAYLIST_KEY = "saarnavideo.youtubePlaylist";
const readStored = (key: string) => { try { return localStorage.getItem(key) ?? ""; } catch { return ""; } };
const writeStored = (key: string, value: string) => { try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch { /* storage unavailable */ } };

/** The `youtube` options of a publish request; empty fields are left out so the server defaults apply. */
export function youtubeOptions(input: { title: string; description: string; tags: string; playlistId: string; scheduleAt: string; madeForKids: boolean; notifySubscribers: boolean }): Record<string, unknown> {
  const tags = input.tags.split(",").map(tag => tag.trim()).filter(Boolean);
  return {
    ...(input.title.trim() ? { title: input.title.trim() } : {}),
    ...(input.description.trim() ? { description: input.description } : {}),
    ...(tags.length ? { tags } : {}),
    ...(input.playlistId ? { playlistId: input.playlistId } : {}),
    ...(input.scheduleAt ? { publishAt: new Date(input.scheduleAt).toISOString() } : {}),
    ...(input.madeForKids ? { madeForKids: true } : {}),
    ...(input.notifySubscribers ? {} : { notifySubscribers: false }),
  };
}
type Platform = Publication["provider"];
type FacebookStatus = { configured: boolean; pageName?: string | null; error?: string };

const ACTIVE = new Set(["QUEUED", "UPLOADING"]);
export const PLATFORM_LABEL: Record<Platform, string> = { YOUTUBE: "YouTube", FACEBOOK: "Facebook" };

/** Privacy choices per platform. Facebook has no unlisted videos: PRIVATE uploads an unpublished video. */
export const PRIVACY_OPTIONS: Record<Platform, Array<{ value: string; labelKey: MessageKey }>> = {
  YOUTUBE: [{ value: "PRIVATE", labelKey: "pub.privacy.private" }, { value: "UNLISTED", labelKey: "pub.privacy.unlisted" }, { value: "PUBLIC", labelKey: "pub.privacy.public" }],
  FACEBOOK: [{ value: "PRIVATE", labelKey: "pub.privacy.fbPrivate" }, { value: "PUBLIC", labelKey: "pub.privacy.fbPublic" }],
};

export function publicationUrl(publication: Publication): string | null {
  if (publication.status !== "COMPLETED" || !publication.externalId) return null;
  return publication.provider === "YOUTUBE" ? `https://www.youtube.com/watch?v=${publication.externalId}` : `https://www.facebook.com/${publication.externalId}`;
}

/** `onRefresh` reloads the whole project (after queuing); `onPoll` is the cheaper refresh used while an upload runs, defaulting to `onRefresh`. */
export default function PublishPanel({ projectId, publications, hasVideo, onRefresh, onPoll }: { projectId: string; publications: Publication[]; hasVideo: boolean; onRefresh: () => void; onPoll?: () => void }) {
  const t = useT();
  const [platform, setPlatform] = useState<Platform>("YOUTUBE");
  const [privacy, setPrivacy] = useState("PRIVATE");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [youtubeConnected, setYoutubeConnected] = useState<boolean | null>(null);
  const [playlistScope, setPlaylistScope] = useState(true);
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [playlistError, setPlaylistError] = useState("");
  const [yt, setYt] = useState({ title: "", description: "", tags: "", playlistId: "", schedule: false, scheduleAt: "", madeForKids: false, notifySubscribers: true });
  const setYtField = <K extends keyof typeof yt>(key: K, value: (typeof yt)[K]) => setYt(current => ({ ...current, [key]: value }));
  const [facebook, setFacebook] = useState<FacebookStatus | null>(null);

  useEffect(() => {
    void fetch("/api/integrations/youtube/status", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then((d: { connected?: boolean; playlists?: boolean } | null) => { setYoutubeConnected(d ? Boolean(d.connected) : null); setPlaylistScope(d?.playlists !== false); }).catch(() => setYoutubeConnected(null));
    setYtField("playlistId", readStored(PLAYLIST_KEY));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The channel's playlists, loaded once the account is known to be connected with the playlist permission.
  useEffect(() => {
    if (!youtubeConnected || !playlistScope || playlists) return;
    requestJson<{ playlists: Playlist[] }>("/api/integrations/youtube/playlists", { cache: "no-store" }, "").then(d => setPlaylists(d.playlists ?? [])).catch(e => { setPlaylists([]); setPlaylistError(errorMessage(e, "?")); });
  }, [youtubeConnected, playlistScope, playlists]);

  useEffect(() => {
    void fetch("/api/integrations/facebook/status", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then((d: FacebookStatus | null) => setFacebook(d)).catch(() => setFacebook(null));
  }, []);

  // Publications finish in the worker; keep the list fresh while one is running.
  // The latest onRefresh is read through a ref, so a new callback identity on each parent render does not restart the timer.
  const running = publications.some(p => ACTIVE.has(p.status));
  const refresh = useRef(onPoll ?? onRefresh);
  refresh.current = onPoll ?? onRefresh;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => refresh.current(), 3000);
    return () => clearInterval(timer);
  }, [running]);

  function choosePlatform(next: Platform) {
    setPlatform(next);
    if (!PRIVACY_OPTIONS[next].some(o => o.value === privacy)) setPrivacy("PRIVATE");
  }

  const facebookReady = Boolean(facebook?.configured);
  const platformHint = platform === "FACEBOOK"
    ? (facebook?.error ? t("pub.fbProblem", { error: facebook.error }) : facebookReady ? t("pub.fbPublishesTo", { page: facebook?.pageName ?? "?" }) : "")
    : (youtubeConnected === false ? t("pub.connectYoutube") : "");

  const scheduled = platform === "YOUTUBE" && yt.schedule;
  async function publish() {
    if (scheduled && (!yt.scheduleAt || new Date(yt.scheduleAt).getTime() < Date.now() + 120_000)) { setError(t("pub.yt.scheduleMissing")); return; }
    setBusy(true); setError("");
    try {
      const body = platform === "YOUTUBE"
        ? { platform, privacy: scheduled ? "PRIVATE" : privacy, youtube: youtubeOptions({ ...yt, scheduleAt: scheduled ? yt.scheduleAt : "" }) }
        : { platform, privacy };
      if (platform === "YOUTUBE") writeStored(PLAYLIST_KEY, yt.playlistId);
      await requestJson(`/api/projects/${projectId}/publish`, jsonInit("POST", body), t("pub.queueFailed"));
      onRefresh();
    } catch (e) { setError(errorMessage(e, t("pub.queueFailed"))); }
    finally { setBusy(false); }
  }

  return <div className="publish-panel">
    <h3>{t("pub.title")}</h3>
    {!hasVideo && <p className="muted">{t("pub.generateFirst")}</p>}
    <div className="picker-controls">
      <label>{t("pub.platform")}<select value={platform} onChange={e => choosePlatform(e.target.value as Platform)}>
        <option value="YOUTUBE">YouTube</option>
        <option value="FACEBOOK" disabled={!facebookReady}>Facebook{facebookReady ? "" : t("pub.notConfigured")}</option>
      </select></label>
      <label>{t("pub.visibility")}<select value={scheduled ? "PRIVATE" : privacy} disabled={scheduled} onChange={e => setPrivacy(e.target.value)}>{PRIVACY_OPTIONS[platform].map(o => <option key={o.value} value={o.value}>{t(o.labelKey)}</option>)}</select></label>
      <button className="primary" disabled={busy || !hasVideo || (platform === "FACEBOOK" && !facebookReady) || (platform === "YOUTUBE" && youtubeConnected === false)} onClick={() => void publish()}>{busy ? t("pub.queuing") : t("pub.publishTo", { platform: PLATFORM_LABEL[platform] })}</button>
    </div>
    {platform === "YOUTUBE" && youtubeConnected !== false && <details className={styles.details}>
      <summary>{t("pub.yt.details")}</summary>
      <div className={styles.fields}>
        <label>{t("pub.yt.title")}<input value={yt.title} maxLength={100} onChange={e => setYtField("title", e.target.value)} /><small className="muted">{t("pub.yt.titleHint")}</small></label>
        <label>{t("pub.yt.description")}<textarea rows={4} value={yt.description} onChange={e => setYtField("description", e.target.value)} /><small className="muted">{t("pub.yt.descriptionHint")}</small></label>
        <label>{t("pub.yt.tags")}<input value={yt.tags} onChange={e => setYtField("tags", e.target.value)} /></label>
        <label>{t("pub.yt.playlist")}<select value={yt.playlistId} disabled={!playlistScope} onChange={e => setYtField("playlistId", e.target.value)}>
          <option value="">{t("pub.yt.noPlaylist")}</option>
          {yt.playlistId && playlists && !playlists.some(p => p.id === yt.playlistId) && <option value={yt.playlistId}>{yt.playlistId}</option>}
          {(playlists ?? []).map(p => <option key={p.id} value={p.id}>{p.title}{p.privacyStatus && p.privacyStatus !== "public" ? ` (${p.privacyStatus})` : ""}</option>)}
        </select></label>
        {!playlistScope && <p className="muted">{t("pub.yt.reconnectForPlaylists")}</p>}
        {playlistError && <p className="muted">{t("pub.yt.playlistsFailed", { error: playlistError })}</p>}
        <label className={styles.inline}><input type="checkbox" checked={yt.schedule} onChange={e => setYtField("schedule", e.target.checked)} /> {t("pub.yt.schedule")}</label>
        {yt.schedule && <label><input type="datetime-local" value={yt.scheduleAt} onChange={e => setYtField("scheduleAt", e.target.value)} /><small className="muted">{t("pub.yt.scheduleHint")}</small></label>}
        <label className={styles.inline}><input type="checkbox" checked={yt.notifySubscribers} onChange={e => setYtField("notifySubscribers", e.target.checked)} /> {t("pub.yt.notify")}</label>
        <label className={styles.inline}><input type="checkbox" checked={yt.madeForKids} onChange={e => setYtField("madeForKids", e.target.checked)} /> {t("pub.yt.madeForKids")}</label>
      </div>
    </details>}
    {!facebookReady && <p className="muted">{t("pub.fbNotConfigured")}</p>}
    {platformHint && <p className="muted">{platformHint}</p>}
    {error && <p className="error">{error}</p>}
    {!!publications.length && <div className="publication-list">
      {publications.map(p => { const url = publicationUrl(p); return <div key={p.id} className="publication-row">
        <strong>{PLATFORM_LABEL[p.provider] ?? p.provider}</strong> <span>{(`pub.status.${p.status}` as MessageKey) in MESSAGES.fi ? t(`pub.status.${p.status}` as MessageKey) : p.status}</span> <span className="muted">{p.privacy.toLowerCase()}</span>
        {p.status === "UPLOADING" && typeof p.progress === "number" && <> <span className="muted">{t("pub.progress", { progress: p.progress })}</span></>}
        {p.options?.publishAt && <> <span className="muted">{t("pub.yt.scheduledFor", { time: new Date(p.options.publishAt).toLocaleString() })}</span></>}
        {url && <> <a href={url} target="_blank" rel="noreferrer">{t("pub.open")}</a></>}
        {p.error && <p className="error">{p.error}</p>}
        {p.warning && <p className="muted">{t("pub.warning", { warning: p.warning })}</p>}
      </div>; })}
    </div>}
  </div>;
}
