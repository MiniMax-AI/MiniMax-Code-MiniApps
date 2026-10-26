// @ts-check
// Tests for the editor's localization: the runtime, the two dictionaries and
// the way the client payload uses them.
//
// The runtime is a classic script, so it is loaded into a `vm` context with a
// small DOM stub. That keeps the test free of a browser and of any dependency.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = path.join(PACKAGE_ROOT, 'miniapp', 'client');

const read = (/** @type {string} */ name) => fs.readFileSync(path.join(CLIENT, name), 'utf8');

/* ── a DOM stub ──────────────────────────────────────────────────────────── */

/**
 * @param {string} tag
 * @param {Record<string, string>} [attrs]
 */
function makeElement(tag, attrs = {}) {
  return {
    tagName: tag.toUpperCase(),
    attributes: { ...attrs },
    /** @type {any[]} */
    children: [],
    _text: '',
    _html: '',
    get textContent() { return this._text; },
    set textContent(value) { this._text = String(value); },
    get innerHTML() { return this._html; },
    set innerHTML(value) { this._html = String(value); },
    /** @param {string} name */
    getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; },
    /** @param {string} name @param {string} value */
    setAttribute(name, value) { this.attributes[name] = String(value); },
    /** @param {string} name */
    removeAttribute(name) { delete this.attributes[name]; },
    /** @param {string} selector */
    querySelectorAll(selector) { return collect(this, selector); },
    /** @param {string} selector */
    querySelector(selector) { return collect(this, selector)[0] ?? null; },
  };
}

/**
 * The only selectors the runtime uses are attribute selectors; the tests also
 * want `#id`.
 * @param {any} root
 * @param {string} selector
 * @returns {any[]}
 */
function collect(root, selector) {
  const attr = /^\[([\w-]+)\]$/.exec(selector);
  if (attr) {
    const name = attr[1];
    /** @type {any[]} */
    const out = [];
    /** @param {any} el */
    const walk = (el) => {
      if (el.getAttribute && el.getAttribute(name) !== null) out.push(el);
      for (const child of el.children ?? []) walk(child);
    };
    walk(root);
    return out;
  }
  const id = /^#([\w-]+)$/.exec(selector);
  if (id) {
    /** @type {any[]} */
    const out = [];
    /** @param {any} el */
    const walk = (el) => {
      if (el.id === id[1]) out.push(el);
      for (const child of el.children ?? []) walk(child);
    };
    walk(root);
    return out;
  }
  return [];
}

/** @param {Record<string, string>} [seed] */
function makeDocument(seed = {}) {
  const root = makeElement('html');
  const body = makeElement('body');
  root.children.push(body);
  const doc = {
    readyState: 'complete',
    documentElement: root,
    title: '',
    /** @param {string} _type @param {() => void} _fn */
    addEventListener(_type, _fn) { },
    /** @param {string} selector */
    querySelectorAll(selector) { return collect(root, selector); },
    /** @param {string} selector */
    querySelector(selector) { return collect(root, selector)[0] ?? null; },
  };
  for (const [id, text] of Object.entries(seed)) {
    const el = makeElement('span', { 'data-i18n': text });
    el.id = id;
    el.textContent = text;
    body.children.push(el);
  }
  return doc;
}

/**
 * Load the runtime into a fresh context.
 * @param {{languages?: string[], stored?: string|null, document?: any}} [options]
 */
function loadRuntime(options = {}) {
  /** @type {Record<string, string>} */
  const store = {};
  if (options.stored) store['fablecut-locale'] = options.stored;
  const sandbox = {
    console,
    navigator: {
      languages: options.languages ?? ['en-US'],
      language: (options.languages ?? ['en-US'])[0],
    },
    localStorage: {
      /** @param {string} key */
      getItem(key) { return key in store ? store[key] : null; },
      /** @param {string} key @param {string} value */
      setItem(key, value) { store[key] = String(value); },
    },
    document: options.document ?? makeDocument(),
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('i18n.js'), sandbox, { filename: 'i18n.js' });
  vm.runInContext(read('i18n-en.js'), sandbox, { filename: 'i18n-en.js' });
  vm.runInContext(read('i18n-zh-CN.js'), sandbox, { filename: 'i18n-zh-CN.js' });
  return { sandbox, store };
}

/* ── the dictionaries ────────────────────────────────────────────────────── */

/* The enum families are keyed by their id ("fit.contain"), so the English
 * dictionary carries a readable label for them instead of repeating the id.
 * Every other key is the English source phrase itself. */
const ENUM_FAMILIES = [
  'kf.', 'fx.', 'anim.', 'delivery.', 'fit.', 'blend.', 'preset.', 'align.',
  'vAlign.', 'direction.', 'channel.', 'denoise.', 'matte.', 'kind.', 'shape.',
  'transition.', 'textAnim.',
];

/**
 * The HTML entities a browser decodes in an attribute value. A key written in
 * the markup as "a &amp; b" reaches the DOM as "a & b", so both sides of a
 * comparison have to be decoded.
 * @param {string} s
 * @returns {string}
 */
function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

test('the two dictionaries have exactly the same keys', () => {
  const { sandbox } = loadRuntime();
  const en = Object.keys(sandbox.I18n.dictionary('en')).sort();
  const zh = Object.keys(sandbox.I18n.dictionary('zh-CN')).sort();
  assert.deepEqual(en, zh);
  assert.ok(en.length > 500, `expected a substantial dictionary, got ${en.length}`);
});

test('the English dictionary repeats the source phrase, and the enum families a readable label', () => {
  const { sandbox } = loadRuntime();
  const en = sandbox.I18n.dictionary('en');
  for (const [key, value] of Object.entries(en)) {
    assert.equal(typeof value, 'string', `en value for ${key}`);
    assert.ok(value.length > 0, `empty English value for ${key}`);
    const family = ENUM_FAMILIES.find((f) => key.startsWith(f));
    if (!family) {
      assert.equal(value, key, `the English dictionary repeats its key: ${key}`);
      continue;
    }
    assert.notEqual(value, key, `the English family label repeats its id: ${key}`);
    assert.ok(!value.startsWith(family), `the English family label keeps the id: ${key}`);
  }
  const zh = sandbox.I18n.dictionary('zh-CN');
  for (const [key, value] of Object.entries(zh)) {
    assert.equal(typeof value, 'string', `zh value for ${key}`);
    assert.ok(value.length > 0, `empty translation for ${key}`);
  }
});

test('the enum families are translated in Chinese too', () => {
  const { sandbox } = loadRuntime();
  const zh = sandbox.I18n.dictionary('zh-CN');
  for (const family of ENUM_FAMILIES) {
    const keys = Object.keys(zh).filter((k) => k.startsWith(family));
    assert.ok(keys.length > 0, `no keys for the family ${family}`);
    for (const key of keys) {
      assert.notEqual(zh[key], key, `the Chinese family label repeats its id: ${key}`);
    }
  }
});

test('the Chinese dictionary really is translated', () => {
  const { sandbox } = loadRuntime();
  const zh = sandbox.I18n.dictionary('zh-CN');
  const same = Object.keys(zh).filter((key) => zh[key] === key);
  // A handful of labels are proper nouns or symbols and stay as they are.
  assert.ok(same.length < Object.keys(zh).length * 0.05,
    `too many untranslated entries: ${same.length}`);
});

/* ── the runtime ─────────────────────────────────────────────────────────── */

test('a string that is not a dictionary key comes back unchanged', () => {
  const { sandbox } = loadRuntime({ languages: ['zh-CN'] });
  sandbox.I18n.setLocale('zh-CN');
  // A name, a caption or a path that reaches the translator by accident keeps
  // its bytes: the lookup finds nothing and hands the text straight back.
  for (const value of ['我的项目 2026', 'Ava Moreno', "Bob's <clip>", 'reel_9x16.mp4', 'C:\\Users\\me\\clip.mov']) {
    assert.equal(sandbox.I18n.t(value), value);
  }
});

test('a known key is translated, and the fallback is English', () => {
  const { sandbox } = loadRuntime({ languages: ['zh-CN'] });
  sandbox.I18n.setLocale('zh-CN');
  const zh = sandbox.I18n.t('Settings');
  assert.notEqual(zh, 'Settings');
  assert.ok(/[一-鿿]/.test(zh), `expected Chinese text, got ${zh}`);
  sandbox.I18n.setLocale('en');
  assert.equal(sandbox.I18n.t('Settings'), 'Settings');
});

test('a key only the English dictionary knows falls back to English', () => {
  const { sandbox } = loadRuntime();
  sandbox.I18n.register('en', { ...sandbox.I18n.dictionary('en'), 'Only in English': 'Only in English' });
  sandbox.I18n.setLocale('zh-CN');
  assert.equal(sandbox.I18n.t('Only in English'), 'Only in English');
});

test('placeholders are filled in, and a missing one is left alone', () => {
  const { sandbox } = loadRuntime();
  sandbox.I18n.setLocale('en');
  assert.equal(sandbox.I18n.t('Tags for {name}', { name: 'clip.mp4' }), 'Tags for clip.mp4');
  assert.equal(sandbox.I18n.t('Tags for {name}'), 'Tags for {name}');
  assert.equal(sandbox.I18n.t('Tags for {name}', {}), 'Tags for {name}');
});

test('esc() escapes the five characters that matter in markup', () => {
  const { sandbox } = loadRuntime();
  assert.equal(sandbox.I18n.esc('<a href="x">&\'</a>'),
    '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(sandbox.I18n.esc(null), '');
});

test('a Chinese browser starts in Chinese and everything else in English', () => {
  for (const tag of ['zh', 'zh-CN', 'zh-Hans-CN', 'zh-TW']) {
    const { sandbox } = loadRuntime({ languages: [tag] });
    assert.equal(sandbox.I18n.getLocale(), 'zh-CN', `${tag} should map to zh-CN`);
  }
  for (const tag of ['en', 'en-GB', 'de', 'fr-FR', 'ja']) {
    const { sandbox } = loadRuntime({ languages: [tag] });
    assert.equal(sandbox.I18n.getLocale(), 'en', `${tag} should map to en`);
  }
});

test('the chosen language is remembered in this browser only', () => {
  const { sandbox, store } = loadRuntime();
  sandbox.I18n.setLocale('zh-CN');
  assert.equal(store['fablecut-locale'], 'zh-CN');
  assert.deepEqual(Object.keys(store), ['fablecut-locale']);
});

test('a remembered language wins over the browser language', () => {
  const { sandbox } = loadRuntime({ languages: ['en-US'], stored: 'zh-CN' });
  assert.equal(sandbox.I18n.getLocale(), 'zh-CN');
});

test('switching the language notifies the listeners', () => {
  const { sandbox } = loadRuntime();
  /** @type {string[]} */
  const seen = [];
  sandbox.I18n.onChange((locale) => seen.push(locale));
  sandbox.I18n.setLocale('zh-CN');
  sandbox.I18n.setLocale('zh-CN');   // the same language again: no event
  sandbox.I18n.setLocale('en');
  assert.deepEqual(seen, ['zh-CN', 'en']);
});

test('the document carries the language and the translated title', () => {
  const document = makeDocument();
  document.title = 'Cutline - Video Editor';
  const { sandbox } = loadRuntime({ document });
  sandbox.I18n.setLocale('zh-CN');
  assert.equal(document.documentElement.getAttribute('lang'), 'zh-CN');
  assert.notEqual(document.title, '');
  assert.notEqual(document.title, 'Cutline - Video Editor');
  sandbox.I18n.setLocale('en');
  assert.equal(document.documentElement.getAttribute('lang'), 'en');
  assert.equal(document.title, 'Cutline - Video Editor');
});

test('the static pass writes text and attributes, never markup', () => {
  const document = makeDocument({ a: 'Settings' });
  const { sandbox } = loadRuntime({ document });
  sandbox.I18n.setLocale('zh-CN');
  const el = document.querySelector('#a');
  assert.notEqual(el.textContent, 'Settings');
  assert.equal(el.innerHTML, '', 'data-i18n must not write markup');
  assert.equal(el.getAttribute('data-i18n'), 'Settings', 'the key itself is kept');
});

test('the static pass fills the title, aria-label and placeholder attributes', () => {
  const body = makeElement('body');
  const el = makeElement('input', { 'data-i18n-title': 'Settings', 'data-i18n-aria-label': 'Settings', 'data-i18n-placeholder': 'Settings' });
  body.children.push(el);
  const root = makeElement('html');
  root.children.push(body);
  const document = {
    readyState: 'complete',
    documentElement: root,
    title: '',
    addEventListener() { },
    querySelectorAll: (selector) => collect(root, selector),
    querySelector: (selector) => collect(root, selector)[0] ?? null,
  };
  const { sandbox } = loadRuntime({ document });
  sandbox.I18n.setLocale('zh-CN');
  const translated = sandbox.I18n.t('Settings');
  assert.equal(el.getAttribute('title'), translated);
  assert.equal(el.getAttribute('aria-label'), translated);
  assert.equal(el.getAttribute('placeholder'), translated);
});

/* ── the client payload ──────────────────────────────────────────────────── */

test('the editor loads the localization runtime before every other script', () => {
  const html = read('index.html');
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.includes('i18n.js'), 'i18n.js is not loaded');
  assert.ok(scripts.includes('i18n-en.js'), 'i18n-en.js is not loaded');
  assert.ok(scripts.includes('i18n-zh-CN.js'), 'i18n-zh-CN.js is not loaded');
  const runtimeAt = scripts.indexOf('i18n.js');
  const appAt = scripts.indexOf('app.js');
  assert.ok(runtimeAt < appAt, 'the runtime has to load before app.js');
  for (const file of scripts) {
    if (file.startsWith('i18n')) continue;
    assert.ok(scripts.indexOf(file) > runtimeAt, `${file} loads before the runtime`);
  }
});

test('the settings dialog offers both languages', () => {
  const html = read('index.html');
  assert.match(html, /<select id="setLang"/, 'no language selector');
  assert.match(html, /<option value="zh-CN">中文<\/option>/);
  assert.match(html, /<option value="en">English<\/option>/);
});

test('every data-i18n key in the markup exists in the dictionary', () => {
  const { sandbox } = loadRuntime();
  const known = new Set(Object.keys(sandbox.I18n.dictionary('en')));
  const html = read('index.html');
  const keys = [...html.matchAll(/data-i18n(?:-title|-aria-label|-placeholder)?="((?:[^"\\]|\\.)*)"/g)]
    .map((m) => decodeEntities(JSON.parse(`"${m[1]}"`)));
  assert.ok(keys.length > 100, `expected many marked elements, got ${keys.length}`);
  const missing = [...new Set(keys)].filter((key) => !known.has(key));
  assert.deepEqual(missing, [], `markup keys missing from the dictionary: ${missing.join(', ')}`);
});

test('every T() key the editor uses exists in the dictionary', () => {
  const { sandbox } = loadRuntime();
  const known = new Set(Object.keys(sandbox.I18n.dictionary('en')));
  /** @type {string[]} */
  const missing = [];
  for (const file of ['app.js', 'audio-fx.js', 'color.js', 'delivery.js', 'templates.js']) {
    const src = read(file);
    for (const m of src.matchAll(/\bT\(\s*"((?:[^"\\]|\\.)*)"/g)) {
      const key = decodeEntities(JSON.parse(`"${m[1]}"`));
      // A key that ends in a dot is a group prefix ("kf." + channel).
      if (key.endsWith(".")) {
        const group = [...known].some((k) => k.startsWith(key));
        if (!group) missing.push(`${file}: ${key}*`);
        continue;
      }
      if (!known.has(key)) missing.push(`${file}: ${key}`);
    }
  }
  assert.deepEqual(missing, [], `keys missing from the dictionary: ${missing.join(', ')}`);
});

test('the grouped label families are all in the dictionary', () => {
  const { sandbox } = loadRuntime();
  const known = new Set(Object.keys(sandbox.I18n.dictionary('en')));
  for (const group of ['kf.', 'fx.', 'anim.', 'delivery.', 'fit.', 'blend.', 'preset.', 'align.',
    'vAlign.', 'direction.', 'channel.', 'denoise.', 'matte.', 'kind.', 'shape.', 'transition.', 'textAnim.']) {
    assert.ok([...known].some((key) => key.startsWith(group)), `no keys for the group ${group}`);
  }
});

test('the timeline toolbar labels are marked for translation', () => {
  const html = read('index.html');
  // These three buttons carry their label as bare text, so they stayed English
  // until the label was wrapped in a marked span.
  for (const [id, label] of [['btnCloseGap', 'Close gap'], ['btnNextGap', 'Find gap'], ['btnRippleDelete', 'Ripple delete']]) {
    const button = new RegExp(`<button[^>]*id="${id}"[^>]*>([\\s\\S]*?)</button>`).exec(html);
    assert.ok(button, `${id} is missing`);
    assert.match(button[1], new RegExp(`<span data-i18n="${label}">`), `${id} has no marked label`);
  }
  const { sandbox } = loadRuntime({ languages: ['zh-CN'] });
  sandbox.I18n.setLocale('zh-CN');
  for (const label of ['Close gap', 'Find gap', 'Ripple delete']) {
    assert.notEqual(sandbox.I18n.t(label), label, `${label} is not translated`);
  }
});

test('the export dialog says everything in the chosen language', () => {
  const { sandbox } = loadRuntime();
  const known = new Set(Object.keys(sandbox.I18n.dictionary('en')));
  // The strings the export dialog builds at runtime.
  for (const key of [
    'Exports the {w}×{h} delivery frame (cropped). Keeps rendering if you switch tabs.',
    'Frame-accurate. Server encodes from JPEG frames. Keeps going if you switch tabs.',
    'Frame-accurate. Browser HW-encodes H.264; server muxes with audio. Faster upload than Fast.',
    'Needs the server + ffmpeg on PATH to export a cropped delivery frame.',
    'Needs the server + ffmpeg on PATH.',
    'Unavailable while an export frame is set — use Fast export.',
    'Unavailable while an export frame is set. Install ffmpeg, or clear the export frame to use Realtime.',
    'WebCodecs (HW encode)',
    'Realtime (in-browser)',
    'Track {list} is disabled and will be omitted from the export.',
    'Tracks {list} are disabled and will be omitted from the export.',
    'Full timeline · {from} → {to}',
    'IN–OUT · {from} → {to}',
    'IN to end · {from} → {to}',
    'Start to OUT · {from} → {to}',
  ]) {
    assert.ok(known.has(key), `the export dialog string is missing from the dictionary: ${key}`);
  }
  sandbox.I18n.setLocale('zh-CN');
  const zh = sandbox.I18n.dictionary('zh-CN');
  for (const key of known) {
    if (!/^(Exports the|Frame-accurate|Needs the server|Unavailable while|Track |Tracks |Full timeline|IN–OUT ·|IN to end|Start to OUT|Realtime \(|WebCodecs \()/.test(key)) continue;
    assert.notEqual(zh[key], key, `the export dialog string is not translated: ${key}`);
  }
  // The track ids are values, not words: they are interpolated, never translated.
  const { sandbox: s2 } = loadRuntime({ languages: ['zh-CN'] });
  s2.I18n.setLocale('zh-CN');
  const warning = s2.I18n.t('Track {list} is disabled and will be omitted from the export.', { list: 'V1, V2' });
  assert.ok(warning.includes('V1, V2'), `the track ids were lost: ${warning}`);
});

test('the export dialog notes keep their translation markup', () => {
  const src = read('app.js');
  // Replacing the note element's whole content would drop the marked holder
  // inside it, and no later pass could translate it again.
  assert.match(src, /function setNoteText\(el, text\)[\s\S]*?el\.querySelector\("\[data-i18n\]"\) \|\| el;/,
    'the note helper does not write into the marked holder');
  assert.match(src, /setNoteText\(fastNote,/, 'the fast-engine note is written the wrong way');
  assert.match(src, /setNoteText\(wcNote,/, 'the realtime-engine note is written the wrong way');
  assert.match(src, /setNoteText\(radio,/, 'the realtime radio label is written the wrong way');
  assert.doesNotMatch(src, /\$\("engineFastNote"\)\.textContent\s*=/,
    'the fast-engine note replaces the element content');
  assert.doesNotMatch(src, /\$\("engineWebCodecsNote"\)\.textContent\s*=/,
    'the realtime-engine note replaces the element content');
  // The radio is relabelled at runtime; its marked holder has to survive too.
  assert.doesNotMatch(src, /label\.textContent\s*=\s*wcOk/,
    'the radio label replaces the element content');
});

test('the export button opens the dialog without a native alert', () => {
  const src = read('app.js');
  // A Host webview may swallow a native modal, and then the click looks like
  // it did nothing at all.
  assert.match(src, /if \(!project\.clips\.length\) \{ toast\(T\("Timeline is empty — add some clips first\."\)\); return; \}/,
    'the empty-timeline gate does not use the in-app toast');
  assert.doesNotMatch(src, /alert\(T\("Timeline is empty/,
    'the empty-timeline gate still uses a native alert');
  // The dialog has to open straight away: the engine detection and the
  // profile list take a moment.
  const open = src.indexOf('async function openExportSetup()');
  assert.ok(open > 0, 'openExportSetup() is missing');
  const body = src.slice(open, open + 2000);
  const shown = body.indexOf('els.exportSetup.classList.remove("hidden")');
  const waited = body.indexOf('await detectWebCodecs()');
  assert.ok(shown > 0 && waited > 0, 'the export dialog is not shown');
  assert.ok(shown < waited, 'the export dialog waits for the engine detection before it opens');
});

test('a language switch redraws the header, the export frame list and the batch list', () => {
  const src = read('app.js');
  const repaint = /function repaintForLocale\(\) \{([\s\S]*?)\n\}/.exec(src);
  assert.ok(repaint, 'repaintForLocale() is missing');
  assert.match(repaint[1], /syncProjectNameStatus\(\);/, 'the header is not redrawn');
  assert.match(repaint[1], /syncExportFrameSel\(\);/, 'the export frame list is not redrawn');
  // The batch list and the timeline are drawn by the editor itself, so they
  // carry wording the editor writes: the counter, the "Export checked" button
  // and the transition tooltips all have to be drawn again.
  assert.match(repaint[1], /renderBatchList\(\);/, 'the export batch list is not redrawn');
  assert.match(repaint[1], /rebuildClips\(\);/, 'the timeline is not redrawn');
  // The project name is the user's own text: only the state word is translated.
  assert.match(src, /function syncProjectNameStatus\(\)[\s\S]*?els\.projectName\.textContent = project\.name \+ \(state\.connected/,
    'the header helper does not keep the project name');
  // The redraw is a redraw: it never touches the project.
  assert.doesNotMatch(repaint[1], /scheduleSave\(/, 'a language switch schedules a save');
  assert.doesNotMatch(repaint[1], /pushUndo\(/, 'a language switch pushes an undo step');
  assert.doesNotMatch(repaint[1], /setProjectOutputs\(/, 'a language switch rewrites the batch outputs');
  assert.doesNotMatch(repaint[1], /project\.[A-Za-z_$][\w$]*\s*=[^=]/, 'a language switch changes the project');
});

test('the editor never runs a blanket text replacement', () => {
  const src = read('app.js');
  assert.doesNotMatch(src, /MutationObserver/, 'a MutationObserver would rewrite the whole page');
  assert.doesNotMatch(src, /\bTreeWalker\b/, 'a tree walker would rewrite the whole page');
  assert.doesNotMatch(src, /document\.body\.innerText\s*=/, 'a bulk text replacement would rewrite user text');
});

test('the language switch never schedules a save', () => {
  const src = read('app.js');
  assert.match(src, /function scheduleSave\(\)\s*\{\s*if \(localeRepainting\) return;/,
    'scheduleSave() has to ignore a language switch');
  assert.match(src, /function repaintForLocale\(\)/, 'no repaint function');
  assert.match(src, /localeRepainting = true;/, 'the repaint is not guarded');
  // The caret and whatever the user was typing survive the redraw.
  assert.match(src, /function repaintForLocale\(\) \{[\s\S]{0,200}?captureEditorFocus\(\)/,
    'the redraw does not capture the focus');
  assert.match(src, /function repaintForLocale\(\) \{[\s\S]*?restoreEditorFocus\(focus\)/,
    'the redraw does not put the focus back');
});

test('user text is never passed through the translator', () => {
  const src = read('app.js');
  // The editor's own names must not be translated: they are what the user typed.
  assert.ok(src.includes('"Untitled Project"'), 'the default project name is missing');
  const sequences = fs.readFileSync(path.join(PACKAGE_ROOT, 'miniapp', 'node', 'vendor', 'fablecut', 'sequences.js'), 'utf8');
  assert.ok(sequences.includes('"Main"'), 'the default sequence name is missing');
  // A name that reaches the screen is escaped, not translated.
  for (const pattern of [
    /escapeHtml\(p\.name\)/,        // a project name
    /escapeHtml\(c\.name \|\| ""\)/, // a clip name
    /escapeHtml\(m\.name\)/,        // a media name
    /escapeHtml\(comp\.name\)/,     // a composition name
  ]) {
    assert.ok(pattern.test(src), `${pattern} is missing: a name has to be escaped, not translated`);
  }
  // The translator is exact: a key that is in the dictionary is translated
  // wherever it is used as interface text. That is exactly why the editor must
  // never hand user text to it — a project called "Settings" has to stay
  // "Settings" in every language.
  const { sandbox } = loadRuntime({ languages: ['zh-CN'] });
  sandbox.I18n.setLocale('zh-CN');
  for (const word of ['Settings', 'Export', 'Color']) {
    assert.notEqual(sandbox.I18n.t(word), word, `${word} should read as an interface word`);
  }
  // The only places a name reaches the translator are the two helpers that
  // first check the name belongs to a template or an animation preset of ours.
  const names = [...src.matchAll(/\bT\(\s*([A-Za-z_$][\w$]*\.name)\s*\)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(names)].sort(), ['p.name', 't.name'],
    'a name reached the translator from somewhere else');
  assert.match(src, /function templateLabel\(t\) \{\s*return isBuiltInTemplate\(t\) \? T\(t\.name\) : String\(t\?\.name \?\? ""\);/,
    'the template name helper is not gated on the built-in templates');
  assert.match(src, /function animPresetLabel\(p\) \{\s*return isBuiltInAnimPreset\(p\) \? T\(p\.name\) : String\(p\?\.name \?\? ""\);/,
    'the animation preset name helper is not gated on the built-in presets');
  // No caption, note, title or value is ever handed to the translator.
  for (const m of src.matchAll(/\bT\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\)/g)) {
    assert.doesNotMatch(m[1], /\.(?:text|notes|caption|title|value)$/,
      `T() was given user text: ${m[1]}`);
  }
});

/* ── the bare dictionary keys ─────────────────────────────────────────────── */

/* The dictionary holds the interface's own words, so a message that shows one
 * of them has to go through the translator — otherwise the editor keeps saying
 * it in English while the rest of the page is in Chinese.
 *
 * A raw value is a different thing: an enum id, a file kind, the server's own
 * error text. Those are values, not words, and they stay exactly as they are.
 */
const RAW_VALUES = new Set([
  'an unsupported',   // the file kind inside a translated sentence
  'unknown error',    // the server's own fallback message
]);

/**
 * The string literals of a piece of source, with the offset of each.
 * @param {string} src
 * @returns {{value: string, start: number}[]}
 */
function stringLiterals(src) {
  /** @type {{value: string, start: number}[]} */
  const out = [];
  for (const m of src.matchAll(/"(?:[^"\\]|\\.)*"/g)) {
    out.push({ value: JSON.parse(m[0]), start: m.index });
  }
  return out;
}

/**
 * The calls of one function, with the text of each argument list.
 * @param {string} src
 * @param {string} name
 * @returns {{text: string, start: number}[]}
 */
function callsOf(src, name) {
  /** @type {{text: string, start: number}[]} */
  const out = [];
  const re = new RegExp(`(?<![\\w.$])${name}\\s*\\(`, 'g');
  for (const m of src.matchAll(re)) {
    const open = m.index + m[0].length - 1;
    let depth = 1;
    let i = open + 1;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '(') depth += 1;
      else if (c === ')') depth -= 1;
      i += 1;
    }
    out.push({ text: src.slice(open + 1, i - 1), start: open + 1 });
  }
  return out;
}

/**
 * Is the literal at `offset` an argument of a T() call?
 *
 * The innermost open paren decides: a T( that is still open when the literal
 * starts means the literal is one of its arguments.
 *
 * @param {string} src
 * @param {number} offset
 * @returns {boolean}
 */
function insideTranslator(src, offset) {
  let depth = 0;
  for (let i = offset - 1; i >= 0; i -= 1) {
    const c = src[i];
    if (c === ')') depth += 1;
    else if (c === '(') {
      if (depth > 0) { depth -= 1; continue; }
      return /(^|[^\w.$])T$/.test(src.slice(0, i));
    }
  }
  return false;
}

test('every toast that shows a dictionary key goes through the translator', () => {
  const { sandbox } = loadRuntime();
  const known = new Set(Object.keys(sandbox.I18n.dictionary('en')));
  const src = read('app.js');
  /** @type {string[]} */
  const bare = [];
  for (const call of callsOf(src, 'toast')) {
    for (const lit of stringLiterals(call.text)) {
      if (!known.has(lit.value)) continue;
      if (RAW_VALUES.has(lit.value)) continue;
      if (insideTranslator(src, call.start + lit.start)) continue;
      const line = src.slice(0, call.start + lit.start).split('\n').length;
      bare.push(`${lit.value} (line ${line})`);
    }
  }
  assert.deepEqual(bare, [], `dictionary keys shown without the translator: ${bare.join(', ')}`);
});

test('the label of an inline prompt goes through the translator', () => {
  const src = read('app.js');
  /** @type {string[]} */
  const bare = [];
  for (const call of callsOf(src, 'promptBinText')) {
    const lits = stringLiterals(call.text);
    if (!lits.length) continue;   // the function's own signature
    const first = lits[0];
    if (insideTranslator(src, call.start + first.start)) continue;
    bare.push(`${first.value} (line ${src.slice(0, call.start + first.start).split('\n').length})`);
  }
  assert.deepEqual(bare, [], `prompt labels shown without the translator: ${bare.join(', ')}`);
});

test('the export batch counter is a dictionary entry with placeholders', () => {
  const { sandbox } = loadRuntime();
  const key = '· {on} of {n} checked';
  assert.ok(Object.keys(sandbox.I18n.dictionary('en')).includes(key),
    'the batch counter is not a dictionary key');
  sandbox.I18n.setLocale('zh-CN');
  const zh = sandbox.I18n.t(key, { on: 2, n: 5 });
  assert.notEqual(zh, key, 'the batch counter is not translated');
  assert.ok(/[一-鿿]/.test(zh), `the batch counter should be Chinese: ${zh}`);
  assert.ok(zh.includes('2') && zh.includes('5'), `the batch counter lost its numbers: ${zh}`);
  // And the editor asks for it by that key.
  const src = read('app.js');
  assert.match(src, /T\("· \{on\} of \{n\} checked", \{ on, n: list\.length \}\)/,
    'the batch counter is not translated at runtime');
});

test('a template group the user typed is not translated', () => {
  const src = read('app.js');
  // A saved template carries the group the user chose, so only the built-in
  // group names are translated.
  assert.match(src, /const BUILTIN_TEMPLATE_GROUPS = new Set\(/,
    'the built-in template groups are not listed');
  assert.match(src, /BUILTIN_TEMPLATE_GROUPS\.has\(group\) \? T\(group\) : group/,
    'a template group is translated without checking that it is one of ours');
});

test('the enum selects keep their raw values and only translate their labels', () => {
  const src = read('app.js');
  // The transition and the text-animation selects carry the id in the value
  // attribute: the browser must never use the translated text as the value,
  // or the saved project would store the label instead of the id.
  assert.match(src, /<option value="\$\{x\}"[^>]*>\$\{enumLabel\("transition", x\)\}<\/option>/,
    'the transition select does not carry the raw id');
  assert.match(src, /<option value="\$\{a\}"[^>]*>\$\{enumLabel\("textAnim", a\)\}<\/option>/,
    'the text-animation select does not carry the raw id');
  // And the same holds for every other select whose label is translated.
  for (const m of src.matchAll(/<option([^>]*)>([\s\S]*?)<\/option>/g)) {
    const [, attrs, label] = m;
    if (!label.includes('enumLabel(')) continue;
    assert.match(attrs, /\bvalue="/, `an option with a translated label has no value: ${attrs}`);
  }
});

test('the dictionary holds no user content', () => {
  const { sandbox } = loadRuntime();
  const zh = sandbox.I18n.dictionary('zh-CN');
  for (const guard of [
    'Untitled Project', 'Main', 'Ava Moreno', 'AVA MORENO', 'Big news is here',
    'Thanks for watching', 'Made with care', 'Read more', 'YOUR BRAND',
    'Director of Photography', 'The best way to predict the future is to make it.',
  ]) {
    assert.equal(zh[guard], undefined, `${guard} must not be a dictionary key`);
  }
});

test('the standalone export path is untouched', () => {
  const src = read('app.js');
  for (const name of ['ensureFont', 'fastExport', 'runExportJob', 'runExportJobFromUrl']) {
    assert.ok(new RegExp(`function ${name}\\b`).test(src), `${name}() is missing`);
  }
  const html = read('index.html');
  for (const id of ['exportOverlay', 'exportProgress', 'exportTitle', 'exportNote']) {
    assert.ok(html.includes(`id="${id}"`), `the export dialog lost #${id}`);
  }
});

test('the export draws its text from the project, not from the interface language', () => {
  const src = read('app.js');
  // The text that ends up in the picture comes from the clip's own props.
  assert.match(src, /props\.text/, 'the exported text does not come from the clip props');
  assert.doesNotMatch(src, /T\(\s*props\.text/, 'the exported text was passed through T()');
});
