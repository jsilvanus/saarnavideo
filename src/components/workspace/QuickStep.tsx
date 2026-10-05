"use client";

import { useT } from "@/i18n/I18nProvider";
import { useState } from "react";
import FetchVariables from "@/components/FetchVariables";
import PublishPanel from "@/components/PublishPanel";
import VariablesEditor from "@/components/VariablesEditor";
import { formatTime, sourceLabel } from "@/components/format";
import { useOpenWorkspace } from "./useWorkspace";
import { Panel } from "./Panel";
import { ProjectTitle } from "./ProjectTitle";
import { jobStatusLabel, outputLabel } from "./helpers";
import type { CaptionMode, Source } from "./types";

const ACTIVE = ["QUEUED", "ACQUIRING_SOURCE", "PROCESSING", "RENDERING"];

/** Length of a source in seconds when it is known (uploads, or a YouTube reference duration), otherwise null. */
function knownSeconds(source: Source) {
  const ms = source.durationMs ?? source.referenceDurationMs;
  return ms && ms > 0 ? ms / 1000 : null;
}

/** Pikajulkaisu: the common case on one page. Every card uses the same handlers as the three detailed steps. */
export default function QuickStep() {
  const {
    selected,
    setStep,
    busy,
    uploadFiles,
    setUploadFiles,
    youtubeUrl,
    setYoutubeUrl,
    addUploads,
    addYoutube,
    addSegment,
    currentDefinition,
    saveTitle,
    saveVariables,
    captionMode,
    setCaptionMode,
    generate,
    previewRender,
    previewBusy,
    stopJob,
    refreshPublications,
    openProject,
    durationNotice,
  } = useOpenWorkspace();

  const t = useT();
  const [manualSeconds, setManualSeconds] = useState("");
  const definition = currentDefinition();
  const clips = definition.composition.items.filter((item) => item.type === "source-clip");
  const firstSource = selected.sources.find((s) => s.status !== "PENDING");
  const manual = Number(manualSeconds.replace(",", "."));
  const wholeSeconds = firstSource ? (knownSeconds(firstSource) ?? (manual > 0 ? manual : null)) : null;
  const jobs = selected.jobs ?? [];
  const activeJob = jobs.find((j) => ACTIVE.includes(j.status));
  const video = selected.outputs?.find((o) => o.type === "VIDEO" && !o.preview);
  const failed = jobs.find((j) => j.status === "FAILED" && !j.preview);
  const wholeSource = () => {
    if (firstSource && wholeSeconds) void addSegment(firstSource.id, t("quick.wholeName"), 0, Math.floor(wholeSeconds));
  };

  return (
    <div className="quick-step">
      <Panel title={t("quick.1.title")} text={t("quick.1.text")}>
        <div className="form-grid">
          <label>
            {t("src.youtubeLink")}
            <input value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)} placeholder="https://youtube.com/watch?v=…" />
            <button onClick={() => void addYoutube()} disabled={busy || !youtubeUrl.trim()}>
              {t("src.addYoutube")}
            </button>
          </label>
          <label>
            {t("quick.orFile")}
            <input type="file" accept="video/*" multiple onChange={(e) => setUploadFiles(Array.from(e.target.files ?? []))} />
            <button onClick={() => void addUploads()} disabled={busy || !uploadFiles.length}>
              {t("src.uploadSelected")}
            </button>
          </label>
        </div>
        {selected.sources.length > 0 ? (
          <ul className="quick-list">
            {selected.sources.map((s) => (
              <li key={s.id}>
                {sourceLabel(s)}
                {knownSeconds(s) !== null && <small className="muted"> · {formatTime(knownSeconds(s)!)}</small>}
                {s.status === "PENDING" && <small className="muted"> · {t("quick.pendingFile")}</small>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{t("src.none")}</p>
        )}
      </Panel>

      <Panel title={t("quick.2.title")} text={t("quick.2.text")}>
        <ProjectTitle title={selected.title} onSave={saveTitle} />
        <FetchVariables projectId={selected.id} variables={definition.variables ?? []} onSave={saveVariables} />
        <VariablesEditor variables={definition.variables ?? []} graphics={definition.graphics} onSave={saveVariables} />
      </Panel>

      <Panel title={t("quick.3.title")} text={t("quick.3.text")}>
        {clips.length ? (
          <p>
            {t("quick.clips", { count: clips.length })}{" "}
            <button className="link-button" onClick={() => setStep("structure")}>
              {t("quick.editSections")}
            </button>
          </p>
        ) : (
          <>
            <p className="muted">{t("quick.noClips")}</p>
            <div className="button-row">
              <button disabled={busy || !wholeSeconds} onClick={wholeSource}>
                {t("quick.useWhole")}
              </button>
              <button onClick={() => setStep("structure")}>{t("quick.chooseSections")}</button>
            </div>
            {firstSource && knownSeconds(firstSource) === null && (
              <label className="muted">
                {t("quick.manualSeconds")}
                <input inputMode="decimal" value={manualSeconds} onChange={(e) => setManualSeconds(e.target.value)} placeholder={t("quick.manualPlaceholder")} />
              </label>
            )}
            {!firstSource && <small className="muted">{t("quick.addSourceFirst")}</small>}
          </>
        )}
      </Panel>

      <Panel title={t("quick.4.title")} text={t("quick.4.text")}>
        {durationNotice}
        <label className="muted">
          {t("captions.label")}{" "}
          <select value={captionMode} onChange={(e) => setCaptionMode(e.target.value as CaptionMode)}>
            <option value="none">{t("captions.none")}</option>
            <option value="soft">{t("captions.soft")}</option>
            <option value="burn">{t("captions.burn")}</option>
            <option value="both">{t("captions.both")}</option>
          </select>
        </label>
        <div className="button-row">
          <button disabled={previewBusy || busy || !clips.length} onClick={() => void previewRender()}>
            {previewBusy ? t("project.previewQueued") : t("quick.quickPreview")}
          </button>
          <button className="primary" disabled={busy || !clips.length} onClick={() => void generate()}>
            {t("quick.finalVideo")}
          </button>
        </div>
        {activeJob && (
          <p className="job-row">
            <strong>{activeJob.preview ? t("quick.jobPreview") : t("quick.jobVideo")} {jobStatusLabel(t, activeJob.status)}</strong> <span>{activeJob.progress}%</span>
            <button className="stop-button" onClick={() => void stopJob(activeJob)}>
              {t("common.stop")}
            </button>
          </p>
        )}
        {failed && !activeJob && <p className="error">{failed.errorMessage ? t("quick.lastFailedWith", { error: failed.errorMessage }) : t("quick.lastFailed")}</p>}
        {video && (
          <div className="downloads">
            <video controls preload="metadata" src={`/api/outputs/${video.id}`} />
            <a href={`/api/outputs/${video.id}`}>{outputLabel(video, t)} ↓</a>
          </div>
        )}
      </Panel>

      <Panel title={t("quick.5.title")}>
        <PublishPanel
          projectId={selected.id}
          publications={selected.publications ?? []}
          hasVideo={!!video}
          onRefresh={() => void openProject(selected.id)}
          onPoll={() => void refreshPublications(selected.id)}
        />
        <small className="muted">
          {t("quick.moreSettings")}<button className="link-button" onClick={() => setStep("publish")}>{t("steps.publish")}</button>.
        </small>
      </Panel>
    </div>
  );
}
