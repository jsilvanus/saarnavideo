"use client";

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
  return (
    <div className="step-grid">
      <div className="step-main">
        <Panel
          title="Lähteet"
          text="Yksi tai useampi tallenne. Paikallisen tiedoston voi ladata heti tai myöhemmin; YouTube-lähde noudetaan, kun video tehdään."
        >
          <div className="form-grid">
            <label>
              Paikalliset videot
              <input type="file" accept="video/*" multiple onChange={(e) => setUploadFiles(Array.from(e.target.files ?? []))} />
              <select value={uploadMode} onChange={(e) => setUploadMode(e.target.value as "now" | "later")}>
                <option value="now">Lataa nyt</option>
                <option value="later">Lataa myöhemmin</option>
              </select>
              <button
                onClick={() => void (uploadMode === "now" ? addUploads() : addDeferredUploads())}
                disabled={busy || !uploadFiles.length}
              >
                {uploadMode === "now" ? "Lataa valitut" : "Lisää odottava lähde"}
              </button>
            </label>
            <label>
              YouTube-linkki
              <input value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)} placeholder="https://youtube.com/watch?v=…" />
              <button onClick={() => void addYoutube()} disabled={busy || !youtubeUrl.trim()}>
                Lisää YouTube-lähde
              </button>
            </label>
          </div>
          <div className="cards">
            {selected.sources.map((s) => (
              <article className="card" key={s.id}>
                <b>
                  {s.type === "YOUTUBE" ? "YouTube" : "Tiedosto"} · {s.status === "PENDING" ? "odottaa tiedostoa" : "valmis"}
                </b>
                <strong>{sourceLabel(s)}</strong>
                <small>
                  {s.status === "PENDING"
                    ? "Odottaa paikallista tiedostoa. Valitse varsinainen tiedosto, kun se on valmis."
                    : s.durationMs
                      ? `Kesto ${formatTime(s.durationMs / 1000)}`
                      : "YouTube-video noudetaan, kun video tehdään."}
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
                      Lataa nyt
                    </button>
                    {pendingFiles[s.id] && <small>Valittu: {pendingFiles[s.id].name}</small>}
                  </div>
                )}
              </article>
            ))}
            {!selected.sources.length && <p className="muted">Ei vielä lähteitä.</p>}
          </div>
        </Panel>
        <Panel
          title="Litteroinnit"
          text="Litteroi lähde kokonaan tai valitulta väliltä ja muokkaa tekstitysraitaa. Litterointi kuuluu lähteelle, joten se näkyy kaikissa projekteissa, jotka käyttävät samaa lähdettä."
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
        <Panel title="Tulosteen koko" text="Videon koko ja oletusrajaus. Rajauksen voi vaihtaa osioittain vaiheessa Rakenne.">
          <OutputSettings template={currentDefinition().template!} onChange={saveOutput} />
        </Panel>
      </div>
      <aside className="step-aside">
        <Panel title="Projektin tiedot">
          <ProjectTitle title={selected.title} onSave={saveTitle} />
          <h3 className="subhead">Muuttujat</h3>
          <p className="muted">Grafiikat käyttävät muuttujia muodossa {"{{nimi}}"}. Arvot täytetään, kun video tehdään.</p>
          <FetchVariables projectId={selected.id} variables={currentDefinition().variables ?? []} onSave={saveVariables} />
          <VariablesEditor
            variables={currentDefinition().variables ?? []}
            graphics={selected.definition?.graphics}
            onSave={saveVariables}
          />
          <SaveAsTemplate
            projectId={selected.id}
            defaultName={selected.title}
            onSaved={(name) => setMessage(`Pohja "${name}" tallennettu. Se löytyy uuden projektin pohjista.`)}
          />
        </Panel>
      </aside>
    </div>
  );
}
