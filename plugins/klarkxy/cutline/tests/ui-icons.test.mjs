// @ts-check
// A regression test for the icon-first toolbar.
//
// The editor shows an icon where it used to show a word: the media actions,
// the split / delete / snap / zoom-fit / markers / audio-hold buttons and the
// three gap buttons. A button that shows only an icon still has to carry its
// name, so this test checks that
//
//   - every icon button names itself, in the chosen language,
//   - the wording stays in the markup (hidden, not deleted), so it is still
//     translated and still read out,
//   - the icon is big enough to hit and nothing overflows at any window size,
//   - the buttons still do their job (the raw ids and the listeners are
//     untouched), and
//   - the fields, the tabs and the destructive wording keep their labels.
//
// The browser part skips itself when the machine has no Chromium-based
// browser, so `npm test` stays green on a machine without one.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = path.join(PACKAGE_ROOT, 'miniapp', 'client');
const require = createRequire(import.meta.url);

const read = (/** @type {string} */ name) => fs.readFileSync(path.join(CLIENT, name), 'utf8');

/* The scratch files of this test live in their own folder, so they never mix
   with the other tests' artifacts. */
const SCRATCH_ROOT = path.resolve(PACKAGE_ROOT, '../../../.fablecut-acceptance/ui-icons');
fs.mkdirSync(SCRATCH_ROOT, { recursive: true });
process.env.FABLECUT_TEST_ROOT = path.join(SCRATCH_ROOT, 'test-runs');
process.env.FABLECUT_DATA_DIR = path.join(SCRATCH_ROOT, 'vendor-data');
fs.mkdirSync(process.env.FABLECUT_DATA_DIR, { recursive: true });

const { startApp } = await import('./helpers.mjs');

/* ── the buttons that show an icon ───────────────────────────────────────── */

/**
 * Every icon button, with the name it has to announce and the wording it
 * keeps in the markup.
 * @type {{id: string, name: string, label: string}[]}
 */
const ICON_BUTTONS = [
  { id: 'btnTitle', name: 'Title', label: 'Title' },
  { id: 'btnAdjust', name: 'Adjust', label: 'Adjust' },
  { id: 'btnImport', name: 'Import', label: 'Import' },
  { id: 'btnImportUrl', name: 'Import from URL', label: 'Import from URL' },
  { id: 'btnSplit', name: 'Split', label: 'Split' },
  { id: 'btnDelete', name: 'Delete', label: 'Delete' },
  { id: 'btnSnap', name: 'Toggle snapping', label: 'Snap' },
  { id: 'btnZoomFit', name: 'Zoom timeline to fit', label: 'Fit' },
  { id: 'btnCloseGap', name: 'Close gap', label: 'Close gap' },
  { id: 'btnNextGap', name: 'Find gap', label: 'Find gap' },
  { id: 'btnRippleDelete', name: 'Ripple delete', label: 'Ripple delete' },
  { id: 'btnMarkers', name: 'Markers', label: 'Markers' },
  { id: 'btnAudioHold', name: 'Audio hold', label: 'Audio hold' },
];

/**
 * The markup of one element, found by its id.
 * @param {string} html
 * @param {string} id
 * @returns {string|null}
 */
function elementMarkup(html, id) {
  const open = new RegExp(`<(button|label)[^>]*\\bid="${id}"[^>]*>`).exec(html);
  if (!open) return null;
  const tag = open[1];
  const end = html.indexOf(`</${tag}>`, open.index + open[0].length);
  if (end < 0) return null;
  return html.slice(open.index, end + tag.length + 3);
}

/**
 * The inline icon of one element.
 * @param {string} markup
 * @returns {string|null}
 */
function iconMarkup(markup) {
  const svg = /<svg[\s\S]*?<\/svg>/.exec(markup);
  return svg ? svg[0] : null;
}

/* ── the dictionaries, without a browser ─────────────────────────────────── */

/**
 * Load the localization runtime with a DOM stub, the way tests/i18n.test.mjs
 * does, and hand back the two dictionaries.
 */
function loadDictionaries() {
  /** @type {Record<string, string>} */
  const store = {};
  const sandbox = {
    console,
    navigator: { languages: ['en-US'], language: 'en-US' },
    localStorage: {
      /** @param {string} key */
      getItem(key) { return key in store ? store[key] : null; },
      /** @param {string} key @param {string} value */
      setItem(key, value) { store[key] = String(value); },
    },
    document: {
      readyState: 'complete',
      documentElement: { setAttribute() { } },
      title: '',
      addEventListener() { },
      querySelectorAll() { return []; },
      querySelector() { return null; },
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const file of ['i18n.js', 'i18n-en.js', 'i18n-zh-CN.js']) {
    vm.runInContext(read(file), sandbox, { filename: file });
  }
  return {
    en: /** @type {Record<string, string>} */ (sandbox.I18n.dictionary('en')),
    zh: /** @type {Record<string, string>} */ (sandbox.I18n.dictionary('zh-CN')),
  };
}

/* ── the static checks ───────────────────────────────────────────────────── */

test('every icon button names itself and keeps its wording in the markup', () => {
  const html = read('index.html');
  for (const button of ICON_BUTTONS) {
    const markup = elementMarkup(html, button.id);
    assert.ok(markup, `${button.id} is missing`);
    assert.match(markup, /\bicon-only\b/, `${button.id} is not an icon button`);
    assert.match(markup, new RegExp(`aria-label="${button.name}"`), `${button.id} has no aria-label`);
    assert.match(markup, new RegExp(`data-i18n-aria-label="${button.name}"`), `${button.id} has no marked aria-label`);
    assert.match(markup, /\btitle="/, `${button.id} has no title`);
    assert.match(markup, /\bdata-i18n-title="/, `${button.id} has no marked title`);
    /* The wording stays: it is hidden by the stylesheet, not deleted, so it is
       still translated and still read out. */
    assert.match(markup, new RegExp(`<span data-i18n="${button.label}">`), `${button.id} lost its wording`);
    const icon = iconMarkup(markup);
    assert.ok(icon, `${button.id} has no icon`);
    assert.match(icon, /aria-hidden="true"/, `${button.id} does not hide its icon from the screen reader`);
  }
});

test('the stylesheet hides the wording of an icon button the sr-only way', () => {
  const css = read('style.css');
  const start = css.indexOf('.sr-only');
  assert.ok(start >= 0, 'the sr-only rule is gone');
  const block = css.slice(start, css.indexOf('}', start));
  assert.match(block, /\.btn\.icon-only > span\[data-i18n\]/,
    'the wording of an icon button is not hidden with the sr-only rule');
  for (const declaration of ['position: absolute', 'width: 1px', 'height: 1px', 'overflow: hidden', 'clip:']) {
    assert.ok(block.includes(declaration), `the sr-only rule lost ${declaration}`);
  }
  /* A button that shows only an icon still has to be easy to hit, and the
     keyboard has to see where it is. */
  const iconRule = /\.btn\.icon-only\s*\{([^}]*)\}/.exec(css);
  assert.ok(iconRule, 'the icon button rule is gone');
  assert.match(iconRule[1], /min-width:\s*32px/, 'an icon button may be narrower than 32px');
  assert.match(iconRule[1], /min-height:\s*32px/, 'an icon button may be shorter than 32px');
  assert.match(css, /\.btn:focus-visible/, 'the keyboard cannot see where it is');
});

test('the three gap buttons have three different symbols', () => {
  const html = read('index.html');
  const icons = new Map();
  for (const id of ['btnCloseGap', 'btnNextGap', 'btnRippleDelete']) {
    const markup = elementMarkup(html, id);
    assert.ok(markup, `${id} is missing`);
    const icon = iconMarkup(markup);
    assert.ok(icon, `${id} has no icon`);
    icons.set(id, icon);
  }
  assert.equal(new Set(icons.values()).size, 3, 'two of the gap buttons share an icon');
});

test('the names of the icon buttons are translated', () => {
  const { en, zh } = loadDictionaries();
  for (const button of ICON_BUTTONS) {
    assert.ok(en[button.name], `the dictionary does not know ${button.name}`);
    assert.ok(zh[button.name], `the Chinese dictionary does not know ${button.name}`);
    assert.notEqual(zh[button.name], button.name, `${button.name} is not translated`);
  }
});

test('the import control keeps its keyboard semantics', () => {
  const html = read('index.html');
  const label = elementMarkup(html, 'btnImport');
  assert.ok(label, 'the import control is missing');
  assert.match(label, /\bfor="fileInput"/, 'the import control no longer points at the file input');
  /* The input sits inside the label, so the keyboard can reach it and the
     label can show where the focus is. */
  assert.match(label, /<input type="file" id="fileInput"/, 'the file input left the import control');
  assert.match(label, /\bmultiple\b/, 'the file input lost multiple selection');
  assert.match(label, /accept="video\/\*/, 'the file input lost its accept list');
  /* Only one file input drives the import. */
  assert.equal((html.match(/id="fileInput"/g) ?? []).length, 1, 'there is more than one file input');
});

test('the empty states say one short thing', () => {
  const html = read('index.html');
  const bin = /<div class="bin-empty" id="binEmpty">([\s\S]*?)<\/div>\s*<\/div>/.exec(html);
  assert.ok(bin, 'the media bin empty state is missing');
  assert.doesNotMatch(bin[1], /<ol/, 'the numbered instructions are still there');
  assert.match(bin[1], /data-i18n="Drop media here"/, 'the bin does not say where to drop media');
  const inspector = /<div class="inspector-empty">([\s\S]*?)<\/div>/.exec(html);
  assert.ok(inspector, 'the inspector empty state is missing');
  assert.match(inspector[1], /data-i18n="Select a clip"/, 'the inspector does not ask for a clip');
  assert.doesNotMatch(inspector[1], /transform, effects/, 'the inspector still explains itself');
});

test('the destructive buttons still tell each other apart', () => {
  const html = read('index.html');
  const destructive = ['btnDelete', 'btnCloseGap', 'btnRippleDelete']
    .map((id) => elementMarkup(html, id));
  for (const markup of destructive) assert.ok(markup);
  const ariaLabels = destructive.map((markup) => /** @type {string} */ (/aria-label="([^"]*)"/.exec(markup)?.[1]));
  assert.equal(new Set(ariaLabels).size, destructive.length, 'two destructive buttons share a name');

  /* Lift and Extract keep their words, and the words say what they do. */
  const lift = elementMarkup(html, 'btnLift');
  const extract = elementMarkup(html, 'btnExtract');
  assert.ok(lift && extract);
  assert.match(lift, /<span data-i18n="Lift">/, 'the Lift button lost its wording');
  assert.match(extract, /<span data-i18n="Extract">/, 'the Extract button lost its wording');

  const { zh } = loadDictionaries();
  assert.notEqual(zh['Lift'], zh['Extract'], 'Lift and Extract say the same thing');
  assert.match(zh['Lift (;) — remove IN→OUT on targeted tracks, leave the gap'], /留空/);
  assert.match(zh["Extract (') — remove IN→OUT on targeted tracks and close the gap"], /前移/);
});

/* ── the browser checks ──────────────────────────────────────────────────── */

/**
 * A Chromium-based browser, or null when the machine has none.
 * @returns {string|null}
 */
function findBrowser() {
  const candidates = [];
  for (const root of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]) {
    if (!root) continue;
    candidates.push(path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    candidates.push(path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  }
  return candidates.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) ?? null;
}

const executablePath = findBrowser();
const puppeteerPath = path.join(PACKAGE_ROOT, 'miniapp', 'node', 'vendor', 'puppeteer', 'puppeteer-core.cjs');
const hasPuppeteer = fs.existsSync(puppeteerPath);

/** The window sizes the editor has to stay usable in. */
const SIZES = [[1280, 900], [923, 899], [720, 800]];

/**
 * @param {import('node:test').TestContext} t
 * @param {number} width
 * @param {number} height
 */
async function openEditor(t, width, height) {
  const app = await startApp();
  const puppeteer = require(puppeteerPath);
  const api = puppeteer.default && typeof puppeteer.default.launch === 'function' ? puppeteer.default : puppeteer;
  const browser = await api.launch({ executablePath, headless: true, pipe: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (err) => { errors.push(String(err)); });
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.goto(`${app.base}${app.surfacePath}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => typeof window.T === 'function' && typeof window.I18n === 'object', { timeout: 20000 });
  t.after(async () => {
    await browser.close();
  });
  return { app, page, errors };
}

/**
 * @param {any} page
 * @param {string} locale
 */
async function switchLanguage(page, locale) {
  await page.evaluate((value) => {
    const sel = document.getElementById('setLang');
    sel.value = value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, locale);
  await page.waitForFunction((value) => document.documentElement.lang === value, { timeout: 15000 }, locale);
}

const skip = !executablePath || !hasPuppeteer ? 'no Chromium-based browser on this machine' : false;

test('the icon buttons are big enough to hit and nothing overflows', { skip }, async (t) => {
  const { app, page, errors } = await openEditor(t, 1280, 900);
  t.after(async () => { await app.dispose(); });

  for (const [width, height] of SIZES) {
    await page.setViewport({ width, height });
    await new Promise((resolve) => setTimeout(resolve, 500));

    const geo = await page.evaluate((ids) => {
      /** @type {any[]} */
      const small = [];
      /** @type {any[]} */
      const outside = [];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el || el.offsetParent === null) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 32 || r.height < 32) small.push({ id, w: Math.round(r.width), h: Math.round(r.height) });
        if (r.left < -1 || r.right > window.innerWidth + 1) outside.push({ id, left: Math.round(r.left), right: Math.round(r.right) });
      }
      const toolbar = document.querySelector('.timeline-toolbar');
      return {
        small,
        outside,
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        toolbarOverflow: toolbar.scrollWidth - toolbar.clientWidth,
        /* The wording is hidden, not painted: it must not take any space. */
        labelWidth: Math.round(document.querySelector('#btnSplit span[data-i18n]').getBoundingClientRect().width),
      };
    }, ICON_BUTTONS.map((button) => button.id));

    const where = `${width}x${height}`;
    assert.deepEqual(geo.small, [], `an icon button is too small to hit at ${where}`);
    assert.deepEqual(geo.outside, [], `an icon button is outside the window at ${where}`);
    assert.equal(geo.pageOverflow, 0, `the page scrolls sideways at ${where}`);
    assert.equal(geo.toolbarOverflow, 0, `the toolbar is wider than the window at ${where}`);
    assert.ok(geo.labelWidth <= 1, `the hidden wording still takes space at ${where}: ${geo.labelWidth}px`);
  }

  assert.deepEqual(errors, [], 'the page logged errors');
});

test('the icon buttons name themselves in the chosen language', { skip }, async (t) => {
  const { app, page, errors } = await openEditor(t, 1280, 900);
  t.after(async () => { await app.dispose(); });

  const read = () => page.evaluate((ids) => Object.fromEntries(ids.map((id) => {
    const el = document.getElementById(id);
    return [id, el?.getAttribute('aria-label') ?? ''];
  })), ICON_BUTTONS.map((button) => button.id));

  /* The browser may start in any language: ask for English first. */
  await switchLanguage(page, 'en');
  const en = await read();
  for (const button of ICON_BUTTONS) {
    assert.equal(en[button.id], button.name, `${button.id} does not announce itself`);
  }

  await switchLanguage(page, 'zh-CN');
  const zh = await read();
  for (const button of ICON_BUTTONS) {
    assert.ok(zh[button.id], `${button.id} has no name in Chinese`);
    assert.notEqual(zh[button.id], en[button.id], `${button.id} was not translated`);
  }
  /* The destructive buttons stay apart in Chinese too. */
  const destructive = ['btnDelete', 'btnCloseGap', 'btnRippleDelete'].map((id) => zh[id]);
  assert.equal(new Set(destructive).size, destructive.length, 'two destructive buttons share a name in Chinese');

  assert.deepEqual(errors, [], 'the page logged errors');
});

test('the file input is still reachable by the keyboard', { skip }, async (t) => {
  const { app, page, errors } = await openEditor(t, 1280, 900);
  t.after(async () => { await app.dispose(); });

  const state = await page.evaluate(() => {
    const input = document.getElementById('fileInput');
    const label = document.getElementById('btnImport');
    input.focus();
    const cs = getComputedStyle(label);
    return {
      focused: document.activeElement === input,
      /* The input is out of sight but still a real, focusable control. */
      inputVisible: input.getBoundingClientRect().width <= 2 && input.getBoundingClientRect().height <= 2,
      labelOutline: cs.outlineStyle,
      labelOutlineWidth: cs.outlineWidth,
    };
  });
  assert.equal(state.focused, true, 'the file input cannot be reached with the keyboard');
  assert.equal(state.inputVisible, true, 'the file input is in the way');
  assert.notEqual(state.labelOutline, 'none', 'the import control does not show where the focus is');

  assert.deepEqual(errors, [], 'the page logged errors');
});

test('the icon buttons still do their job, and the labels around them stay', { skip }, async (t) => {
  const { app, page, errors } = await openEditor(t, 1280, 900);
  t.after(async () => { await app.dispose(); });

  /* The browser may start in any language: ask for English first. */
  await switchLanguage(page, 'en');

  /* The raw ids and the listeners are untouched: the button still works. */
  const before = await page.evaluate(() => document.getElementById('btnSnap').classList.contains('on'));
  await page.click('#btnSnap');
  const after = await page.evaluate(() => document.getElementById('btnSnap').classList.contains('on'));
  assert.notEqual(after, before, 'the snap button no longer toggles');

  await page.click('#btnTitle');
  await page.waitForSelector('select[data-k="textAnim"]', { timeout: 20000 });
  assert.ok(true, 'the title button no longer adds a title card');

  /* The inspector asks for a clip in one short line. */
  await page.evaluate(() => {
    const clip = document.querySelector('.clip');
    if (clip) clip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await new Promise((resolve) => setTimeout(resolve, 300));

  /* The navigation keeps its names. */
  const tabs = await page.evaluate(() => ({
    bin: [...document.querySelectorAll('#binTabs button')].map((b) => b.textContent.trim()),
    side: [...document.querySelectorAll('#sideTabs button')].map((b) => b.textContent.trim()),
    empty: document.querySelector('#inspector .inspector-empty')?.textContent?.trim() ?? '',
  }));
  assert.ok(tabs.bin.includes('Project'), 'the media bin lost its tab names');
  assert.ok(tabs.side.includes('Inspector'), 'the inspector lost its tab names');
  assert.ok(!tabs.empty || tabs.empty === 'Select a clip', `the inspector says too much: ${tabs.empty}`);

  /* The forms keep their field labels. */
  await page.click('#btnExport');
  await page.waitForSelector('#exportSetup:not(.hidden)', { timeout: 20000 });
  const fields = await page.evaluate(() => {
    /** @type {string[]} */
    const labels = [];
    for (const label of document.querySelectorAll('#dlvBody .dlv-f')) {
      const span = label.querySelector('span[data-i18n]');
      if (!span) continue;
      const r = span.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) labels.push(span.textContent.trim());
    }
    return labels;
  });
  assert.ok(fields.length > 5, `the export form lost its field labels: ${fields.join(', ')}`);
  assert.ok(fields.includes('Resolution'), `the export form lost its field labels: ${fields.join(', ')}`);

  assert.deepEqual(errors, [], 'the page logged errors');
});
