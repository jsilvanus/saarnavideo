import { variableNames } from "@/domain/variables";
import { findPreset, presetForSize } from "@/domain/output-presets";
import type { Graphic } from "@/domain/graphics";
import { MESSAGES, type MessageKey, type TFunction } from "@/i18n/translate";
import type { Definition, Output } from "./types";

export function outputLabel(o: Output, t: TFunction) {
  const kind =
    o.type === "VIDEO"
      ? t("output.video")
      : o.type === "AUDIO"
        ? t("output.podcast", { format: o.mimeType === "audio/mp4" ? "M4A" : "MP3" })
        : o.type === "CAPTIONS_SRT"
          ? t("output.captionsSrt")
          : o.type === "CAPTIONS_VTT"
            ? t("output.captionsVtt")
            : o.type;
  const lang = o.type.startsWith("CAPTIONS_") && o.language && o.language !== "und" ? ` · ${o.language}` : "";
  return `${o.preview ? t("output.previewPrefix") : ""}${kind}${lang}`;
}

export function outputSizeLabel(template: Definition["template"]) {
  const width = template?.width ?? 1920,
    height = template?.height ?? 1080;
  const preset = findPreset(template?.presetKey) ?? presetForSize(width, height, template?.presetKey);
  return preset ? `${preset.label} (${width}×${height})` : `${width}×${height}`;
}

export function graphicVariables(graphic: Graphic) {
  return [...new Set(graphic.layers.flatMap((layer) => variableNames(layer.text ?? "")))];
}

/** Localised name of a job status; an unknown status is shown as it is. */
export function jobStatusLabel(t: TFunction, status: string): string {
  const key = `jobStatus.${status}` as MessageKey;
  return (MESSAGES.fi as Record<string, string>)[key] ? t(key) : status;
}
