"use client";

import { useState } from "react";
import type { ClipAudio } from "@/domain/clip-audio";
import { useT } from "@/i18n/I18nProvider";
import styles from "./SectionAudio.module.css";

const isEmpty = (audio: ClipAudio) => audio.volume === undefined && !audio.highpassHz && !audio.humHz && !audio.normalize;

/**
 * Sound settings of a section: manual fader (volume), loudness normalisation, high-pass and a mains-hum filter. Saved
 * when a control changes; the render applies them to the clips cut from the section (src/domain/clip-audio.ts).
 */
export default function SectionAudio({ current, onSave }: { current: ClipAudio | undefined; onSave: (audio: ClipAudio | undefined) => Promise<void> | void }) {
  const t = useT();
  const audio = current ?? {};
  const [volume, setVolume] = useState(String(audio.volume ?? 1));
  const commit = (patch: Partial<ClipAudio>) => {
    const next: ClipAudio = { ...audio, ...patch };
    for (const key of Object.keys(next) as Array<keyof ClipAudio>) if (next[key] === undefined || next[key] === false) delete next[key];
    void onSave(isEmpty(next) ? undefined : next);
  };
  return <details className={styles.audio}>
    <summary>{t("seq.audio")}{current ? ` · ${t("seq.audio.set")}` : ""}</summary>
    <div className={styles.row}>
      <label>{t("seq.audio.volume")}
        <input type="range" min="0" max="2" step="0.05" value={volume} onChange={e => setVolume(e.target.value)}
          onPointerUp={() => commit({ volume: Number(volume) === 1 ? undefined : Number(volume) })}
          onKeyUp={() => commit({ volume: Number(volume) === 1 ? undefined : Number(volume) })} />
        <output>{Math.round(Number(volume) * 100)} %</output>
      </label>
      <label><input type="checkbox" checked={Boolean(audio.normalize)} onChange={e => commit({ normalize: e.target.checked })} />{t("seq.audio.normalize")}</label>
      <label><input type="checkbox" checked={Boolean(audio.highpassHz)} onChange={e => commit({ highpassHz: e.target.checked ? 80 : undefined })} />{t("seq.audio.highpass")}</label>
      {audio.highpassHz !== undefined && <label>Hz<input type="number" min="20" max="500" step="10" value={audio.highpassHz} onChange={e => { const n = Number(e.target.value); if (n >= 20 && n <= 500) commit({ highpassHz: n }); }} /></label>}
      <label>{t("seq.audio.hum")}
        <select value={audio.humHz ?? ""} onChange={e => commit({ humHz: e.target.value ? (Number(e.target.value) as 50 | 60) : undefined })}>
          <option value="">{t("seq.audio.humOff")}</option>
          <option value="50">50 Hz</option>
          <option value="60">60 Hz</option>
        </select>
      </label>
      {current && <button type="button" onClick={() => { setVolume("1"); void onSave(undefined); }}>{t("seq.audio.reset")}</button>}
    </div>
  </details>;
}
