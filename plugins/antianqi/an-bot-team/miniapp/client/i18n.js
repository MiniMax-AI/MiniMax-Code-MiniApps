// @ts-check
// Client-side localisation. Strings live in per-area dictionaries (strings-*.js), each exporting
// `{ zh: {...}, en: {...} }`; keys are flat and namespaced by area to avoid collisions.
//
// Language resolution:
//   settings.language === 'auto'  -> the OS language, read from navigator.languages (in MiniMax
//                                    Code's Electron this follows the operating system), else en
//   settings.language === 'zh'|'en' -> that language
// The server owns the preference (server-side text such as errors and system notices must match),
// so the effective locale arrives with /api/state; systemLocale() is only used until then and is
// reported to the server so it can resolve `auto` too.
import app from './strings-app.js';
import panels from './strings-panels.js';

/** @typedef {'zh' | 'en'} Locale */
/** @type {Locale[]} */
export const LOCALES = ['zh', 'en'];

/** @type {Record<Locale, Record<string, string | ((p: Record<string, any>) => string)>>} */
const DICT = {
  zh: { ...app.zh, ...panels.zh },
  en: { ...app.en, ...panels.en },
};

/** First OS-preferred language we have strings for; English otherwise. */
export function systemLocale() {
  const list = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of list) {
    const base = String(tag ?? '').toLowerCase();
    if (base.startsWith('zh')) return 'zh';
    if (base.startsWith('en')) return 'en';
  }
  return 'en';
}

/** @type {Locale} */
let current = systemLocale();

export const locale = () => current;
/** BCP 47 tag for Intl and <html lang>. */
export const localeTag = () => (current === 'zh' ? 'zh-CN' : 'en-US');

/** @param {string | undefined} next @returns {boolean} whether it changed */
export function setLocale(next) {
  const value = LOCALES.includes(/** @type {Locale} */ (next)) ? /** @type {Locale} */ (next) : 'en';
  const changed = value !== current;
  current = value;
  document.documentElement.lang = localeTag();
  return changed;
}

/**
 * Translate `key`. String entries interpolate `{name}` placeholders; function entries receive the
 * params object (use them for plurals or word order). A missing key falls back to English, then
 * Chinese, then the key itself, so a gap is visible rather than blank.
 * @param {string} key
 * @param {Record<string, any>} [params]
 */
export function t(key, params) {
  const entry = DICT[current][key] ?? DICT.en[key] ?? DICT.zh[key];
  if (entry === undefined) return key;
  if (typeof entry === 'function') return entry(params ?? {});
  return params ? entry.replace(/\{(\w+)\}/g, (m, name) => (params[name] ?? m).toString()) : entry;
}

/** Fill `data-i18n` (text), `data-i18n-label` (aria-label) and `data-i18n-title` in static HTML. */
export function translateDom(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(/** @type {HTMLElement} */ (el).dataset.i18n ?? '');
  for (const el of root.querySelectorAll('[data-i18n-label]')) el.setAttribute('aria-label', t(/** @type {HTMLElement} */ (el).dataset.i18nLabel ?? ''));
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.setAttribute('title', t(/** @type {HTMLElement} */ (el).dataset.i18nTitle ?? ''));
}
