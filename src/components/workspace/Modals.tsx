"use client";

import { formatTime } from "@/components/format";
import { TemplatePicker } from "@/components/TemplatePicker";
import { useT } from "@/i18n/I18nProvider";
import { useWorkspace } from "./useWorkspace";

export default function Modals() {
  const {
    creating,
    setCreating,
    title,
    setTitle,
    templateValue,
    setTemplateValue,
    removeAsset,
    setRemoveAsset,
    error,
    busy,
    confirmDelete,
    setConfirmDelete,
    durationMismatch,
    setDurationMismatch,
    setAcceptedClamp,
    confirmDeleteGraphicId,
    setConfirmDeleteGraphicId,
    createProject,
    deleteProject,
    confirmRemoveAsset,
    deleteGraphic,
  } = useWorkspace();
  const t = useT();
  return (
    <>
      {creating && (
        <div className="backdrop">
          <form className="modal" onSubmit={createProject}>
            <h2>{t("modal.newProject")}</h2>
            <label>
              {t("project.title")}
              <input value={title} onChange={(e) => setTitle(e.target.value)} required />
            </label>
            <TemplatePicker value={templateValue} onChange={setTemplateValue} />
            <div className="actions">
              <button type="button" onClick={() => setCreating(false)}>
                {t("common.cancel")}
              </button>
              <button className="primary" disabled={busy}>
                {t("modal.createProject")}
              </button>
            </div>
            {error && <p className="error">{error}</p>}
          </form>
        </div>
      )}
      {removeAsset && (
        <div className="backdrop">
          <div className="modal" role="dialog" aria-label={t("modal.removeAsset.aria")}>
            <h2>{t("modal.removeAsset.title", { name: removeAsset.asset.assetKey })}</h2>
            {removeAsset.usage.length > 0 && (
              <p className="error">{t("modal.removeAsset.used", { usage: removeAsset.usage.join(", ") })}</p>
            )}
            <p className="muted">{t("modal.removeAsset.note")}</p>
            <div className="actions">
              <button onClick={() => setRemoveAsset(null)}>{t("common.cancel")}</button>
              <button className="dangerButton" data-testid="confirm-remove-asset" onClick={() => void confirmRemoveAsset()}>
                {t("modal.removeAsset.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmDelete && (
        <div className="backdrop">
          <div className="modal">
            <h2>{t("modal.deleteProject.title", { title: confirmDelete.title })}</h2>
            <p className="muted">{t("modal.deleteProject.note")}</p>
            <div className="actions">
              <button onClick={() => setConfirmDelete(null)}>{t("common.cancel")}</button>
              <button className="dangerButton" onClick={() => void deleteProject()}>
                {t("modal.deleteProject.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmDeleteGraphicId && (
        <div className="backdrop">
          <div className="modal">
            <h2>{t("modal.deleteGraphic.title")}</h2>
            <p className="muted">{t("modal.deleteGraphic.note")}</p>
            <div className="actions">
              <button onClick={() => setConfirmDeleteGraphicId(null)}>{t("common.cancel")}</button>
              <button className="dangerButton" onClick={() => void deleteGraphic(confirmDeleteGraphicId)}>
                {t("modal.deleteGraphic.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
      {durationMismatch && (
        <div className="backdrop">
          <div className="modal">
            <h2>{t("modal.duration.title")}</h2>
            <p>{t("modal.duration.text")}</p>
            <p>
              <strong>{t("modal.duration.reference")}</strong>{" "}
              {durationMismatch.referenceDurationMs != null ? formatTime(durationMismatch.referenceDurationMs / 1000) : t("common.unknown")}
              <br />
              <strong>{t("modal.duration.selected")}</strong>{" "}
              {durationMismatch.actualDurationMs != null ? formatTime(durationMismatch.actualDurationMs / 1000) : t("common.unknown")}
            </p>
            {durationMismatch.violations?.length && (
              <div className="warning-list">
                {durationMismatch.violations.map((v) => (
                  <div key={`${v.label}-${v.endSeconds}`}>
                    {t("modal.duration.violation", { label: v.label, end: formatTime(v.endSeconds), fileEnd: formatTime(v.durationSeconds) })}
                  </div>
                ))}
              </div>
            )}
            <div className="actions">
              <button onClick={() => setDurationMismatch(null)}>{t("modal.duration.chooseOther")}</button>
              <button
                className="primary"
                onClick={() => {
                  setAcceptedClamp(true);
                  setDurationMismatch(null);
                }}
              >
                {t("modal.duration.clamp")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
