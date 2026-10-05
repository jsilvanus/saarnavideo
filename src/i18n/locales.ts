export const LOCALES = ["fi", "en", "sv"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "fi";
export const LOCALE_COOKIE = "saarnavideo-lang";
export const LOCALE_NAMES: Record<Locale, string> = { fi: "Suomi", en: "English", sv: "Svenska" };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** The first supported language in an `Accept-Language` header, else the default. */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  for (const part of (header ?? "").split(",")) {
    const code = part.split(";")[0].trim().slice(0, 2).toLowerCase();
    if (isLocale(code)) return code;
  }
  return DEFAULT_LOCALE;
}
