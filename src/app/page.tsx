"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";

type Source = { id: string; type: "UPLOAD" | "YOUTUBE"; originalName?: string | null; youtubeUrl?: string | null; youtubeVideoId?: string | null; storagePath?: string | null; sizeBytes?: string | number | null };
type Asset = { id: string; assetKey: string; type: string; mimeType?: string | null; width?: number | null; height?: number | null; sizeBytes?: string };
type Output = { id: string; type: string; mimeType?: string; storagePath?: string; createdAt?: string };
type Job = { id: string; status: string; progress: number; errorMessage?: string | null };
type Segment = { id: string; label: string; startSeconds: number; endSeconds: number };
type Transition = { type: "cut" | "fade" | "crossfade"; durationSeconds: number };
type Item = { type: "source-clip" | "overlay" | "slate"; sourceId?: string; startSeconds?: number; endSeconds?: number; template?: string; mode?: "standalone" | "overlay"; durationSeconds?: number; kind?: "text" | "rectangle" | "image"; imageAsset?: string; opacity?: number; x?: number; y?: number; width?: number; height?: number; color?: string; data?: Record<string, string>; transitionIn?: Transition; transitionOut?: Transition };
type Project = { id: string; title: string; preacher?: string | null; gospelRef?: string | null; gospelText?: string | null; templateKey?: string; sources: Source[]; assets?: Asset[]; outputs?: Output[]; jobs?: Job[]; definition?: { semanticSegments: Segment[]; template?: { key: string; width: number; height: number; fps: number; backgroundColor: string; textColor: string }; composition: { sourceStartSeconds: number; sourceEndSeconds: number; items: Item[] } } };
type Section = "Sources" | "Sections" | "Graphics" | "Composition" | "Preview" | "Transcription" | "Generate" | "Download";
const sections: Section[] = ["Sources", "Sections", "Graphics", "Composition", "Preview", "Transcription", "Generate", "Download"];

export default function HomePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<Project | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [active, setActive] = useState<Section>("Sources");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [assetFile, setAssetFile] = useState<File | null>(null);
  const [assetKey, setAssetKey] = useState("");
  const [assetType, setAssetType] = useState("OVERLAY");
  const [segmentLabel, setSegmentLabel] = useState("Sermon");
  const [segmentStart, setSegmentStart] = useState("0");
  const [segmentEnd, setSegmentEnd] = useState("60");
  const [language, setLanguage] = useState("fi");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Project | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  async function refreshProjects() {
    const r = await fetch("/api/projects", { cache: "no-store" });
    if (!r.ok) return;
    const data = await r.json() as Project[];
    setProjects(data);
    if (selectedId && !data.some((p) => p.id === selectedId)) { setSelected(null); setSelectedId(null); }
    if (!selectedId && data[0]) await openProject(data[0].id);
  }

  async function openProject(id: string) {
    const r = await fetch(`/api/projects/${id}`, { cache: "no-store" });
    if (!r.ok) { setError("Could not load project"); return; }
    setSelected(await r.json() as Project); setSelectedId(id); setActive("Sources"); setMessage(""); setError("");
  }

  useEffect(() => { void refreshProjects(); }, []);

  async function createProject(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const r = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, templateKey: "basic" }) });
      const data = await r.json(); if (!r.ok) throw new Error(data.error ?? "Project creation failed");
      setCreating(false); setTitle(""); await refreshProjects(); await openProject(data.id); setMessage("Project created.");
    } catch (e) { setError(e instanceof Error ? e.message : "Project creation failed"); } finally { setBusy(false); }
  }

  async function duplicateProject(project: Project) {
    setMenuId(null); setBusy(true); setError("");
    try { const r = await fetch(`/api/projects/${project.id}/duplicate`, { method: "POST" }); const data = await r.json(); if (!r.ok) throw new Error(data.error ?? "Could not duplicate project"); await refreshProjects(); await openProject(data.id ?? data.project?.id); setMessage("Project duplicated."); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not duplicate project"); } finally { setBusy(false); }
  }

  async function deleteProject() {
    if (!confirmDelete) return; const project = confirmDelete; setConfirmDelete(null); setMenuId(null); setBusy(true); setError("");
    try { const r = await fetch(`/api/projects/${project.id}`, { method: "DELETE" }); if (!r.ok) throw new Error((await r.json()).error ?? "Could not delete project"); await refreshProjects(); setMessage("Project deleted."); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not delete project"); } finally { setBusy(false); }
  }

  async function addUploads() {
    if (!selected || uploadFiles.length === 0) return;
    setBusy(true); setError("");
    try { for (const file of uploadFiles) { const form = new FormData(); form.set("file", file); const r = await fetch(`/api/projects/${selected.id}/source`, { method: "POST", body: form }); if (!r.ok) throw new Error((await r.json()).error ?? "Upload failed"); } setUploadFiles([]); await openProject(selected.id); setMessage("Source(s) added."); }
    catch (e) { setError(e instanceof Error ? e.message : "Upload failed"); } finally { setBusy(false); }
  }

  async function addYoutube() {
    if (!selected || !youtubeUrl.trim()) return;
    setBusy(true); setError("");
    try { const r = await fetch(`/api/projects/${selected.id}/source`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ youtubeUrl }) }); const data = await r.json(); if (!r.ok) throw new Error(data.error ?? "Could not add YouTube source"); setYoutubeUrl(""); await openProject(selected.id); setMessage("YouTube source added."); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not add YouTube source"); } finally { setBusy(false); }
  }

  function currentDefinition() {
    return selected?.definition ?? { version: 1, semanticSegments: [], template: { key: selected?.templateKey ?? "basic", width: 1920, height: 1080, fps: 30, backgroundColor: "black", textColor: "white" }, composition: { sourceStartSeconds: 0, sourceEndSeconds: 0.001, items: [] } };
  }

  async function saveDefinition(definition: Project["definition"]) {
    if (!selected || !definition) return;
    const r = await fetch(`/api/projects/${selected.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ definition }) });
    if (!r.ok) throw new Error((await r.json()).error ?? "Could not save project");
    await openProject(selected.id);
  }

  async function addSegment(e: FormEvent) {
    e.preventDefault(); if (!selected) return; const start = Number(segmentStart), end = Number(segmentEnd); if (!(end > start)) return setError("End must be greater than start.");
    const def = currentDefinition(); const source = selected.sources[0]; if (!source) return setError("Add a source first.");
    const segment: Segment = { id: crypto.randomUUID(), label: segmentLabel || "Section", startSeconds: start, endSeconds: end };
    const items = [...def.composition.items, { type: "source-clip" as const, sourceId: source.id, startSeconds: start, endSeconds: end }];
    await saveDefinition({ ...def, semanticSegments: [...def.semanticSegments, segment], composition: { ...def.composition, sourceStartSeconds: Math.min(def.composition.sourceStartSeconds, start), sourceEndSeconds: Math.max(def.composition.sourceEndSeconds, end), items } });
    setMessage("Section saved.");
  }

  async function removeSegment(id: string) {
    if (!selected) return; const def = currentDefinition(); const semanticSegments = def.semanticSegments.filter((s) => s.id !== id); const index = def.semanticSegments.findIndex((s) => s.id === id); const items = def.composition.items.filter((item, i) => !(item.type === "source-clip" && i === index));
    await saveDefinition({ ...def, semanticSegments, composition: { ...def.composition, items } });
  }

  async function uploadAsset() {
    if (!selected || !assetFile || !assetKey.trim()) return setError("Choose an image and give it an asset key.");
    setBusy(true); setError("");
    try { const form = new FormData(); form.set("file", assetFile); form.set("assetKey", assetKey.trim()); form.set("type", assetType); const r = await fetch(`/api/projects/${selected.id}/assets`, { method: "POST", body: form }); if (!r.ok) throw new Error((await r.json()).error ?? "Asset upload failed"); setAssetFile(null); setAssetKey(""); await openProject(selected.id); setMessage("Graphic asset uploaded."); }
    catch (e) { setError(e instanceof Error ? e.message : "Asset upload failed"); } finally { setBusy(false); }
  }

  async function addGraphic(kind: "slate" | "overlay") {
    if (!selected) return; const def = currentDefinition(); const end = Math.max(10, def.composition.sourceEndSeconds || 10);
    const item: Item = kind === "slate" ? { type: "slate", template: "basic-slate", mode: "standalone", durationSeconds: 5, data: { title: selected.title, author: selected.preacher ?? "" } } : { type: "overlay", template: "text-overlay", kind: "text", startSeconds: 0, endSeconds: end, opacity: 0.85, data: { text: selected.gospelText ?? "" } };
    await saveDefinition({ ...def, composition: { ...def.composition, items: [...def.composition.items, item] } }); setMessage(`${kind === "slate" ? "Slate" : "Overlay"} added to composition.`);
  }

  async function reorder(to: number) {
    if (!selected || dragIndex === null || dragIndex === to) return; const def = currentDefinition(); const items = [...def.composition.items]; const [moved] = items.splice(dragIndex, 1); items.splice(to, 0, moved); setDragIndex(null); await saveDefinition({ ...def, composition: { ...def.composition, items } });
  }

  async function setTransition(index: number, type: Transition["type"]) {
    if (!selected) return; const def = currentDefinition(); const items = def.composition.items.map((item, i) => i === index ? { ...item, transitionIn: { type, durationSeconds: type === "cut" ? 0 : 0.5 } } : item); await saveDefinition({ ...def, composition: { ...def.composition, items } });
  }

  async function generate() {
    if (!selected) return; setBusy(true); setError("");
    try { const r = await fetch(`/api/projects/${selected.id}/generate`, { method: "POST" }); const data = await r.json(); if (!r.ok) throw new Error(data.error ?? "Could not queue generation"); setMessage(`Generation queued (${data.id}).`); setActive("Generate"); await openProject(selected.id); }
    catch (e) { setError(e instanceof Error ? e.message : "Generation failed"); } finally { setBusy(false); }
  }

  const sourceNames = useMemo(() => Object.fromEntries((selected?.sources ?? []).map((s) => [s.id, s.originalName || s.youtubeUrl || s.id])), [selected]);

  return <main className="app">
    <aside className="sidebar"><div className="brand">SaarnaVideo</div><button className="new" onClick={() => setCreating(true)}>＋ New project</button><div className="projects">{projects.map((p) => <div key={p.id} className={`project ${selectedId === p.id ? "selected" : ""}`}><button className="project-main" onClick={() => void openProject(p.id)}><strong>{p.title}</strong><small>{p.preacher || "No author"}</small></button><button className="more" onClick={() => setMenuId(menuId === p.id ? null : p.id)}>⋯</button>{menuId === p.id && <div className="menu"><button onClick={() => void duplicateProject(p)}>Duplicate</button><button className="danger" onClick={() => { setConfirmDelete(p); setMenuId(null); }}>Delete…</button></div>}</div>)}{!projects.length && <p className="muted">No projects yet.</p>}</div></aside>
    <section className="workspace">
      {!selected ? <div className="empty"><h1>Create a project</h1><button onClick={() => setCreating(true)}>＋ New project</button></div> : <>
        <header><div><h1>{selected.title}</h1><p className="muted">{selected.preacher || "No author set"} · {selected.sources.length} source{selected.sources.length === 1 ? "" : "s"}</p></div><button className="primary" disabled={busy} onClick={() => void generate()}>Generate</button></header>
        <nav>{sections.map((s) => <button key={s} className={active === s ? "active" : ""} onClick={() => setActive(s)}>{s}</button>)}</nav>
        <div className="content">
          {active === "Sources" && <Panel title="Sources" text="Upload local video files or add YouTube targets. Multiple sources can be used in one composition."><div className="form-grid"><label>Upload videos<input type="file" accept="video/*" multiple onChange={(e) => setUploadFiles(Array.from(e.target.files ?? []))} /><button onClick={() => void addUploads()} disabled={busy || !uploadFiles.length}>Upload selected</button></label><label>YouTube URL<input value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)} placeholder="https://youtube.com/watch?v=…" /><button onClick={() => void addYoutube()} disabled={busy || !youtubeUrl.trim()}>Add YouTube source</button></label></div><div className="cards">{selected.sources.map((s) => <article className="card" key={s.id}><b>{s.type}</b><strong>{s.originalName || s.youtubeUrl || s.id}</strong><small>{s.sizeBytes ? `${s.sizeBytes} bytes` : "Will be downloaded when referenced by a generation job"}</small></article>)}</div></Panel>}
          {active === "Sections" && <Panel title="Sections" text="Create reusable clips from any source. A section is a semantic clip and can be arranged in the composition."><form className="form-grid four" onSubmit={addSegment}><label>Name<input value={segmentLabel} onChange={(e) => setSegmentLabel(e.target.value)} /></label><label>Start (s)<input type="number" min="0" step="0.1" value={segmentStart} onChange={(e) => setSegmentStart(e.target.value)} /></label><label>End (s)<input type="number" min="0" step="0.1" value={segmentEnd} onChange={(e) => setSegmentEnd(e.target.value)} /></label><button className="primary" type="submit">＋ Add section</button></form><div className="list">{(selected.definition?.semanticSegments ?? []).map((s) => <div className="row" key={s.id}><span><strong>{s.label}</strong><small>{s.startSeconds}s → {s.endSeconds}s</small></span><button onClick={() => void removeSegment(s.id)}>Remove</button></div>)}{!selected.definition?.semanticSegments?.length && <p className="muted">No sections yet.</p>}</div></Panel>}
          {active === "Graphics" && <Panel title="Graphics" text="Upload reusable image assets and add generic slates or overlays to the composition. Graphic text is stored in the generic project definition."><div className="form-grid four"><label>Image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setAssetFile(e.target.files?.[0] ?? null)} /></label><label>Asset key<input value={assetKey} onChange={(e) => setAssetKey(e.target.value)} placeholder="logo" /></label><label>Type<select value={assetType} onChange={(e) => setAssetType(e.target.value)}><option value="OVERLAY">Overlay</option><option value="BACKGROUND">Background</option><option value="LOGO">Logo</option><option value="FONT">Font</option></select></label><button onClick={() => void uploadAsset()} disabled={busy}>Upload image</button></div><div className="button-row"><button onClick={() => void addGraphic("slate")}>＋ Add slate</button><button onClick={() => void addGraphic("overlay")}>＋ Add overlay</button></div><div className="cards">{(selected.assets ?? []).map((a) => <article className="card" key={a.id}><b>{a.type}</b><strong>{a.assetKey}</strong><small>{a.width} × {a.height} · {a.mimeType}</small></article>)}</div></Panel>}
          {active === "Composition" && <Panel title="Composition" text="The saved renderer definition is the source of truth. Drag items to reorder them and choose transitions."><div className="timeline">{(selected.definition?.composition.items ?? []).map((item, i) => <div className="timeline-item" draggable key={i} onDragStart={() => setDragIndex(i)} onDragOver={(e) => e.preventDefault()} onDrop={() => void reorder(i)}><span className="handle">☷</span><div><strong>{item.type === "source-clip" ? `Clip · ${sourceNames[item.sourceId ?? ""] ?? "source"}` : item.type === "slate" ? "Slate" : `Overlay · ${item.kind ?? "text"}`}</strong><small>{item.startSeconds !== undefined ? `${item.startSeconds}s → ${item.endSeconds ?? item.durationSeconds}s` : `${item.durationSeconds ?? ""}s`}</small></div><select value={item.transitionIn?.type ?? "cut"} onChange={(e) => void setTransition(i, e.target.value as Transition["type"])}><option value="cut">Cut</option><option value="fade">Fade</option><option value="crossfade">Crossfade</option></select></div>)}{!(selected.definition?.composition.items?.length) && <p className="muted">Add sections or graphics first.</p>}</div></Panel>}
          {active === "Preview" && <Panel title="Preview" text="The renderer is server-side. Until a media-serving preview endpoint exists, this view shows the current composition and latest output status."><div className="preview"><div><strong>{selected.definition?.composition.items.length ?? 0} timeline item(s)</strong><p>{selected.outputs?.length ? `${selected.outputs.length} generated output(s) available.` : "No rendered output yet."}</p></div></div></Panel>}
          {active === "Transcription" && <Panel title="Transcription" text="The project UI is ready for the transcription worker, but main currently has no transcription API/worker implementation to call."><label>Language<select value={language} onChange={(e) => setLanguage(e.target.value)}><option value="fi">Finnish</option><option value="en">English</option><option value="sv">Swedish</option><option value="auto">Auto detect</option></select></label><button disabled>Transcribe and create VTT</button><p className="hint">No transcription endpoint exists in the current main branch, so this is intentionally not a fake action.</p></Panel>}
          {active === "Generate" && <Panel title="Generate" text="Queue the existing generation worker. The worker resolves YouTube sources, renders the saved composition and creates output records."><div className="job">{selected.jobs?.map((j) => <div key={j.id}><strong>{j.status}</strong><span>{j.progress}%</span>{j.errorMessage && <small>{j.errorMessage}</small>}</div>)}{!selected.jobs?.length && <p className="muted">No generation jobs yet.</p>}<button className="primary" disabled={busy} onClick={() => void generate()}>Generate video</button></div></Panel>}
          {active === "Download" && <Panel title="Download" text="Generated files are exposed through the existing output route.">{selected.outputs?.length ? <div className="downloads">{selected.outputs.map((o) => <a key={o.id} href={`/api/outputs/${o.id}`}>{o.type} ↓</a>)}</div> : <p className="muted">No generated outputs yet.</p>}</Panel>}
          {message && <p className="success">{message}</p>}{error && <p className="error">{error}</p>}
        </div>
      </>}
    </section>
    {creating && <div className="backdrop"><form className="modal" onSubmit={createProject}><h2>New project</h2><label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} required /></label><p className="muted">Author/preacher is optional and can be defined later in graphics.</p><div className="actions"><button type="button" onClick={() => setCreating(false)}>Cancel</button><button className="primary" disabled={busy}>Create project</button></div>{error && <p className="error">{error}</p>}</form></div>}
    {confirmDelete && <div className="backdrop"><div className="modal"><h2>Delete “{confirmDelete.title}”?</h2><p className="muted">The project is deleted. Shared sources/assets are retained when referenced elsewhere.</p><div className="actions"><button onClick={() => setConfirmDelete(null)}>Cancel</button><button className="dangerButton" onClick={() => void deleteProject()}>Delete project</button></div></div></div>}
    <style jsx>{`
      *{box-sizing:border-box}.app{min-height:100vh;display:flex;background:#f6f7f9;color:#18202a;font-family:system-ui,sans-serif}.sidebar{width:270px;flex:none;background:#111827;color:white;padding:20px 14px}.brand{font-size:21px;font-weight:750;padding:4px 8px 18px}.new{width:100%;padding:10px;border:0;border-radius:8px;font-weight:650;margin-bottom:14px}.projects{display:grid;gap:4px}.project{position:relative;display:flex;border-radius:8px}.project.selected{background:#273244}.project-main{flex:1;text-align:left;background:none;color:#e5e7eb;border:0;padding:10px}.project-main strong,.project-main small{display:block}.project-main small{color:#94a3b8;margin-top:3px}.more{background:none;color:#cbd5e1;border:0;padding:0 10px;font-size:20px}.menu{position:absolute;right:4px;top:40px;background:white;color:#111827;border-radius:8px;box-shadow:0 8px 25px #0003;padding:5px;z-index:3;min-width:150px}.menu button{display:block;width:100%;text-align:left;background:none;border:0;padding:9px;border-radius:5px}.danger,.dangerButton{color:#b91c1c!important}.workspace{flex:1;min-width:0}.workspace header{height:92px;background:white;border-bottom:1px solid #e5e7eb;padding:20px 30px;display:flex;justify-content:space-between;align-items:center}.workspace h1{margin:0 0 4px;font-size:24px}nav{display:flex;overflow:auto;background:white;border-bottom:1px solid #e5e7eb;padding:0 20px}nav button{background:none;border:0;padding:14px 11px;color:#64748b;border-bottom:2px solid transparent;white-space:nowrap}nav button.active{color:#111827;border-bottom-color:#111827;font-weight:650}.content{max-width:1100px;padding:28px}.panel{background:white;border:1px solid #e5e7eb;border-radius:12px;padding:24px}.panel h2{margin:0 0 5px}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:end}.form-grid.four{grid-template-columns:repeat(4,1fr)}label{display:grid;gap:6px;font-weight:600;font-size:14px}input,select{width:100%;padding:10px;border:1px solid #d8dee8;border-radius:7px;background:white}.form-grid button,.button-row button,.row button{padding:10px 12px;border:0;border-radius:7px;background:#e5e7eb}.primary{background:#111827!important;color:white;border:0;border-radius:8px;padding:10px 15px;font-weight:650}.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin-top:20px}.card{border:1px solid #e5e7eb;border-radius:9px;padding:13px;display:grid;gap:5px}.card b{font-size:11px;color:#4338ca}.card small,.timeline-item small{color:#64748b}.list{display:grid;gap:8px;margin-top:20px}.row{display:flex;justify-content:space-between;align-items:center;border:1px solid #e5e7eb;padding:12px;border-radius:8px}.row span,.row small{display:grid;gap:3px}.button-row{display:flex;gap:9px;margin-top:16px}.timeline{display:grid;gap:8px}.timeline-item{display:grid;grid-template-columns:28px 1fr 130px;gap:10px;align-items:center;border:1px solid #dfe4eb;border-radius:9px;padding:12px;background:white;cursor:grab}.handle{color:#94a3b8;font-size:20px}.preview{height:350px;background:#111827;color:white;border-radius:10px;display:grid;place-items:center;text-align:center}.job{display:flex;align-items:center;justify-content:space-between;padding:18px;background:#f8fafc;border-radius:9px}.job div{display:grid;gap:4px}.downloads{display:flex;gap:10px;flex-wrap:wrap}.downloads a{padding:11px 15px;border:1px solid #d8dee8;border-radius:8px;text-decoration:none;color:#111827}.muted{color:#64748b;font-size:14px}.hint{color:#64748b;font-size:13px}.success{color:#047857}.error{color:#b91c1c}.empty{text-align:center;margin:15vh auto}.empty button{padding:11px 16px;border:0;border-radius:8px;background:#111827;color:white}.backdrop{position:fixed;inset:0;background:#0008;display:grid;place-items:center;z-index:10}.modal{background:white;border-radius:12px;padding:24px;width:min(460px,calc(100% - 30px));box-shadow:0 20px 50px #0004}.modal label{margin:15px 0}.actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}.actions button{padding:10px 14px;border:0;border-radius:7px}.dangerButton{background:#fee2e2;border:0;border-radius:7px;padding:10px 14px;font-weight:650}@media(max-width:800px){.sidebar{width:220px}.content{padding:18px}.form-grid,.form-grid.four{grid-template-columns:1fr}.timeline-item{grid-template-columns:25px 1fr}.timeline-item select{grid-column:2}}
    `}</style>
  </main>;
}

function Panel({ title, text, children }: { title: string; text: string; children: ReactNode }) { return <section className="panel"><h2>{title}</h2><p className="muted">{text}</p>{children}</section>; }
