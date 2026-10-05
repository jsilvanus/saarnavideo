import { DEFAULT_LOCALE, type Locale } from "./locales";
import { fi } from "./messages/fi";
import { en } from "./messages/en";
import { sv } from "./messages/sv";

type RawKey = keyof typeof fi;
/** A key as written in code: `x_one` / `x_other` pairs are used as plain `x`. */
export type MessageKey = RawKey extends infer K ? (K extends `${infer B}_one` | `${infer B}_other` ? B : K) : never;
export type Messages = Record<RawKey, string>;
export type Params = Record<string, string | number | boolean>;
export type TFunction = (key: MessageKey, params?: Params) => string;

export const MESSAGES: Record<Locale, Messages> = { fi, en, sv };

/**
 * Looks a message up and fills `{name}` placeholders. When `params.count` is set, `<key>_one` is used for 1 and
 * `<key>_other` otherwise if such keys exist (Finnish, English and Swedish all have just these two forms).
 */
export function translate(locale: Locale, key: MessageKey, params?: Params): string {
  const table = MESSAGES[locale] ?? MESSAGES[DEFAULT_LOCALE];
  let template: string | undefined;
  if (params && typeof params.count === "number") {
    const form = new Intl.PluralRules(locale).select(params.count) === "one" ? "_one" : "_other";
    template = (table as Record<string, string>)[`${key}${form}`];
  }
  template ??= (table as Record<string, string>)[key] ?? (MESSAGES[DEFAULT_LOCALE] as Record<string, string>)[key] ?? key;
  return params ? template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match)) : template;
}

export function makeT(locale: Locale): TFunction {
  return (key, params) => translate(locale, key, params);
}
