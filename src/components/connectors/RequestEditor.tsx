"use client";

import { useEffect, useMemo, useState } from "react";
import { useT } from "@/i18n/I18nProvider";
import { errorMessage, jsonInit, requestJson } from "@/components/api";
import { variableNames } from "@/domain/variables";
import PairsEditor from "./PairsEditor";
import type { ApiRequestView, MappingRow, Pair } from "./types";
import styles from "./connectors.module.css";

type Props = { connectorId: string; request: ApiRequestView; onSaved: (request: ApiRequestView) => void; onDeleted: () => void };
type Draft = Omit<ApiRequestView, "id" | "connectorId">;

const toDraft = ({ id: _id, connectorId: _connectorId, ...rest }: ApiRequestView): Draft => rest;

/** One request of a connector: where to call, and which part of the response fills which project variable. */
export default function RequestEditor({ connectorId, request, onSaved, onDeleted }: Props) {
  const t = useT();
  const [draft, setDraft] = useState<Draft>(toDraft(request));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [testValues, setTestValues] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<string>("");
  useEffect(() => setDraft(toDraft(request)), [request]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(request));
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  // {{name}} placeholders in the request, so the test form asks for exactly those.
  const placeholders = useMemo(() => variableNames([draft.path, ...draft.query.map((q) => q.value), draft.body ?? ""].join(" ")), [draft]);
  const url = `/api/connectors/${connectorId}/requests/${request.id}`;

  const updateMapping = (index: number, patch: Partial<MappingRow>) => set("mappings", draft.mappings.map((m, i) => (i === index ? { ...m, ...patch } : m)));

  async function save() {
    setBusy(true);
    setError("");
    try {
      onSaved(await requestJson<ApiRequestView>(url, jsonInit("PATCH", draft), t("req.saveFailed")));
    } catch (e) {
      setError(errorMessage(e, t("req.saveFailed")));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await requestJson(url, { method: "DELETE" }, t("req.deleteFailed"));
      onDeleted();
    } catch (e) {
      setError(errorMessage(e, t("req.deleteFailed")));
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setError("");
    setTestResult("");
    try {
      const data = await requestJson<{ values: Record<string, string | null> }>(`${url}/test`, jsonInit("POST", { variables: testValues }), t("req.testFailed"));
      setTestResult(Object.keys(data.values).length ? Object.entries(data.values).map(([name, value]) => `{{${name}}} = ${value}`).join("\n") : t("req.testNoValues"));
    } catch (e) {
      setError(errorMessage(e, t("req.testFailed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.subcard}>
      <div className={styles.grid2}>
        <label className={styles.field}>
          {t("req.name")}
          <input value={draft.name} onChange={(e) => set("name", e.target.value)} />
        </label>
        <div className={styles.grid2}>
          <label className={styles.field}>
            {t("req.method")}
            <select value={draft.method} onChange={(e) => set("method", e.target.value)}>
              {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            {t("req.response")}
            <select value={draft.responseType} onChange={(e) => set("responseType", e.target.value as Draft["responseType"])}>
              <option value="auto">{t("req.responseAuto")}</option>
              <option value="json">JSON</option>
              <option value="text">{t("req.typeText")}</option>
            </select>
          </label>
        </div>
      </div>
      <label className={styles.field}>
        {t("req.path")}
        <input className={styles.mono} value={draft.path} placeholder="/api/v1/date/{{paiva}}" onChange={(e) => set("path", e.target.value)} />
      </label>
      <PairsEditor label={t("req.query")} rows={draft.query} onChange={(rows: Pair[]) => set("query", rows)} />
      {draft.method !== "GET" && (
        <div className={styles.grid2}>
          <label className={styles.field}>
            {t("req.bodyType")}
            <select value={draft.bodyType} onChange={(e) => set("bodyType", e.target.value as Draft["bodyType"])}>
              <option value="none">{t("req.bodyNone")}</option>
              <option value="json">JSON</option>
              <option value="text">{t("req.typeText")}</option>
            </select>
          </label>
          {draft.bodyType !== "none" && (
            <label className={styles.field}>
              {t("req.body")}
              <textarea value={draft.body ?? ""} onChange={(e) => set("body", e.target.value)} />
            </label>
          )}
        </div>
      )}
      <div className={styles.rows}>
        <span className={styles.muted}>{t("req.mappingHelp")}</span>
        {draft.mappings.map((mapping, index) => (
          <div className={styles.row2} key={index}>
            <input aria-label={t("req.jsonPath")} className={styles.mono} value={mapping.jsonPath} placeholder="$.holyDay.name" onChange={(e) => updateMapping(index, { jsonPath: e.target.value })} />
            <input aria-label={t("req.variableName")} className={styles.mono} value={mapping.variable} placeholder={t("req.variablePlaceholder")} onChange={(e) => updateMapping(index, { variable: e.target.value.trim() })} />
            <button type="button" className={styles.icon} aria-label={t("req.removeMapping", { n: index + 1 })} onClick={() => set("mappings", draft.mappings.filter((_, i) => i !== index))}>
              ×
            </button>
          </div>
        ))}
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={() => set("mappings", [...draft.mappings, { jsonPath: "$", variable: "", skipIfNull: true }])}>
            {t("req.addMapping")}
          </button>
        </div>
      </div>
      <div className={styles.actions}>
        <button type="button" className={`${styles.button} ${styles.primary}`} disabled={!dirty || busy} onClick={() => void save()}>
          {t("req.save")}
        </button>
        <button type="button" className={`${styles.button} ${styles.danger}`} disabled={busy} onClick={() => void remove()}>
          {t("req.delete")}
        </button>
      </div>
      <div className={styles.rows}>
        <span className={styles.muted}>{t("req.testIntro", { note: dirty ? t("req.saveFirst") : "" })}</span>
        {placeholders.map((name) => (
          <label className={styles.field} key={name}>
            {`{{${name}}}`}
            <input value={testValues[name] ?? ""} onChange={(e) => setTestValues((current) => ({ ...current, [name]: e.target.value }))} />
          </label>
        ))}
        <div className={styles.actions}>
          <button type="button" className={styles.button} disabled={busy || dirty} onClick={() => void test()}>
            {t("req.test")}
          </button>
        </div>
        {testResult && <pre className={styles.result}>{testResult}</pre>}
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
