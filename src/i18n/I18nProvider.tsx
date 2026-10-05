"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_LOCALE, LOCALE_COOKIE, type Locale } from "./locales";
import { makeT, type TFunction } from "./translate";

type I18n = { locale: Locale; setLocale: (locale: Locale) => void; t: TFunction };

const I18nContext = createContext<I18n>({ locale: DEFAULT_LOCALE, setLocale: () => undefined, t: makeT(DEFAULT_LOCALE) });

export function I18nProvider({ initialLocale, children }: { initialLocale: Locale; children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = next;
  }, []);
  const value = useMemo<I18n>(() => ({ locale, setLocale, t: makeT(locale) }), [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
/** Translation function of the current language. */
export const useT = () => useContext(I18nContext).t;
