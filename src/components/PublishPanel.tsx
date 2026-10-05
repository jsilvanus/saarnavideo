"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/I18nProvider";
import { MESSAGES, type MessageKey } from "@/i18n/translate";
import { errorMessage, jsonInit, requestJson } from "./api";

export type Publication = { id: string; provider: "YOUTUBE" | "FACEBOOK"; status: "QUEUED" | "UPLOADING" | "COMPLETED" | "FAILED"; privacy: string; externalId?: string | null; error?: string | null; createdAt?: string };
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
  const [facebook, setFacebook] = useState<FacebookStatus | null>(null);

  useEffect(() => {
    void fetch("/api/integrations/youtube/status", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then((d: { connected?: boolean } | null) => setYoutubeConnected(d ? Boolean(d.connected) : null)).catch(() => setYoutubeConnected(null));
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

  async function publish() {
    setBusy(true); setError("");
    try {
      await requestJson(`/api/projects/${projectId}/publish`, jsonInit("POST", { platform, privacy }), t("pub.queueFailed"));
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
      <label>{t("pub.visibility")}<select value={privacy} onChange={e => setPrivacy(e.target.value)}>{PRIVACY_OPTIONS[platform].map(o => <option key={o.value} value={o.value}>{t(o.labelKey)}</option>)}</select></label>
      <button className="primary" disabled={busy || !hasVideo || (platform === "FACEBOOK" && !facebookReady) || (platform === "YOUTUBE" && youtubeConnected === false)} onClick={() => void publish()}>{busy ? t("pub.queuing") : t("pub.publishTo", { platform: PLATFORM_LABEL[platform] })}</button>
    </div>
    {!facebookReady && <p className="muted">{t("pub.fbNotConfigured")}</p>}
    {platformHint && <p className="muted">{platformHint}</p>}
    {error && <p className="error">{error}</p>}
    {!!publications.length && <div className="publication-list">
      {publications.map(p => { const url = publicationUrl(p); return <div key={p.id} className="publication-row">
        <strong>{PLATFORM_LABEL[p.provider] ?? p.provider}</strong> <span>{(`pub.status.${p.status}` as MessageKey) in MESSAGES.fi ? t(`pub.status.${p.status}` as MessageKey) : p.status}</span> <span className="muted">{p.privacy.toLowerCase()}</span>
        {url && <> <a href={url} target="_blank" rel="noreferrer">{t("pub.open")}</a></>}
        {p.error && <p className="error">{p.error}</p>}
      </div>; })}
    </div>}
  </div>;
}
