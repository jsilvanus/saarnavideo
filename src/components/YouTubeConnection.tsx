"use client";

import { useEffect, useState } from "react";

export default function YouTubeConnection() {
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    const response = await fetch("/api/integrations/youtube/status", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json() as { connected?: boolean };
    setConnected(Boolean(data.connected));
  }

  useEffect(() => { void refresh(); }, []);

  async function disconnect() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/integrations/youtube/disconnect", { method: "POST" });
      if (!response.ok) throw new Error("Could not disconnect YouTube");
      setConnected(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not disconnect YouTube");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: "fixed", top: 12, right: 12, zIndex: 1000, display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, background: "var(--background, #fff)", border: "1px solid #ddd", boxShadow: "0 2px 10px rgba(0,0,0,.12)" }}>
      {connected ? <><span style={{ fontSize: 13 }}>YouTube connected</span><button type="button" disabled={busy} onClick={() => void disconnect()}>Disconnect</button></> : <a href="/api/integrations/youtube/connect">Connect YouTube</a>}
      {error && <span role="alert" style={{ fontSize: 12 }}>{error}</span>}
    </div>
  );
}
