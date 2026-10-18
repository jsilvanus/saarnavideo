import { outputExtension } from "@/domain/captions";

/** Longest label a user can give an output (characters after trimming). */
export const OUTPUT_LABEL_MAX = 120;

/** Longest base name (without extension) used in a download file name. */
const FILE_BASE_MAX = 100;

export type OutputForName = { type: string; mimeType: string; language: string | null; label?: string | null };

/**
 * Checks a label sent to `PATCH /api/outputs/[id]`: trimmed, at most OUTPUT_LABEL_MAX characters. An empty string (or null)
 * clears the label. Returns the label to store (null = none) or the reason it was refused.
 */
export function normalizeOutputLabel(value: unknown): { ok: true; label: string | null } | { ok: false; reason: string } {
  if (value === null) return { ok: true, label: null };
  if (typeof value !== "string") return { ok: false, reason: "label must be a string" };
  const label = value.trim();
  if (label.length > OUTPUT_LABEL_MAX) return { ok: false, reason: `label must be at most ${OUTPUT_LABEL_MAX} characters` };
  return { ok: true, label: label || null };
}

/**
 * The part of a label that can be a file name: control characters and path or shell-hostile characters become spaces,
 * whitespace is collapsed, leading and trailing dots are dropped (no hidden or relative names). Null when nothing is left.
 */
export function sanitizeOutputFileBase(label: string): string | null {
  const cleaned = label
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "")
    .trim()
    .slice(0, FILE_BASE_MAX)
    .trim();
  return cleaned || null;
}

/** The default base name of an output, e.g. `saarnavideo-video` or `saarnavideo-podcast`. */
export function defaultOutputBaseName(output: Pick<OutputForName, "type" | "language">): string {
  if (output.type === "AUDIO") return "saarnavideo-podcast";
  if (output.type.startsWith("CAPTIONS_")) return `saarnavideo-captions${output.language && output.language !== "und" ? `-${output.language}` : ""}`;
  return `saarnavideo-${output.type.toLowerCase()}`;
}

/**
 * The download file name of an output: the label (sanitised, with the expected extension added or kept once) when one is
 * set, else the default name. The extension always comes from outputExtension.
 */
export function outputDownloadName(output: OutputForName): string {
  const extension = outputExtension(output.type, output.mimeType);
  const base = (output.label ? sanitizeOutputFileBase(output.label) : null) ?? defaultOutputBaseName(output);
  // A label that already ends with the extension ("Sermon.mp4") does not get it twice.
  const bare = base.toLowerCase().endsWith(`.${extension}`) ? base.slice(0, -(extension.length + 1)).trim() || defaultOutputBaseName(output) : base;
  return `${bare}.${extension}`;
}

/**
 * A Content-Disposition attachment header for `filename`: an ASCII fallback for old clients plus the UTF-8 name
 * (RFC 5987), so Finnish or Swedish labels arrive intact.
 */
export function attachmentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}
