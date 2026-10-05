import { variableNames } from "@/domain/variables";
import { findPreset, presetForSize } from "@/domain/output-presets";
import type { Graphic } from "@/domain/graphics";
import type { Definition, Output } from "./types";

export function outputLabel(o: Output) {
  const kind =
    o.type === "VIDEO"
      ? "Video"
      : o.type === "AUDIO"
        ? `Podcast (${o.mimeType === "audio/mp4" ? "M4A" : "MP3"})`
        : o.type === "CAPTIONS_SRT"
          ? "Captions (SRT)"
          : o.type === "CAPTIONS_VTT"
            ? "Captions (VTT)"
            : o.type;
  const lang = o.type.startsWith("CAPTIONS_") && o.language && o.language !== "und" ? ` · ${o.language}` : "";
  return `${o.preview ? "Preview " : ""}${kind}${lang}`;
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
