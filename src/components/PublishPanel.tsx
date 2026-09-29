"use client";

import { useEffect, useState } from "react";
import { errorMessage, jsonInit, requestJson } from "./api";

export type Publication = { id: string; provider: "YOUTUBE" | "FACEBOOK"; status: "QUEUED" | "UPLOADING" | "COMPLETED" | "FAILED"; privacy: string; externalId?: string | null; error?: string | null; createdAt?: string };
type Platform = Publication["provider"];
type FacebookStatus = { configured: boolean; pageName?: string | null; error?: string };

const ACTIVE = new Set(["QUEUED", "UPLOADING"]);
export const PLATFORM_LABEL: Record<Platform, string> = { YOUTUBE: "YouTube", FACEBOOK: "Facebook" };

/** Privacy choices per platform. Facebook has no unlisted videos: PRIVATE uploads an unpublished video. */
export const PRIVACY_OPTIONS: Record<Platform, Array<{ value: string; label: string }>> = {
  YOUTUBE: [{ value: "PRIVATE", label: "Private" }, { value: "UNLISTED", label: "Unlisted" }, { value: "PUBLIC", label: "Public" }],
  FACEBOOK: [{ value: "PRIVATE", label: "Unpublished (visible to Page admins only)" }, { value: "PUBLIC", label: "Published on the Page" }],
};

export function publicationUrl(publication: Publication): string | null {
  if (publication.status !== "COMPLETED" || !publication.externalId) return null;
  return publication.provider === "YOUTUBE" ? `https://www.youtube.com/watch?v=${publication.externalId}` : `https://www.facebook.com/${publication.externalId}`;
}

export default function PublishPanel({ projectId, publications, hasVideo, onRefresh }: { projectId: string; publications: Publication[]; hasVideo: boolean; onRefresh: () => void }) {
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
  const running = publications.some(p => ACTIVE.has(p.status));
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(onRefresh, 3000);
    return () => clearInterval(timer);
  }, [running, onRefresh]);

  function choosePlatform(next: Platform) {
    setPlatform(next);
    if (!PRIVACY_OPTIONS[next].some(o => o.value === privacy)) setPrivacy("PRIVATE");
  }

  const facebookReady = Boolean(facebook?.configured);
  const platformHint = platform === "FACEBOOK"
    ? (facebook?.error ? `Facebook Page problem: ${facebook.error}` : facebookReady ? `Publishes to the Page “${facebook?.pageName ?? "?"}”.` : "")
    : (youtubeConnected === false ? "Connect a YouTube account first (top right)." : "");

  async function publish() {
    setBusy(true); setError("");
    try {
      await requestJson(`/api/projects/${projectId}/publish`, jsonInit("POST", { platform, privacy }), "Could not queue the publication");
      onRefresh();
    } catch (e) { setError(errorMessage(e, "Could not queue the publication")); }
    finally { setBusy(false); }
  }

  return <div className="publish-panel">
    <h3>Publish</h3>
    {!hasVideo && <p className="muted">Generate a video first.</p>}
    <div className="picker-controls">
      <label>Platform<select value={platform} onChange={e => choosePlatform(e.target.value as Platform)}>
        <option value="YOUTUBE">YouTube</option>
        <option value="FACEBOOK" disabled={!facebookReady}>Facebook{facebookReady ? "" : " (not configured)"}</option>
      </select></label>
      <label>Visibility<select value={privacy} onChange={e => setPrivacy(e.target.value)}>{PRIVACY_OPTIONS[platform].map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
      <button className="primary" disabled={busy || !hasVideo || (platform === "FACEBOOK" && !facebookReady) || (platform === "YOUTUBE" && youtubeConnected === false)} onClick={() => void publish()}>{busy ? "Queuing…" : `Publish to ${PLATFORM_LABEL[platform]}`}</button>
    </div>
    {!facebookReady && <p className="muted">Facebook is not configured: set FACEBOOK_PAGE_ID and FACEBOOK_PAGE_ACCESS_TOKEN on the server and worker (docs/FACEBOOK_SETUP.md).</p>}
    {platformHint && <p className="muted">{platformHint}</p>}
    {error && <p className="error">{error}</p>}
    {!!publications.length && <div className="publication-list">
      {publications.map(p => { const url = publicationUrl(p); return <div key={p.id} className="publication-row">
        <strong>{PLATFORM_LABEL[p.provider] ?? p.provider}</strong> <span>{p.status}</span> <span className="muted">{p.privacy.toLowerCase()}</span>
        {url && <> <a href={url} target="_blank" rel="noreferrer">Open ↗</a></>}
        {p.error && <p className="error">{p.error}</p>}
      </div>; })}
    </div>}
  </div>;
}
