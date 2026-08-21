"use client";

import { FormEvent, ReactNode, useEffect, useState } from "react";

type Project = { id: string; title: string; preacher?: string | null; jobs?: { id: string; status: string; progress: number }[]; outputs?: { id: string; type: string }[]; };
type Section = "Sources" | "Sections" | "Graphics" | "Composition" | "Preview" | "Transcription" | "Generate" | "Download";
const sections: Section[] = ["Sources", "Sections", "Graphics", "Composition", "Preview", "Transcription", "Generate", "Download"];

export default function HomePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [active, setActive] = useState<Section>("Sources");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Project | null>(null);
  const selected = projects.find(p => p.id === selectedId) ?? null;

  async function refresh() { const r = await fetch("/api/projects", { cache: "no-store" }); if (r.ok) { const data = await r.json(); setProjects(data); if (!selectedId && data[0]) setSelectedId(data[0].id); } }
  useEffect(() => { void refresh(); }, []);

  async function createProject(e: FormEvent) {
    e.preventDefault(); setError("");
    try { const r = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, templateKey: "basic" }) }); const data = await r.json(); if (!r.ok) throw new Error(data.error ?? "Project creation failed"); setCreating(false); setTitle(""); await refresh(); setSelectedId(data.id); }
    catch (e) { setError(e instanceof Error ? e.message : "Project creation failed"); }
  }

  async function duplicateProject(project: Project) {
    setMenuId(null); setError("");
    const r = await fetch(`/api/projects/${project.id}/duplicate`, { method: "POST" });
    if (!r.ok) { setError((await r.json()).error ?? "Could not duplicate project"); return; }
    const data = await r.json(); await refresh(); setSelectedId(data.id ?? data.project?.id); setMessage("Project duplicated.");
  }

  async function deleteProject() {
    if (!confirmDelete) return; const project = confirmDelete; setConfirmDelete(null); setMenuId(null); setError("");
    const r = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
    if (!r.ok) { setError((await r.json()).error ?? "Could not delete project"); return; }
    if (selectedId === project.id) setSelectedId(null); await refresh(); setMessage("Project deleted.");
  }

  return <main className="app">
    <aside className="sidebar"><div className="brand">SaarnaVideo</div><button className="new" onClick={() => setCreating(true)}>＋ New project</button><div className="projects">
      {projects.map(p => <div key={p.id} className={`project ${selectedId === p.id ? "selected" : ""}`}><button className="project-main" onClick={() => { setSelectedId(p.id); setActive("Sources"); setMenuId(null); }}><strong>{p.title}</strong><small>{p.preacher || "No author"}</small></button><button className="more" aria-label={`Actions for ${p.title}`} onClick={() => setMenuId(menuId === p.id ? null : p.id)}>⋯</button>{menuId === p.id && <div className="menu"><button onClick={() => duplicateProject(p)}>Duplicate</button><button className="danger" onClick={() => { setConfirmDelete(p); setMenuId(null); }}>Delete…</button></div>}</div>)}
      {projects.length === 0 && <p className="muted">No projects yet.</p>}
    </div></aside>
    <section className="workspace">
      {!selected ? <div className="empty"><h1>{projects.length ? "Select a project" : "Create a project"}</h1><button onClick={() => setCreating(true)}>＋ New project</button></div> : <>
        <header><div><h1>{selected.title}</h1><p className="muted">{selected.preacher || "No author set"}</p></div><button className="primary" onClick={() => setActive("Generate")}>Generate</button></header>
        <nav>{sections.map(s => <button key={s} className={active === s ? "active" : ""} onClick={() => setActive(s)}>{s}</button>)}</nav>
        <div className="content">
          {active === "Sources" && <Panel title="Sources" text="Upload video files or add YouTube targets. Sources are reusable and are not copied when projects are duplicated."><div className="placeholder">Upload source / Add YouTube target</div></Panel>}
          {active === "Sections" && <Panel title="Sections" text="Create clips from your sources by setting source and in/out points."><div className="placeholder">Section / clip editor</div></Panel>}
          {active === "Graphics" && <Panel title="Graphics" text="Upload images and create generic slates, overlays and thumbnails. Author/preacher information can be defined here when it is needed for a graphic."><div className="graphics"><div>＋ Image</div><div>＋ Slate</div><div>＋ Overlay</div><div>＋ Thumbnail</div></div></Panel>}
          {active === "Composition" && <Panel title="Composition" text="Arrange sections and overlays. Drag to reorder and set transitions."><div className="placeholder">Timeline editor</div></Panel>}
          {active === "Preview" && <Panel title="Preview" text="Browser preview can be added when a preview endpoint is available."><div className="preview">Preview</div></Panel>}
          {active === "Transcription" && <Panel title="Transcription" text="Choose a language and create a VTT track from a source."><select><option>Finnish</option><option>English</option><option>Swedish</option><option>Auto detect</option></select><button disabled>Transcribe → VTT</button></Panel>}
          {active === "Generate" && <Panel title="Generate" text="Render the current composition."><button className="primary">Generate video</button></Panel>}
          {active === "Download" && <Panel title="Download" text="Download generated video, thumbnail and transcription when ready.">{selected.outputs?.length ? selected.outputs.map(o => <a className="download" key={o.id} href={`/api/outputs/${o.id}`}>{o.type} ↓</a>) : <p className="muted">Nothing generated yet.</p>}</Panel>}
          {message && <p className="success">{message}</p>}{error && <p className="error">{error}</p>}
        </div>
      </>}
    </section>
    {creating && <div className="backdrop"><form className="modal" onSubmit={createProject}><h2>New project</h2><label>Title<input value={title} onChange={e => setTitle(e.target.value)} required /></label><p className="muted">Author/preacher is optional and can be added later when creating graphics.</p><div className="actions"><button type="button" onClick={() => setCreating(false)}>Cancel</button><button className="primary">Create</button></div>{error && <p className="error">{error}</p>}</form></div>}
    {confirmDelete && <div className="backdrop"><div className="modal"><h2>Delete “{confirmDelete.title}”?</h2><p className="muted">This deletes the project and its composition. Shared source media and assets are kept when still used elsewhere.</p><div className="actions"><button onClick={() => setConfirmDelete(null)}>Cancel</button><button className="dangerButton" onClick={deleteProject}>Delete project</button></div></div></div>}
    <style jsx>{`
      .app{min-height:100vh;display:flex;background:#f6f7f9;color:#18202a;font-family:system-ui,sans-serif}.sidebar{width:270px;flex:none;background:#111827;color:white;padding:20px 14px}.brand{font-size:21px;font-weight:750;padding:4px 8px 18px}.new{width:100%;padding:10px;border:0;border-radius:8px;font-weight:650;margin-bottom:14px}.projects{display:grid;gap:4px}.project{position:relative;display:flex;border-radius:8px}.project.selected{background:#273244}.project-main{flex:1;text-align:left;background:none;color:#e5e7eb;border:0;padding:10px}.project-main strong,.project-main small{display:block}.project-main small{color:#94a3b8;margin-top:3px}.more{background:none;color:#cbd5e1;border:0;padding:0 10px;font-size:20px}.menu{position:absolute;right:4px;top:40px;background:white;color:#111827;border-radius:8px;box-shadow:0 8px 25px #0003;padding:5px;z-index:3;min-width:150px}.menu button{display:block;width:100%;text-align:left;background:none;border:0;padding:9px;border-radius:5px}.menu button:hover{background:#f1f5f9}.danger,.dangerButton{color:#b91c1c!important}.workspace{flex:1;min-width:0}.workspace header{height:92px;background:white;border-bottom:1px solid #e5e7eb;padding:20px 30px;display:flex;justify-content:space-between;align-items:center}.workspace h1{margin:0 0 4px;font-size:24px}.muted{color:#64748b;font-size:14px}.primary{background:#111827;color:white;border:0;border-radius:8px;padding:10px 15px;font-weight:650}nav{display:flex;overflow:auto;background:white;border-bottom:1px solid #e5e7eb;padding:0 20px}nav button{background:none;border:0;padding:14px 11px;color:#64748b;border-bottom:2px solid transparent;white-space:nowrap}nav button.active{color:#111827;border-bottom-color:#111827;font-weight:650}.content{max-width:1050px;padding:28px}.panel{background:white;border:1px solid #e5e7eb;border-radius:12px;padding:24px}.panel h2{margin:0 0 5px}.panel>p{margin-top:0}.placeholder{min-height:180px;border:1px dashed #cbd5e1;border-radius:10px;display:grid;place-items:center;color:#64748b}.graphics{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.graphics div{min-height:120px;border:1px dashed #cbd5e1;border-radius:10px;display:grid;place-items:center;color:#64748b}.preview{height:360px;background:#111827;color:white;border-radius:10px;display:grid;place-items:center}.download{display:inline-block;padding:10px 14px;border:1px solid #d8dee8;border-radius:8px;margin-right:8px;color:#111827;text-decoration:none}.success{color:#047857}.error{color:#b91c1c}.empty{text-align:center;margin:15vh auto}.backdrop{position:fixed;inset:0;background:#0008;display:grid;place-items:center;z-index:10}.modal{background:white;border-radius:12px;padding:24px;width:min(460px,calc(100% - 30px));box-shadow:0 20px 50px #0004}.modal label{display:block;margin:15px 0;font-weight:600}.modal input,.modal select{display:block;width:100%;margin-top:6px;padding:10px;border:1px solid #d8dee8;border-radius:7px}.actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}.actions button{padding:10px 14px;border:0;border-radius:7px}.dangerButton{background:#fee2e2;border:0;border-radius:7px;padding:10px 14px;font-weight:650}.empty button{padding:11px 16px;border:0;border-radius:8px;background:#111827;color:white}
      @media(max-width:750px){.sidebar{width:220px}.content{padding:18px}.graphics{grid-template-columns:1fr}}
    `}</style>
  </main>;
}
function Panel({title,text,children}:{title:string;text:string;children:ReactNode}){return <section className="panel"><h2>{title}</h2><p className="muted">{text}</p>{children}</section>}
