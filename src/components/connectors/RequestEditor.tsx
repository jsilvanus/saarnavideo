"use client";

import { useEffect, useMemo, useState } from "react";
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
      onSaved(await requestJson<ApiRequestView>(url, jsonInit("PATCH", draft), "Pyyntöä ei voitu tallentaa"));
    } catch (e) {
      setError(errorMessage(e, "Pyyntöä ei voitu tallentaa"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await requestJson(url, { method: "DELETE" }, "Pyyntöä ei voitu poistaa");
      onDeleted();
    } catch (e) {
      setError(errorMessage(e, "Pyyntöä ei voitu poistaa"));
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setError("");
    setTestResult("");
    try {
      const data = await requestJson<{ values: Record<string, string | null> }>(`${url}/test`, jsonInit("POST", { variables: testValues }), "Testi epäonnistui");
      setTestResult(Object.keys(data.values).length ? Object.entries(data.values).map(([name, value]) => `{{${name}}} = ${value}`).join("\n") : "Pyyntö onnistui, mutta mikään kohdistus ei löytänyt arvoa.");
    } catch (e) {
      setError(errorMessage(e, "Testi epäonnistui"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.subcard}>
      <div className={styles.grid2}>
        <label className={styles.field}>
          Pyynnön nimi
          <input value={draft.name} onChange={(e) => set("name", e.target.value)} />
        </label>
        <div className={styles.grid2}>
          <label className={styles.field}>
            Metodi
            <select value={draft.method} onChange={(e) => set("method", e.target.value)}>
              {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Vastaus
            <select value={draft.responseType} onChange={(e) => set("responseType", e.target.value as Draft["responseType"])}>
              <option value="auto">Tunnista</option>
              <option value="json">JSON</option>
              <option value="text">Teksti</option>
            </select>
          </label>
        </div>
      </div>
      <label className={styles.field}>
        Polku (osoitteen perään; {"{{nimi}}"} täytetään muuttujasta)
        <input className={styles.mono} value={draft.path} placeholder="/api/v1/date/{{paiva}}" onChange={(e) => set("path", e.target.value)} />
      </label>
      <PairsEditor label="Kyselyparametrit" rows={draft.query} onChange={(rows: Pair[]) => set("query", rows)} />
      {draft.method !== "GET" && (
        <div className={styles.grid2}>
          <label className={styles.field}>
            Sisällön tyyppi
            <select value={draft.bodyType} onChange={(e) => set("bodyType", e.target.value as Draft["bodyType"])}>
              <option value="none">Ei sisältöä</option>
              <option value="json">JSON</option>
              <option value="text">Teksti</option>
            </select>
          </label>
          {draft.bodyType !== "none" && (
            <label className={styles.field}>
              Sisältö
              <textarea value={draft.body ?? ""} onChange={(e) => set("body", e.target.value)} />
            </label>
          )}
        </div>
      )}
      <div className={styles.rows}>
        <span className={styles.muted}>Vastauksen kohdistus muuttujiin. Polku on muotoa $.kentta.alikentta tai $.lista[0].nimi. Jos kaksi riviä täyttää saman muuttujan, löytynyt arvo korvaa aiemman.</span>
        {draft.mappings.map((mapping, index) => (
          <div className={styles.row2} key={index}>
            <input aria-label="JSON-polku" className={styles.mono} value={mapping.jsonPath} placeholder="$.holyDay.name" onChange={(e) => updateMapping(index, { jsonPath: e.target.value })} />
            <input aria-label="Muuttujan nimi" className={styles.mono} value={mapping.variable} placeholder="muuttuja" onChange={(e) => updateMapping(index, { variable: e.target.value.trim() })} />
            <button type="button" className={styles.icon} aria-label={`Poista kohdistus ${index + 1}`} onClick={() => set("mappings", draft.mappings.filter((_, i) => i !== index))}>
              ×
            </button>
          </div>
        ))}
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={() => set("mappings", [...draft.mappings, { jsonPath: "$", variable: "", skipIfNull: true }])}>
            ＋ Lisää kohdistus
          </button>
        </div>
      </div>
      <div className={styles.actions}>
        <button type="button" className={`${styles.button} ${styles.primary}`} disabled={!dirty || busy} onClick={() => void save()}>
          Tallenna pyyntö
        </button>
        <button type="button" className={`${styles.button} ${styles.danger}`} disabled={busy} onClick={() => void remove()}>
          Poista pyyntö
        </button>
      </div>
      <div className={styles.rows}>
        <span className={styles.muted}>Kokeile pyyntöä{dirty ? " (tallenna ensin muutokset)" : ""}. Mitään ei tallenneta projektiin.</span>
        {placeholders.map((name) => (
          <label className={styles.field} key={name}>
            {`{{${name}}}`}
            <input value={testValues[name] ?? ""} onChange={(e) => setTestValues((current) => ({ ...current, [name]: e.target.value }))} />
          </label>
        ))}
        <div className={styles.actions}>
          <button type="button" className={styles.button} disabled={busy || dirty} onClick={() => void test()}>
            Kokeile
          </button>
        </div>
        {testResult && <pre className={styles.result}>{testResult}</pre>}
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
