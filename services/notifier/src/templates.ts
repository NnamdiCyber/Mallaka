import { en } from "./locales/en.js";
import { ha } from "./locales/ha.js";
import { yo } from "./locales/yo.js";
import { ig } from "./locales/ig.js";
import { pcm } from "./locales/pcm.js";
import type { Locale, LocaleTable, TemplateId, TemplateParams } from "./types.js";

export const LOCALES: Record<Locale, LocaleTable> = { en, ha, yo, ig, pcm };

/** Required placeholders per template. render() throws if one is missing. */
export const TEMPLATE_PARAMS: Record<TemplateId, string[]> = {
  payment_received: ["amount", "balance"],
  due_soon: ["amount", "dueDate"],
  grace_entered: ["amount", "dueDate", "graceEnds"],
  pre_lock: ["lockAfter", "amount"],
  lock_engaged: ["amount"],
  unlock_confirmed: [],
  lease_completed: [],
  otp: ["code"],
};

export function isLocale(value: string): value is Locale {
  return value in LOCALES;
}

/**
 * Renders a template. Locale mechanism: use the locale's text if present,
 * otherwise fall back to English (never to an unreviewed translation).
 */
export function render(id: TemplateId, locale: Locale, params: TemplateParams = {}): string {
  const template = LOCALES[locale]?.[id] ?? en[id];
  if (!template) throw new Error(`Unknown notification template: ${id}`);
  for (const key of TEMPLATE_PARAMS[id]) {
    if (params[key] === undefined || params[key] === "") {
      throw new Error(`Template ${id} requires parameter "${key}"`);
    }
  }
  return template.replace(/\{(\w+)\}/g, (_m, key: string) => {
    const value = params[key];
    if (value === undefined) throw new Error(`Template ${id} has unfilled placeholder "${key}"`);
    return value;
  });
}
