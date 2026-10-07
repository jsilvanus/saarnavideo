"use client";

import { useT } from "@/i18n/I18nProvider";

export function UploadProgress({ progress, label }: { progress: number | null; label?: string }) {
  if (progress == null || progress < 0) return null;
  const t = useT();
  const percent = Math.min(100, Math.max(0, Number.isFinite(progress) ? progress : 0));

  return (
    <div className="job-progress" role="status" aria-live="polite" style={{ marginTop: 8 }}>
      <div className="job-status-line">
        <span>{label ?? t("common.uploading")}</span>
        <span>{percent}%</span>
      </div>
      <div className="progress-bar">
        <div style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
