"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fleetStripParts, type FleetStripData } from "@/domain/fleet-strip";
import { formatJobAge, isActiveJob, jobDetail, jobPercent, pollInterval, type PanelJob } from "@/domain/job-panel";
import { useT } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/translate";
import styles from "./JobsIndicator.module.css";

type JobsResponse = { jobs: PanelJob[]; counts: { running: number; queued: number } };
type StripResponse = ({ enabled: true } & FleetStripData) | { enabled: false };

const TYPE_KEYS = new Set(["VIDEO", "PREVIEW", "THUMBNAIL", "PODCAST", "DOWNLOAD", "TRANSCRIBE", "IMPORT"]);

/** Top-bar badge and drop-down of the jobs of all projects (queued, running, recently finished) with a cancel button and the fleet strip. */
export default function JobsIndicator() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<JobsResponse | null>(null);
  const [strip, setStrip] = useState<StripResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [cancelling, setCancelling] = useState<Set<string>>(new Set());
  const [cancelError, setCancelError] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const wrap = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    if (typeof document !== "undefined" && document.hidden) return;
    try {
      const [jobsRes, stripRes] = await Promise.all([fetch("/api/jobs"), fetch("/api/fleet/status").catch(() => null)]);
      if (!jobsRes.ok) throw new Error("jobs");
      setData(await jobsRes.json() as JobsResponse);
      setFailed(false);
      if (stripRes?.ok) setStrip(await stripRes.json() as StripResponse);
      setNow(Date.now());
    } catch {
      setFailed(true);
    }
  }, []);

  const active = data ? data.counts.running + data.counts.queued : 0;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const tick = async () => {
      await refresh();
      if (!stopped) timer = setTimeout(tick, pollInterval(open, active));
    };
    void tick();
    return () => { stopped = true; clearTimeout(timer); };
  }, [open, active, refresh]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const onDown = (event: PointerEvent) => { if (wrap.current && !wrap.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onDown); };
  }, [open]);

  async function cancel(job: PanelJob) {
    setCancelError(false);
    setCancelling(prev => new Set(prev).add(job.id));
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(job.projectId)}/jobs/${encodeURIComponent(job.id)}/cancel`, { method: "POST" });
      if (!res.ok) throw new Error("cancel");
    } catch {
      setCancelError(true);
    } finally {
      setCancelling(prev => { const next = new Set(prev); next.delete(job.id); return next; });
      void refresh();
    }
  }

  const stripText = strip && strip.enabled ? fleetStripParts(strip, t).join(" · ") : "";
  const activeJobs = data?.jobs.filter(isActiveJob) ?? [];
  const recentJobs = data?.jobs.filter(job => !isActiveJob(job)) ?? [];
  const typeLabel = (type: string) => (TYPE_KEYS.has(type) ? t(`jobs.type.${type}` as MessageKey) : type);

  const renderJob = (job: PanelJob) => {
    const percent = jobPercent(job);
    const detail = jobDetail(job);
    const statusLabel = job.cancelRequested && isActiveJob(job) ? t("jobs.cancelRequested") : t(`jobStatus.${job.status}` as MessageKey);
    return (
      <li key={job.id} className={styles.row}>
        <div className={styles.top}>
          <span className={styles.title}>{typeLabel(job.type)} · {job.projectTitle}</span>
          <span className={styles.meta}>{formatJobAge(job.startedAt ?? job.createdAt, now, t)}</span>
        </div>
        <div className={styles.bar} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <div className={`${styles.barFill} ${job.status === "COMPLETED" ? styles.barDone : ""} ${job.status === "FAILED" ? styles.barFailed : ""}`} style={{ width: `${percent}%` }} />
        </div>
        {detail ? <div className={`${styles.detail} ${job.status === "FAILED" ? styles.error : ""}`}>{detail}</div> : null}
        <div className={styles.foot}>
          <span className={styles.status}>{statusLabel}{job.status === "RUNNING" ? ` · ${percent} %` : ""}{job.workerId ? ` · ${job.workerId.slice(0, 12)}` : ""}</span>
          {isActiveJob(job) && !job.cancelRequested ? (
            <button type="button" className={styles.cancel} disabled={cancelling.has(job.id)} onClick={() => void cancel(job)}>
              {cancelling.has(job.id) ? t("jobs.cancelling") : t("jobs.cancel")}
            </button>
          ) : null}
        </div>
      </li>
    );
  };

  return (
    <div className={styles.wrap} ref={wrap}>
      <button type="button" className={styles.button} aria-expanded={open} aria-label={open ? t("jobs.close") : t("jobs.open")} onClick={() => setOpen(value => !value)}>
        <span>{t("jobs.title")}</span>
        <span className={`${styles.badge} ${active === 0 ? styles.badgeIdle : ""}`} title={t("jobs.badge", { count: active })}>{active}</span>
        {stripText ? <span className={styles.inlineStrip}>{stripText}</span> : null}
      </button>
      {open ? (
        <div className={styles.panel} role="region" aria-label={t("jobs.title")}>
          {stripText ? <p className={styles.strip}>{stripText}</p> : null}
          {failed ? <p className={styles.notice}>{t("jobs.loadFailed")}</p> : null}
          {cancelError ? <p className={`${styles.notice} ${styles.error}`}>{t("jobs.cancelFailed")}</p> : null}
          {data && data.jobs.length === 0 ? <p className={styles.empty}>{t("jobs.empty")}</p> : null}
          {activeJobs.length ? (<><h3 className={styles.heading}>{t("jobs.section.active")}</h3><ul className={styles.list}>{activeJobs.map(renderJob)}</ul></>) : null}
          {recentJobs.length ? (<><h3 className={styles.heading}>{t("jobs.section.recent")}</h3><ul className={styles.list}>{recentJobs.map(renderJob)}</ul></>) : null}
        </div>
      ) : null}
    </div>
  );
}
