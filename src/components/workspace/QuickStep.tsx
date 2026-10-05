"use client";

import { useState } from "react";
import FetchVariables from "@/components/FetchVariables";
import PublishPanel from "@/components/PublishPanel";
import VariablesEditor from "@/components/VariablesEditor";
import { formatTime, sourceLabel } from "@/components/format";
import { useOpenWorkspace } from "./useWorkspace";
import { Panel } from "./Panel";
import { ProjectTitle } from "./ProjectTitle";
import { outputLabel } from "./helpers";
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
    if (firstSource && wholeSeconds) void addSegment(firstSource.id, "Koko tallenne", 0, Math.floor(wholeSeconds));
  };

  return (
    <div className="quick-step">
      <Panel title="1. Lähde" text="Lisää tallenne: YouTube-linkki tai tiedosto. YouTube-lähde noudetaan, kun video tehdään.">
        <div className="form-grid">
          <label>
            YouTube-linkki
            <input value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)} placeholder="https://youtube.com/watch?v=…" />
            <button onClick={() => void addYoutube()} disabled={busy || !youtubeUrl.trim()}>
              Lisää YouTube-lähde
            </button>
          </label>
          <label>
            Tai videotiedosto
            <input type="file" accept="video/*" multiple onChange={(e) => setUploadFiles(Array.from(e.target.files ?? []))} />
            <button onClick={() => void addUploads()} disabled={busy || !uploadFiles.length}>
              Lataa valitut
            </button>
          </label>
        </div>
        {selected.sources.length > 0 ? (
          <ul className="quick-list">
            {selected.sources.map((s) => (
              <li key={s.id}>
                {sourceLabel(s)}
                {knownSeconds(s) !== null && <small className="muted"> · {formatTime(knownSeconds(s)!)}</small>}
                {s.status === "PENDING" && <small className="muted"> · odottaa tiedostoa (Lähde-vaihe)</small>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Ei vielä lähteitä.</p>
        )}
      </Panel>

      <Panel title="2. Tiedot" text="Otsikko ja muuttujat, joita grafiikat käyttävät. Hae pyhäpäivä ja evankeliumi rajapinnasta tai kirjoita itse.">
        <ProjectTitle title={selected.title} onSave={saveTitle} />
        <FetchVariables projectId={selected.id} variables={definition.variables ?? []} onSave={saveVariables} />
        <VariablesEditor variables={definition.variables ?? []} graphics={definition.graphics} onSave={saveVariables} />
      </Panel>

      <Panel title="3. Osiot" text="Mitä lähteestä otetaan mukaan.">
        {clips.length ? (
          <p>
            {clips.length} {clips.length === 1 ? "osa" : "osaa"} koostuksessa.{" "}
            <button className="link-button" onClick={() => setStep("structure")}>
              Muokkaa osioita (Rakenne)
            </button>
          </p>
        ) : (
          <>
            <p className="muted">Koostuksessa ei ole vielä osia.</p>
            <div className="button-row">
              <button disabled={busy || !wholeSeconds} onClick={wholeSource}>
                Käytä koko tallennetta
              </button>
              <button onClick={() => setStep("structure")}>Valitse osiot (Rakenne)</button>
            </div>
            {firstSource && knownSeconds(firstSource) === null && (
              <label className="muted">
                Tallenteen kesto sekunteina (kesto ei ole tiedossa)
                <input inputMode="decimal" value={manualSeconds} onChange={(e) => setManualSeconds(e.target.value)} placeholder="esim. 2400" />
              </label>
            )}
            {!firstSource && <small className="muted">Lisää ensin lähde.</small>}
          </>
        )}
      </Panel>

      <Panel title="4. Tee video" text="Valinnainen tekstitys ja lopullinen video. Nopea esikatselu on 640 px leveä.">
        {durationNotice}
        <label className="muted">
          Tekstitys{" "}
          <select value={captionMode} onChange={(e) => setCaptionMode(e.target.value as CaptionMode)}>
            <option value="none">Ei tekstitystä</option>
            <option value="soft">Valittava raita (sekä SRT/VTT-tiedostot)</option>
            <option value="burn">Poltettu kuvaan</option>
            <option value="both">Molemmat</option>
          </select>
        </label>
        <div className="button-row">
          <button disabled={previewBusy || busy || !clips.length} onClick={() => void previewRender()}>
            {previewBusy ? "Esikatselu jonoon…" : "Nopea esikatselu"}
          </button>
          <button className="primary" disabled={busy || !clips.length} onClick={() => void generate()}>
            Tee lopullinen video
          </button>
        </div>
        {activeJob && (
          <p className="job-row">
            <strong>{activeJob.preview ? "Esikatselu" : "Video"} {activeJob.status}</strong> <span>{activeJob.progress}%</span>
            <button className="stop-button" onClick={() => void stopJob(activeJob)}>
              Pysäytä
            </button>
          </p>
        )}
        {failed && !activeJob && <p className="error">Viimeisin työ epäonnistui{failed.errorMessage ? `: ${failed.errorMessage}` : "."}</p>}
        {video && (
          <div className="downloads">
            <video controls preload="metadata" src={`/api/outputs/${video.id}`} />
            <a href={`/api/outputs/${video.id}`}>{outputLabel(video)} ↓</a>
          </div>
        )}
      </Panel>

      <Panel title="5. Julkaise">
        <PublishPanel
          projectId={selected.id}
          publications={selected.publications ?? []}
          hasVideo={!!video}
          onRefresh={() => void openProject(selected.id)}
          onPoll={() => void refreshPublications(selected.id)}
        />
        <small className="muted">
          Podcast, tekstitystyylit ja muut lisäasetukset ovat vaiheessa <button className="link-button" onClick={() => setStep("publish")}>Julkaisu</button>.
        </small>
      </Panel>
    </div>
  );
}
