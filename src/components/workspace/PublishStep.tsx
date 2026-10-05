"use client";

import { useT } from "@/i18n/I18nProvider";
import PodcastPanel from "@/components/PodcastPanel";
import PublishPanel from "@/components/PublishPanel";
import { useOpenWorkspace } from "./useWorkspace";
import { Panel } from "./Panel";
import { jobStatusLabel, outputLabel } from "./helpers";
import type { CaptionMode, Definition } from "./types";

export default function PublishStep() {
  const {
    selected,
    setStep,
    busy,
    captionMode,
    setCaptionMode,
    captionStyleId,
    setCaptionStyleId,
    setSelectedGraphicId,
    previewBusy,
    refreshPublications,
    openProject,
    currentDefinition,
    saveDefinition,
    durationNotice,
    captionStyles,
    createCaptionStyle,
    stopJob,
    generate,
    previewRender,
    activeJob,
    previewJob,
    latestPreview,
  } = useOpenWorkspace();
  const t = useT();
  return (
    <div className="step-grid">
      <div className="step-main">
        <Panel
          title={t("pub.make.title")}
          text={t("pub.make.text")}
        >
          {durationNotice}
          <div className="job">
            <label className="muted">
              {t("captions.label")}{" "}
              <select value={captionMode} onChange={(e) => setCaptionMode(e.target.value as CaptionMode)}>
                <option value="none">{t("captions.none")}</option>
                <option value="soft">{t("captions.soft")}</option>
                <option value="burn">{t("captions.burn")}</option>
                <option value="both">{t("captions.both")}</option>
              </select>
            </label>
            {(captionMode === "burn" || captionMode === "both") && (
              <div className="caption-style-row">
                <label className="muted">
                  {t("pub.captionStyle")}{" "}
                  <select
                    value={captionStyles.some((g) => g.id === captionStyleId) ? captionStyleId : ""}
                    onChange={(e) => setCaptionStyleId(e.target.value)}
                  >
                    <option value="">{t("pub.captionStyleDefault")}</option>
                    {captionStyles.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button onClick={() => void createCaptionStyle()}>{t("pub.newCaptionStyle")}</button>
                {captionStyles.some((g) => g.id === captionStyleId) && (
                  <button
                    onClick={() => {
                      setStep("structure");
                      setSelectedGraphicId(captionStyleId);
                    }}
                  >
                    {t("pub.editStyle")}
                  </button>
                )}
                <small className="muted">
                  {t("pub.captionStyleHelp")}
                </small>
              </div>
            )}
            <div className="button-row">
              <button disabled={previewBusy || busy} onClick={() => void previewRender()}>
                {previewBusy ? t("project.previewQueued") : t("pub.quickPreview640")}
              </button>
              <button className="primary" disabled={busy} onClick={() => void generate()}>
                {t("quick.finalVideo")}
              </button>
            </div>
            {selected.jobs?.map((j) => (
              <div key={j.id} className="job-row">
                <strong>
                  {j.preview ? t("pub.jobPreviewPrefix") : ""}
                  {j.type === "PODCAST" ? t("pub.jobPodcastPrefix") : ""}
                  {jobStatusLabel(t, j.status)}
                </strong>
                <span>{j.progress}%</span>
                {j.errorMessage && <small>{j.errorMessage}</small>}
                {["QUEUED", "ACQUIRING_SOURCE", "PROCESSING", "RENDERING"].includes(j.status) && (
                  <button className="stop-button" onClick={() => void stopJob(j)}>
                    {t("common.stop")}
                  </button>
                )}
              </div>
            ))}
            {!selected.jobs?.length && <p className="muted">{t("pub.noJobs")}</p>}
            {activeJob && <small className="muted">{t("pub.running", { progress: activeJob.progress })}</small>}
          </div>
        </Panel>
        <Panel title={t("pub.preview.title")}>
          <div className="preview-panel">
            {latestPreview ? (
              <video controls preload="metadata" src={`/api/outputs/${latestPreview.id}`} />
            ) : (
              <div className="preview-empty">
                <strong>{t("pub.preview.none")}</strong>
                <p>{t("pub.preview.hint")}</p>
              </div>
            )}
            {previewJob && (
              <span className="muted">
                {t("pub.preview.status", { status: jobStatusLabel(t, previewJob.status), progress: previewJob.progress })}
              </span>
            )}
          </div>
        </Panel>
        <Panel title={t("pub.files.title")}>
          {selected.outputs?.length ? (
            <div className="downloads">
              {selected.outputs.map((o) => (
                <a key={o.id} href={`/api/outputs/${o.id}`}>
                  {outputLabel(o, t)} ↓
                </a>
              ))}
            </div>
          ) : (
            <p className="muted">{t("pub.files.none")}</p>
          )}
        </Panel>
      </div>
      <aside className="step-aside">
        <Panel title={t("pub.publish.title")}>
          <PublishPanel
            projectId={selected.id}
            publications={selected.publications ?? []}
            hasVideo={!!selected.outputs?.some((o) => o.type === "VIDEO" && !o.preview)}
            onRefresh={() => void openProject(selected.id)}
            onPoll={() => void refreshPublications(selected.id)}
          />
        </Panel>
        <Panel title={t("pub.podcast.title")}>
          <PodcastPanel
            projectId={selected.id}
            projectTitle={selected.title}
            preacher={selected.preacher}
            gospelRef={selected.gospelRef}
            definition={currentDefinition()}
            outputs={selected.outputs ?? []}
            jobs={selected.jobs ?? []}
            onSaveDefinition={async (def) => {
              await saveDefinition(def as Definition);
            }}
            onQueued={() => openProject(selected.id)}
          />
        </Panel>
      </aside>
    </div>
  );
}
