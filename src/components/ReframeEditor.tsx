"use client";

import { useEffect, useRef, useState } from "react";
import type { MessageKey } from "@/i18n/translate";
import { useT } from "@/i18n/I18nProvider";
import { aspectLabel } from "@/domain/output-presets";
import { cropAspect, cropForAspect, type CropRect, type Reframe } from "@/domain/reframe";
import { choiceOf, dragCrop, reframeBadge, reframeFromChoice, withZoom, zoomOf, type ReframeChoice } from "./reframe-helpers";

type PreviewSource = { id: string; type: "UPLOAD" | "YOUTUBE"; status?: "PENDING" | "AVAILABLE"; youtubeVideoId?: string | null };
type Props = {
  title: string;
  current: Reframe | undefined;
  /** Label of the "no setting here" option, e.g. "Use project default" or "Use section setting". */
  defaultLabel: string;
  source?: PreviewSource;
  atSeconds: number;
  outWidth: number;
  outHeight: number;
  onSave: (reframe: Reframe | undefined) => Promise<void>;
};

const CHOICES: Array<[ReframeChoice, MessageKey]> = [["fill", "reframe.choice.fill"], ["custom", "reframe.choice.custom"], ["fit-blur", "reframe.choice.fitBlur"], ["fit-color", "reframe.choice.fitColor"]];

/** "Reframe" button with its badge; opens the crop dialog. */
export default function ReframeEditor({ title, current, defaultLabel, source, atSeconds, outWidth, outHeight, onSave }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const badge = reframeBadge(current);
  return <>
    <button type="button" data-testid="reframe-open" style={{ padding: "5px 10px", border: 0, borderRadius: 7, background: "#e5e7eb", color: "#18202a", fontSize: 12, fontWeight: 600, cursor: "pointer" }} onClick={() => setOpen(true)} title={t("reframe.openTitle")}>{t("reframe.open")}</button>
    {badge && <span data-testid="reframe-badge" title={t("reframe.badgeTitle")} style={{ fontSize: 11, padding: "1px 6px", borderRadius: 999, background: "#dbeafe", color: "#1e40af" }}>{t(`reframe.badge.${badge}`)}</span>}
    {open && <ReframeDialog title={title} current={current} defaultLabel={defaultLabel} source={source} atSeconds={atSeconds} outWidth={outWidth} outHeight={outHeight} onClose={() => setOpen(false)} onSave={async value => { await onSave(value); setOpen(false); }} />}
  </>;
}

function ReframeDialog({ title, current, defaultLabel, source, atSeconds, outWidth, outHeight, onClose, onSave }: Props & { onClose: () => void }) {
  const t = useT();
  const [choice, setChoice] = useState<ReframeChoice>(choiceOf(current));
  const [crop, setCrop] = useState<CropRect | null>(current?.crop ?? null);
  const [size, setSize] = useState({ w: 1920, h: 1080 });
  const [frameReady, setFrameReady] = useState(0);
  const [saving, setSaving] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null), boxRef = useRef<HTMLDivElement>(null), previewRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; start: CropRect } | null>(null);
  const hasFile = source?.type === "UPLOAD" && source.status !== "PENDING";

  const fresh = cropForAspect(size.w, size.h, outWidth, outHeight);
  const rect = crop ?? fresh;
  const zoom = zoomOf(rect, size.w, size.h, outWidth, outHeight);
  const mismatch = !!crop && Math.abs(cropAspect(crop, size.w, size.h) / (outWidth / outHeight) - 1) > 0.02;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const loaded = () => { if (video.videoWidth && video.videoHeight) setSize({ w: video.videoWidth, h: video.videoHeight }); video.currentTime = Math.max(0, atSeconds); };
    const seeked = () => setFrameReady(n => n + 1);
    video.addEventListener("loadedmetadata", loaded); video.addEventListener("seeked", seeked);
    if (video.readyState >= 1) loaded();
    return () => { video.removeEventListener("loadedmetadata", loaded); video.removeEventListener("seeked", seeked); };
  }, [atSeconds, source?.id]);

  useEffect(() => {
    const canvas = previewRef.current, video = videoRef.current;
    if (!canvas || !video || !frameReady || choice === "default") return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = choice === "fit-blur" ? "#374151" : "#000"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    try {
      if (choice === "fit-blur" || choice === "fit-color") {
        const scale = Math.min(canvas.width / size.w, canvas.height / size.h), w = size.w * scale, h = size.h * scale;
        ctx.drawImage(video, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
      } else {
        const c = choice === "custom" ? rect : fresh;
        ctx.drawImage(video, c.x * size.w, c.y * size.h, c.w * size.w, c.h * size.h, 0, 0, canvas.width, canvas.height);
      }
    } catch { /* frame not decodable yet */ }
  });

  const setRect = (next: CropRect) => { setCrop(next); setChoice("custom"); };
  const onPointerDown = (event: React.PointerEvent) => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, start: rect }; if (choice !== "custom") setChoice("custom"); };
  const onPointerMove = (event: React.PointerEvent) => {
    const state = drag.current, box = boxRef.current?.getBoundingClientRect();
    if (!state || !box) return;
    setCrop(dragCrop(state.start, event.clientX - state.x, event.clientY - state.y, box.width, box.height));
  };
  const onPointerUp = (event: React.PointerEvent) => { drag.current = null; try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already released */ } };

  const save = async () => { setSaving(true); try { await onSave(reframeFromChoice(choice, choice === "custom" ? rect : undefined)); } finally { setSaving(false); } };
  const previewW = 110, previewH = Math.max(40, Math.min(200, Math.round(previewW * outHeight / outWidth)));

  return <div className="backdrop"><div className="modal" role="dialog" aria-label={t("reframe.dialogLabel")} data-testid="reframe-modal" style={{ width: "min(780px,calc(100% - 30px))", maxHeight: "92vh", overflow: "auto", display: "grid", gap: 12 }}>
    <h2 style={{ margin: 0 }}>{t("reframe.dialogTitle", { title })}</h2>
    <div data-testid="reframe-mode" role="radiogroup" style={{ display: "flex", gap: "8px 18px", flexWrap: "wrap" }}>
      {([["default", defaultLabel] as [ReframeChoice, string], ...CHOICES.map(([value, key]) => [value, t(key)] as [ReframeChoice, string])]).map(([value, label]) => <label key={value} style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 400 }}><input type="radio" style={{ width: "auto", margin: 0 }} name="reframe-mode" data-testid={`reframe-mode-${value}`} checked={choice === value} onChange={() => setChoice(value)} />{label}</label>)}
    </div>
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
      <div style={{ flex: "1 1 420px", minWidth: 0 }}>
        <div ref={boxRef} data-testid="reframe-frame" style={{ position: "relative", width: "100%", aspectRatio: `${size.w} / ${size.h}`, background: "#111", overflow: "hidden", touchAction: "none" }}>
          {hasFile && <video ref={videoRef} muted preload="auto" src={`/api/sources/${source!.id}`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />}
          {!hasFile && source?.type === "YOUTUBE" && source.youtubeVideoId && <img alt="" src={`https://i.ytimg.com/vi/${source.youtubeVideoId}/hqdefault.jpg`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />}
          {!hasFile && !(source?.type === "YOUTUBE" && source.youtubeVideoId) && <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#9ca3af", fontSize: 13 }}>{t("reframe.noPicture")}</span>}
          {choice === "custom" && <div data-testid="reframe-rect" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
            style={{ position: "absolute", left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%`, border: "2px solid #fbbf24", boxShadow: "0 0 0 9999px rgba(0,0,0,.55)", cursor: "move", boxSizing: "border-box" }} />}
        </div>
        {choice === "custom" && <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 400 }}>{t("reframe.zoom")} <input style={{ width: 160 }} data-testid="reframe-zoom" type="range" min="1" max="4" step="0.05" value={zoom} onChange={e => setRect(withZoom(rect, Number(e.target.value), size.w, size.h, outWidth, outHeight))} /> {zoom.toFixed(2)}×</label>
          <button type="button" onClick={() => setRect(cropForAspect(size.w, size.h, outWidth, outHeight, { x: 0.5, y: 0.5 }, zoom))}>{t("reframe.centre")}</button>
          <button type="button" onClick={() => { setCrop(null); setChoice("custom"); }}>{t("reframe.reset")}</button>
        </div>}
        {mismatch && choice === "custom" && <small className="error">{t("reframe.mismatch")}</small>}
        <small className="muted" style={{ display: "block", marginTop: 6 }}>{t("reframe.source", { width: size.w, height: size.h })}{choice === "custom" ? t("reframe.dragHint") : t("reframe.startFrame")}</small>
      </div>
      <div style={{ display: "grid", gap: 4, justifyItems: "center" }}>
        <small className="muted">{t("reframe.output", { width: outWidth, height: outHeight, aspect: aspectLabel(outWidth, outHeight) })}</small>
        <div data-testid="reframe-output-shape" style={{ width: previewW, height: previewH, border: "1px solid #9ca3af", background: "#000", display: "grid", placeItems: "center", overflow: "hidden" }}>
          <canvas ref={previewRef} width={previewW * 2} height={previewH * 2} style={{ width: previewW, height: previewH, display: choice === "default" ? "none" : "block" }} />
          {choice === "default" && <small style={{ color: "#9ca3af", textAlign: "center" }}>{t("reframe.inherited")}</small>}
        </div>
      </div>
    </div>
    <div className="actions" style={{ display: "flex", gap: 9, justifyContent: "flex-end" }}>
      <button type="button" onClick={onClose}>{t("common.cancel")}</button>
      <button type="button" className="primary" data-testid="reframe-save" disabled={saving} onClick={() => void save()}>{t("common.save")}</button>
    </div>
  </div></div>;
}
