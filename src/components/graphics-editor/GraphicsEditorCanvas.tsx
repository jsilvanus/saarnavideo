import type { FC, PointerEvent as ReactPointerEvent, RefObject } from "react";
import { HANDLE_LIST } from "./constants";
import { anchor, layerStyle } from "./geometry";
import type { Layer } from "./types";

export const GraphicsEditorCanvas: FC<{
  canvasRef: RefObject<HTMLDivElement | null>; artboardRef: RefObject<HTMLDivElement | null>;
  layers: Layer[]; selectedIds: Set<string>; grid: boolean; safe: boolean; background: string;
  onPointerMove: (e: ReactPointerEvent) => void; onPointerUp: () => void; onCanvasPointerDown: () => void;
  onLayerPointerDown: (e: ReactPointerEvent, id: string, kind: string, handle?: string) => void;
}> = ({ canvasRef, artboardRef, layers, selectedIds, grid, safe, background, onPointerMove, onPointerUp, onCanvasPointerDown, onLayerPointerDown }) => (
  <div className="ge-canvas-wrap">
    <div ref={canvasRef} className="ge-canvas" onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp} onPointerDown={onCanvasPointerDown}>
      <div ref={artboardRef} className="ge-artboard" style={{ background }}>
        {grid && <div className="ge-grid" />}
        {layers.map(l => <div key={l.id} style={layerStyle(l, selectedIds.has(l.id))} onPointerDown={e => onLayerPointerDown(e, l.id, "move")}>
          {l.type === "text" && <div style={{ width: "100%", height: "100%", pointerEvents: "none", overflow: "hidden" }}>{l.text}</div>}
          {l.type === "ellipse" && <div style={{ width: "100%", height: "100%", borderRadius: "50%", pointerEvents: "none" }} />}
          {l.type === "rect" && <div style={{ width: "100%", height: "100%", pointerEvents: "none" }} />}
          {(l.type === "image" || l.type === "svg") && l.src && <img src={l.src} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }} />}
          {selectedIds.has(l.id) && <>
            {HANDLE_LIST.map(h => { const a = anchor(h, l); return <span key={h} className="ge-handle" style={{ left: a.left, top: a.top, cursor: `${h}-resize` }} onPointerDown={e => onLayerPointerDown(e, l.id, "resize", h)} />; })}
            <span className="ge-rotate" style={{ left: l.width / 2, top: -32 }} onPointerDown={e => onLayerPointerDown(e, l.id, "rotate")} />
          </>}
        </div>)}
        {safe && <><div className="ge-safe safe90" /><div className="ge-safe safe80" /></>}
      </div>
    </div>
  </div>
);
