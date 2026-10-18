"use client";

import { useState } from "react";
import { useT } from "@/i18n/I18nProvider";
import { errorMessage, requestJson } from "@/components/api";
import { formatTime } from "@/components/format";
import AssetPicker from "@/components/AssetPicker";
import { AudioCapture, type AudioAsset } from "@/components/AudioCapture";

export type { AudioAsset } from "@/components/AudioCapture";
type Item = { type: string; assetId?: string; mode?: string; startSeconds?: number; endSeconds?: number; [key: string]: unknown };
type Definition = { composition: { items: Item[]; [key: string]: unknown }; [key: string]: unknown };

/** Trim window of a new timeline clip for a whole asset; assets without a known duration get 10 s. */
export function audioClipFor(asset: AudioAsset, mode: "standalone" | "mix"): Item {
  const seconds = asset.durationMs ? Math.max(0.1, asset.durationMs / 1000) : 10;
  return { type: "audio-clip", assetId: asset.id, mode, startSeconds: 0, endSeconds: Math.round(seconds * 1000) / 1000, volume: 1, ...(mode === "mix" ? { atSeconds: 0, duckSourceVolume: 0.25 } : {}) };
}

type Props = { projectId: string; assets: AudioAsset[]; definition: Definition; onSaveDefinition: (definition: Definition) => Promise<void>; onChanged: () => void | Promise<void> };

export default function VoiceoverPanel({ projectId, assets, definition, onSaveDefinition, onChanged }: Props) {
  const t = useT();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function addToComposition(asset: AudioAsset, mode: "standalone" | "mix") {
    setError(""); setMessage("");
    try { await onSaveDefinition({ ...definition, composition: { ...definition.composition, items: [...definition.composition.items, audioClipFor(asset, mode)] } }); setMessage(mode === "standalone" ? t("vo.addedSection") : t("vo.addedMix")); }
    catch (e) { setError(errorMessage(e, t("vo.updateFailed"))); }
  }
  const usage = (assetId: string) => definition.composition.items.filter(item => item.type === "audio-clip" && item.assetId === assetId).length;

  return <div className="voiceover-panel" style={{ display: "grid", gap: 18 }}>
    <AudioCapture endpoint={`/api/projects/${projectId}/assets`} onSaved={async (asset) => { setMessage(t("vo.saved", { name: asset.assetKey })); await onChanged(); }} />

    {message && <p className="success">{message}</p>}{error && <p className="error">{error}</p>}

    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}><strong>{t("vo.projectAudio")}</strong><button data-testid="audio-from-library" onClick={() => setLibraryOpen(true)}>{t("vo.fromLibrary")}</button></div>
      {libraryOpen && <AssetPicker projectId={projectId} kind="audio" title={t("vo.pickerTitle")} linkedIds={assets.map(a => a.id)} pickLinked={false} onPick={async () => { await onChanged(); setMessage(t("vo.pickerAdded")); }} onClose={() => setLibraryOpen(false)} />}
      <div className="list" style={{ marginTop: 8 }}>
        {assets.map(asset => <div className="row" key={asset.id} style={{ flexWrap: "wrap", gap: 10 }}>
          <span><strong>{asset.assetKey}</strong><small style={{ display: "block" }}>{asset.durationMs ? formatTime(asset.durationMs / 1000) : t("vo.unknownLength")}{usage(asset.id) ? t("vo.usedTimes", { count: usage(asset.id) }) : ""}</small></span>
          <audio controls preload="none" src={`/api/projects/${projectId}/assets/${asset.id}`} style={{ height: 34 }} />
          <span style={{ display: "flex", gap: 6 }}><button onClick={() => void addToComposition(asset, "standalone")} title={t("vo.addSectionTitle")}>{t("vo.addSection")}</button><button onClick={() => void addToComposition(asset, "mix")} title={t("vo.mixTitle")}>{t("vo.mix")}</button></span>
        </div>)}
        {!assets.length && <p className="muted">{t("vo.none")}</p>}
      </div>
    </div>
  </div>;
}
