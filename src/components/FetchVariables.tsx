"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { errorMessage, jsonInit, requestJson } from "@/components/api";
import type { ApiConnectorView } from "@/components/connectors/types";
import type { ProjectVariable } from "@/domain/variables";
import styles from "./FetchVariables.module.css";

type Props = {
  projectId: string;
  variables: ProjectVariable[];
  onSave: (variables: ProjectVariable[]) => Promise<void>;
};

/** Next Sunday (today when it is Sunday) as YYYY-MM-DD in local time. */
function nextSunday(from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "Hae muuttujat": runs a configured API request and offers the returned values as project variables. */
export default function FetchVariables({ projectId, variables, onSave }: Props) {
  const [connectors, setConnectors] = useState<ApiConnectorView[] | null>(null);
  const [requestId, setRequestId] = useState("");
  const [date, setDate] = useState(nextSunday);
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    requestJson<{ connectors: ApiConnectorView[] }>("/api/connectors", undefined, "Rajapintojen haku epäonnistui")
      .then((data) => {
        setConnectors(data.connectors);
        const first = data.connectors.flatMap((c) => c.requests)[0];
        setRequestId((current) => current || first?.id || "");
      })
      .catch((e) => { setConnectors([]); setError(errorMessage(e, "Rajapintojen haku epäonnistui")); });
  }, []);

  const options = useMemo(() => (connectors ?? []).flatMap((c) => c.requests.map((r) => ({ id: r.id, label: `${c.name} · ${r.name}` }))), [connectors]);
  const current = useMemo(() => new Map(variables.map((v) => [v.key, v.value])), [variables]);
  const changes = Object.entries(values ?? {}).filter(([key, value]) => current.get(key) !== value);

  async function fetchValues() {
    setBusy(true); setError(""); setValues(null);
    try {
      const data = await requestJson<{ values: Record<string, string> }>(`/api/projects/${projectId}/fetch-variables`, jsonInit("POST", { requestId, variables: { paiva: date } }), "Haku epäonnistui");
      setValues(data.values);
    } catch (e) { setError(errorMessage(e, "Haku epäonnistui")); }
    finally { setBusy(false); }
  }

  async function apply() {
    setBusy(true); setError("");
    try {
      const next = new Map(current);
      for (const [key, value] of changes) next.set(key, value);
      await onSave([...next].map(([key, value]) => ({ key, value })));
      setValues(null);
    } catch (e) { setError(errorMessage(e, "Tallennus epäonnistui")); }
    finally { setBusy(false); }
  }

  if (connectors && !options.length) {
    return <p className="muted" data-testid="fetch-variables">Muuttujat voi hakea rajapinnasta. <Link href="/settings">Lisää rajapinta asetuksissa</Link>.{error && <span className="error"> {error}</span>}</p>;
  }
  return <div className={styles["fetch-variables"]} data-testid="fetch-variables">
    <div className="form-grid">
      <label>Rajapinta<select value={requestId} onChange={(e) => { setRequestId(e.target.value); setValues(null); }}>{options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
      <label>Päivä <small className="muted">{"{{paiva}}"}</small><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
    </div>
    <div className="button-row"><button type="button" disabled={busy || !requestId || !date} onClick={() => void fetchValues()}>{busy && !values ? "Haetaan…" : "Hae muuttujat"}</button></div>
    {error && <p className="error">{error}</p>}
    {values && (changes.length === 0
      ? <p className="muted">Ei muutoksia: haetut arvot ovat jo muuttujissa{Object.keys(values).length === 0 ? " (haku ei palauttanut arvoja)" : ""}.</p>
      : <>
        <table className={styles["fetch-diff"]}><thead><tr><th>Muuttuja</th><th>Nyt</th><th>Haettu</th></tr></thead><tbody>
          {changes.map(([key, value]) => <tr key={key}><td className="mono">{key}</td><td>{current.get(key) ?? "–"}</td><td>{value}</td></tr>)}
        </tbody></table>
        <div className="button-row"><button type="button" className="primary" disabled={busy} onClick={() => void apply()}>Käytä arvot</button><button type="button" onClick={() => setValues(null)}>Hylkää</button></div>
      </>)}
  </div>;
}
