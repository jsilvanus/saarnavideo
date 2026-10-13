"use client";

import { useState } from "react";
import { useT } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/translate";
import { formatTime } from "@/components/format";
import { useOpenWorkspace } from "@/components/workspace/useWorkspace";
import type { Source } from "@/components/workspace/types";
import styles from "./FeedSourceActions.module.css";

type DskEvent = { atMs?: number; kind?: string; data?: unknown };

function brief(data: unknown): string {
  if (data === null || data === undefined) return "";
  const text = typeof data === "string" ? data : JSON.stringify(data);
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

/** What a source from an imported live stream can do: be the working feed, lay its graphics over the clean picture, show the on-air graphics log. */
export default function FeedSourceActions({ source }: { source: Source }) {
  const t = useT();
  const { selected, switchFeed, addFeedGraphics, removeFeedGraphics, cutOutFeedGraphics, busy } = useOpenWorkspace();
  const [events, setEvents] = useState<DskEvent[] | null>(null);
  const [eventError, setEventError] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  if (!source.feedRole) return null;

  const items = selected.definition?.composition.items ?? [];
  const usedAsMain = items.some((item) => item.type === "source-clip" && item.sourceId === source.id);
  const overlays = items.filter((item) => item.type === "feed-overlay" && item.sourceId === source.id);
  const role = source.feedRole;

  async function loadEvents() {
    if (events || !source.feedGroupId) return;
    try {
      const response = await fetch(`/api/imports/${source.feedGroupId}?events=1`);
      if (!response.ok) throw new Error("failed");
      const body = (await response.json()) as { summary?: { dskEvents?: DskEvent[] } | null };
      setEvents(body.summary?.dskEvents ?? []);
    } catch {
      setEventError(true);
    }
  }

  return (
    <div className={styles.feed}>
      <div className={styles.row}>
        <span className={styles.badge}>{source.feedLabel ? `${t(`feed.role.${role}` as MessageKey)} · ${source.feedLabel}` : t(`feed.role.${role}` as MessageKey)}</span>
        {!!source.syncOffsetMs && <small className="muted">{t("feed.offset", { seconds: (source.syncOffsetMs / 1000).toFixed(1) })}</small>}
        {role === "DSK" && <small className="muted">{source.keyParams?.hasAlpha ? t("feed.keyAlpha") : t("feed.keyColor", { color: source.keyParams?.color ?? "#00B140" })}</small>}
      </div>
      {role !== "DSK" && (
        <div className={styles.row}>
          {usedAsMain ? <small className="muted">{t("feed.inUse")}</small> : <button onClick={() => void switchFeed(source.id)} disabled={busy}>{t("feed.use")}</button>}
          {role === "CLEAN" && <small className="muted">{t("feed.cleanHelp")}</small>}
          {role === "PROGRAM" && <small className="muted">{t("feed.programHelp")}</small>}
        </div>
      )}
      {role === "DSK" && (
        <>
          <div className={styles.row}>
            <button onClick={() => void addFeedGraphics(source.id)} disabled={busy}>{overlays.length ? t("feed.graphicsRefresh") : t("feed.graphicsAdd")}</button>
            {!!overlays.length && <button onClick={() => void removeFeedGraphics(source.id)} disabled={busy}>{t("feed.graphicsRemove")}</button>}
            <small className="muted">{overlays.length ? t("feed.graphicsOn", { count: overlays.length }) : t("feed.graphicsHelp")}</small>
          </div>
          {!!overlays.length && (
            <div className={`${styles.row} ${styles.cut}`}>
              <label>{t("feed.cutFrom")} <input type="number" min={0} step={0.1} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
              <label>{t("feed.cutTo")} <input type="number" min={0} step={0.1} value={to} onChange={(e) => setTo(e.target.value)} /></label>
              <button onClick={() => void cutOutFeedGraphics(source.id, Number(from), Number(to))} disabled={busy || from === "" || to === ""}>{t("feed.cut")}</button>
            </div>
          )}
          <details onToggle={(event) => { if ((event.currentTarget as HTMLDetailsElement).open) void loadEvents(); }}>
            <summary>{t("feed.events")}</summary>
            <div className={styles.events}>
              {eventError && <small>{t("feed.eventsError")}</small>}
              {events && !events.length && <small>{t("feed.eventsNone")}</small>}
              {!!events?.length && (
                <table>
                  <tbody>
                    {events.slice(0, 300).map((event, index) => (
                      <tr key={index}>
                        <td>{formatTime((event.atMs ?? 0) / 1000)}</td>
                        <td>{event.kind}</td>
                        <td>{brief(event.data)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </details>
        </>
      )}
    </div>
  );
}
