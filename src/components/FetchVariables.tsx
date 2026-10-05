"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useT } from "@/i18n/I18nProvider";
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
  const t = useT();
  const [connectors, setConnectors] = useState<ApiConnectorView[] | null>(null);
  const [requestId, setRequestId] = useState("");
  const [date, setDate] = useState(nextSunday);
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    requestJson<{ connectors: ApiConnectorView[] }>("/api/connectors", undefined, t("fetch.apisFailed"))
      .then((data) => {
        setConnectors(data.connectors);
        const first = data.connectors.flatMap((c) => c.requests)[0];
        setRequestId((current) => current || first?.id || "");
      })
      .catch((e) => { setConnectors([]); setError(errorMessage(e, t("fetch.apisFailed"))); });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- load once; a language switch reloads the page
  }, []);

  const options = useMemo(() => (connectors ?? []).flatMap((c) => c.requests.map((r) => ({ id: r.id, label: `${c.name} · ${r.name}` }))), [connectors]);
  const current = useMemo(() => new Map(variables.map((v) => [v.key, v.value])), [variables]);
  const changes = Object.entries(values ?? {}).filter(([key, value]) => current.get(key) !== value);

  async function fetchValues() {
    setBusy(true); setError(""); setValues(null);
    try {
      const data = await requestJson<{ values: Record<string, string> }>(`/api/projects/${projectId}/fetch-variables`, jsonInit("POST", { requestId, variables: { paiva: date } }), t("fetch.failed"));
      setValues(data.values);
    } catch (e) { setError(errorMessage(e, t("fetch.failed"))); }
    finally { setBusy(false); }
  }

  async function apply() {
    setBusy(true); setError("");
    try {
      const next = new Map(current);
      for (const [key, value] of changes) next.set(key, value);
      await onSave([...next].map(([key, value]) => ({ key, value })));
      setValues(null);
    } catch (e) { setError(errorMessage(e, t("fetch.saveFailed"))); }
    finally { setBusy(false); }
  }

  if (connectors && !options.length) {
    return <p className="muted" data-testid="fetch-variables">{t("fetch.none")} <Link href="/settings">{t("fetch.addApi")}</Link>.{error && <span className="error"> {error}</span>}</p>;
  }
  return <div className={styles["fetch-variables"]} data-testid="fetch-variables">
    <div className="form-grid">
      <label>{t("fetch.api")}<select value={requestId} onChange={(e) => { setRequestId(e.target.value); setValues(null); }}>{options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
      <label>{t("fetch.date")} <small className="muted">{"{{paiva}}"}</small><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
    </div>
    <div className="button-row"><button type="button" disabled={busy || !requestId || !date} onClick={() => void fetchValues()}>{busy && !values ? t("fetch.fetching") : t("fetch.fetch")}</button></div>
    {error && <p className="error">{error}</p>}
    {values && (changes.length === 0
      ? <p className="muted">{t("fetch.noChanges", { note: Object.keys(values).length === 0 ? t("fetch.noValues") : "" })}</p>
      : <>
        <table className={styles["fetch-diff"]}><thead><tr><th>{t("fetch.colVariable")}</th><th>{t("fetch.colNow")}</th><th>{t("fetch.colFetched")}</th></tr></thead><tbody>
          {changes.map(([key, value]) => <tr key={key}><td className="mono">{key}</td><td>{current.get(key) ?? "–"}</td><td>{value}</td></tr>)}
        </tbody></table>
        <div className="button-row"><button type="button" className="primary" disabled={busy} onClick={() => void apply()}>{t("fetch.apply")}</button><button type="button" onClick={() => setValues(null)}>{t("fetch.discard")}</button></div>
      </>)}
  </div>;
}
