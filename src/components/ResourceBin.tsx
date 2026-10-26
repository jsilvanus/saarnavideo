"use client";

import type { DragEvent } from "react";
import type { Graphic } from "@/domain/graphics";
import { useT } from "@/i18n/I18nProvider";
import type { DropPayload } from "@/domain/timeline-drop";

/** Drag data types are readable while dragging (the data itself is not), so the kind travels as a type of its own. */
export const RESOURCE_TYPE_PREFIX = "application/x-saarnavideo-";

/** Starts dragging a resource: JSON for the drop and a type that tells the lanes what is coming. */
export function startResourceDrag(event: DragEvent, payload: DropPayload & { kind: DropPayload["kind"] | "source" }) {
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData("application/json", JSON.stringify(payload));
  event.dataTransfer.setData(`${RESOURCE_TYPE_PREFIX}${payload.kind}`, payload.id);
}

/** The graphics and voiceover audio of the project as tiles to drag onto the lanes of the timeline. */
export default function ResourceBin({ graphics, audioAssets }: { graphics: Graphic[]; audioAssets: Array<{ id: string; assetKey: string }> }) {
  const t = useT();
  return <div className="resource-bin" data-testid="resource-bin">
    <div className="resource-bin-title"><strong>{t("comp.binTitle")}</strong><span>{t("tl.bin.help")}</span></div>
    <div className="resource-bin-grid">
      <div className="resource-tile graphic" draggable title={t("tl.black")} onDragStart={event => startResourceDrag(event, { kind: "black", id: "black" })}><span className="resource-icon">■</span><span>{t("tl.black")}</span></div>
      {graphics.map(graphic => <div key={graphic.id} className="resource-tile graphic" draggable title={graphic.name} onDragStart={event => startResourceDrag(event, { kind: "graphic", id: graphic.id })}><span className="resource-icon">✦</span><span>{graphic.name}</span></div>)}
      {audioAssets.map(asset => <div key={asset.id} className="resource-tile audio" draggable title={asset.assetKey} onDragStart={event => startResourceDrag(event, { kind: "audio", id: asset.id })}><span className="resource-icon">🎙</span><span>{asset.assetKey}</span></div>)}
      
    </div>
  </div>;
}
