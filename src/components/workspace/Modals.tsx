"use client";

import { formatTime } from "@/components/format";
import { TemplatePicker } from "@/components/TemplatePicker";
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
  return (
    <>
      {creating && (
        <div className="backdrop">
          <form className="modal" onSubmit={createProject}>
            <h2>Uusi projekti</h2>
            <label>
              Otsikko
              <input value={title} onChange={(e) => setTitle(e.target.value)} required />
            </label>
            <TemplatePicker value={templateValue} onChange={setTemplateValue} />
            <div className="actions">
              <button type="button" onClick={() => setCreating(false)}>
                Peruuta
              </button>
              <button className="primary" disabled={busy}>
                Luo projekti
              </button>
            </div>
            {error && <p className="error">{error}</p>}
          </form>
        </div>
      )}
      {removeAsset && (
        <div className="backdrop">
          <div className="modal" role="dialog" aria-label="Remove asset from project">
            <h2>Remove “{removeAsset.asset.assetKey}” from this project?</h2>
            {removeAsset.usage.length > 0 && (
              <p className="error">It is still used by {removeAsset.usage.join(", ")}. Those will render without it.</p>
            )}
            <p className="muted">The asset stays in the graphics library and in other projects.</p>
            <div className="actions">
              <button onClick={() => setRemoveAsset(null)}>Cancel</button>
              <button className="dangerButton" data-testid="confirm-remove-asset" onClick={() => void confirmRemoveAsset()}>
                Remove from project
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmDelete && (
        <div className="backdrop">
          <div className="modal">
            <h2>Delete “{confirmDelete.title}”?</h2>
            <p className="muted">The project is deleted. Shared sources/assets are retained when referenced elsewhere.</p>
            <div className="actions">
              <button onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="dangerButton" onClick={() => void deleteProject()}>
                Delete project
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmDeleteGraphicId && (
        <div className="backdrop">
          <div className="modal">
            <h2>Delete graphic?</h2>
            <p className="muted">This cannot be undone. A graphic that is already used in Composition will be protected.</p>
            <div className="actions">
              <button onClick={() => setConfirmDeleteGraphicId(null)}>Cancel</button>
              <button className="dangerButton" onClick={() => void deleteGraphic(confirmDeleteGraphicId)}>
                Delete graphic
              </button>
            </div>
          </div>
        </div>
      )}
      {durationMismatch && (
        <div className="backdrop">
          <div className="modal">
            <h2>Source duration differs</h2>
            <p>The selected file differs from the recording used to define these sections.</p>
            <p>
              <strong>Reference:</strong>{" "}
              {durationMismatch.referenceDurationMs != null ? formatTime(durationMismatch.referenceDurationMs / 1000) : "unknown"}
              <br />
              <strong>Selected:</strong>{" "}
              {durationMismatch.actualDurationMs != null ? formatTime(durationMismatch.actualDurationMs / 1000) : "unknown"}
            </p>
            {durationMismatch.violations?.length && (
              <div className="warning-list">
                {durationMismatch.violations.map((v) => (
                  <div key={`${v.label}-${v.endSeconds}`}>
                    <strong>{v.label}</strong>: ends at {formatTime(v.endSeconds)}, file ends at {formatTime(v.durationSeconds)}
                  </div>
                ))}
              </div>
            )}
            <div className="actions">
              <button onClick={() => setDurationMismatch(null)}>Choose another file</button>
              <button
                className="primary"
                onClick={() => {
                  setAcceptedClamp(true);
                  setDurationMismatch(null);
                }}
              >
                Continue and clamp at EOF
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
