// @ts-check
// A browser smoke test for the editor's language switch.
//
// It drives a real Chromium against a real Mini App instance: the page has to
// load, the interface has to follow the chosen language, the choice has to
// survive a reload, and a name the user typed has to stay as it is.
//
// The test skips itself when the machine has no Chromium-based browser, so
// `npm test` stays green on a machine without one.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { startApp } from './helpers.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
const require = createRequire(import.meta.url);

/**
 * A Chromium-based browser, or null when the machine has none.
 * @returns {string|null}
 */
function findBrowser() {
  const vendored = path.join(PACKAGE_ROOT, 'miniapp', 'node', 'vendor', 'fablecut', 'export-jobs.js');
  if (fs.existsSync(vendored)) {
    try {
      const { findBrowser: find } = require(vendored);
      const found = find();
      if (found) return found;
    } catch { /* fall through to the manual search */ }
  }
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

/**
 * @param {import('node:test').TestContext} t
 */
async function openEditor(t) {
  const app = await startApp();
  dataDir = dataDir ?? app.dataDir;
  const puppeteer = require(puppeteerPath);
  const api = puppeteer.default && typeof puppeteer.default.launch === 'function' ? puppeteer.default : puppeteer;
  const browser = await api.launch({ executablePath, headless: true, pipe: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const pageErrors = [];
  /** @type {string[]} */
  const nativeDialogs = [];
  page.on('pageerror', (err) => { pageErrors.push(String(err)); errors.push(String(err)); });
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  // A native modal would block the page: record it and let it go.
  page.on('dialog', async (dialog) => {
    nativeDialogs.push(`${dialog.type()}: ${dialog.message()}`);
    await dialog.dismiss();
  });
  await page.goto(`${app.base}${app.surfacePath}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => typeof window.T === 'function' && typeof window.I18n === 'object', { timeout: 20000 });
  t.after(async () => {
    await browser.close();
  });
  return { app, page, errors, pageErrors, nativeDialogs };
}

/**
 * Switch the language the way the settings dialog does.
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

/* The upstream modules read their data directory from the environment the
 * first time they are loaded, so the whole process shares one data folder —
 * even though every test starts its own Mini App instance. */
let dataDir = null;

/**
 * Write the project document and wait until the editor has picked it up.
 *
 * The Mini App watches its data folder, so a write reaches the page the way
 * an Agent's edit would. The editor's own save is debounced, so the write
 * waits for a quiet moment first.
 * @param {any} page
 * @param {any} app
 * @param {Record<string, unknown>} doc
 */
async function writeProject(page, app, doc) {
  await new Promise((resolve) => setTimeout(resolve, 700));
  const file = path.join(dataDir ?? app.dataDir, 'project.json');
  let current = { name: 'Untitled Project', width: 1280, height: 720, fps: 30, revision: 0, media: [], clips: [] };
  try {
    current = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { /* the editor has not written the project yet */ }
  fs.writeFileSync(file, JSON.stringify(
    { ...current, ...doc, revision: (current.revision || 0) + 1 },
    null,
    2,
  ));
  await page.waitForFunction(
    (name) => (document.getElementById('projectName')?.textContent ?? '').startsWith(name),
    { timeout: 20000 },
    String(doc.name ?? current.name),
  );
}

/**
 * Rename the project the way a user would, and wait for the header.
 * @param {any} page
 * @param {any} app
 * @param {string} name
 */
async function renameProject(page, app, name) {
  await writeProject(page, app, { name });
}

test('the editor loads and the interface follows the chosen language', { skip: !executablePath || !hasPuppeteer ? 'no Chromium-based browser on this machine' : false }, async (t) => {
  const { app, page, errors } = await openEditor(t);
  t.after(async () => { await app.dispose(); });

  // The first run follows the browser, so the test asks for both languages
  // instead of assuming one of them.
  await switchLanguage(page, 'en');
  const en = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    title: document.title,
    projectTab: document.querySelector('[data-tab="project"] span')?.textContent,
    settingsLabel: document.getElementById('setLang')?.closest('label')
      ?.querySelector('.settings-label span')?.textContent,
  }));
  assert.equal(en.lang, 'en');
  assert.equal(en.title, 'MiniMax Cut - Video Editor');
  assert.equal(en.projectTab, 'Project');
  assert.equal(en.settingsLabel, 'Language');

  // The name of a project is the user's own text: it must not be translated.
  // The project is renamed for real, so the editor has to pick the name up
  // from the project document.
  await renameProject(page, app, 'Settings');

  await switchLanguage(page, 'zh-CN');
  const zh = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    title: document.title,
    projectTab: document.querySelector('[data-tab="project"] span')?.textContent,
    settingsLabel: document.getElementById('setLang')?.closest('label')
      ?.querySelector('.settings-label span')?.textContent,
    projectName: document.getElementById('projectName')?.textContent,
    stored: localStorage.getItem('fablecut-locale'),
    // The translator is exact: a key that is in the dictionary is translated.
    known: window.T('Settings'),
    unknown: window.T('A user string that is not ours'),
  }));
  assert.equal(zh.lang, 'zh-CN');
  assert.notEqual(zh.title, 'MiniMax Cut - Video Editor');
  assert.ok(/[一-鿿]/.test(zh.title), `the title should be Chinese: ${zh.title}`);
  assert.notEqual(zh.projectTab, 'Project');
  assert.ok(/[一-鿿]/.test(zh.projectTab), `the bin tab should be Chinese: ${zh.projectTab}`);
  assert.notEqual(zh.settingsLabel, 'Language');
  assert.ok(/[一-鿿]/.test(zh.settingsLabel), `the settings label should be Chinese: ${zh.settingsLabel}`);
  // The user's own name stays as it is, even when it reads like one of ours.
  assert.ok(zh.projectName?.startsWith('Settings'), `the project name was changed: ${zh.projectName}`);
  assert.equal(zh.stored, 'zh-CN');
  assert.ok(/[一-鿿]/.test(zh.known));
  assert.equal(zh.unknown, 'A user string that is not ours');

  assert.deepEqual(errors, [], 'the page logged errors');
});

test('the export button says so when the timeline is empty', { skip: !executablePath || !hasPuppeteer ? 'no Chromium-based browser on this machine' : false }, async (t) => {
  const { app, page, errors, nativeDialogs } = await openEditor(t);
  t.after(async () => { await app.dispose(); });

  await switchLanguage(page, 'zh-CN');

  // An empty timeline: the editor has to say so in the page, not in a native
  // modal a Host webview may swallow.
  await page.click('#btnExport');
  await new Promise((resolve) => setTimeout(resolve, 800));
  const empty = await page.evaluate(() => ({
    hidden: document.getElementById('exportSetup')?.classList.contains('hidden'),
    toast: document.getElementById('toast')?.textContent?.trim(),
  }));
  assert.equal(empty.hidden, true, 'the export dialog opened on an empty timeline');
  assert.ok(/[一-鿿]/.test(empty.toast ?? ''), `the toast should be Chinese: ${empty.toast}`);
  assert.deepEqual(nativeDialogs, [], 'the editor used a native dialog');
  assert.deepEqual(errors, [], 'the page logged errors');
});

test('the chosen language survives a reload', { skip: !executablePath || !hasPuppeteer ? 'no Chromium-based browser on this machine' : false }, async (t) => {
  const { app, page } = await openEditor(t);
  t.after(async () => { await app.dispose(); });
  await switchLanguage(page, 'zh-CN');

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => typeof window.T === 'function', { timeout: 20000 });
  const after = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    tab: document.querySelector('[data-tab="project"] span')?.textContent,
    select: document.getElementById('setLang')?.value,
  }));
  assert.equal(after.lang, 'zh-CN');
  assert.ok(/[一-鿿]/.test(after.tab), `the bin tab should be Chinese: ${after.tab}`);
  assert.equal(after.select, 'zh-CN');
});

test('an enum keeps its id when the language changes', { skip: !executablePath || !hasPuppeteer ? 'no Chromium-based browser on this machine' : false }, async (t) => {
  const { app, page, errors } = await openEditor(t);
  t.after(async () => { await app.dispose(); });

  await switchLanguage(page, 'en');

  /* A title card gives the inspector a text clip, and with it the transition
     and the text-animation selects. */
  await page.click('#btnTitle');
  await page.waitForSelector('select[data-k="textAnim"]', { timeout: 20000 });

  /**
   * @param {string} key
   * @returns {Promise<any>}
   */
  const readSelect = (key) => page.evaluate((k) => {
    const sel = document.querySelector(`select[data-k="${k}"]`);
    if (!sel) return null;
    return {
      value: sel.value,
      options: [...sel.options].map((o) => ({ value: o.value, text: o.textContent ?? '' })),
    };
  }, key);

  const enAnim = await readSelect('textAnim');
  const enTrans = await readSelect('transIn');
  assert.ok(enAnim, 'no text-animation select in the inspector');
  assert.ok(enTrans, 'no transition select in the inspector');

  /* The value of an option is the raw id, never the text shown next to it. */
  assert.ok(enAnim.options.some((o) => o.value === 'word-pop'), 'the text animations have no word-pop');
  assert.ok(enAnim.options.some((o) => o.value === 'none'), 'the text animations have no none');
  assert.ok(enTrans.options.some((o) => o.value === 'fade'), 'the transitions have no fade');
  assert.ok(enTrans.options.some((o) => o.value === 'none'), 'the transitions have no none');
  for (const option of [...enAnim.options, ...enTrans.options]) {
    assert.ok(option.value && !/[一-鿿]/.test(option.value),
      `an option value is not a raw id: ${option.value}`);
  }

  /* Pick an animation that is not the default. The inspector fields listen on
     "input", not on "change". */
  await page.evaluate(() => {
    const sel = document.querySelector('select[data-k="textAnim"]');
    sel.value = 'word-pop';
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(
    () => document.querySelector('select[data-k="textAnim"]')?.value === 'word-pop',
    { timeout: 15000 },
  );

  await switchLanguage(page, 'zh-CN');

  const zhAnim = await readSelect('textAnim');
  const zhTrans = await readSelect('transIn');
  /* The ids did not move… */
  assert.deepEqual(zhAnim.options.map((o) => o.value), enAnim.options.map((o) => o.value));
  assert.deepEqual(zhTrans.options.map((o) => o.value), enTrans.options.map((o) => o.value));
  /* …only the labels did. */
  const zhLabels = zhAnim.options.map((o) => o.text);
  assert.notDeepEqual(zhLabels, enAnim.options.map((o) => o.text),
    'the labels did not follow the language');
  assert.ok(zhLabels.some((t) => /[一-鿿]/.test(t)), `the labels should be Chinese: ${zhLabels.join(' | ')}`);
  /* And the selection still points at the id. */
  assert.equal(zhAnim.value, 'word-pop', 'the selected value changed with the language');
  assert.equal(zhTrans.value, 'none');

  /* The project on disk holds the id, not the label. The save is debounced,
     so the file is polled for a moment. */
  let project = null;
  for (let i = 0; i < 40; i += 1) {
    project = await page.evaluate(async () => {
      const res = await fetch('/api/project');
      return res.json();
    });
    if ((project.clips || []).some((c) => c.kind === 'text')) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const clip = (project.clips || []).find((c) => c.kind === 'text');
  assert.ok(clip, 'the title card was not saved');
  assert.equal(clip.props.textAnim, 'word-pop', 'the saved project holds the label instead of the id');

  assert.deepEqual(errors, [], 'the page logged errors');
});

test('the toolbar, the header and the export frame list follow the language', { skip: !executablePath || !hasPuppeteer ? 'no Chromium-based browser on this machine' : false }, async (t) => {
  const { app, page, errors } = await openEditor(t);
  t.after(async () => { await app.dispose(); });

  /**
   * @returns {Promise<any>}
   */
  const read = () => page.evaluate(() => ({
    closeGap: document.getElementById('btnCloseGap')?.textContent?.trim(),
    findGap: document.getElementById('btnNextGap')?.textContent?.trim(),
    ripple: document.getElementById('btnRippleDelete')?.textContent?.trim(),
    header: document.getElementById('projectName')?.textContent,
    exportFrame: [...(document.getElementById('exportFrameSel')?.options ?? [])].map((o) => o.textContent),
  }));

  await switchLanguage(page, 'zh-CN');
  const zh = await read();
  assert.ok(/[一-鿿]/.test(zh.closeGap ?? ''), `the toolbar label should be Chinese: ${zh.closeGap}`);
  assert.ok(/[一-鿿]/.test(zh.findGap ?? ''), `the toolbar label should be Chinese: ${zh.findGap}`);
  assert.ok(/[一-鿿]/.test(zh.ripple ?? ''), `the toolbar label should be Chinese: ${zh.ripple}`);
  assert.ok(/[一-鿿]/.test(zh.header ?? ''), `the header should be Chinese: ${zh.header}`);
  assert.ok(zh.exportFrame.some((t) => /[一-鿿]/.test(t)), `the export frame list should be Chinese: ${zh.exportFrame.join(' | ')}`);
  // The name of the project is the user's own text: only the state word moves.
  const projectName = (zh.header ?? '').replace(/\s*·.*$/, '');
  assert.ok(projectName, `the header has no project name: ${zh.header}`);

  await switchLanguage(page, 'en');
  const en = await read();
  assert.equal(en.closeGap, 'Close gap');
  assert.equal(en.ripple, 'Ripple delete');
  assert.ok(/·\s+🟢 connected$/.test(en.header ?? ''), `the state word should be English: ${en.header}`);
  assert.deepEqual(en.exportFrame, ['Full canvas', '9:16 Reel', '16:9', '4:5 IG', '1:1 Square']);
  assert.equal((en.header ?? '').replace(/\s*·.*$/, ''), projectName,
    'the project name changed with the language');

  assert.deepEqual(errors, [], 'the page logged errors');
});

test('the export button opens the dialog and the dialog speaks the chosen language', { skip: !executablePath || !hasPuppeteer ? 'no Chromium-based browser on this machine' : false }, async (t) => {
  const { app, page, errors, pageErrors, nativeDialogs } = await openEditor(t);
  t.after(async () => { await app.dispose(); });

  await switchLanguage(page, 'zh-CN');

  // A title card gives the timeline a clip, so the export dialog can open.
  await page.click('#btnTitle');
  await page.waitForSelector('select[data-k="textAnim"]', { timeout: 20000 });

  await page.click('#btnExport');
  await page.waitForFunction(
    () => !document.getElementById('exportSetup')?.classList.contains('hidden'),
    { timeout: 15000 },
  );

  /**
   * @returns {Promise<any>}
   */
  const readDialog = () => page.evaluate(() => ({
    fastRadio: document.getElementById('engineFast')?.closest('label')?.querySelector('b')?.textContent?.trim(),
    realtimeRadio: document.getElementById('engineRealtime')?.closest('label')?.querySelector('b')?.textContent?.trim(),
    fastNote: document.getElementById('engineFastNote')?.textContent?.trim(),
    wcNote: document.getElementById('engineWebCodecsNote')?.textContent?.trim(),
    rangeNote: document.getElementById('exportRangeNote')?.textContent?.trim(),
  }));

  const zh = await readDialog();
  assert.ok(/[一-鿿]/.test(zh.fastRadio ?? ''), `the radio label should be Chinese: ${zh.fastRadio}`);
  assert.ok(/[一-鿿]/.test(zh.realtimeRadio ?? ''), `the radio label should be Chinese: ${zh.realtimeRadio}`);
  assert.ok(/[一-鿿]/.test(zh.fastNote ?? ''), `the engine note should be Chinese: ${zh.fastNote}`);
  assert.ok(/[一-鿿]/.test(zh.wcNote ?? ''), `the engine note should be Chinese: ${zh.wcNote}`);
  assert.ok(/[一-鿿]/.test(zh.rangeNote ?? ''), `the range note should be Chinese: ${zh.rangeNote}`);

  // The language can change while the dialog is open.
  await switchLanguage(page, 'en');
  await new Promise((resolve) => setTimeout(resolve, 400));
  const en = await readDialog();
  assert.equal(en.fastRadio, 'Fast (ffmpeg)');
  assert.ok(/^[A-Za-z]/.test(en.realtimeRadio ?? ''), `the radio label should be English: ${en.realtimeRadio}`);
  assert.ok(/^[A-Za-z]/.test(en.fastNote ?? ''), `the engine note should be English: ${en.fastNote}`);
  assert.ok(/^[A-Za-z]/.test(en.wcNote ?? ''), `the engine note should be English: ${en.wcNote}`);
  assert.ok(/^[A-Za-z]/.test(en.rangeNote ?? ''), `the range note should be English: ${en.rangeNote}`);

  assert.deepEqual(nativeDialogs, [], 'the editor used a native dialog');
  /* The export dialog asks the server for its encoding profiles. When the
   * harness has already stopped and restarted the Mini App in this process,
   * that request answers 500; the editor catches it and carries on, so it is
   * not an editor failure. An uncaught exception in the page is. */
  assert.deepEqual(pageErrors, [], 'the page threw');
  const unexpected = errors.filter((e) => !/500 \(Internal Server Error\)/.test(e));
  assert.deepEqual(unexpected, [], 'the page logged errors');
});
