"use client";

import { useEffect, useMemo, useState } from "react";
import { useT } from "@/i18n/I18nProvider";
import type { Graphic } from "@/domain/graphics";
import { VARIABLE_KEY_PATTERN, variableNames, type ProjectVariable } from "@/domain/variables";
import styles from "./VariablesEditor.module.css";

type Props = {
  variables: ProjectVariable[];
  graphics?: Graphic[];
  onSave: (variables: ProjectVariable[]) => Promise<void>;
};

/** Project variables: name/value rows that graphics insert with {{name}}. Nothing is predefined; the project chooses its own names. */
export default function VariablesEditor({ variables, graphics = [], onSave }: Props) {
  const t = useT();
  const [rows, setRows] = useState<ProjectVariable[]>(variables);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setRows(variables); }, [variables]);

  // Names used by graphics, so a variable that is used but missing is offered as a row to fill in.
  const usage = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const graphic of graphics) for (const layer of graphic.layers) for (const name of variableNames(layer.text ?? "")) map.set(name, [...new Set([...(map.get(name) ?? []), graphic.name])]);
    return map;
  }, [graphics]);
  const missing = [...usage.keys()].filter(name => !rows.some(row => row.key === name));

  const problem = (row: ProjectVariable, index: number) => !VARIABLE_KEY_PATTERN.test(row.key) ? t("vars.badKey") : rows.findIndex(r => r.key === row.key) !== index ? t("vars.duplicate") : "";
  const invalid = rows.some((row, index) => problem(row, index));
  const dirty = JSON.stringify(rows) !== JSON.stringify(variables);
  const update = (index: number, patch: Partial<ProjectVariable>) => setRows(current => current.map((row, i) => i === index ? { ...row, ...patch } : row));

  async function save() {
    setSaving(true); setError("");
    try { await onSave(rows.map(row => ({ key: row.key.trim(), value: row.value }))); }
    catch (e) { setError(e instanceof Error ? e.message : t("vars.saveFailed")); }
    finally { setSaving(false); }
  }

  return <div className={styles["variables-editor"]} data-testid="variables-editor">
    {rows.map((row, index) => <div className={styles["variable-row"]} key={index}>
      <label><span className="sr-only">{t("vars.nameLabel")}</span><input aria-label={t("vars.nameLabel")} className="mono" value={row.key} placeholder={t("vars.namePlaceholder")} onChange={e => update(index, { key: e.target.value.trim() })} aria-invalid={!!problem(row, index)} /></label>
      <label><span className="sr-only">{t("vars.valueLabel")}</span><input aria-label={t("vars.valueFor", { key: row.key })} value={row.value} placeholder={t("vars.valuePlaceholder")} onChange={e => update(index, { value: e.target.value })} /></label>
      <button type="button" className="icon-button" aria-label={t("vars.removeNamed", { key: row.key })} title={t("vars.remove")} onClick={() => setRows(current => current.filter((_, i) => i !== index))}>×</button>
      <small className={problem(row, index) ? "error" : "muted"}>{problem(row, index) || (usage.get(row.key)?.length ? `{{${row.key}}} · ${usage.get(row.key)!.join(", ")}` : `{{${row.key || t("vars.namePlaceholder")}}}`)}</small>
    </div>)}
    {!rows.length && <p className="muted">{t("vars.empty")}</p>}
    {missing.length > 0 && <p className="muted">{t("vars.missing")} {missing.map(name => <button type="button" key={name} className="chip" onClick={() => setRows(current => [...current, { key: name, value: "" }])}>＋ {name}</button>)}</p>}
    <div className="button-row">
      <button type="button" onClick={() => setRows(current => [...current, { key: "", value: "" }])}>{t("vars.add")}</button>
      <button type="button" className="primary" disabled={!dirty || invalid || saving} onClick={() => void save()}>{saving ? t("vars.saving") : t("vars.save")}</button>
    </div>
    {error && <p className="error">{error}</p>}
  </div>;
}
