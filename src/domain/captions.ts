import { z } from "zod";

/**
 * Caption options of a generate request. "none" renders no captions; "soft"
 * muxes a mov_text track into the MP4 and stores sidecar SRT/VTT outputs.
 * A later "burn" mode (captions drawn into the picture) extends this enum.
 */
export const captionOptionsSchema = z.object({
  mode: z.enum(["none", "soft"]).default("none"),
  /** BCP 47 style tag ("fi", "fi-FI") or ISO 639-2 code ("fin"). Defaults to the transcript's own language. */
  language: z.string().trim().regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, "language must be a language tag such as fi, fin or fi-FI").optional(),
});
export type CaptionOptions = z.infer<typeof captionOptionsSchema>;

// ISO 639-1 -> ISO 639-2/T, for the languages a Finnish congregation is likely to use.
const ISO_639_2: Record<string, string> = {
  fi: "fin", sv: "swe", en: "eng", et: "est", de: "deu", ru: "rus", no: "nor", nb: "nob", da: "dan", is: "isl",
  fr: "fra", es: "spa", it: "ita", pt: "por", pl: "pol", uk: "ukr", ar: "ara", so: "som", se: "sme", sk: "slk", cs: "ces", hu: "hun", lv: "lav", lt: "lit", nl: "nld",
};

/** Primary subtag of a language tag, lower-cased ("fi-FI" -> "fi"). */
export function primaryLanguage(tag: string): string {
  return tag.split("-")[0].toLowerCase();
}

/** ISO 639-2 code for MP4 track language metadata; "und" when the language is unknown. */
export function toIso6392(tag: string | undefined | null): string {
  if (!tag) return "und";
  const primary = primaryLanguage(tag);
  if (primary.length === 3) return primary;
  return ISO_639_2[primary] ?? "und";
}

/** Two-letter (or as given) tag YouTube expects for caption tracks; undefined when unknown. */
export function toYouTubeLanguage(tag: string | undefined | null): string | undefined {
  if (!tag) return undefined;
  const primary = primaryLanguage(tag);
  if (primary === "und") return undefined;
  if (primary.length === 2) return primary;
  const two = Object.entries(ISO_639_2).find(([, three]) => three === primary)?.[0];
  return two ?? primary;
}

export const CAPTION_MIME = {
  srt: "application/x-subrip; charset=utf-8",
  vtt: "text/vtt; charset=utf-8",
} as const;

/** File extension for a stored Output row. */
export function outputExtension(type: string): string {
  switch (type) {
    case "VIDEO": return "mp4";
    case "CAPTIONS_SRT": return "srt";
    case "CAPTIONS_VTT": return "vtt";
    default: return "jpg";
  }
}
