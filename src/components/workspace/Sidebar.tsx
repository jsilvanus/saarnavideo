"use client";

import { useWorkspace } from "./useWorkspace";
import { useT } from "@/i18n/I18nProvider";

export default function Sidebar() {
  const { projects, selectedId, setCreating, menuId, setMenuId, setConfirmDelete, openProject, duplicateProject } = useWorkspace();
  const t = useT();
  return (
    <aside className="sidebar">
      <div className="brand">SaarnaVideo</div>
      <button className="new" onClick={() => setCreating(true)}>
        {t("sidebar.new")}
      </button>
      <div className="projects">
        {projects.map((p) => (
          <div key={p.id} className={`project ${selectedId === p.id ? "selected" : ""}`}>
            <button className="project-main" onClick={() => void openProject(p.id)}>
              <strong>{p.title}</strong>
            </button>
            <button className="more" aria-label={t("sidebar.actions", { title: p.title })} onClick={() => setMenuId(menuId === p.id ? null : p.id)}>
              ⋯
            </button>
            {menuId === p.id && (
              <div className="menu">
                <button onClick={() => void duplicateProject(p)}>{t("sidebar.duplicate")}</button>
                <button
                  className="danger"
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
