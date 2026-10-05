"use client";

import { useWorkspace } from "./useWorkspace";

export default function Sidebar() {
  const { projects, selectedId, setCreating, menuId, setMenuId, setConfirmDelete, openProject, duplicateProject } = useWorkspace();
  return (
    <aside className="sidebar">
      <div className="brand">SaarnaVideo</div>
      <button className="new" onClick={() => setCreating(true)}>
        ＋ Uusi projekti
      </button>
      <div className="projects">
        {projects.map((p) => (
          <div key={p.id} className={`project ${selectedId === p.id ? "selected" : ""}`}>
            <button className="project-main" onClick={() => void openProject(p.id)}>
              <strong>{p.title}</strong>
            </button>
            <button className="more" aria-label={`Toiminnot: ${p.title}`} onClick={() => setMenuId(menuId === p.id ? null : p.id)}>
              ⋯
            </button>
            {menuId === p.id && (
              <div className="menu">
                <button onClick={() => void duplicateProject(p)}>Monista</button>
                <button
                  className="danger"
                  onClick={() => {
                    setConfirmDelete(p);
                    setMenuId(null);
                  }}
                >
                  Poista…
                </button>
              </div>
            )}
          </div>
        ))}
        {!projects.length && <p className="muted">Ei vielä projekteja.</p>}
      </div>
    </aside>
  );
}
