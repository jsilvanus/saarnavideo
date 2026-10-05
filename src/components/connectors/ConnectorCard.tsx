"use client";

import { useEffect, useState } from "react";
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
      onChanged(await requestJson<ApiConnectorView>(`/api/connectors/${connector.id}`, jsonInit("PATCH", { name: draft.name, baseUrl: draft.baseUrl, headers: draft.headers, auth }), "Yhteyttä ei voitu tallentaa"));
    } catch (e) {
      setError(errorMessage(e, "Yhteyttä ei voitu tallentaa"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await requestJson(`/api/connectors/${connector.id}`, { method: "DELETE" }, "Yhteyttä ei voitu poistaa");
      onDeleted();
    } catch (e) {
      setError(errorMessage(e, "Yhteyttä ei voitu poistaa"));
      setBusy(false);
    }
  }

  async function addRequest(body: object) {
    setBusy(true);
    setError("");
    try {
      const created = await requestJson<ApiRequestView>(`/api/connectors/${connector.id}/requests`, jsonInit("POST", body), "Pyyntöä ei voitu lisätä");
      onChanged({ ...connector, requests: [...connector.requests, created] });
    } catch (e) {
      setError(errorMessage(e, "Pyyntöä ei voitu lisätä"));
    } finally {
      setBusy(false);
    }
  }

  const secretPlaceholder = secretStored ? "tallennettu, jätä tyhjäksi säilyttääksesi" : "";
  return (
    <section className={styles.card} aria-label={`Yhteys ${connector.name}`}>
      <h2>{connector.name}</h2>
      <div className={styles.grid2}>
        <label className={styles.field}>
          Nimi
          <input value={draft.name} onChange={(e) => set("name", e.target.value)} />
        </label>
        <label className={styles.field}>
          Osoite
          <input className={styles.mono} value={draft.baseUrl} placeholder="https://" onChange={(e) => set("baseUrl", e.target.value)} />
        </label>
      </div>
      <div className={styles.grid2}>
        <label className={styles.field}>
          Tunnistautuminen
          <select value={draft.authType} onChange={(e) => set("authType", e.target.value as AuthType)}>
            <option value="none">Ei mitään</option>
            <option value="bearer">Bearer-tunniste</option>
            <option value="api_key">API-avain otsikossa</option>
            <option value="basic">Käyttäjätunnus ja salasana</option>
          </select>
        </label>
        {draft.authType === "bearer" && (
          <label className={styles.field}>
            Tunniste
            <input type="password" autoComplete="off" value={draft.token} placeholder={secretPlaceholder} onChange={(e) => set("token", e.target.value)} />
          </label>
        )}
        {draft.authType === "api_key" && (
          <div className={styles.grid2}>
            <label className={styles.field}>
              Otsikon nimi
              <input className={styles.mono} value={draft.headerName} placeholder="X-Api-Key" onChange={(e) => set("headerName", e.target.value)} />
            </label>
            <label className={styles.field}>
              Avain
              <input type="password" autoComplete="off" value={draft.value} placeholder={secretPlaceholder} onChange={(e) => set("value", e.target.value)} />
            </label>
          </div>
        )}
        {draft.authType === "basic" && (
          <div className={styles.grid2}>
            <label className={styles.field}>
              Käyttäjätunnus
              <input autoComplete="off" value={draft.username} onChange={(e) => set("username", e.target.value)} />
            </label>
            <label className={styles.field}>
              Salasana
              <input type="password" autoComplete="off" value={draft.password} placeholder={secretPlaceholder} onChange={(e) => set("password", e.target.value)} />
            </label>
          </div>
        )}
      </div>
      <PairsEditor label="Otsikot (lähetetään jokaisen pyynnön mukana)" rows={draft.headers} onChange={(rows) => set("headers", rows)} keyPlaceholder="Accept-Language" />
      <div className={styles.actions}>
        <button type="button" className={`${styles.button} ${styles.primary}`} disabled={!dirty || busy} onClick={() => void save()}>
          Tallenna yhteys
        </button>
        {!confirmDelete ? (
          <button type="button" className={`${styles.button} ${styles.danger}`} disabled={busy} onClick={() => setConfirmDelete(true)}>
            Poista yhteys…
          </button>
        ) : (
          <>
            <span className={styles.muted}>Poistetaanko yhteys ja sen pyynnöt? Projektien muuttujat säilyvät.</span>
            <button type="button" className={`${styles.button} ${styles.danger}`} disabled={busy} onClick={() => void remove()}>
              Poista
            </button>
            <button type="button" className={styles.button} onClick={() => setConfirmDelete(false)}>
              Peruuta
            </button>
          </>
        )}
      </div>
      {error && <p className={styles.error}>{error}</p>}
      <h3>Pyynnöt</h3>
      {connector.requests.map((request) => (
        <RequestEditor
          key={request.id}
          connectorId={connector.id}
          request={request}
          onSaved={(saved) => onChanged({ ...connector, requests: connector.requests.map((r) => (r.id === saved.id ? saved : r)) })}
          onDeleted={() => onChanged({ ...connector, requests: connector.requests.filter((r) => r.id !== request.id) })}
        />
      ))}
      {!connector.requests.length && <p className={styles.muted}>Ei pyyntöjä vielä.</p>}
      <div className={styles.actions}>
        <button type="button" className={styles.button} disabled={busy} onClick={() => void addRequest({ name: `Pyyntö ${connector.requests.length + 1}`, path: "/" })}>
          ＋ Uusi pyyntö
        </button>
        <button type="button" className={styles.button} disabled={busy} onClick={() => void addRequest(CHURCH_YEAR_REQUEST_PRESET)}>
          ＋ Kirkkovuosipyyntö (anno-api-muotoinen)
        </button>
      </div>
    </section>
  );
}
