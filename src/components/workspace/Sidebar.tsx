"use client";

import { useWorkspace } from "./useWorkspace";
import { useT } from "@/i18n/I18nProvider";
import styles from "./Sidebar.module.css";

export default function Sidebar() {
  const { projects, selectedId, setCreating, menuId, setMenuId, setConfirmDelete, openProject, duplicateProject } = useWorkspace();
  const t = useT();
  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>SaarnaVideo</div>
      <button className={styles.new} onClick={() => setCreating(true)}>
        {t("sidebar.new")}
      </button>
      <div className={styles.projects}>
        {projects.map((p) => (
          <div key={p.id} className={`${styles.project} ${selectedId === p.id ? styles.selected : ""}`}>
            <button className={styles.projectMain} onClick={() => void openProject(p.id)}>
              <strong>{p.title}</strong>
            </button>
            <button className={styles.more} aria-label={t("sidebar.actions", { title: p.title })} onClick={() => setMenuId(menuId === p.id ? null : p.id)}>
              ⋯
            </button>
            {menuId === p.id && (
              <div className={styles.menu}>
                <button onClick={() => void duplicateProject(p)}>{t("sidebar.duplicate")}</button>
                <button
                  className={styles.danger}
                  onClick={() => {
                    setConfirmDelete(p);
                    setMenuId(null);
                  }}
                >
                  {t("sidebar.delete")}
                </button>
              </div>
            )}
          </div>
        ))}
        {!projects.length && <p className="muted">{t("sidebar.empty")}</p>}
      </div>
    </aside>
  );
}
