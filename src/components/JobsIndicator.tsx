"use client";

import { useCallback } from "react";
import JobsPanel, { type JobsResponse, type StripResponse } from "@/components/jobs-panel/JobsPanel";
import type { PanelJob, Translate } from "@/components/jobs-panel/job-panel";
import { useT } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/translate";

const TYPE_KEYS = new Set(["VIDEO", "PREVIEW", "THUMBNAIL", "PODCAST", "DOWNLOAD", "TRANSCRIBE", "IMPORT"]);

/**
 * SaarnaVideo's wiring of the jobs panel (`components/jobs-panel/`, a component that is copied between apps, see its
 * README): where the jobs and the fleet strip come from, how a job is cancelled and what the types are called.
 */
export default function JobsIndicator() {
  const translate = useT();
  const t: Translate = (key, params) => translate(key as MessageKey, params);
  const loadJobs = useCallback(async () => {
    const res = await fetch("/api/jobs");
    if (!res.ok) throw new Error("jobs");
    return await res.json() as JobsResponse;
  }, []);
  const loadStrip = useCallback(async () => {
    const res = await fetch("/api/fleet/status");
    return res.ok ? await res.json() as StripResponse : null;
  }, []);
  const cancelJob = useCallback(async (job: PanelJob) => {
    const res = await fetch(`/api/projects/${encodeURIComponent(job.projectId)}/jobs/${encodeURIComponent(job.id)}/cancel`, { method: "POST" });
    if (!res.ok) throw new Error("cancel");
  }, []);
  const typeLabel = (type: string) => (TYPE_KEYS.has(type) ? t(`jobs.type.${type}`) : type);
  return <JobsPanel t={t} loadJobs={loadJobs} loadStrip={loadStrip} cancelJob={cancelJob} typeLabel={typeLabel} />;
}
