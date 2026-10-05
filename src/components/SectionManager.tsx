"use client";

import { useT } from "@/i18n/I18nProvider";
import { useMemo, useState, type ReactNode } from "react";
import { SECTION_TEMPLATES, instantiateSectionTemplate } from "@/domain/section-templates";
import type { Section } from "@/domain/sections";
import { formatTime, sourceLabel } from "./format";
import type { MessageKey } from "@/i18n/translate";

type Source = { id: string; originalName?: string | null; youtubeUrl?: string | null; durationMs?: number | null; referenceDurationMs?: number | null };
type Props = {
  scope: Section["scope"];
  sections: Section[];
  sources?: Source[];
  durationSeconds?: number;
  /** Section names the project's template suggests; offered as one more placement button. */
  suggestedNames?: string[];
  onChange: (sections: Section[]) => Promise<void>;
  /** Extra per-section controls, e.g. the reframe button. */
  renderActions?: (section: Section) => ReactNode;
};

export default function SectionManager({ scope, sections, sources = [], durationSeconds, suggestedNames, onChange, renderActions }: Props) {
  const t = useT();
  const localizedTemplates = SECTION_TEMPLATES.map(item => ({ ...item, label: t(`sectionTemplate.${item.key}` as MessageKey), sections: t(`sectionTemplate.${item.key}.sections` as MessageKey).split("|") }));
  const templates = [...localizedTemplates, ...(suggestedNames?.length ? [{ key: "project-template", label: t("sec.templateOwn"), sections: suggestedNames }] : [])];
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
      origin: "MANUAL" as const,
    })) as Section[];
    await onChange([...sections, ...next]);
    setLines("");
  }

  async function applyTemplate(key: string) {
    const template = templates.find(item => item.key === key);
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
      {scope === "SOURCE" && <label>{t("sec.source")}<select value={sourceId} onChange={e => setSourceId(e.target.value)}>{sources.map(source => <option key={source.id} value={source.id}>{sourceLabel(source)}</option>)}</select></label>}
      <label>{t("sec.level")}<select value={parentId} onChange={e => setParentId(e.target.value)}><option value="">{t("sec.topLevel")}</option>{roots.map(section => <option key={section.id} value={section.id}>{t("sec.inside", { label: section.label })}</option>)}</select></label>
    </div>
    <label>{t("sec.linesLabel")}<textarea rows={6} value={lines} onChange={e => setLines(e.target.value)} placeholder={t("sec.linesPlaceholder")} /></label>
    <div className="button-row">
      <button onClick={() => void addLines()} disabled={!lines.trim() || (scope === "SOURCE" && !sourceId)}>{t("sec.placeEvenly")}</button>
      {templates.map(template => <button key={template.key} onClick={() => void applyTemplate(template.key)} disabled={!canPlace && scope === "SOURCE"}>{template.label}</button>)}
      <button disabled title={t("sec.aiHint")}>{t("sec.aiButton")}</button>
    </div>
    <p className="muted">{canPlace ? t("sec.placed", { start: formatTime(rangeStart), end: formatTime(rangeEnd) }) : t("sec.notPlaced")}</p>
    <div className="list">
      {visible.map(section => <div className="row" key={section.id}>
        <span><strong>{section.label}</strong><small>{section.startSeconds !== undefined ? formatTime(section.startSeconds) + " → " + formatTime(section.endSeconds ?? section.startSeconds) : t("sec.noPosition")} · {t(`sec.origin.${section.origin}` as MessageKey)}</small></span>
        <span className="button-row">{renderActions?.(section)}<button onClick={() => setParentId(section.id)}>{t("sec.inside.button")}</button><button onClick={() => void removeSection(section.id)}>{t("common.remove")}</button></span>
      </div>)}
      {!visible.length && <p className="muted">{parentId ? t("sec.noSub") : t("sec.none")}</p>}
    </div>
  </div>;
}
