"use client";

import { FormEvent, useEffect, useState } from "react";

type Project = {
  id: string; title: string; preacher?: string | null;
  jobs?: { id: string; status: string; progress: number }[];
  outputs?: { id: string; type: string }[];
};

type Segment = { id: string; label: string; startSeconds: number; endSeconds: number };

const TEMPLATES = [
  { key: "sermon", label: "Sermon" },
  { key: "liturgy", label: "Liturgy" },
  { key: "vespers", label: "Vespers" },
];

const SEGMENT_TYPES = [
  { id: "gospel", label: "Gospel", enabled: true },
  { id: "epistle", label: "Epistle", enabled: true },
  { id: "sermon", label: "Sermon", enabled: true },
  { id: "creed", label: "Creed", enabled: true },
  { id: "intercessions", label: "Intercessions", enabled: true },
];

export default function HomePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [title, setTitle] = useState("");
  const [preacher, setPreacher] = useState("");
  const [templateKey, setTemplateKey] = useState("sermon");
  const [sourceUrl, setSourceUrl] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [segments, setSegments] = useState<Segment[]>(
    SEGMENT_TYPES.filter(s => s.enabled).map(s => ({ ...s, startSeconds: 0, endSeconds: 0 }))
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    const response = await fetch("/api/projects", { cache: "no-store" });
    if (response.ok) setProjects(await response.json());
  }

  useEffect(() => {
    void refresh();
    const interval = setInterval(refresh, 5000); // Auto-refresh every 5 seconds
    return () => clearInterval(interval);
  }, []);

  function updateSegment(index: number, field: "startSeconds" | "endSeconds", value: string) {
    const updated = [...segments];
    updated[index] = { ...updated[index], [field]: Number(value) || 0 };
    setSegments(updated);
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");

    if (files.length === 0 && !sourceUrl.trim()) {
      setError("Choose a source video or paste a YouTube URL");
      return;
    }

    // Filter segments with valid times
    const validSegments = segments.filter(
      (s) => Number.isFinite(s.startSeconds) && Number.isFinite(s.endSeconds) && s.endSeconds > s.startSeconds
    );

    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        preacher,
        templateKey,
        sourceUrl: sourceUrl.trim() || undefined,
        semanticSegments: validSegments,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      setError(data.error ?? "Project creation failed");
      return;
    }

    for (const file of files) {
      const form = new FormData();
      form.set("file", file);
      const upload = await fetch(`/api/projects/${data.id}/source`, { method: "POST", body: form });
      if (!upload.ok) {
        const body = await upload.json();
        setError(body.error ?? "Upload failed");
        return;
      }
    }

    // Queue generation
    const generated = await fetch(`/api/projects/${data.id}/generate`, { method: "POST" });
    if (!generated.ok) {
      const body = await generated.json();
      setError(body.error ?? "Unable to queue generation");
      return;
    }

    setMessage(`Project "${title}" created and queued for generation.`);
    setFiles([]);
    setSourceUrl("");
    setTitle("");
    setPreacher("");
    setTemplateKey("sermon");
    setSegments(
      SEGMENT_TYPES.filter(s => s.enabled).map(s => ({ ...s, startSeconds: 0, endSeconds: 0 }))
    );
    await refresh();
  }

  const statusColor = (status: string) => {
    if (status === "COMPLETED") return "#4caf50";
    if (status === "FAILED") return "#f44336";
    if (status === "RENDERING") return "#ff9800";
    return "#2196f3";
  };

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
          <h2>Template</h2>
          <div>
            <label htmlFor="template">Composition Template</label>
            <select id="template" value={templateKey} onChange={(e) => setTemplateKey(e.target.value)}>
              {TEMPLATES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </section>

        <section className="card">
          <h2>Sources</h2>
          <input
            type="file"
            accept="video/*"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
          <div style={{ marginTop: "1rem" }}>
            <label htmlFor="source-url">YouTube URL (optional)</label>
            <input
              id="source-url"
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
            />
          </div>
          <p className="muted">Upload one or more video files or reference a YouTube URL. Existing sources remain attached to the project.</p>
        </section>

        <section className="card">
          <h2>Semantic Sections</h2>
          <p className="muted">
            Mark the start and end times (in seconds) for each section of the recording. Leave empty sections unused.
          </p>
          <div className="grid two">
            {segments.map((segment, idx) => (
              <fieldset key={segment.id}>
                <legend>{segment.label}</legend>
                <div className="input-group">
                  <label>Start (sec)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={segment.startSeconds || ""}
                    onChange={(e) => updateSegment(idx, "startSeconds", e.target.value)}
                  />
                </div>
                <div className="input-group">
                  <label>End (sec)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={segment.endSeconds || ""}
                    onChange={(e) => updateSegment(idx, "endSeconds", e.target.value)}
                  />
                </div>
              </fieldset>
            ))}
          </div>
        </section>

        <button type="submit">Create &amp; Generate</button>
        {message && <p style={{ color: "#4caf50" }}>{message}</p>}
        {error && <p style={{ color: "#f44336" }}>{error}</p>}
      </form>

      <section className="card">
        <h2>Projects</h2>
        {projects.length === 0 ? (
          <p className="muted">No projects yet. Create one above to get started.</p>
        ) : (
          <div>
            {projects.map((project) => {
              const job = project.jobs?.[0];
              const isProcessing = job && ["QUEUED", "ACQUIRING_SOURCE", "PROCESSING", "RENDERING"].includes(job.status);
              return (
                <article
                  key={project.id}
                  className="project-row"
                  style={{ opacity: isProcessing ? 0.9 : 1, transition: "opacity 0.3s" }}
                >
                  <div>
                    <strong>{project.title}</strong>
                    {project.preacher && <span className="preacher">{project.preacher}</span>}
                  </div>
                  <div>
                    {job ? (
                      <div className="job-status">
                        <span style={{ color: statusColor(job.status) }}>
                          {job.status} ({job.progress}%)
                        </span>
                        {isProcessing && <span className="spinner">●</span>}
                      </div>
                    ) : (
                      <span className="muted">No job</span>
                    )}
                  </div>
                  {(project.outputs && project.outputs.length > 0) && (
                    <div className="outputs">
                      {project.outputs.map((output) => (
                        <a key={output.id} href={`/api/outputs/${output.id}`} className="download-btn">
                          {output.type === "VIDEO" ? "📥 Video" : "🖼️ Thumbnail"}
                        </a>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <style jsx>{`
        main {
          max-width: 1200px;
          margin: 0 auto;
          padding: 2rem;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        header {
          margin-bottom: 2rem;
        }

        h1 {
          margin: 0 0 0.5rem 0;
        }

        .muted {
          color: #666;
          font-size: 0.9rem;
          margin: 0.5rem 0 0 0;
        }

        .card {
          border: 1px solid #ddd;
          border-radius: 8px;
          padding: 1.5rem;
          margin-bottom: 1.5rem;
          background: #fafafa;
        }

        .card h2 {
          margin: 0 0 1rem 0;
          font-size: 1.2rem;
        }

        .grid {
          display: grid;
          gap: 1.5rem;
        }

        .grid.two {
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        }

        label {
          display: block;
          margin-bottom: 0.5rem;
          font-weight: 500;
        }

        input[type="text"],
        input[type="number"],
        input[type="file"],
        select {
          width: 100%;
          padding: 0.75rem;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 1rem;
          font-family: inherit;
        }

        input[type="file"] {
          padding: 0.5rem;
        }

        select {
          cursor: pointer;
        }

        fieldset {
          border: 1px solid #ddd;
          border-radius: 4px;
          padding: 1rem;
          margin-bottom: 1rem;
        }

        legend {
          font-weight: 600;
          padding: 0 0.5rem;
        }

        .input-group {
          margin-bottom: 0.75rem;
        }

        .input-group:last-child {
          margin-bottom: 0;
        }

        button {
          background: #2196f3;
          color: white;
          border: none;
          padding: 0.75rem 1.5rem;
          border-radius: 4px;
          font-size: 1rem;
          cursor: pointer;
          transition: background 0.2s;
        }

        button:hover {
          background: #1976d2;
        }

        p[style] {
          padding: 0.75rem 1rem;
          border-radius: 4px;
          margin-top: 1rem;
        }

        .project-row {
          display: grid;
          grid-template-columns: 1fr auto auto;
          gap: 1.5rem;
          align-items: center;
          padding: 1rem;
          border-bottom: 1px solid #ddd;
        }

        .project-row:last-child {
          border-bottom: none;
        }

        .project-row strong {
          font-size: 1.1rem;
          display: block;
          margin-bottom: 0.25rem;
        }

        .preacher {
          color: #666;
          font-size: 0.9rem;
          display: block;
        }

        .job-status {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .spinner {
          display: inline-block;
          animation: spin 1s linear infinite;
          font-size: 0.8rem;
        }

        @keyframes spin {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(360deg);
          }
        }

        .outputs {
          display: flex;
          gap: 0.5rem;
        }

        .download-btn {
          display: inline-block;
          padding: 0.5rem 1rem;
          background: #4caf50;
          color: white;
          text-decoration: none;
          border-radius: 4px;
          font-size: 0.9rem;
          transition: background 0.2s;
        }

        .download-btn:hover {
          background: #45a049;
        }
      `}</style>
    </main>
  );
}
