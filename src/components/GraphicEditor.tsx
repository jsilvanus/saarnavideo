"use client";

import GraphicsEditor from "@/components/GraphicsEditor";
import type { Graphic } from "@/domain/graphics";

/**
 * Edits a reusable Graphic without making the editor itself aware of timeline
 * placement. The existing DSK editor is given a temporary standalone slate
 * representation and the resulting layer definition is written back to the
 * Graphic.
 */
export default function GraphicEditor({
  projectId,
  graphic,
  assets,
  onChange,
}: {
  projectId: string;
  graphic: Graphic;
  assets: Array<{ id: string; assetKey: string; type: string; mimeType?: string | null; width?: number | null; height?: number | null }>;
  onChange: (graphic: Graphic) => void;
}) {
  const item = {
    type: "slate" as const,
    template: "rich",
    mode: "standalone" as const,
    durationSeconds: 1,
    data: {
      backgroundColor: graphic.backgroundColor,
      layers: JSON.stringify(graphic.layers),
    },
  };

  return (
    <GraphicsEditor
      projectId={projectId}
      item={item}
      assets={assets}
      title={graphic.name}
      onChange={(next) => {
        let layers = graphic.layers;
        const raw = next.data?.layers;
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) layers = parsed;
          } catch {
            // Keep the last valid graphic if the editor is mid-edit.
          }
        }
        onChange({
          ...graphic,
          backgroundColor: next.data?.backgroundColor ?? graphic.backgroundColor,
          layers,
        });
      }}
    />
  );
}
