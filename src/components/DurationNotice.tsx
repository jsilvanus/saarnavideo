"use client";

import { useMemo } from "react";
import { computeDurationReport, formatDuration } from "@/lib/duration-report";
import type { ProjectDefinition } from "@/domain/project";

type Props = { definition: unknown; assets?: Array<{ id: string; type?: string; durationMs?: number | null }> };

/** Video / podcast length against target and platform limit. Informational only, never blocks anything. */
export default function DurationNotice({ definition, assets = [] }: Props) {
  const report = useMemo(() => {
    try {
      const durations = new Map<string, number>();
      for (const asset of assets) if (asset.durationMs) durations.set(asset.id, asset.durationMs / 1000);
      return computeDurationReport(definition as ProjectDefinition, durations);
    } catch { return null; }
  }, [definition, assets]);
  if (!report) return null;
  const parts = [`Video ${formatDuration(report.videoSeconds)}`];
  if (report.podcastSeconds !== undefined) parts.push(`Podcast ${formatDuration(report.podcastSeconds)}`);
  if (report.targetSeconds) parts.push(`Target ${formatDuration(report.targetSeconds)}`);
  if (report.limitSeconds) parts.push(`Limit ${formatDuration(report.limitSeconds)}${report.limitLabel ? ` (${report.limitLabel})` : ""}`);
  return <div data-testid="duration-notice" style={{ margin: "0 0 14px", display: "grid", gap: 6 }}>
    <div className="muted"><strong>{parts.join(" · ")}</strong></div>
    {report.warnings.length > 0 && <div className="warning-list" style={report.warnings.every(w => w.level === "info") ? { background: "#f3f4f6", borderColor: "#d1d5db" } : undefined}>
      {report.warnings.map(w => <div key={w.code} data-level={w.level} style={w.level === "info" ? { color: "#4b5563" } : { color: "#9a3412" }}>{w.level === "warning" ? "⚠ " : "ℹ "}{w.message}</div>)}
    </div>}
  </div>;
}
