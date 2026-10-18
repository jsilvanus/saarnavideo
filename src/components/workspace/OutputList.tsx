"use client";

import { useMemo, useRef, useState } from "react";
import { useI18n, useT } from "@/i18n/I18nProvider";
import { errorMessage, jsonInit, requestJson } from "@/components/api";
import { groupOutputsByRender, formatRenderTime, intlLocaleFor } from "@/domain/output-groups";
import { outputLabel } from "./helpers";
import type { Output } from "./types";
import styles from "./OutputList.module.css";

type Props = {
  outputs: Output[];
  /** Called after an output was renamed, so the project (and the list) reloads. */
  onChanged: () => void | Promise<void>;
};

/** The finished files of a project, one group per render (newest first), each file renameable. */
export default function OutputList({ outputs, onChanged }: Props) {
  const t = useT();
  const { locale } = useI18n();
  const groups = useMemo(() => groupOutputsByRender(outputs), [outputs]);
  if (!outputs.length) return <p className="muted">{t("pub.files.none")}</p>;
  return (
    <div className={styles.groups}>
      {groups.map(group => (
        <section key={group.key} className={styles.group} data-testid="output-group">
          <h4 className={styles.heading}>
            {group.producedAt ? formatRenderTime(group.producedAt, new Date(), intlLocaleFor(locale), t("out.today")) : t("out.unknownTime")}
          </h4>
          {group.outputs.map(output => (
            <OutputRow key={output.id} output={output} onChanged={onChanged} />
          ))}
        </section>
      ))}
    </div>
  );
}

function OutputRow({ output, onChanged }: { output: Output; onChanged: () => void | Promise<void> }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // Enter and the blur that follows it must save once; Escape must not save on the blur it causes.
  const finished = useRef(false);
  const kind = outputLabel(output, t);

  function startEditing() {
    setValue(output.label ?? "");
    setError("");
    finished.current = false;
    setEditing(true);
  }
  function cancel() {
    finished.current = true;
    setError("");
    setEditing(false);
  }
  async function save() {
    if (finished.current) return;
    finished.current = true;
    const next = value.trim();
    if (next === (output.label ?? "")) { setEditing(false); return; }
    setSaving(true);
    try {
      await requestJson(`/api/outputs/${output.id}`, jsonInit("PATCH", { label: next }), t("out.renameFailed"));
      setEditing(false);
      await onChanged();
    } catch (e) {
      finished.current = false;
      setError(errorMessage(e, t("out.renameFailed")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.row} data-testid="output-row">
      {editing ? (
        <input
          autoFocus
          className={styles.input}
          aria-label={t("out.renameLabel")}
          placeholder={t("out.renamePlaceholder")}
          title={t("out.renameHint")}
          maxLength={120}
          value={value}
          disabled={saving}
          onChange={e => setValue(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={e => {
            if (e.key === "Enter") { e.preventDefault(); void save(); }
            if (e.key === "Escape") { e.preventDefault(); cancel(); }
          }}
        />
      ) : (
        <>
          <a className={styles.name} href={`/api/outputs/${output.id}`}>
            {output.label || kind} ↓
          </a>
          {output.label && <span className={styles.kind}>{kind}</span>}
          <button type="button" aria-label={t("out.rename")} title={t("out.rename")} onClick={startEditing}>✎</button>
        </>
      )}
      {error && <div role="alert" className={styles.error}>{error}</div>}
    </div>
  );
}
