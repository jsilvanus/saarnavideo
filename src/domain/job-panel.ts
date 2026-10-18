import type { TFunction } from "@/i18n/translate";

export type PanelJob = {
  id: string;
  projectId: string;
  projectTitle: string;
  type: string;
  status: string;
  phase: string | null;
  progress: number;
  message: string | null;
  error: string | null;
  workerId: string | null;
  cancelRequested: boolean;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export const isActiveJob = (job: Pick<PanelJob, "status">) => job.status === "QUEUED" || job.status === "RUNNING";

export const POLL_ACTIVE_MS = 3000;
export const POLL_IDLE_MS = 15000;

/** The panel polls every 3 s while it is open or something is active, every 15 s otherwise. */
export const pollInterval = (open: boolean, activeCount: number) => (open || activeCount > 0 ? POLL_ACTIVE_MS : POLL_IDLE_MS);

/** "5 min ago" style age of an ISO time. */
export function formatJobAge(iso: string | null, now: number, t: TFunction): string {
  if (!iso) return "";
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return t("jobs.ago.s", { n: seconds });
  if (seconds < 3600) return t("jobs.ago.m", { n: Math.floor(seconds / 60) });
  if (seconds < 86400) return t("jobs.ago.h", { n: Math.floor(seconds / 3600) });
  return t("jobs.ago.d", { n: Math.floor(seconds / 86400) });
}

/** Progress bar value 0-100: finished jobs are full or empty, a queued job has none. */
export function jobPercent(job: Pick<PanelJob, "status" | "progress">): number {
  if (job.status === "COMPLETED") return 100;
  if (job.status === "QUEUED") return 0;
  return Math.min(100, Math.max(0, Math.round(job.progress || 0)));
}

/** The line under the title: the worker's message, else the phase, else (failed) the error. */
export function jobDetail(job: Pick<PanelJob, "status" | "message" | "phase" | "error">): string {
  if (job.status === "FAILED" && job.error) return job.error;
  return job.message || job.phase || "";
}
