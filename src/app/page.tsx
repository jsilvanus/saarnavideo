"use client";

import { FormEvent, useState } from "react";

export default function HomePage() {
  const [title, setTitle] = useState("");
  const [preacher, setPreacher] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [gospelStart, setGospelStart] = useState("");
  const [gospelEnd, setGospelEnd] = useState("");
  const [sermonStart, setSermonStart] = useState("");
  const [sermonEnd, setSermonEnd] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");

    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        preacher,
        sourceUrl,
        segments: [
          { id: "gospel", label: "Gospel", startSeconds: Number(gospelStart), endSeconds: Number(gospelEnd) },
          { id: "sermon", label: "Sermon", startSeconds: Number(sermonStart), endSeconds: Number(sermonEnd) },
        ],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      setError(data.error ?? "Project creation failed");
      return;
    }

    setMessage(`Project created: ${data.id}`);
  }

  return (
    <main>
      <header>
        <h1>SaarnaVideo</h1>
        <p className="muted">Create a publishable worship-service video from a recording.</p>
      </header>

      <form onSubmit={createProject}>
        <section className="card">
          <h2>Project</h2>
          <div className="grid two">
            <div>
              <label htmlFor="title">Title</label>
              <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <div>
              <label htmlFor="preacher">Preacher</label>
              <input id="preacher" value={preacher} onChange={(e) => setPreacher(e.target.value)} />
            </div>
          </div>
        </section>

        <section className="card">
          <h2>Source</h2>
          <label htmlFor="sourceUrl">YouTube URL</label>
          <input id="sourceUrl" type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=..." required />
          <p className="muted">YouTube acquisition is wired as the source model; OAuth/download handling is implemented in the next integration phase.</p>
        </section>

        <section className="card">
          <h2>Sections</h2>
          <p className="muted">Times are seconds from the beginning of the source recording. Adjacent sections can remain one continuous source range.</p>
          <div className="grid two">
            <div><label htmlFor="gospelStart">Gospel start</label><input id="gospelStart" type="number" min="0" step="0.1" value={gospelStart} onChange={(e) => setGospelStart(e.target.value)} required /></div>
            <div><label htmlFor="gospelEnd">Gospel end</label><input id="gospelEnd" type="number" min="0" step="0.1" value={gospelEnd} onChange={(e) => setGospelEnd(e.target.value)} required /></div>
            <div><label htmlFor="sermonStart">Sermon start</label><input id="sermonStart" type="number" min="0" step="0.1" value={sermonStart} onChange={(e) => setSermonStart(e.target.value)} required /></div>
            <div><label htmlFor="sermonEnd">Sermon end</label><input id="sermonEnd" type="number" min="0" step="0.1" value={sermonEnd} onChange={(e) => setSermonEnd(e.target.value)} required /></div>
          </div>
        </section>

        <button type="submit">Create project</button>
        {message && <p>{message}</p>}
        {error && <p className="error">{error}</p>}
      </form>
    </main>
  );
}
