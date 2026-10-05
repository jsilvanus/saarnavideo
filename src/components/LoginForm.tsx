"use client";

import { useState, type FormEvent } from "react";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useT } from "@/i18n/I18nProvider";

export default function LoginForm({ next }: { next: string }) {
  const t = useT();
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret }) });
      if (response.ok) {
        window.location.assign(next);
        return;
      }
      setError(response.status === 401 ? t("login.wrong") : t("login.failed"));
    } catch {
      setError(t("login.failed"));
    }
    setBusy(false);
  }

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 }}>
      <form onSubmit={submit} style={{ display: "grid", gap: 12, width: "min(360px, 100%)", background: "white", border: "1px solid #ccc", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px #0002" }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>SaarnaVideo</h1>
        <label style={{ display: "grid", gap: 6 }}>
          {t("login.secret")}
          <input type="password" autoFocus autoComplete="current-password" value={secret} onChange={(event) => setSecret(event.target.value)} style={{ padding: 8, fontSize: 16 }} />
        </label>
        {error ? <p role="alert" style={{ margin: 0, color: "#b00020" }}>{error}</p> : null}
        <button type="submit" disabled={busy || !secret} style={{ padding: "8px 12px", fontSize: 16 }}>{t("login.submit")}</button>
        <div><LanguageSwitcher /></div>
      </form>
    </main>
  );
}
