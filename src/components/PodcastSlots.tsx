"use client";

import { useState } from "react";
import { useT } from "@/i18n/I18nProvider";
import { RESOURCE_TYPE_PREFIX } from "./ResourceBin";
import styles from "./TimelineView.module.css";

export type PodcastSlot = "intro" | "outro";
type AudioAsset = { id: string; assetKey: string };

/**
 * The two places on the audio lane that exist only for the podcast: an intro before the video's first second and an
 * outro after its last. They are not part of the video (the podcast render adds them around the composition audio),
 * so they sit outside the timeline proper, at its left and right ends. Drop a library voiceover on a slot, or pick
 * one from the list; the cross symbol empties it.
 */
export default function PodcastSlots({ introAssetId, outroAssetId, audioAssets, onChange }: {
  introAssetId?: string; outroAssetId?: string; audioAssets: AudioAsset[];
  onChange: (slot: PodcastSlot, assetId: string | undefined) => void;
}) {
  const t = useT();
  return <div className={styles["podcast-slots"]} data-testid="podcast-slots">
    <Slot slot="intro" assetId={introAssetId} audioAssets={audioAssets} onChange={onChange} />
    <span className={`muted ${styles["podcast-slots-help"]}`}>{t("tl.podcast.help")}</span>
    <Slot slot="outro" assetId={outroAssetId} audioAssets={audioAssets} onChange={onChange} />
  </div>;
}

function Slot({ slot, assetId, audioAssets, onChange }: { slot: PodcastSlot; assetId?: string; audioAssets: AudioAsset[]; onChange: (slot: PodcastSlot, assetId: string | undefined) => void }) {
  const t = useT();
  const [over, setOver] = useState(false);
  const asset = audioAssets.find(candidate => candidate.id === assetId);
  const accepts = (event: React.DragEvent) => event.dataTransfer.types.includes(`${RESOURCE_TYPE_PREFIX}audio`);
  return <div
    className={`${styles["podcast-slot"]} ${over ? styles["podcast-slot-over"] : ""}`}
    data-testid={`podcast-slot-${slot}`}
    onDragOver={event => { if (!accepts(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setOver(true); }}
    onDragLeave={() => setOver(false)}
    onDrop={event => {
      setOver(false);
      if (!accepts(event)) return;
      event.preventDefault();
      try { const id = (JSON.parse(event.dataTransfer.getData("application/json")) as { id?: string }).id; if (id) onChange(slot, id); } catch { /* not ours */ }
    }}
  >
    <strong>{t(`tl.podcast.${slot}` as const)}</strong>
    <select aria-label={t(`tl.podcast.${slot}` as const)} value={assetId ?? ""} onChange={event => onChange(slot, event.target.value || undefined)}>
      <option value="">{t("tl.podcast.empty")}</option>
      {audioAssets.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.assetKey}</option>)}
      {assetId && !asset && <option value={assetId}>{t("tl.audio")}</option>}
    </select>
    {assetId && <button type="button" aria-label={t("tl.podcast.clear")} title={t("tl.podcast.clear")} onClick={() => onChange(slot, undefined)}>×</button>}
  </div>;
}
