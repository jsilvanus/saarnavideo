"use client";

import { useT } from "@/i18n/I18nProvider";
import GraphicsEditor from "@/components/GraphicsEditor";
import AssetPicker from "@/components/AssetPicker";
import { formatTime, sourceLabel } from "@/components/format";
import CompositionEditor from "@/components/CompositionEditor";
import VoiceoverPanel from "@/components/VoiceoverPanel";
import SectionManager from "@/components/SectionManager";
import TimelineView from "@/components/TimelineView";
import ReframeEditor from "@/components/ReframeEditor";
import { isCaptionStyleGraphic } from "@/domain/caption-style";
import { useOpenWorkspace } from "./useWorkspace";
import { Panel } from "./Panel";
import { SectionPicker } from "./SectionPicker";
import { graphicVariables } from "./helpers";
import type { Definition } from "./types";

export default function StructureStep() {
  const {
    selected,
    pendingFiles,
    setAssetFile,
    assetKey,
    setAssetKey,
    assetType,
    setAssetType,
    libraryOpen,
    setLibraryOpen,
    setMessage,
    busy,
    selectedGraphicId,
    setSelectedGraphicId,
    setConfirmDeleteGraphicId,
    openProject,
    currentDefinition,
    saveDefinition,
    addSegment,
    removeSegment,
    saveSections,
    changeSectionSource,
    saveSectionReframe,
    durationNotice,
    compositionDurationSeconds,
    refreshAssets,
    askRemoveAsset,
    uploadAsset,
    createGraphic,
    createCaptionStyle,
    duplicateGraphic,
    updateGraphic,
    sourceNames,
    selectedGraphic,
    editorItem,
  } = useOpenWorkspace();
  const t = useT();
  return (
    <div className="step-stack">
      <Panel
        title={t("str.sections.title")}
        text={t("str.sections.text")}
      >
        <SectionManager
          scope="SOURCE"
          suggestedNames={selected.definition?.template?.sectionNames}
          sections={selected.definition?.sections ?? []}
          sources={selected.sources}
          onChange={saveSections}
          renderActions={(section) => (
            <>
              {section.scope === "SOURCE" && !section.parentId && selected.sources.length > 1 && (
                <select
                  aria-label={t("str.sourceOf", { label: section.label })}
                  className="inline-select"
                  value={section.sourceId ?? ""}
                  onChange={(e) => void changeSectionSource(section.id, e.target.value)}
                >
                  {selected.sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {sourceLabel(s)}
                    </option>
                  ))}
                </select>
              )}
              {section.startSeconds !== undefined && (
                <ReframeEditor
                  title={t("str.sectionReframe", { label: section.label })}
                  current={section.reframe}
                  defaultLabel={t("str.projectDefault")}
                  source={selected.sources.find((x) => x.id === section.sourceId)}
                  atSeconds={section.startSeconds}
                  outWidth={currentDefinition().template?.width ?? 1920}
                  outHeight={currentDefinition().template?.height ?? 1080}
                  onSave={(r) => saveSectionReframe(section.id, r)}
                />
              )}
            </>
          )}
        />
        <SectionPicker
          projectId={selected.id}
          sources={selected.sources}
          pendingFiles={pendingFiles}
          onAdd={(id, l, s, e) => void addSegment(id, l, s, e)}
        />
        <div className="list">
          {(selected.definition?.semanticSegments ?? []).map((s) => (
            <div className="row" key={s.id}>
              <span>
                <strong>{s.label}</strong>
                <small>
                  {sourceNames[s.sourceId ?? ""] ?? t("str.sourceFallback")} · {formatTime(s.startSeconds)} → {formatTime(s.endSeconds)}
                </small>
              </span>
              <button onClick={() => void removeSegment(s.id)}>{t("common.remove")}</button>
            </div>
          ))}
        </div>
      </Panel>
      <Panel
        title={t("str.graphics.title")}
        text={t("str.graphics.text")}
      >
        <div className="form-grid four">
          <label>
            {t("str.imageFile")}
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setAssetFile(e.target.files?.[0] ?? null)} />
          </label>
          <label>
            {t("str.name")}
            <input value={assetKey} onChange={(e) => setAssetKey(e.target.value)} placeholder="logo" />
          </label>
          <label>
            {t("str.type")}
            <select value={assetType} onChange={(e) => setAssetType(e.target.value)}>
              <option value="OVERLAY">{t("str.type.overlay")}</option>
              <option value="BACKGROUND">{t("str.type.background")}</option>
              <option value="LOGO">{t("str.type.logo")}</option>
            </select>
          </label>
          <button onClick={() => void uploadAsset()} disabled={busy}>
            {t("str.uploadImage")}
          </button>
        </div>
        <div className="button-row">
          <button data-testid="add-from-library" onClick={() => setLibraryOpen(true)}>
            {t("str.addFromLibrary")}
          </button>
          <button className="primary" onClick={() => void createGraphic()}>
            {t("str.newGraphic")}
          </button>
          <button onClick={() => void createCaptionStyle()}>{t("pub.newCaptionStyle")}</button>
        </div>
        <div className="graphic-list">
          {(selected.definition?.graphics ?? []).map((g) => (
            <button key={g.id} className={selectedGraphicId === g.id ? "graphic-selected" : ""} onClick={() => setSelectedGraphicId(g.id)}>
              <strong>{g.name}</strong>
              <small>
                {g.width} × {g.height}
                {isCaptionStyleGraphic(g) ? t("str.captionStyleTag") : ""}
                {graphicVariables(g).length
                  ? ` · ${graphicVariables(g)
                      .map((n) => `{{${n}}}`)
                      .join(" ")}`
                  : ""}
              </small>
            </button>
          ))}
          {!selected.definition?.graphics?.length && <p className="muted">{t("str.noGraphics")}</p>}
        </div>
        {selectedGraphic && editorItem && (
          <>
            <div className="graphic-editor-header" id="graphic-editor">
              <div>
                <strong>{selectedGraphic.name}</strong>
                <small>
                  {selectedGraphic.width} × {selectedGraphic.height}
                </small>
              </div>
              <div className="graphic-editor-actions">
                <button
                  className="icon-button"
                  title={t("str.duplicateGraphic")}
                  aria-label={t("str.duplicateGraphic")}
                  onClick={() => void duplicateGraphic(selectedGraphic.id)}
                >
                  ⧉
                </button>
                <button
                  className="icon-button danger-icon"
                  title={t("str.deleteGraphic")}
                  aria-label={t("str.deleteGraphic")}
                  onClick={() => setConfirmDeleteGraphicId(selectedGraphic.id)}
                >
                  🗑
                </button>
              </div>
            </div>
            <GraphicsEditor
              projectId={selected.id}
              graphicId={selectedGraphic.id}
              item={editorItem}
              assets={selected.assets ?? []}
              title={selectedGraphic.name}
              onChange={(item) => void updateGraphic(selectedGraphic.id, item)}
              onAssetsChanged={refreshAssets}
            />
          </>
        )}
        <div className="cards">
          {(selected.assets ?? []).map((a) => (
            <article className="card" key={a.id}>
              <b>{a.type}</b>
              <strong>{a.assetKey}</strong>
              <small>
                {a.type === "AUDIO" ? t("str.audioShort") : `${a.width} × ${a.height}`} · {a.mimeType}
              </small>
              <button data-testid="remove-asset" onClick={() => askRemoveAsset(a)} disabled={busy}>
                {t("str.removeFromProject")}
              </button>
            </article>
          ))}
        </div>
        {libraryOpen && (
          <AssetPicker
            projectId={selected.id}
            title={t("str.addFromLibrary")}
            linkedIds={(selected.assets ?? []).map((a) => a.id)}
            pickLinked={false}
            onPick={async () => {
              await refreshAssets();
              setMessage(t("str.addedToProject"));
            }}
            onClose={() => setLibraryOpen(false)}
          />
        )}
      </Panel>
      <Panel
        title={t("str.audio.title")}
        text={t("str.audio.text")}
      >
        <VoiceoverPanel
          projectId={selected.id}
          assets={(selected.assets ?? []).filter((a) => a.type === "AUDIO")}
          definition={currentDefinition()}
          onSaveDefinition={async (def) => {
            await saveDefinition(def as Definition);
          }}
          onChanged={() => openProject(selected.id)}
        />
      </Panel>
      <Panel
        title={t("str.timeline.title")}
        text={t("str.timeline.text")}
      >
        {durationNotice}
        <TimelineView
          items={currentDefinition().composition.items}
          graphics={selected.definition?.graphics}
          sections={selected.definition?.sections}
          sources={selected.sources}
          audioAssets={(selected.assets ?? []).filter((a) => a.type === "AUDIO")}
        />
        <h3 className="subhead">{t("str.editComposition")}</h3>
        <CompositionEditor
          definition={currentDefinition()}
          sources={selected.sources}
          audioAssets={(selected.assets ?? []).filter((a) => a.type === "AUDIO")}
          onChange={async (def) => {
            await saveDefinition(def as Definition);
            setMessage(t("str.compositionSaved"));
          }}
        />
        <details className="composition-sections">
          <summary>{t("str.ownSections")}</summary>
          <SectionManager
            scope="COMPOSITION"
            sections={selected.definition?.sections ?? []}
            durationSeconds={compositionDurationSeconds()}
            onChange={saveSections}
          />
        </details>
      </Panel>
    </div>
  );
}
