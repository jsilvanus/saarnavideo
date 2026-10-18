import type { FC, PointerEvent as ReactPointerEvent, RefObject } from "react";
import { GRID, HANDLE_LIST } from "./constants";
import { anchor, captionAlignment, layerContentStyle, layerFrameStyle } from "./geometry";
import { applyVariables, type ProjectVariable } from "@/domain/variables";
import { aspectLabel } from "@/domain/output-presets";
import { boxToFrame, type FrameLayout } from "@/domain/frame-layout";
import type { Layer, PointerHandler } from "./types";
import styles from "./GraphicsEditor.module.css";

/**
 * The editor stage: the output frame (red border, output size as a label) with a margin around it. Layers are drawn at
 * their place in the frame (`boxToFrame`, the renderer's mapping); what lies outside the frame is dimmed but stays
 * visible and editable. Grid and safe areas follow the frame.
 */
export const GraphicsEditorCanvas: FC<{
  canvasRef: RefObject<HTMLDivElement | null>;
  artboardRef: RefObject<HTMLDivElement | null>;
  scale: number; variables: ProjectVariable[];
  layout: FrameLayout; margin: number;
  layers: Layer[]; selectedIds: Set<string>; grid: boolean; safe: boolean; background: string;
  onPointerMove: (e: ReactPointerEvent) => void; onPointerUp: () => void; onCanvasPointerDown: () => void;
  onLayerPointerDown: PointerHandler;
}> = ({ scale, variables, canvasRef, artboardRef, layout, margin, layers, selectedIds, grid, safe, background, onPointerMove, onPointerUp, onCanvasPointerDown, onLayerPointerDown }) => {
  const stageW = layout.width + 2 * margin, stageH = layout.height + 2 * margin;
  const frame = { left: margin, top: margin, width: layout.width, height: layout.height };
  return (
    <div className="ge-canvas-wrap">
      <div ref={canvasRef} className="ge-canvas" style={{ aspectRatio: `${stageW} / ${stageH}`, width: `min(100%, 1080px, ${Math.round((stageW / stageH) * 72)}vh)` }} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp} onPointerDown={onCanvasPointerDown}>
        <div ref={artboardRef} className="ge-artboard" style={{ width: stageW, height: stageH, background: "#0b1220", transform: `scale(${scale})`, ["--ge-inv" as string]: 1 / scale }}>
          <div className={styles.frame} style={{ ...frame, background }}>
            {grid && <div className="ge-grid" style={{ backgroundSize: `${GRID * layout.k}px ${GRID * layout.k}px` }} />}
            {layers.map(l => {
              const display = boxToFrame(l, layout);
              return <div key={l.id} style={layerFrameStyle(l, display, selectedIds.has(l.id))} onPointerDown={e => onLayerPointerDown(e, l.id, "move")}>
                <div style={layerContentStyle(l, layout.k)}>
                  {l.type === "text" && <div style={{ width: "100%", height: "100%", pointerEvents: "none", overflow: "hidden" }}>{applyVariables(l.text ?? "", variables)}</div>}
                  {l.type === "caption" && <div style={{ width: "100%", height: "100%", pointerEvents: "none", overflow: "hidden", display: "flex", ...captionAlignment(l) }}><span style={{ maxWidth: "100%" }}>{applyVariables(l.text ?? "", variables)}</span></div>}
                  {l.type === "ellipse" && <div style={{ width: "100%", height: "100%", borderRadius: "50%", pointerEvents: "none" }} />}
                  {l.type === "image" && <img src={l.src || ""} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }} />}
                </div>
                {selectedIds.has(l.id) && <>
                  {HANDLE_LIST.map(h => { const a = anchor(h, display); return <span key={h} className="ge-handle" style={{ left: a.left, top: a.top, cursor: `${h}-resize` }} onPointerDown={e => onLayerPointerDown(e, l.id, "resize", h)} />; })}
                  <span className="ge-rotate" style={{ left: display.width / 2, top: -32 / scale }} onPointerDown={e => onLayerPointerDown(e, l.id, "rotate")} />
                </>}
              </div>;
            })}
            {safe && <><div className="ge-safe safe90" /><div className="ge-safe safe80" /></>}
          </div>
          <div className={styles.dim} style={frame} aria-hidden="true" />
          <span className={styles.label} style={{ left: margin, top: 0, height: margin }}>{layout.width} × {layout.height} · {aspectLabel(layout.width, layout.height)}</span>
        </div>
      </div>
    </div>
  );
};
