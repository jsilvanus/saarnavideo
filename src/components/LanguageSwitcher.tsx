"use client";

import { useI18n } from "@/i18n/I18nProvider";
import { LOCALES, LOCALE_NAMES, isLocale } from "@/i18n/locales";

export default function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  return (
    <select aria-label={t("lang.label")} value={locale} onChange={(e) => { if (isLocale(e.target.value)) setLocale(e.target.value); }}
      style={{ background: "white", border: "1px solid #ccc", borderRadius: 8, padding: "8px 8px", boxShadow: "0 1px 4px #0002", color: "inherit" }}>
      {LOCALES.map((code) => <option key={code} value={code}>{LOCALE_NAMES[code]}</option>)}
    </select>
  );
}
