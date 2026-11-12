"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/I18nProvider";
import GraphicsEditor from "./GraphicsEditor";
import type { Asset, Item } from "./graphics-editor/types";
import type { ProjectVariable } from "@/domain/variables";
import styles from "./GraphicsEditorDialog.module.css";

type Props = {
  projectId: string;
  graphicId: string;
  graphicName: string;
  graphicWidth: number;
  graphicHeight: number;
  item: Item;
  assets: Asset[];
  variables?: ProjectVariable[];
  outputWidth?: number;
  outputHeight?: number;
  onChange: (item: Item) => void;
  onRename: (name: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
  onAssetsChanged?: () => void | Promise<void>;
};

/** Full-screen dialog wrapper for the GraphicsEditor. Opens above the page nav. */
export default function GraphicsEditorDialog({
  projectId, graphicId, graphicName, graphicWidth, graphicHeight,
  item, assets, variables = [], outputWidth = 1920, outputHeight = 1080,
  onChange, onRename, onDuplicate, onDelete, onClose, onAssetsChanged,
}: Props) {
  const t = useT();
  const [nameDraft, setNameDraft] = useState(graphicName);
  const nameRef = useRef<HTMLInputElement>(null);

  // Update draft when graphic changes (e.g. duplicate)
  useEffect(() => setNameDraft(graphicName), [graphicName]);

  // Close on Escape unless focus is on the name field
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && document.activeElement !== nameRef.current) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function commitName() {
    const next = nameDraft.trim();
    if (next && next !== graphicName) onRename(next);
    else setNameDraft(graphicName);
  }

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label={graphicName}>
      <div className={styles.dialog}>
        <header className={styles.head}>
          <input
            ref={nameRef}
            className={styles.nameInput}
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
            aria-label={t("str.graphicName")}
          />
          <span className={styles.meta}>{graphicWidth} × {graphicHeight}</span>
          <div className={styles.actions}>
            <button type="button" className={styles.actionBtn} onClick={onDuplicate} title={t("str.duplicateGraphic")} aria-label={t("str.duplicateGraphic")}>
              ⧉ {t("str.duplicateGraphic")}
            </button>
            <button type="button" className={`${styles.actionBtn} ${styles.actionBtnDanger}`} onClick={onDelete} title={t("str.deleteGraphic")} aria-label={t("str.deleteGraphic")}>
              🗑 {t("str.deleteGraphic")}
            </button>
            <button type="button" className={styles.closeBtn} onClick={onClose} aria-label={t("tr.dialogClose")}>✕</button>
          </div>
        </header>
        <div className={styles.editorWrap}>
          <GraphicsEditor
            key={graphicId}
            projectId={projectId}
            graphicId={graphicId}
            item={item}
            assets={assets}
            title={graphicName}
            variables={variables}
            outputWidth={outputWidth}
            outputHeight={outputHeight}
            onChange={onChange}
            onAssetsChanged={onAssetsChanged}
          />
        </div>
      </div>
    </div>
  );
}
