"use client";

import { useEffect, useState } from "react";
import { useT } from "@/i18n/I18nProvider";
import { errorMessage, jsonInit, requestJson } from "@/components/api";
import styles from "./connectors.module.css";

type CookiesStatus = { configured: boolean; source: "db" | "env" | "none"; cookieCount: number | null; updatedAt: string | null; envFallback: boolean };

/** Settings: the YouTube cookies yt-dlp uses for downloads. The text is write-only; only the status comes back. */
export default function YouTubeCookiesSettings() {
  const t = useT();
  const [status, setStatus] = useState<CookiesStatus | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    requestJson<CookiesStatus>("/api/integrations/youtube/cookies", { cache: "no-store" }, t("ytc.loadFailed"))
      .then(setStatus)
      .catch((e) => setError(errorMessage(e, t("ytc.loadFailed"))));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  async function run(call: () => Promise<CookiesStatus>, done: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setStatus(await call());
      setText("");
      setConfirmDelete(false);
      setNotice(done);
    } catch (e) {
      setError(errorMessage(e, t("ytc.saveFailed")));
    } finally {
      setBusy(false);
    }
  }

  const save = () => run(() => requestJson<CookiesStatus>("/api/integrations/youtube/cookies", jsonInit("PUT", { cookies: text }), t("ytc.saveFailed")), t("ytc.saved"));
  const remove = () => run(() => requestJson<CookiesStatus>("/api/integrations/youtube/cookies", { method: "DELETE" }, t("ytc.deleteFailed")), t("ytc.deleted"));

  async function readFile(file: File | undefined) {
    if (file) setText(await file.text());
  }

  const stored = status?.source === "db";
  const summary = !status ? "" : stored
    ? t("ytc.statusDb", { count: status.cookieCount ?? 0, time: status.updatedAt ? new Date(status.updatedAt).toLocaleString() : "" })
    : status.source === "env" ? t("ytc.statusEnv") : t("ytc.statusNone");

  return (
    <section className={styles.card}>
      <h2>{t("ytc.title")}</h2>
      <p className={styles.muted}>{t("ytc.intro")}</p>
      {status && <p className={status.configured ? styles.ok : styles.muted}>{summary}</p>}
      {stored && status?.envFallback && <p className={styles.muted}>{t("ytc.envAlso")}</p>}
      <label className={styles.field}>
        {t("ytc.fileLabel")}
        <input type="file" accept=".txt,text/plain" onChange={(e) => void readFile(e.target.files?.[0])} />
      </label>
      <label className={styles.field}>
        {t("ytc.pasteLabel")}
        <textarea className={styles.mono} value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" spellCheck={false} />
      </label>
      <div className={styles.actions}>
        <button type="button" className={`${styles.button} ${styles.primary}`} disabled={busy || !text.trim()} onClick={() => void save()}>
          {stored ? t("ytc.replace") : t("ytc.save")}
        </button>
        {stored && !confirmDelete && (
          <button type="button" className={`${styles.button} ${styles.danger}`} disabled={busy} onClick={() => setConfirmDelete(true)}>
            {t("ytc.delete")}
          </button>
        )}
        {stored && confirmDelete && (
          <>
            <span className={styles.muted}>{t("ytc.confirmDelete")}</span>
            <button type="button" className={`${styles.button} ${styles.danger}`} disabled={busy} onClick={() => void remove()}>
              {t("ytc.delete")}
            </button>
            <button type="button" className={styles.button} onClick={() => setConfirmDelete(false)}>
              {t("common.cancel")}
            </button>
          </>
        )}
      </div>
      {notice && <p className={styles.ok}>{notice}</p>}
      {error && <p className={styles.error}>{error}</p>}
    </section>
  );
}
