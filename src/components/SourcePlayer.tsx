"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { formatTime } from "./format";

type PlayableSource = { id: string; type: "UPLOAD" | "YOUTUBE"; status?: "PENDING" | "AVAILABLE"; youtubeVideoId?: string | null };
type YouTubePlayer = { getCurrentTime: () => number; seekTo: (seconds: number, allowSeekAhead: boolean) => void; destroy: () => void };
type YTWindow = Window & { YT?: { Player: new (element: HTMLElement, options: { videoId: string; events?: { onReady?: () => void } }) => YouTubePlayer }; onYouTubeIframeAPIReady?: () => void };

export type SourcePlayerState = {
  current: number;
  setCurrent: (seconds: number) => void;
  seek: (seconds: number) => void;
  videoRef: RefObject<HTMLVideoElement | null>;
  ytHostRef: RefObject<HTMLDivElement | null>;
  localUrl: string | null;
};

/**
 * Preview-player state for a project source: a YouTube iframe player, a local
 * (not yet uploaded) file, or the stored upload. `onReset` runs whenever the
 * selected source or its local file changes, so callers can reset their range.
 */
export function useSourcePlayer(source: PlayableSource | undefined, sourceId: string, localFile: File | undefined, onReset: () => void): SourcePlayerState {
  const [current, setCurrent] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const ytRef = useRef<YouTubePlayer | null>(null);
  const ytHostRef = useRef<HTMLDivElement>(null);
  const localUrlRef = useRef<string | null>(null);
  const onResetRef = useRef(onReset);
  onResetRef.current = onReset;

  useEffect(() => {
    onResetRef.current(); setCurrent(0);
    ytRef.current?.destroy(); ytRef.current = null;
    if (localUrlRef.current) { URL.revokeObjectURL(localUrlRef.current); localUrlRef.current = null; }
  }, [sourceId]);

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
      if (!document.getElementById("youtube-iframe-api")) { const script = document.createElement("script"); script.id = "youtube-iframe-api"; script.src = "https://www.youtube.com/iframe_api"; document.body.appendChild(script); }
      const previous = win.onYouTubeIframeAPIReady;
      win.onYouTubeIframeAPIReady = () => { previous?.(); create(); };
    }
    return () => { cancelled = true; if (timer) clearInterval(timer); ytRef.current?.destroy(); ytRef.current = null; };
  }, [source?.type, source?.youtubeVideoId, sourceId]);

  useEffect(() => {
    if (source?.status === "PENDING" && localFile) {
      if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current);
      localUrlRef.current = URL.createObjectURL(localFile);
      setCurrent(0); onResetRef.current();
    }
    return () => { if (localUrlRef.current) { URL.revokeObjectURL(localUrlRef.current); localUrlRef.current = null; } };
  }, [source?.id, source?.status, localFile]);

  const seek = (seconds: number) => {
    const n = Math.max(0, seconds);
    setCurrent(n);
    if (source?.type === "YOUTUBE") ytRef.current?.seekTo(n, true);
    else if (videoRef.current) videoRef.current.currentTime = n;
  };

  return { current, setCurrent, seek, videoRef, ytHostRef, localUrl: localUrlRef.current };
}

/** Player plus current time and ±5s/±30s seek buttons; `children` are extra buttons in the same row. */
export function SourcePlayer({ source, player, localFile, remoteSrc, onDuration, children }: {
  source: PlayableSource; player: SourcePlayerState; localFile?: File; remoteSrc: string;
  onDuration: (seconds: number) => void; children?: ReactNode;
}) {
  const { current, setCurrent, seek, videoRef, ytHostRef, localUrl } = player;
  return <>
    <div className="picker-player">
      {source.type === "YOUTUBE" && source.youtubeVideoId ? <div ref={ytHostRef} />
        : source.status === "PENDING" && localFile ? <video ref={videoRef} src={localUrl ?? undefined} controls onTimeUpdate={e => setCurrent(e.currentTarget.currentTime)} />
        : source.status === "PENDING" ? <div className="muted">Choose the local file in Sources to preview it.</div>
        : <video ref={videoRef} src={remoteSrc} controls preload="metadata" onTimeUpdate={e => setCurrent(e.currentTarget.currentTime)} onLoadedMetadata={e => { if (e.currentTarget.duration) onDuration(e.currentTarget.duration); }} />}
    </div>
    <div className="picker-time">
      <strong>{formatTime(current)}</strong>
      <div className="picker-buttons">
        <button type="button" onClick={() => seek(current - 30)}>−30s</button>
        <button type="button" onClick={() => seek(current - 5)}>−5s</button>
        <button type="button" onClick={() => seek(current + 5)}>+5s</button>
        <button type="button" onClick={() => seek(current + 30)}>+30s</button>
        {children}
      </div>
    </div>
  </>;
}
