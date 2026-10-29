import { en, type Strings } from "./locales/en";
import { ha } from "./locales/ha";
import { yo } from "./locales/yo";
import { ig } from "./locales/ig";
import { pcm } from "./locales/pcm";

export type Locale = "en" | "ha" | "yo" | "ig" | "pcm";

/** Language names are written in the language itself. NEEDS NATIVE REVIEW for ha/yo/ig/pcm names too. */
export const LOCALES: { code: Locale; label: string; ready: boolean }[] = [
  { code: "en", label: "English", ready: true },
  { code: "ha", label: "Hausa", ready: false },
  { code: "yo", label: "Yorùbá", ready: false },
  { code: "ig", label: "Igbo", ready: false },
  { code: "pcm", label: "Pidgin", ready: false },
];

const TABLES: Record<Locale, Partial<Strings>> = { en, ha, yo, ig, pcm };

export type StringKey = keyof Strings;

/** Looks a string up in the chosen language and falls back to English. Fills {placeholders}. */
export function translate(locale: Locale, key: StringKey, vars: Record<string, string | number> = {}): string {
  const text = TABLES[locale][key] ?? en[key];
  return text.replace(/\{(\w+)\}/g, (_m, name: string) => String(vars[name] ?? ""));
}

export type T = (key: StringKey, vars?: Record<string, string | number>) => string;
export const makeT = (locale: Locale): T => (key, vars) => translate(locale, key, vars);
