import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE, isLocale, localeFromAcceptLanguage, type Locale } from "./locales";

/** The request's language for server components: the language cookie, else the browser's Accept-Language, else Finnish. */
export async function getServerLocale(): Promise<Locale> {
  const saved = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(saved) ? saved : localeFromAcceptLanguage((await headers()).get("accept-language"));
}
