import { describe, expect, it } from "vitest";
import { LOCALES, isLocale, localeFromAcceptLanguage } from "./locales";
import { MESSAGES, makeT, translate } from "./translate";

const placeholders = (text: string) => [...text.replace(/\{\{[^}]*\}\}/g, "").matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

describe("message catalogues", () => {
  const keys = Object.keys(MESSAGES.fi);

  it("have the same keys in every language", () => {
    for (const locale of LOCALES) expect(Object.keys(MESSAGES[locale]).sort()).toEqual([...keys].sort());
  });

  it("have no empty messages", () => {
    for (const locale of LOCALES) for (const key of keys) expect(MESSAGES[locale][key as keyof typeof MESSAGES.fi].trim(), `${locale}:${key}`).not.toBe("");
  });

  it("use the same {placeholders} in every language", () => {
    for (const key of keys) {
      const expected = placeholders(MESSAGES.fi[key as keyof typeof MESSAGES.fi]);
      for (const locale of LOCALES) expect(placeholders(MESSAGES[locale][key as keyof typeof MESSAGES.fi]), `${locale}:${key}`).toEqual(expected);
    }
  });

  it("give every plural form both a _one and an _other message", () => {
    for (const key of keys) {
      if (key.endsWith("_one")) expect(keys, key).toContain(`${key.slice(0, -4)}_other`);
      if (key.endsWith("_other")) expect(keys, key).toContain(`${key.slice(0, -6)}_one`);
    }
  });
});

describe("translate", () => {
  it("fills {name} placeholders and leaves unknown ones as written", () => {
    expect(translate("en", "duration.video", { value: "1:00" })).toBe("Video 1:00");
    expect(translate("en", "duration.video", {})).toBe("Video {value}");
  });

  it("picks the plural form from params.count", () => {
    expect(translate("en", "tr.runLines", { count: 1 })).toBe("1 line");
    expect(translate("en", "tr.runLines", { count: 3 })).toBe("3 lines");
    expect(translate("sv", "tr.runLines", { count: 2 })).toBe("2 rader");
  });

  it("works for the same key in every language", () => {
    const text = (locale: "fi" | "en" | "sv") => makeT(locale)("common.cancel");
    expect(new Set([text("fi"), text("en"), text("sv")]).size).toBe(3);
  });

  it("falls back to the key for an unknown message", () => {
    expect(translate("fi", "no.such.key" as never)).toBe("no.such.key");
  });
});

describe("locale detection", () => {
  it("accepts only the supported languages", () => {
    expect(LOCALES.every(isLocale)).toBe(true);
    expect(isLocale("de")).toBe(false);
  });

  it("reads the first supported language of Accept-Language, else Finnish", () => {
    expect(localeFromAcceptLanguage("sv-SE,sv;q=0.9,en;q=0.8")).toBe("sv");
    expect(localeFromAcceptLanguage("de,en;q=0.5")).toBe("en");
    expect(localeFromAcceptLanguage("de,fr")).toBe("fi");
    expect(localeFromAcceptLanguage(null)).toBe("fi");
  });
});
