"use client";

import { useOpenWorkspace } from "./useWorkspace";
import QuickStep from "./QuickStep";
import SourceStep from "./SourceStep";
import StructureStep from "./StructureStep";
import PublishStep from "./PublishStep";
import { outputSizeLabel } from "./helpers";
import { STEPS } from "./types";
import styles from "./OpenProject.module.css";

export default function OpenProject() {
  const { selected, step, setStep, message, error, busy, previewBusy, currentDefinition, generate, previewRender } = useOpenWorkspace();
  return (
    <>
      <header>
        <div>
          <h1>{selected.title}</h1>
          <p className="muted">
            {selected.sources.length} {selected.sources.length === 1 ? "lähde" : "lähdettä"} ·{" "}
            {outputSizeLabel(currentDefinition().template)}
          </p>
        </div>
        <div className="header-actions">
          <button disabled={previewBusy || busy} onClick={() => void previewRender()}>
            {previewBusy ? "Esikatselu jonoon…" : "Esikatselu"}
          </button>
          <button className="primary" disabled={busy} onClick={() => void generate()}>
            Tee video
          </button>
        </div>
      </header>
      <nav className={styles["stepper"]} aria-label="Työvaiheet">
        {STEPS.map((s, index) => (
          <button
            key={s.id}
            className={step === s.id ? `active ${styles.active}` : ""}
            aria-current={step === s.id ? "step" : undefined}
            onClick={() => setStep(s.id)}
          >
            <span className={styles["step-badge"]}>{index + 1}</span>
            <span className={styles["step-text"]}>
              <strong>{s.title}</strong>
              <small>{s.sub}</small>
            </span>
          </button>
        ))}
      </nav>
      <div className="content">
        {step === "quick" && <QuickStep />}
        {step === "source" && <SourceStep />}
        {step === "structure" && <StructureStep />}
        {step === "publish" && <PublishStep />}
        {message && <p className="success">{message}</p>}
        {error && <p className="error">{error}</p>}
      </div>
    </>
  );
}
