"use client";

import { useT } from "@/i18n/I18nProvider";
import { useEffect, useState } from "react";
import { errorMessage, jsonInit, requestJson } from "./api";
import { findPreset } from "@/domain/output-presets";

export type TemplateChoice = {
  kind: "builtin" | "saved";
  key?: string;
  id?: string;
  name: string;
  description: string;
  sections: string[];
  presetKey: string | null;
  targetSeconds: number | null;
};

/** What the picker selected, in the shape `POST /api/projects` takes: a built-in key or a saved template id. */
export type TemplateSelection = { templateKey: string } | { userTemplateId: string };

export const BLANK_TEMPLATE_KEY = "basic";
const valueOf = (choice: TemplateChoice) => (choice.kind === "saved" ? `saved:${choice.id}` : `builtin:${choice.key}`);

export function selectionFromValue(value: string): TemplateSelection {
  if (value.startsWith("saved:")) return { userTemplateId: value.slice("saved:".length) };
  return { templateKey: value.startsWith("builtin:") ? value.slice("builtin:".length) : BLANK_TEMPLATE_KEY };
}

/** Template list for the new-project dialog: blank project, built-in templates and the ones saved from projects. */
export function TemplatePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const t = useT();
  const [choices, setChoices] = useState<TemplateChoice[]>([]);
  const [error, setError] = useState("");

  async function load() {
    try {
      setChoices((await requestJson<{ templates: TemplateChoice[] }>("/api/templates", { cache: "no-store" }, t("tpl.loadFailed"))).templates);
    } catch (e) {
      setError(errorMessage(e, t("tpl.loadFailed")));
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  const current = choices.find((choice) => valueOf(choice) === value);
  const preset = findPreset(current?.presetKey ?? undefined);
  async function remove() {
    if (current?.kind !== "saved" || !window.confirm(t("tpl.confirmDelete", { name: current.name }))) return;
    try {
      await requestJson(`/api/templates/${current.id}`, { method: "DELETE" }, t("tpl.deleteFailed"));
      onChange(`builtin:sermon`);
      await load();
    } catch (e) {
      setError(errorMessage(e, t("tpl.deleteFailed")));
    }
  }

  const builtin = choices.filter((choice) => choice.kind === "builtin"), saved = choices.filter((choice) => choice.kind === "saved");
  return (
    <div className="template-picker">
      <label>
        {t("tpl.label")}
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value={`builtin:${BLANK_TEMPLATE_KEY}`}>{t("tpl.blank")}</option>
          {builtin.length > 0 && <optgroup label={t("tpl.builtin")}>{builtin.map((choice) => <option key={valueOf(choice)} value={valueOf(choice)}>{choice.name}</option>)}</optgroup>}
          {saved.length > 0 && <optgroup label={t("tpl.saved")}>{saved.map((choice) => <option key={valueOf(choice)} value={valueOf(choice)}>{choice.name}</option>)}</optgroup>}
        </select>
      </label>
      {current ? (
        <p className="muted">
          {current.description}
          {preset && t("tpl.size", { label: preset.label })}
          {current.targetSeconds && t("tpl.target", { minutes: Math.round(current.targetSeconds / 60) })}
          {current.sections.length > 0 && t("tpl.sections", { list: `${current.sections.slice(0, 6).join(", ")}${current.sections.length > 6 ? " …" : ""}` })}
        </p>
      ) : (
        <p className="muted">{t("tpl.blankText")}</p>
      )}
      {current?.kind === "saved" && <button type="button" onClick={() => void remove()}>{t("tpl.deleteThis")}</button>}
      {error && <small className="error">{error}</small>}
    </div>
  );
}

/** Saves the open project's structure as a template: graphics, output size, variable names, slates and section rules (no sources or clips). */
export function SaveAsTemplate({ projectId, defaultName, onSaved }: { projectId: string; defaultName: string; onSaved: (name: string) => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    const trimmed = name.trim() || defaultName;
    setBusy(true);
    setError("");
    try {
      await requestJson("/api/templates", jsonInit("POST", { projectId, name: trimmed }), t("tpl.saveFailed"));
      setName("");
      onSaved(trimmed);
    } catch (e) {
      setError(errorMessage(e, t("tpl.saveFailed")));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="save-template">
      <h3 className="subhead">{t("tpl.saveTitle")}</h3>
      <p className="muted">{t("tpl.saveText")}</p>
      <div className="button-row">
        <input aria-label={t("tpl.nameLabel")} value={name} placeholder={defaultName} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void save()} />
        <button type="button" disabled={busy} onClick={() => void save()}>{t("tpl.saveButton")}</button>
      </div>
      {error && <small className="error">{error}</small>}
    </div>
  );
}
