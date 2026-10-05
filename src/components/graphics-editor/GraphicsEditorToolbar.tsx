import type { FC } from "react";
import { useT } from "@/i18n/I18nProvider";
import type { Layer } from "./types";

export const GraphicsEditorToolbar: FC<{
  grid: boolean; safe: boolean;
  onAdd: (type: Layer["type"]) => void;
  onDuplicate: () => void; onDelete: () => void;
  onToggleGrid: () => void; onToggleSafe: () => void;
}> = ({ grid, safe, onAdd, onDuplicate, onDelete, onToggleGrid, onToggleSafe }) => {
  const t = useT();
  return (
    <div className="ge-toolbar" aria-label={t("ge.tools")}>
      <button onClick={() => onAdd("text")}>{t("ge.addText")}</button>
      <button onClick={() => onAdd("rect")}>{t("ge.addRect")}</button>
      <button onClick={() => onAdd("ellipse")}>{t("ge.addEllipse")}</button>
      <button onClick={() => onAdd("image")}>{t("ge.addImage")}</button>
      <button onClick={() => onAdd("caption")} title={t("ge.addCaptionTitle")}>{t("ge.addCaption")}</button>
      <span className="ge-spacer" />
      <button onClick={onDuplicate}>{t("ge.duplicate")}</button>
      <button onClick={onDelete}>{t("ge.delete")}</button>
      <button className={grid ? "ge-active" : ""} onClick={onToggleGrid}>{t("ge.grid")}</button>
      <button className={safe ? "ge-active" : ""} onClick={onToggleSafe}>{t("ge.safeArea")}</button>
    </div>
  );
};
