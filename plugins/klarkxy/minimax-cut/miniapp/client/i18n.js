/* MiniMax Cut — UI localization runtime (English / 简体中文).
 *
 * This file is the small half of the localization: it owns the current
 * locale, the persisted preference, the translation lookup and the static
 * `data-i18n` pass. The dictionaries live in i18n-en.js and i18n-zh-CN.js and
 * are registered into it; the editor's own app.js calls `I18n.t()` at the
 * places where it builds UI.
 *
 * Rules this runtime keeps:
 *   - A key that is not in a dictionary is returned untouched.
 *   - A key that IS in a dictionary is translated, so a string that reads like
 *     one of ours ("Settings", "Export", "Color") is translated wherever it is
 *     used as interface text. The editor therefore never hands user text to
 *     `t()`: a project name, a clip name, a caption or a template field is
 *     written straight into the DOM, so it stays byte-identical in every
 *     language even when it happens to match a key.
 *   - Nothing is fetched. The dictionaries are local files.
 *   - `data-i18n` writes textContent, never innerHTML, so a translated
 *     phrase can never inject markup.
 */
(function (global) {
  "use strict";

  /** The locales the editor ships with. */
  const LOCALES = ["en", "zh-CN"];
  /** The locale used when nothing else is known. */
  const DEFAULT_LOCALE = "en";
  /** Where the chosen locale is remembered, in this browser only. */
  const STORAGE_KEY = "fablecut-locale";
  /** The page title, in both languages. */
  const DOC_TITLE = "MiniMax Cut - Video Editor";

  /** @type {Map<string, Record<string, string>>} */
  const dicts = new Map();
  /** @type {Set<(locale: string) => void>} */
  const listeners = new Set();

  let locale = DEFAULT_LOCALE;
  /** Whether the runtime has started (the markup has been translated once). */
  let started = false;

  /**
   * Whitespace runs collapse to one space and the ends are trimmed. The
   * applier writes normalized keys, so a phrase that was written with a
   * newline in the source still finds its entry.
   * @param {string} s
   * @returns {string}
   */
  function normalizeKey(s) {
    return String(s ?? "").replace(/\s+/g, " ").trim();
  }

  /**
   * Decode the HTML entities a browser decodes in an attribute value.
   *
   * A key that comes from the markup is written with `&amp;`; the DOM hands
   * the text back decoded. Both sides are decoded here, so they meet.
   *
   * @param {string} s
   * @returns {string}
   */
  function decodeEntities(s) {
    return String(s)
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&");
  }

  /**
   * @param {string} key
   * @param {string} id
   * @returns {string | null}
   */
  function rawLookup(key, id) {
    const dict = dicts.get(id);
    if (!dict) return null;
    if (!Object.prototype.hasOwnProperty.call(dict, key)) return null;
    const value = dict[key];
    return typeof value === "string" ? value : null;
  }

  /**
   * Fill `{name}` placeholders. A missing value leaves the placeholder
   * alone, so a half-translated message is still readable.
   * @param {string} s
   * @param {Record<string, unknown>} params
   * @returns {string}
   */
  function interpolate(s, params) {
    return String(s).replace(/\{(\w+)\}/g, (match, name) => {
      const value = params ? params[name] : undefined;
      return value === undefined || value === null ? match : String(value);
    });
  }

  /**
   * Translate a key.
   *
   * The lookup falls back to English and then to the key itself, so an
   * untranslated developer or server message keeps its original text.
   *
   * A key that is in a dictionary is translated wherever it is used. The
   * editor keeps user text away from here, so a name the user typed is never
   * changed by a language switch.
   *
   * @param {string} key
   * @param {Record<string, unknown>} [params]
   * @returns {string}
   */
  function t(key, params) {
    if (typeof key !== "string") return key === undefined || key === null ? "" : String(key);
    const wanted = decodeEntities(key);
    let out = rawLookup(wanted, locale);
    if (out === null) {
      const normalized = normalizeKey(wanted);
      if (normalized !== wanted) out = rawLookup(normalized, locale);
    }
    if (out === null) out = rawLookup(wanted, DEFAULT_LOCALE);
    if (out === null) {
      const normalized = normalizeKey(wanted);
      if (normalized !== wanted) out = rawLookup(normalized, DEFAULT_LOCALE);
    }
    if (out === null) return params ? interpolate(wanted, params) : wanted;
    return params ? interpolate(out, params) : out;
  }

  /**
   * HTML-escape a value. Used where a translated phrase has to go into an
   * innerHTML string next to other markup; the values it takes are the
   * dictionary's own, never raw user text.
   * @param {unknown} value
   * @returns {string}
   */
  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * The locale tag of a browser language, or null when it is not one the
   * editor ships with.
   * @param {unknown} value
   * @returns {string | null}
   */
  function normalizeLocale(value) {
    const tag = String(value ?? "").trim().toLowerCase().replace(/_/g, "-");
    if (!tag) return null;
    if (tag === "zh" || tag.startsWith("zh-")) return "zh-CN";
    if (tag === "en" || tag.startsWith("en-")) return "en";
    return null;
  }

  /**
   * The locale to start with when the browser has not chosen one: Chinese for
   * a Chinese browser, English for everything else.
   * @returns {string}
   */
  function detectLocale() {
    /** @type {string[]} */
    const tags = [];
    try {
      const nav = global.navigator;
      if (nav) {
        if (Array.isArray(nav.languages)) tags.push(...nav.languages);
        if (nav.language) tags.push(nav.language);
      }
    } catch { }
    for (const raw of tags) {
      const locale = normalizeLocale(raw);
      if (locale) return locale;
    }
    return DEFAULT_LOCALE;
  }

  /**
   * @returns {string | null}
   */
  function readStored() {
    try {
      return normalizeLocale(global.localStorage?.getItem(STORAGE_KEY));
    } catch {
      return null;
    }
  }

  /**
   * @param {string} value
   */
  function writeStored(value) {
    try { global.localStorage?.setItem(STORAGE_KEY, value); } catch { }
  }

  /**
   * Put the locale on the document: the `lang` attribute and the title.
   */
  function applyDocumentLocale() {
    const doc = global.document;
    if (!doc) return;
    const root = doc.documentElement;
    if (root) root.setAttribute("lang", locale);
    if (doc.title) doc.title = t(DOC_TITLE);
  }

  /**
   * Write the static translations of a subtree.
   *
   * `data-i18n` sets textContent (never innerHTML); `data-i18n-title`,
   * `data-i18n-aria-label` and `data-i18n-placeholder` set the matching
   * attribute. Every one of them names its own key, so nothing is matched by
   * what it happens to say.
   *
   * @param {Document | Element} [root]
   */
  function applyStatic(root) {
    const doc = root || global.document;
    if (!doc || typeof doc.querySelectorAll !== "function") return;
    for (const el of doc.querySelectorAll("[data-i18n]")) {
      const key = el.getAttribute("data-i18n");
      if (key) el.textContent = t(key);
    }
    for (const el of doc.querySelectorAll("[data-i18n-title]")) {
      const key = el.getAttribute("data-i18n-title");
      if (key) el.setAttribute("title", t(key));
    }
    for (const el of doc.querySelectorAll("[data-i18n-aria-label]")) {
      const key = el.getAttribute("data-i18n-aria-label");
      if (key) el.setAttribute("aria-label", t(key));
    }
    for (const el of doc.querySelectorAll("[data-i18n-placeholder]")) {
      const key = el.getAttribute("data-i18n-placeholder");
      if (key) el.setAttribute("placeholder", t(key));
    }
  }

  /**
   * @param {string} id
   */
  function emit(id) {
    for (const fn of [...listeners]) {
      try { fn(id); } catch { }
    }
  }

  /**
   * Choose the locale.
   *
   * @param {string} next
   * @param {{persist?: boolean}} [options]
   * @returns {string} the locale in force
   */
  function setLocale(next, options) {
    const id = normalizeLocale(next) || DEFAULT_LOCALE;
    const changed = id !== locale;
    locale = id;
    if (!options || options.persist !== false) writeStored(id);
    applyDocumentLocale();
    if (changed) {
      applyStatic(global.document);
      emit(id);
    }
    return locale;
  }

  /**
   * @param {(locale: string) => void} fn
   * @returns {() => void} a function that removes the listener
   */
  function onChange(fn) {
    if (typeof fn !== "function") return () => { };
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }

  /**
   * Start the runtime: the stored choice, else the browser's language.
   *
   * The locale is resolved when this file loads, not when the editor starts:
   * the other client scripts call `T()` while they are loading, so the
   * language has to be known already.
   *
   * @returns {string}
   */
  function init() {
    locale = readStored() || detectLocale();
    applyDocumentLocale();
    if (global.document && global.document.readyState !== "loading") {
      started = true;
      applyStatic(global.document);
    }
    return locale;
  }

  /**
   * Add a dictionary. Later registrations win, so a hot reload is fine.
   *
   * A dictionary usually arrives after the runtime has started, so the
   * markup is translated again as soon as one shows up.
   *
   * @param {string} id
   * @param {Record<string, string>} entries
   */
  function register(id, entries) {
    if (!id || !entries || typeof entries !== "object") return;
    /** @type {Record<string, string>} */
    const decoded = {};
    for (const [key, value] of Object.entries(entries)) {
      if (typeof value !== "string") continue;
      decoded[decodeEntities(key)] = value;
    }
    dicts.set(id, decoded);
    if (started) {
      applyDocumentLocale();
      applyStatic(global.document);
    }
  }

  global.I18n = {
    LOCALES,
    DEFAULT_LOCALE,
    STORAGE_KEY,
    DOC_TITLE,
    register,
    t,
    esc,
    get locale() { return locale; },
    detectLocale,
    normalizeLocale,
    setLocale,
    getLocale: () => locale,
    onChange,
    applyStatic,
    applyDocumentLocale,
    init,
    /** @returns {Record<string, string>} */
    dictionary: (id) => dicts.get(id || locale) || {},
    /** @returns {string[]} */
    locales: () => [...dicts.keys()],
  };

  /* The short form the editor's own code uses. It is a property of the
     global object, not a lexical binding, so the other client scripts can
     call it while they are loading. */
  global.T = (key, params) => t(key, params);

  /* The locale is resolved straight away, before any other script runs: the
     other client scripts call `T()` while they load. The markup itself is
     translated as soon as the DOM is there. */
  locale = readStored() || detectLocale();
  if (global.document) {
    if (global.document.readyState === "loading") {
      global.document.addEventListener("DOMContentLoaded", () => {
        started = true;
        applyDocumentLocale();
        applyStatic(global.document);
      }, { once: true });
    } else {
      started = true;
      applyDocumentLocale();
      applyStatic(global.document);
    }
  }
})(typeof window !== "undefined" ? window : globalThis);