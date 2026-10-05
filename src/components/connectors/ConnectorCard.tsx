"use client";

import { useEffect, useState } from "react";
import { useT } from "@/i18n/I18nProvider";
import { errorMessage, jsonInit, requestJson } from "@/components/api";
import PairsEditor from "./PairsEditor";
import RequestEditor from "./RequestEditor";
import { CHURCH_YEAR_REQUEST_PRESET, type ApiConnectorView, type ApiRequestView, type AuthType, type Pair } from "./types";
import styles from "./connectors.module.css";

type Props = { connector: ApiConnectorView; onChanged: (connector: ApiConnectorView) => void; onDeleted: () => void };

type Draft = { name: string; baseUrl: string; headers: Pair[]; authType: AuthType; headerName: string; username: string; token: string; value: string; password: string };

const toDraft = (c: ApiConnectorView): Draft => ({
  name: c.name,
  baseUrl: c.baseUrl,
  headers: c.headers,
  authType: c.auth.type,
  headerName: c.auth.headerName ?? "",
  username: c.auth.username ?? "",
  token: "",
  value: "",
  password: "",
});

/** One connector: address, authentication, extra headers and its requests. Stored secrets are never shown. */
export default function ConnectorCard({ connector, onChanged, onDeleted }: Props) {
  const t = useT();
  const [draft, setDraft] = useState<Draft>(toDraft(connector));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => setDraft(toDraft(connector)), [connector]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const secretStored = connector.auth.hasSecret && connector.auth.type === draft.authType;
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(connector));

  async function save() {
    setBusy(true);
    setError("");
    try {
      const auth = { type: draft.authType, token: draft.token, headerName: draft.headerName, value: draft.value, username: draft.username, password: draft.password };
      onChanged(await requestJson<ApiConnectorView>(`/api/connectors/${connector.id}`, jsonInit("PATCH", { name: draft.name, baseUrl: draft.baseUrl, headers: draft.headers, auth }), t("conn.saveFailed")));
    } catch (e) {
      setError(errorMessage(e, t("conn.saveFailed")));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await requestJson(`/api/connectors/${connector.id}`, { method: "DELETE" }, t("conn.deleteFailed"));
      onDeleted();
    } catch (e) {
      setError(errorMessage(e, t("conn.deleteFailed")));
      setBusy(false);
    }
  }

  async function addRequest(body: object) {
    setBusy(true);
    setError("");
    try {
      const created = await requestJson<ApiRequestView>(`/api/connectors/${connector.id}/requests`, jsonInit("POST", body), t("conn.requestAddFailed"));
      onChanged({ ...connector, requests: [...connector.requests, created] });
    } catch (e) {
      setError(errorMessage(e, t("conn.requestAddFailed")));
    } finally {
      setBusy(false);
    }
  }

  const secretPlaceholder = secretStored ? t("conn.secretStored") : "";
  return (
    <section className={styles.card} aria-label={t("conn.ariaCard", { name: connector.name })}>
      <h2>{connector.name}</h2>
      <div className={styles.grid2}>
        <label className={styles.field}>
          {t("conn.name")}
          <input value={draft.name} onChange={(e) => set("name", e.target.value)} />
        </label>
        <label className={styles.field}>
          {t("conn.address")}
          <input className={styles.mono} value={draft.baseUrl} placeholder="https://" onChange={(e) => set("baseUrl", e.target.value)} />
        </label>
      </div>
      <div className={styles.grid2}>
        <label className={styles.field}>
          {t("conn.auth")}
          <select value={draft.authType} onChange={(e) => set("authType", e.target.value as AuthType)}>
            <option value="none">{t("conn.auth.none")}</option>
            <option value="bearer">{t("conn.auth.bearer")}</option>
            <option value="api_key">{t("conn.auth.apiKey")}</option>
            <option value="basic">{t("conn.auth.basic")}</option>
          </select>
        </label>
        {draft.authType === "bearer" && (
          <label className={styles.field}>
            {t("conn.token")}
            <input type="password" autoComplete="off" value={draft.token} placeholder={secretPlaceholder} onChange={(e) => set("token", e.target.value)} />
          </label>
        )}
        {draft.authType === "api_key" && (
          <div className={styles.grid2}>
            <label className={styles.field}>
              {t("conn.headerName")}
              <input className={styles.mono} value={draft.headerName} placeholder="X-Api-Key" onChange={(e) => set("headerName", e.target.value)} />
            </label>
            <label className={styles.field}>
              {t("conn.apiKey")}
              <input type="password" autoComplete="off" value={draft.value} placeholder={secretPlaceholder} onChange={(e) => set("value", e.target.value)} />
            </label>
          </div>
        )}
        {draft.authType === "basic" && (
          <div className={styles.grid2}>
            <label className={styles.field}>
              {t("conn.username")}
              <input autoComplete="off" value={draft.username} onChange={(e) => set("username", e.target.value)} />
            </label>
            <label className={styles.field}>
              {t("conn.password")}
              <input type="password" autoComplete="off" value={draft.password} placeholder={secretPlaceholder} onChange={(e) => set("password", e.target.value)} />
            </label>
          </div>
        )}
      </div>
      <PairsEditor label={t("conn.headers")} rows={draft.headers} onChange={(rows) => set("headers", rows)} keyPlaceholder="Accept-Language" />
      <div className={styles.actions}>
        <button type="button" className={`${styles.button} ${styles.primary}`} disabled={!dirty || busy} onClick={() => void save()}>
          {t("conn.save")}
        </button>
        {!confirmDelete ? (
          <button type="button" className={`${styles.button} ${styles.danger}`} disabled={busy} onClick={() => setConfirmDelete(true)}>
            {t("conn.deleteAsk")}
          </button>
        ) : (
          <>
            <span className={styles.muted}>{t("conn.deleteConfirm")}</span>
            <button type="button" className={`${styles.button} ${styles.danger}`} disabled={busy} onClick={() => void remove()}>
              {t("conn.delete")}
            </button>
            <button type="button" className={styles.button} onClick={() => setConfirmDelete(false)}>
              {t("conn.cancel")}
            </button>
          </>
        )}
      </div>
      {error && <p className={styles.error}>{error}</p>}
      <h3>{t("conn.requests")}</h3>
      {connector.requests.map((request) => (
        <RequestEditor
          key={request.id}
          connectorId={connector.id}
          request={request}
          onSaved={(saved) => onChanged({ ...connector, requests: connector.requests.map((r) => (r.id === saved.id ? saved : r)) })}
          onDeleted={() => onChanged({ ...connector, requests: connector.requests.filter((r) => r.id !== request.id) })}
        />
      ))}
      {!connector.requests.length && <p className={styles.muted}>{t("conn.noRequests")}</p>}
      <div className={styles.actions}>
        <button type="button" className={styles.button} disabled={busy} onClick={() => void addRequest({ name: t("conn.defaultRequestName", { n: connector.requests.length + 1 }), path: "/" })}>
          {t("conn.newRequest")}
        </button>
        <button type="button" className={styles.button} disabled={busy} onClick={() => void addRequest(CHURCH_YEAR_REQUEST_PRESET)}>
          {t("conn.churchYearRequest")}
        </button>
      </div>
    </section>
  );
}
