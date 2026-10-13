"use client";

import { useEffect, useState } from "react";
import { useT } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/translate";

type ImportInfo = { id: string; status: "PENDING" | "DOWNLOADING" | "READY" | "FAILED"; projectId: string | null; error: string | null; summary: { notices?: string[]; mainRole?: string; captionLanguages?: string[]; dskEventCount?: number } | null };

/** Status of the LCYT import that made this project: progress while it fetches, the error with a retry when it failed, and what arrived. */
export default function ImportNotice({ projectId }: { projectId: string }) {
  const t = useT();
  const [info, setInfo] = useState<ImportInfo | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      try {
        const response = await fetch("/api/imports");
        if (!response.ok) return;
        const rows = (await response.json()) as ImportInfo[];
        const mine = rows.find((row) => row.projectId === projectId) ?? null;
        if (cancelled) return;
        setInfo(mine);
        if (mine && (mine.status === "PENDING" || mine.status === "DOWNLOADING")) timer = setTimeout(() => setTick((value) => value + 1), 3000);
      } catch { /* the notice is optional */ }
    })();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [projectId, tick]);

  if (!info) return null;
  async function retry() {
    await fetch(`/api/imports/${info!.id}/retry`, { method: "POST" });
    setTick((value) => value + 1);
  }
  const summary = info.summary;
  return (
    <section className="panel" aria-live="polite">
      <h2>{t("import.title")}</h2>
      {(info.status === "PENDING" || info.status === "DOWNLOADING") && <p className="muted">{t("import.running")}</p>}
      {info.status === "FAILED" && (
        <>
          <p className="error">{t("import.failed", { error: info.error ?? "" })}</p>
          <button onClick={() => void retry()}>{t("import.retry")}</button>
        </>
      )}
      {info.status === "READY" && summary && (
        <ul className="muted">
          {summary.mainRole && <li>{t("import.done", { feed: t(`feed.role.${summary.mainRole.toUpperCase()}` as MessageKey) })}</li>}
          {!!summary.captionLanguages?.length && <li>{t("import.captions", { languages: summary.captionLanguages.join(", ") })}</li>}
          {!!summary.dskEventCount && <li>{t("import.events", { count: summary.dskEventCount })}</li>}
          {summary.notices?.map((notice) => <li key={notice}>{notice}</li>)}
        </ul>
      )}
    </section>
  );
}
