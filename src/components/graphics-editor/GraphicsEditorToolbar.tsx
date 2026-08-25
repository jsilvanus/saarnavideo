import type { FC } from "react";

export const GraphicsEditorToolbar: FC<{
  grid: boolean; safe: boolean;
  onAdd: (type: "text" | "rect" | "ellipse" | "image") => void;
  onDuplicate: () => void; onDelete: () => void;
  onToggleGrid: () => void; onToggleSafe: () => void;
  onExportEmbedded?: () => void; onExportReferenced?: () => void; onImport?: (file: File) => void;
}> = ({ grid, safe, onAdd, onDuplicate, onDelete, onToggleGrid, onToggleSafe, onExportEmbedded, onExportReferenced, onImport }) => {
  const inputId = "svgraphic-import-input";
  return <div className="ge-toolbar" aria-label="Graphic tools">
    <button onClick={() => onAdd("text")}>＋ Text</button>
    <button onClick={() => onAdd("rect")}>＋ Rectangle</button>
    <button onClick={() => onAdd("ellipse")}>＋ Ellipse</button>
    <button onClick={() => onAdd("image")}>＋ Image</button>
    <span className="ge-spacer" />
    <button onClick={onDuplicate}>Duplicate</button>
    <button onClick={onDelete}>Delete</button>
    {onExportEmbedded && <button onClick={onExportEmbedded}>Export .svgraphic</button>}
    {onExportReferenced && <button onClick={onExportReferenced}>Export refs</button>}
    {onImport && <><button onClick={() => document.getElementById(inputId)?.click()}>Import .svgraphic</button><input id={inputId} type="file" accept=".svgraphic,application/vnd.saarnavideo.graphic+json,application/json" hidden onChange={e => { const file = e.target.files?.[0]; if (file) onImport(file); e.currentTarget.value = ""; }} /></>}
    <button className={grid ? "ge-active" : ""} onClick={onToggleGrid}>Grid</button>
    <button className={safe ? "ge-active" : ""} onClick={onToggleSafe}>Safe area</button>
  </div>;
};
