import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

export type Asset = { id: string; assetKey: string; type: string; mimeType?: string | null; width?: number | null; height?: number | null };
export type GraphicKind = "slate" | "overlay";
export type Layer = {
  id: string;
  type: "text" | "rect" | "ellipse" | "image";
  x: number; y: number; width: number; height: number;
  rotation?: number; text?: string; src?: string; animation?: string;
  style?: Record<string, string | number>;
};
export type Item = {
  type: GraphicKind; template?: string; mode?: "standalone" | "overlay";
  durationSeconds?: number; startSeconds?: number; endSeconds?: number;
  opacity?: number; backgroundImage?: string; data?: Record<string, string>;
};
export type PointerHandler = (e: ReactPointerEvent, layerId: string, kind: string, handle?: string) => void;
export type LayerCss = CSSProperties;
