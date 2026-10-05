"use client";

import { useEffect, useState } from "react";
import { errorMessage, jsonInit, requestJson } from "@/components/api";
import ConnectorCard from "./ConnectorCard";
import type { ApiConnectorView } from "./types";
import styles from "./connectors.module.css";

/** Settings: API connectors that fill project variables (for example the church year of a service date). */
export default function ConnectorsSettings() {
  const [connectors, setConnectors] = useState<ApiConnectorView[] | null>(null);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    requestJson<{ connectors: ApiConnectorView[] }>("/api/connectors", { cache: "no-store" }, "Yhteyksiä ei voitu ladata")
      .then((data) => setConnectors(data.connectors))
      .catch((e) => setError(errorMessage(e, "Yhteyksiä ei voitu ladata")));
  }, []);

  async function create() {
    setBusy(true);
    setError("");
    try {
      const created = await requestJson<ApiConnectorView>("/api/connectors", jsonInit("POST", { name, baseUrl }), "Yhteyttä ei voitu luoda");
      setConnectors((current) => [...(current ?? []), created].sort((a, b) => a.name.localeCompare(b.name)));
      setName("");
      setBaseUrl("");
    } catch (e) {
      setError(errorMessage(e, "Yhteyttä ei voitu luoda"));
    } finally {
      setBusy(false);
    }
  }

  const replace = (updated: ApiConnectorView) => setConnectors((current) => (current ?? []).map((c) => (c.id === updated.id ? updated : c)));

  return (
    <>
      <section className={styles.card}>
        <h2>API-yhteydet</h2>
        <p className={styles.muted}>
          Yhteys on osoite, tunnistautuminen ja pyyntöjä. Pyyntö hakee tietoa ja täyttää sen avulla projektin muuttujia, esimerkiksi pyhäpäivän nimen ja evankeliumin jumalanpalveluksen päivän mukaan. Haku tehdään Lähde-vaiheen
          Muuttujat-kohdassa.
        </p>
        <div className={styles.grid2}>
          <label className={styles.field}>
            Nimi
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Kirkkovuosi" />
          </label>
          <label className={styles.field}>
            Osoite
            <input className={styles.mono} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://" />
          </label>
        </div>
        <div className={styles.actions}>
          <button type="button" className={`${styles.button} ${styles.primary}`} disabled={busy || !name.trim() || !baseUrl.trim()} onClick={() => void create()}>
            ＋ Lisää yhteys
          </button>
        </div>
        <p className={styles.muted}>
          Palvelin ei yhdisty sisäverkon osoitteisiin ennen kuin ne on sallittu palvelimen asetuksessa CONNECTOR_ALLOW (osoitteita, CIDR-alueita tai nimiä pilkulla erotettuna). Asetusta ei voi muuttaa tältä sivulta.
        </p>
        {error && <p className={styles.error}>{error}</p>}
      </section>
      {connectors === null && !error && <p className={styles.muted}>Ladataan…</p>}
      {connectors?.map((connector) => (
        <ConnectorCard key={connector.id} connector={connector} onChanged={replace} onDeleted={() => setConnectors((current) => (current ?? []).filter((c) => c.id !== connector.id))} />
      ))}
      {connectors?.length === 0 && <p className={styles.muted}>Ei yhteyksiä vielä.</p>}
    </>
  );
}
