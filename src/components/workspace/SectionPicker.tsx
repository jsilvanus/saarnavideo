"use client";

import { useT } from "@/i18n/I18nProvider";
import { useEffect, useState } from "react";
import { SourcePlayer, useSourcePlayer } from "@/components/SourcePlayer";
import { formatTime, sourceLabel } from "@/components/format";
import type { Source } from "./types";

export function SectionPicker({
  projectId,
  sources,
  pendingFiles,
  onAdd,
}: {
  projectId: string;
  sources: Source[];
  pendingFiles: Record<string, File>;
  onAdd: (sourceId: string, label: string, start: number, end: number) => void;
}) {
  const t = useT();
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? ""),
    [label, setLabel] = useState(t("pick.default")),
    [start, setStart] = useState(0),
    [end, setEnd] = useState(60);
  const source = sources.find((s) => s.id === sourceId) || sources[0];
  useEffect(() => {
    if (sources.length && !sources.some((s) => s.id === sourceId)) setSourceId(sources[0].id);
  }, [sources, sourceId]);
  const localFile = source ? pendingFiles[source.id] : undefined;
  const player = useSourcePlayer(source, sourceId, localFile, () => {
    setStart(0);
    setEnd(60);
  });
  const { current, seek } = player;
  if (!source) return <p className="muted">{t("pick.addSourceFirst")}</p>;
  return (
    <div className="section-picker">
      <div className="picker-controls">
        <label>
          {t("pick.source")}
          <select value={source.id} onChange={(e) => setSourceId(e.target.value)}>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.type} · {sourceLabel(s)}
                {s.status === "PENDING" ? t("pick.uploadLater") : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("pick.name")}
          <input value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
      </div>
      <SourcePlayer
        source={source}
        player={player}
        localFile={localFile}
        remoteSrc={`/api/projects/${projectId}/source/${source.id}`}
        onDuration={(d) => {
          if (end === 60) setEnd(Math.min(60, d));
        }}
      >
        <button onClick={() => setStart(current)}>{t("pick.setStart")}</button>
        <button onClick={() => setEnd(current)}>{t("pick.setEnd")}</button>
      </SourcePlayer>
      <div className="range-inputs">
        <label>
          {t("pick.start")}
          <input
            type="number"
            min="0"
            step=".1"
            value={start}
            onChange={(e) => {
              const n = Number(e.target.value);
              setStart(n);
              seek(n);
            }}
          />
        </label>
        <label>
          {t("pick.end")}
          <input type="number" min=".1" step=".1" value={end} onChange={(e) => setEnd(Number(e.target.value))} />
        </label>
      </div>
      <button className="primary" onClick={() => end > start && onAdd(source.id, label, start, end)}>
        {t("pick.add", { start: formatTime(start), end: formatTime(end) })}
      </button>
    </div>
  );
}
