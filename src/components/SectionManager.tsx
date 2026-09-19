"use client";

import { useMemo, useState } from "react";
import { SECTION_TEMPLATES, instantiateSectionTemplate } from "@/domain/section-templates";
import type { Section } from "@/domain/sections";

type Source = { id: string; originalName?: string | null; youtubeUrl?: string | null; durationMs?: number | null; referenceDurationMs?: number | null };
type Props = {
  scope: Section["scope"];
  sections: Section[];
  sources?: Source[];
  durationSeconds?: number;
  onChange: (sections: Section[]) => Promise<void>;
};

export default function SectionManager({ scope, sections, sources = [], durationSeconds, onChange }: Props) {
  const [lines, setLines] = useState("");
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [parentId, setParentId] = useState("");
  const roots = useMemo(() => sections.filter(s => s.scope === scope && !s.parentId), [sections, scope]);
  const parent = parentId ? sections.find(s => s.id === parentId) : undefined;
  const visible = parentId ? sections.filter(s => s.parentId === parentId) : roots;
  const source = sourceId ? sources.find(s => s.id === sourceId) : undefined;
  const availableDuration = durationSeconds ?? ((source?.durationMs ?? source?.referenceDurationMs ?? 0) / 1000);
  const rangeStart = parent?.startSeconds ?? 0;
  const rangeEnd = parent?.endSeconds ?? availableDuration;

  async function addLines() {
    const labels = lines.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (!labels.length) return;
    const next = labels.map((label, index) => ({
      id: crypto.randomUUID(),
      label,
      scope,
      parentId: parentId || undefined,
      sourceId: scope === "SOURCE" ? sourceId || undefined : undefined,
      startSeconds: rangeEnd > rangeStart ? rangeStart + ((rangeEnd - rangeStart) * index) / labels.length : undefined,
      endSeconds: rangeEnd > rangeStart ? rangeStart + ((rangeEnd - rangeStart) * (index + 1)) / labels.length : undefined,
      origin,
    })) as Section[];
    await onChange([...sections, ...next]);
    setLines("");
  }

  async function applyTemplate(key: string) {
    const template = SECTION_TEMPLATES.find(item => item.key === key);
    if (!template) return;
    const next = instantiateSectionTemplate(template, scope, {
      sourceId: scope === "SOURCE" ? sourceId || undefined : undefined,
      startSeconds: rangeEnd > rangeStart ? rangeStart : undefined,
      endSeconds: rangeEnd > rangeStart ? rangeEnd : undefined,
    }).map(section => ({ ...section, parentId: parentId || undefined }));
    await onChange([...sections, ...next]);
  }

  async function removeSection(id: string) {
    const ids = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const section of sections) {
        if (section.parentId && ids.has(section.parentId) && !ids.has(section.id)) {
          ids.add(section.id);
          changed = true;
        }
      }
    }
    await onChange(sections.filter(section => !ids.has(section.id)));
    if (parentId && ids.has(parentId)) setParentId("");
  }

  const canPlace = rangeEnd > rangeStart;
  return <div className="section-manager">
    <div className="form-grid">
      {scope === "SOURCE" && <label>Source<select value={sourceId} onChange={e => setSourceId(e.target.value)}>{sources.map(source => <option key={source.id} value={source.id}>{source.originalName || source.youtubeUrl || source.id}</option>)}</select></label>}
      <label>Section level<select value={parentId} onChange={e => setParentId(e.target.value)}><option value="">Top level</option>{roots.map(section => <option key={section.id} value={section.id}>Inside: {section.label}</option>)}</select></label>
    </div>
    <label>Sections, one per line<textarea rows={6} value={lines} onChange={e => setLines(e.target.value)} placeholder={"Opening\nPsalm\nGospel\nSermon\nPrayers\nClosing"} /></label>
    <div className="button-row">
      <button onClick={() => void addLines()} disabled={!lines.trim() || (scope === "SOURCE" && !sourceId)}>Place evenly</button>
      {SECTION_TEMPLATES.map(template => <button key={template.key} onClick={() => void applyTemplate(template.key)} disabled={!canPlace && scope === "SOURCE"}>{template.label}</button>)}
      <button disabled title="AI section placement will consume transcript/audio analysis once the assisted transcription service is connected.">Suggest positions with AI</button>
    </div>
    <p className="muted">{canPlace ? "New sections are evenly placed from " + formatTime(rangeStart) + " to " + formatTime(rangeEnd) + ". AI assistance can later refine those boundaries." : "Sections can be created without timestamps; choose a source/range when you want automatic placement."}</p>
    <div className="list">
      {visible.map(section => <div className="row" key={section.id}>
        <span><strong>{section.label}</strong><small>{section.startSeconds !== undefined ? formatTime(section.startSeconds) + " → " + formatTime(section.endSeconds ?? section.startSeconds) : "No position yet"} · {section.origin.toLowerCase()}</small></span>
        <span className="button-row"><button onClick={() => setParentId(section.id)}>Section inside…</button><button onClick={() => void removeSection(section.id)}>Remove</button></span>
      </div>)}
      {!visible.length && <p className="muted">{parentId ? "No subsections yet." : "No sections yet."}</p>}
    </div>
  </div>;
}

function formatTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? h + ":" + String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0") : m + ":" + String(sec).padStart(2, "0");
}
