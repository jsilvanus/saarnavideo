"use client";

import PodcastPanel from "@/components/PodcastPanel";
import PublishPanel from "@/components/PublishPanel";
import { useOpenWorkspace } from "./useWorkspace";
import { Panel } from "./Panel";
import { outputLabel } from "./helpers";
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
  return (
    <div className="step-grid">
      <div className="step-main">
        <Panel
          title="Tee video"
          text="Lisää video työjonoon. Lyhyempi korvaava lähde ei koskaan muuta tallennettuja aikoja huomaamatta; katkaisu tiedoston loppuun vaatii vahvistuksen."
        >
          {durationNotice}
          <div className="job">
            <label className="muted">
              Tekstitys{" "}
              <select value={captionMode} onChange={(e) => setCaptionMode(e.target.value as CaptionMode)}>
                <option value="none">Ei tekstitystä</option>
                <option value="soft">Valittava raita (sekä SRT/VTT-tiedostot)</option>
                <option value="burn">Poltettu kuvaan</option>
                <option value="both">Molemmat</option>
              </select>
            </label>
            {(captionMode === "burn" || captionMode === "both") && (
              <div className="caption-style-row">
                <label className="muted">
                  Tekstitystyyli{" "}
                  <select
                    value={captionStyles.some((g) => g.id === captionStyleId) ? captionStyleId : ""}
                    onChange={(e) => setCaptionStyleId(e.target.value)}
                  >
                    <option value="">Oletus (alhaalla keskellä, valkoinen tummalla)</option>
                    {captionStyles.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button onClick={() => void createCaptionStyle()}>＋ Uusi tekstitystyyli</button>
                {captionStyles.some((g) => g.id === captionStyleId) && (
                  <button
                    onClick={() => {
                      setStep("structure");
                      setSelectedGraphicId(captionStyleId);
                    }}
                  >
                    Muokkaa tyyliä
                  </button>
                )}
                <small className="muted">
                  Sijainti, koko, fontti ja tausta tulevat grafiikan tekstitystasolta. Esikatselu käyttää samaa asetusta.
                </small>
              </div>
            )}
            <div className="button-row">
              <button disabled={previewBusy || busy} onClick={() => void previewRender()}>
                {previewBusy ? "Esikatselu jonoon…" : "Nopea esikatselu (640 px)"}
              </button>
              <button className="primary" disabled={busy} onClick={() => void generate()}>
                Tee lopullinen video
              </button>
            </div>
            {selected.jobs?.map((j) => (
              <div key={j.id} className="job-row">
                <strong>
                  {j.preview ? "Esikatselu " : ""}
                  {j.type === "PODCAST" ? "Podcast " : ""}
                  {j.status}
                </strong>
                <span>{j.progress}%</span>
                {j.errorMessage && <small>{j.errorMessage}</small>}
                {["QUEUED", "ACQUIRING_SOURCE", "PROCESSING", "RENDERING"].includes(j.status) && (
                  <button className="stop-button" onClick={() => void stopJob(j)}>
                    Pysäytä
                  </button>
                )}
              </div>
            ))}
            {!selected.jobs?.length && <p className="muted">Ei vielä töitä.</p>}
            {activeJob && <small className="muted">Käynnissä: {activeJob.progress}% · pysäytys on turvallinen.</small>}
          </div>
        </Panel>
        <Panel title="Esikatselu">
          <div className="preview-panel">
            {latestPreview ? (
              <video controls preload="metadata" src={`/api/outputs/${latestPreview.id}`} />
            ) : (
              <div className="preview-empty">
                <strong>Esikatselua ei ole vielä tehty.</strong>
                <p>Tee nopea esikatselu, kun koostus on valmis.</p>
              </div>
            )}
            {previewJob && (
              <span className="muted">
                Esikatselu: {previewJob.status} · {previewJob.progress}%
              </span>
            )}
          </div>
        </Panel>
        <Panel title="Valmiit tiedostot">
          {selected.outputs?.length ? (
            <div className="downloads">
              {selected.outputs.map((o) => (
                <a key={o.id} href={`/api/outputs/${o.id}`}>
                  {outputLabel(o)} ↓
                </a>
              ))}
            </div>
          ) : (
            <p className="muted">Ei vielä valmiita tiedostoja.</p>
          )}
        </Panel>
      </div>
      <aside className="step-aside">
        <Panel title="Julkaise">
          <PublishPanel
            projectId={selected.id}
            publications={selected.publications ?? []}
            hasVideo={!!selected.outputs?.some((o) => o.type === "VIDEO" && !o.preview)}
            onRefresh={() => void openProject(selected.id)}
            onPoll={() => void refreshPublications(selected.id)}
          />
        </Panel>
        <Panel title="Podcast">
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
