"use client";

import { useT } from "@/i18n/I18nProvider";
import { useEffect, useState } from "react";
import { MAX_OUTPUT_DIMENSION, MIN_OUTPUT_DIMENSION, OUTPUT_PRESETS, aspectLabel, findPreset, presetForSize } from "@/domain/output-presets";
import type { Reframe } from "@/domain/reframe";
import type { MessageKey, TFunction } from "@/i18n/translate";
import { checkDimension, formatTargetLength, parseTargetLength } from "./output-helpers";

export type OutputTemplate = { width: number; height: number; presetKey?: string; targetSeconds?: number; reframe?: Reframe };
type Props = { template: OutputTemplate; onChange: (patch: Partial<OutputTemplate> & { reframe?: Reframe | undefined; presetKey?: string | undefined; targetSeconds?: number | undefined }) => Promise<void> };

const GROUPS = ["Landscape", "Vertical", "Square and portrait"] as const;
const dimensionProblem = (t: TFunction, error: "whole" | "range" | "even") => error === "range" ? t("out.err.range", { min: MIN_OUTPUT_DIMENSION, max: MAX_OUTPUT_DIMENSION }) : t(`out.err.${error}` as MessageKey);
type DefaultChoice = "fill" | "fit-blur" | "fit-color";

function defaultChoice(reframe: Reframe | undefined): DefaultChoice {
  return reframe?.mode === "fit" ? (reframe.fitBackground === "color" ? "fit-color" : "fit-blur") : "fill";
}

/** Output size, project-default framing and target length; saved into definition.template. */
export default function OutputSettings({ template, onChange }: Props) {
  const t = useT();
  const matched = presetForSize(template.width, template.height, template.presetKey);
  const [custom, setCustom] = useState(!matched);
  const [width, setWidth] = useState(String(template.width)), [height, setHeight] = useState(String(template.height));
  const [target, setTarget] = useState(formatTargetLength(template.targetSeconds));
  const [problem, setProblem] = useState("");
  const [changed, setChanged] = useState(false);
  useEffect(() => { setWidth(String(template.width)); setHeight(String(template.height)); }, [template.width, template.height]);
  useEffect(() => { setTarget(formatTargetLength(template.targetSeconds)); }, [template.targetSeconds]);

  const selectValue = custom ? "custom" : (matched?.key ?? "custom");
  const preset = findPreset(template.presetKey) ?? matched;
  const scaled = template.width !== 1920 || template.height !== 1080;

  async function pickPreset(key: string) {
    setProblem("");
    if (key === "custom") { setCustom(true); await onChange({ presetKey: undefined }); return; }
    const next = findPreset(key);
    if (!next) return;
    setCustom(false); setChanged(true);
    await onChange({ width: next.width, height: next.height, presetKey: next.key });
  }
  async function applyCustom() {
    const w = checkDimension(width, MIN_OUTPUT_DIMENSION, MAX_OUTPUT_DIMENSION), h = checkDimension(height, MIN_OUTPUT_DIMENSION, MAX_OUTPUT_DIMENSION);
    if (w.error || h.error) { setProblem(`${w.error ? t("out.widthProblem", { problem: dimensionProblem(t, w.error) }) : ""}${h.error ? t("out.heightProblem", { problem: dimensionProblem(t, h.error) }) : ""}`.trim()); return; }
    setProblem("");
    if (w.value === template.width && h.value === template.height) return;
    setChanged(true);
    await onChange({ width: w.value, height: h.value, presetKey: undefined });
  }
  async function applyTarget() {
    const seconds = parseTargetLength(target);
    if (target.trim() && seconds === undefined) { setProblem(t("out.targetProblem")); return; }
    setProblem("");
    if (seconds !== template.targetSeconds) await onChange({ targetSeconds: seconds });
  }
  async function pickDefault(choice: DefaultChoice) {
    await onChange({ reframe: choice === "fill" ? undefined : { mode: "fit", fitBackground: choice === "fit-color" ? "color" : "blur" } });
  }

  return <div className="output-settings" data-testid="output-settings" style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 14, margin: "0 0 16px", display: "grid", gap: 10 }}>
    <strong>{t("out.title")}</strong>
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "end" }}>
      <label>{t("out.preset")}<select data-testid="output-preset" value={selectValue} onChange={e => void pickPreset(e.target.value)}>
        {GROUPS.map(group => <optgroup key={group} label={t(`out.group.${group}` as MessageKey)}>{OUTPUT_PRESETS.filter(p => p.group === group).map(p => <option key={p.key} value={p.key}>{p.label} · {p.width}×{p.height}</option>)}</optgroup>)}
        <option value="custom">{t("out.custom")}</option>
      </select></label>
      {custom && <>
        <label>{t("out.width")}<input data-testid="output-width" inputMode="numeric" style={{ width: 90 }} value={width} onChange={e => setWidth(e.target.value)} onBlur={() => void applyCustom()} onKeyDown={e => { if (e.key === "Enter") void applyCustom(); }} /></label>
        <label>{t("out.height")}<input data-testid="output-height" inputMode="numeric" style={{ width: 90 }} value={height} onChange={e => setHeight(e.target.value)} onBlur={() => void applyCustom()} onKeyDown={e => { if (e.key === "Enter") void applyCustom(); }} /></label>
      </>}
      <span className="muted" data-testid="output-aspect">{template.width}×{template.height} · {aspectLabel(template.width, template.height)}{preset?.maxSeconds ? t("out.platformMax", { time: `${Math.floor(preset.maxSeconds / 60)}:${String(preset.maxSeconds % 60).padStart(2, "0")}` }) : ""}</span>
    </div>
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "end" }}>
      <label>{t("out.framing")}<select data-testid="output-reframe" value={defaultChoice(template.reframe)} onChange={e => void pickDefault(e.target.value as DefaultChoice)}>
        <option value="fill">{t("out.fill")}</option><option value="fit-blur">{t("out.fitBlur")}</option><option value="fit-color">{t("out.fitColor")}</option>
      </select></label>
      <label>{t("out.target")}<input data-testid="output-target" placeholder={t("out.targetPlaceholder")} style={{ width: 90 }} value={target} onChange={e => setTarget(e.target.value)} onBlur={() => void applyTarget()} onKeyDown={e => { if (e.key === "Enter") void applyTarget(); }} /></label>
    </div>
    {(changed || scaled) && <small className="muted">{t("out.scaled")}</small>}
    {problem && <small className="error" role="alert">{problem}</small>}
  </div>;
}
