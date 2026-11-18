// @ts-check
// Server-side localisation. One process serves one user, so the effective language is module
// state: set from the user's preference (`settings.language`), falling back to the OS language the
// page reported, then to a best guess from this process's environment.
import STRINGS from './strings.mjs';

/** @typedef {'zh' | 'en'} Locale */
export const LOCALES = /** @type {const} */ (['zh', 'en']);
export const LANGUAGE_PREFS = /** @type {const} */ (['auto', 'zh', 'en']);

/** Map any BCP 47-ish tag to a supported locale, or undefined. */
export function matchLocale(tag) {
  const value = String(tag ?? '').toLowerCase();
  if (value.startsWith('zh')) return 'zh';
  if (value.startsWith('en')) return 'en';
  return undefined;
}

/**
 * Best guess before the page has reported the OS language. A GUI app started from the Finder or
 * Start menu often has no LANG, so this is only a fallback; the page's report wins.
 * @returns {Locale}
 */
export function guessOsLocale() {
  const candidates = [
    process.env.LC_ALL,
    process.env.LC_MESSAGES,
    process.env.LANG,
    Intl.DateTimeFormat().resolvedOptions().locale,
  ];
  for (const tag of candidates) {
    const match = matchLocale(tag);
    if (match) return match;
  }
  return 'en';
}

/** @type {Locale} */
let current = guessOsLocale();

export const locale = () => current;

/** @param {{ settings?: { language?: string }, systemLocale?: string }} state */
export function resolveLocale(state) {
  const pref = state.settings?.language;
  if (pref === 'zh' || pref === 'en') return pref;
  // The page reports the user's own language; the process guess is the last resort. Once a
  // language is in force, a later reload keeps it instead of re-guessing the server's OS.
  return matchLocale(state.systemLocale) ?? current;
}

/** @param {string} next @returns {boolean} whether it changed */
export function setLocale(next) {
  const value = matchLocale(next) ?? 'en';
  const changed = value !== current;
  current = value;
  return changed;
}

/**
 * @param {string} key
 * @param {Record<string, any>} [params]
 * @param {Locale} [lang] render in this language instead of the current one
 */
export function t(key, params, lang = current) {
  const entry = STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? STRINGS.zh[key];
  if (entry === undefined) return key;
  if (typeof entry === 'function') return entry(params ?? {});
  return params ? entry.replace(/\{(\w+)\}/g, (m, name) => (params[name] ?? m).toString()) : entry;
}

/** Whether `text` is the default for `key` in any language (i.e. the user has not edited it). */
export function isDefaultText(key, text) {
  return LOCALES.some((lang) => t(key, undefined, lang) === text);
}
