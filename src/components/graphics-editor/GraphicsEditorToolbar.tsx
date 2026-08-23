import type { FC } from "react";

export const GraphicsEditorToolbar: FC<{
  grid: boolean; safe: boolean;
  onAdd: (type: "text" | "rect" | "ellipse" | "image") => void;
  onDuplicate: () => void; onDelete: () => void;
  onToggleGrid: () => void; onToggleSafe: () => void;
}> = ({ grid, safe, onAdd, onDuplicate, onDelete, onToggleGrid, onToggleSafe }) => (
  <div className="ge-toolbar" aria-label="Graphic tools">
    <button onClick={() => onAdd("text")}>＋ Text</button>
    <button onClick={() => onAdd("rect")}>＋ Rectangle</button>
    <button onClick={() => onAdd("ellipse")}>＋ Ellipse</button>
    <button onClick={() => onAdd("image")}>＋ Image</button>
    <span className="ge-spacer" />
    <button onClick={onDuplicate}>Duplicate</button>
    <button onClick={onDelete}>Delete</button>
    <button className={grid ? "ge-active" : ""} onClick={onToggleGrid}>Grid</button>
    <button className={safe ? "ge-active" : ""} onClick={onToggleSafe}>Safe area</button>
  </div>
);
