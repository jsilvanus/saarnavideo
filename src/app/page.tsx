"use client";

import { FormEvent, useEffect, useState } from "react";

type Project = {
  id: string; title: string; preacher?: string | null;
  jobs?: { id: string; status: string; progress: number }[];
  outputs?: { id: string; type: string }[];
};

export default function HomePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [title, setTitle] = useState(""); const [preacher, setPreacher] = useState(""); const [file, setFile] = useState<File | null>(null);
  const [gospelStart, setGospelStart] = useState(""); const [gospelEnd, setGospelEnd] = useState("");
  const [sermonStart, setSermonStart] = useState(""); const [sermonEnd, setSermonEnd] = useState("");
  const [message, setMessage] = useState(""); const [error, setError] = useState("");

  async function refresh() {
    const response = await fetch("/api/projects", { cache: "no-store" });
    if (response.ok) setProjects(await response.json());
  }
  useEffect(() => { void refresh(); }, []);

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(""); setError("");
    if (!file) { setError("Choose a source video"); return; }
    const segments = [
      { id: "gospel", label: "Gospel", startSeconds: Number(gospelStart), endSeconds: Number(gospelEnd) },
      { id: "sermon", label: "Sermon", startSeconds: Number(sermonStart), endSeconds: Number(sermonEnd) },
    ].filter((s) => Number.isFinite(s.startSeconds) && Number.isFinite(s.endSeconds) && s.endSeconds > s.startSeconds);
    const response = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, preacher, segments }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Project creation failed"); return; }
    const form = new FormData(); form.set("file", file);
    const upload = await fetch(`/api/projects/${data.id}/source`, { method: "POST", body: form });
    if (!upload.ok) { const body = await upload.json(); setError(body.error ?? "Upload failed"); return; }
    const generated = await fetch(`/api/projects/${data.id}/generate`, { method: "POST" });
    if (!generated.ok) { const body = await generated.json(); setError(body.error ?? "Unable to queue generation"); return; }
    setMessage(`Project ${data.id} queued for generation.`); setFile(null); await refresh();
  }

  return <main>
    <header><h1>SaarnaVideo</h1><p className="muted">Create a publishable worship-service video from a recording.</p></header>
    <form onSubmit={createProject}>
      <section className="card"><h2>Project</h2><div className="grid two">
        <div><label htmlFor="title">Title</label><input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
        <div><label htmlFor="preacher">Preacher</label><input id="preacher" value={preacher} onChange={(e) => setPreacher(e.target.value)} /></div>
      </div></section>
      <section className="card"><h2>Source</h2><input type="file" accept="video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required /><p className="muted">Local upload is the Phase 2 source. YouTube acquisition is added in Phase 3.</p></section>
      <section className="card"><h2>Sections</h2><p className="muted">Times are seconds from the beginning of the source recording. Leave a section empty if it is not needed.</p><div className="grid two">
        <div><label htmlFor="gospelStart">Gospel start</label><input id="gospelStart" type="number" min="0" step="0.1" value={gospelStart} onChange={(e) => setGospelStart(e.target.value)} /></div>
        <div><label htmlFor="gospelEnd">Gospel end</label><input id="gospelEnd" type="number" min="0" step="0.1" value={gospelEnd} onChange={(e) => setGospelEnd(e.target.value)} /></div>
        <div><label htmlFor="sermonStart">Sermon start</label><input id="sermonStart" type="number" min="0" step="0.1" value={sermonStart} onChange={(e) => setSermonStart(e.target.value)} /></div>
        <div><label htmlFor="sermonEnd">Sermon end</label><input id="sermonEnd" type="number" min="0" step="0.1" value={sermonEnd} onChange={(e) => setSermonEnd(e.target.value)} /></div>
      </div></section>
      <button type="submit">Create &amp; generate</button>{message && <p>{message}</p>}{error && <p className="error">{error}</p>}
    </form>
    <section className="card"><h2>Projects</h2>{projects.length === 0 ? <p className="muted">No projects yet.</p> : projects.map((project) => { const job = project.jobs?.[0]; return <article key={project.id} className="project-row"><strong>{project.title}</strong><span>{project.preacher ?? ""}</span><span>{job ? `${job.status} (${job.progress}%)` : "No job"}</span>{project.outputs?.map((output) => <a key={output.id} href={`/api/outputs/${output.id}`}>{output.type === "VIDEO" ? "Download video" : "Download thumbnail"}</a>)}</article>; })}</section>
  </main>;
}
