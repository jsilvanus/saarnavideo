"use client";

import { useMemo } from "react";
import { useT } from "@/i18n/I18nProvider";
import { computeDurationReport, formatDuration, type DurationWarning } from "@/lib/duration-report";
import type { ProjectDefinition } from "@/domain/project";

type Props = { definition: unknown; assets?: Array<{ id: string; type?: string; durationMs?: number | null }> };

/** Video / podcast length against target and platform limit. Informational only, never blocks anything. */
export default function DurationNotice({ definition, assets = [] }: Props) {
  const t = useT();
  const report = useMemo(() => {
    try {
      const durations = new Map<string, number>();
      for (const asset of assets) if (asset.durationMs) durations.set(asset.id, asset.durationMs / 1000);
      return computeDurationReport(definition as ProjectDefinition, durations);
    } catch { return null; }
  }, [definition, assets]);
  if (!report) return null;
  const warningText = (w: DurationWarning) => {
    const params = w.params ?? {};
    switch (w.code) {
      case "empty": return t("duration.empty");
      case "over-platform-limit": return t("duration.overLimit", params);
      case "off-target": return t("duration.offTarget", params);
      case "podcast-differs": return t(params.ranged ? "duration.podcastDiffersRanged" : "duration.podcastDiffers", params);
      default: return w.message;
    }
  };
  const parts = [t("duration.video", { value: formatDuration(report.videoSeconds) })];
  if (report.podcastSeconds !== undefined) parts.push(t("duration.podcast", { value: formatDuration(report.podcastSeconds) }));
  if (report.targetSeconds) parts.push(t("duration.target", { value: formatDuration(report.targetSeconds) }));
  if (report.limitSeconds) parts.push(t("duration.limit", { value: `${formatDuration(report.limitSeconds)}${report.limitLabel ? ` (${report.limitLabel})` : ""}` }));
  return <div data-testid="duration-notice" style={{ margin: "0 0 14px", display: "grid", gap: 6 }}>
    <div className="muted"><strong>{parts.join(" · ")}</strong></div>
    {report.warnings.length > 0 && <div className="warning-list" style={report.warnings.every(w => w.level === "info") ? { background: "#f3f4f6", borderColor: "#d1d5db" } : undefined}>
      {report.warnings.map(w => <div key={w.code} data-level={w.level} style={w.level === "info" ? { color: "#4b5563" } : { color: "#9a3412" }}>{w.level === "warning" ? "⚠ " : "ℹ "}{warningText(w)}</div>)}
    </div>}
  </div>;
}
