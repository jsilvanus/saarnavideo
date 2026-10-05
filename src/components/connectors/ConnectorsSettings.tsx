"use client";

import { useEffect, useState } from "react";
import { useT } from "@/i18n/I18nProvider";
import { errorMessage, jsonInit, requestJson } from "@/components/api";
import ConnectorCard from "./ConnectorCard";
import type { ApiConnectorView } from "./types";
import styles from "./connectors.module.css";

/** Settings: API connectors that fill project variables (for example the church year of a service date). */
export default function ConnectorsSettings() {
  const t = useT();
  const [connectors, setConnectors] = useState<ApiConnectorView[] | null>(null);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    requestJson<{ connectors: ApiConnectorView[] }>("/api/connectors", { cache: "no-store" }, t("conn.loadFailed"))
      .then((data) => setConnectors(data.connectors))
      .catch((e) => setError(errorMessage(e, t("conn.loadFailed"))));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  async function create() {
    setBusy(true);
    setError("");
    try {
      const created = await requestJson<ApiConnectorView>("/api/connectors", jsonInit("POST", { name, baseUrl }), t("conn.createFailed"));
      setConnectors((current) => [...(current ?? []), created].sort((a, b) => a.name.localeCompare(b.name)));
      setName("");
      setBaseUrl("");
    } catch (e) {
      setError(errorMessage(e, t("conn.createFailed")));
    } finally {
      setBusy(false);
    }
  }

  const replace = (updated: ApiConnectorView) => setConnectors((current) => (current ?? []).map((c) => (c.id === updated.id ? updated : c)));

  return (
    <>
      <section className={styles.card}>
        <h2>{t("conn.title")}</h2>
        <p className={styles.muted}>{t("conn.intro")}</p>
        <div className={styles.grid2}>
          <label className={styles.field}>
            {t("conn.name")}
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("conn.namePlaceholder")} />
          </label>
          <label className={styles.field}>
            {t("conn.address")}
            <input className={styles.mono} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://" />
          </label>
        </div>
        <div className={styles.actions}>
          <button type="button" className={`${styles.button} ${styles.primary}`} disabled={busy || !name.trim() || !baseUrl.trim()} onClick={() => void create()}>
            {t("conn.add")}
          </button>
        </div>
        <p className={styles.muted}>{t("conn.allowNote")}</p>
        {error && <p className={styles.error}>{error}</p>}
      </section>
      {connectors === null && !error && <p className={styles.muted}>{t("conn.loading")}</p>}
      {connectors?.map((connector) => (
        <ConnectorCard key={connector.id} connector={connector} onChanged={replace} onDeleted={() => setConnectors((current) => (current ?? []).filter((c) => c.id !== connector.id))} />
      ))}
      {connectors?.length === 0 && <p className={styles.muted}>{t("conn.none")}</p>}
    </>
  );
}
