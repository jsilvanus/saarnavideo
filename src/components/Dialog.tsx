"use client";

import { useEffect, type ReactNode } from "react";
import { useT } from "@/i18n/I18nProvider";
import styles from "./Dialog.module.css";

/**
 * Modal dialog for a secondary task. Closes with the ✕ button or Escape only,
 * so an unsaved edit is never lost to a stray click on the backdrop.
 */
export default function Dialog({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return <div className={styles.backdrop}>
    <div role="dialog" aria-modal="true" aria-label={title} className={`${styles.panel}${wide ? ` ${styles.wide}` : ""}`}>
      <header className={styles.head}>
        <h2>{title}</h2>
        <button type="button" onClick={onClose} aria-label={t("tr.dialogClose")}>✕</button>
      </header>
      <div className={styles.body}>{children}</div>
    </div>
  </div>;
}
