"use client";

import { useT } from "@/i18n/I18nProvider";
import { formatTime, sourceLabel } from "@/components/format";
import TranscriptionEditor from "@/components/TranscriptionEditor";
import OutputSettings from "@/components/OutputSettings";
import VariablesEditor from "@/components/VariablesEditor";
import FetchVariables from "@/components/FetchVariables";
import { SaveAsTemplate } from "@/components/TemplatePicker";
import { useOpenWorkspace } from "./useWorkspace";
import { Panel } from "./Panel";
import { ProjectTitle } from "./ProjectTitle";

export default function SourceStep() {
  const {
    selected,
    uploadFiles,
    setUploadFiles,
    uploadMode,
    setUploadMode,
    pendingFiles,
    setPendingFiles,
    youtubeUrl,
    setYoutubeUrl,
    setMessage,
    busy,
    openProject,
    addUploads,
    addDeferredUploads,
    uploadPendingSource,
    addYoutube,
    currentDefinition,
    saveVariables,
    saveTitle,
    saveOutput,
  } = useOpenWorkspace();
  const t = useT();
  return (
    <div className="step-grid">
      <div className="step-main">
        <Panel
          title={t("src.panel.title")}
          text={t("src.panel.text")}
        >
          <div className="form-grid">
            <label>
              {t("src.localVideos")}
              <input type="file" accept="video/*" multiple onChange={(e) => setUploadFiles(Array.from(e.target.files ?? []))} />
              <select value={uploadMode} onChange={(e) => setUploadMode(e.target.value as "now" | "later")}>
                <option value="now">{t("src.uploadNow")}</option>
                <option value="later">{t("src.uploadLater")}</option>
              </select>
              <button
                onClick={() => void (uploadMode === "now" ? addUploads() : addDeferredUploads())}
                disabled={busy || !uploadFiles.length}
              >
                {uploadMode === "now" ? t("src.uploadSelected") : t("src.addPending")}
              </button>
            </label>
            <label>
              {t("src.youtubeLink")}
              <input value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)} placeholder="https://youtube.com/watch?v=…" />
              <button onClick={() => void addYoutube()} disabled={busy || !youtubeUrl.trim()}>
                {t("src.addYoutube")}
              </button>
            </label>
          </div>
          <div className="cards">
            {selected.sources.map((s) => (
              <article className="card" key={s.id}>
                <b>
                  {s.type === "YOUTUBE" ? "YouTube" : t("src.file")} · {s.status === "PENDING" ? t("src.pendingShort") : t("src.ready")}
                </b>
                <strong>{sourceLabel(s)}</strong>
                <small>
                  {s.status === "PENDING"
                    ? t("src.pendingHelp")
                    : s.durationMs
                      ? t("src.duration", { time: formatTime(s.durationMs / 1000) })
                      : t("src.youtubeFetched")}
                </small>
                {s.status === "PENDING" && (
                  <div className="pending-upload">
                    <input
                      type="file"
                      accept="video/*"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) setPendingFiles((p) => ({ ...p, [s.id]: f }));
                      }}
                    />
                    <button onClick={() => void uploadPendingSource(s)} disabled={busy || !pendingFiles[s.id]}>
                      {t("src.uploadNow")}
                    </button>
                    {pendingFiles[s.id] && <small>{t("src.selectedFile", { name: pendingFiles[s.id].name })}</small>}
                  </div>
                )}
              </article>
            ))}
            {!selected.sources.length && <p className="muted">{t("src.none")}</p>}
          </div>
        </Panel>
        <Panel
          title={t("src.transcriptions.title")}
          text={t("src.transcriptions.text")}
        >
          <TranscriptionEditor
            projectId={selected.id}
            sources={selected.sources}
            pendingFiles={pendingFiles}
            jobs={selected.jobs ?? []}
            sections={selected.definition?.sections}
            onProjectRefresh={() => void openProject(selected.id)}
          />
        </Panel>
        <Panel title={t("src.size.title")} text={t("src.size.text")}>
          <OutputSettings template={currentDefinition().template!} onChange={saveOutput} />
        </Panel>
      </div>
      <aside className="step-aside">
        <Panel title={t("src.info.title")}>
          <ProjectTitle title={selected.title} onSave={saveTitle} />
          <h3 className="subhead">{t("src.variables")}</h3>
          <p className="muted">{t("src.variablesText")}</p>
          <FetchVariables projectId={selected.id} variables={currentDefinition().variables ?? []} onSave={saveVariables} />
          <VariablesEditor
            variables={currentDefinition().variables ?? []}
            graphics={selected.definition?.graphics}
            onSave={saveVariables}
          />
          <SaveAsTemplate
            projectId={selected.id}
            defaultName={selected.title}
            onSaved={(name) => setMessage(t("src.templateSaved", { name }))}
          />
        </Panel>
      </aside>
    </div>
  );
}
