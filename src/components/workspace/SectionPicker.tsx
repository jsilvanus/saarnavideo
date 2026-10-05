"use client";

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
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? ""),
    [label, setLabel] = useState("Section"),
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
  if (!source) return <p className="muted">Add a source first.</p>;
  return (
    <div className="section-picker">
      <div className="picker-controls">
        <label>
          Source
          <select value={source.id} onChange={(e) => setSourceId(e.target.value)}>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.type} · {sourceLabel(s)}
                {s.status === "PENDING" ? " · upload later" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Section name
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
        <button onClick={() => setStart(current)}>Set start</button>
        <button onClick={() => setEnd(current)}>Set end</button>
      </SourcePlayer>
      <div className="range-inputs">
        <label>
          Start
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
          End
          <input type="number" min=".1" step=".1" value={end} onChange={(e) => setEnd(Number(e.target.value))} />
        </label>
      </div>
      <button className="primary" onClick={() => end > start && onAdd(source.id, label, start, end)}>
        ＋ Add section {formatTime(start)} → {formatTime(end)}
      </button>
    </div>
  );
}
