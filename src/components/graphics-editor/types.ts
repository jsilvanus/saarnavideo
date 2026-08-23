import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

export type Asset = { id: string; assetKey: string; type: string; mimeType?: string | null; width?: number | null; height?: number | null };
export type Layer = {
  id: string;
  type: "text" | "rect" | "ellipse" | "image" | "svg";
  x: number; y: number; width: number; height: number;
  rotation?: number; text?: string; src?: string; assetId?: string; animation?: string;
  style?: Record<string, string | number>;
};
export type Item = { data?: Record<string, string>; template?: string };
export type PointerHandler = (e: ReactPointerEvent, layerId: string, kind: string, handle?: string) => void;
export type LayerCss = CSSProperties;
