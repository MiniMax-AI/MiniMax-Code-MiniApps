// @ts-check
// A browser regression test for the monitor head, the snap menu and the
// sequence menu.
//
// It drives a real Chromium against a real Mini App instance and checks the
// things a screenshot cannot: that the monitor head keeps one row at every
// size, that the canvas settings live in a popover that stays inside the
// window, that the snap menu and the sequence menu speak the chosen language
// while their ids and the user's own names stay exactly as they were.
//
// The test skips itself when the machine has no Chromium-based browser, so
// `npm test` stays green on a machine without one.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

/* The upstream modules read their data directory from the environment the
   first time they are loaded, so it has to point at a scratch folder before
   anything of theirs is required — otherwise a test writes into the package. */
const SCRATCH_DIR = path.resolve(PACKAGE_ROOT, '../../../.fablecut-acceptance/monitor-header');
fs.mkdirSync(SCRATCH_DIR, { recursive: true });
process.env.FABLECUT_DATA_DIR = SCRATCH_DIR;

const { startApp } = await import('./helpers.mjs');

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

/** The window sizes the monitor head has to stay usable in. */
const SIZES = [[1280, 900], [985, 899], [951, 899], [923, 899], [720, 800]];

/**
 * @param {import('node:test').TestContext} t
 * @param {number} width
 * @param {number} height
 */
async function openEditor(t, width = 1280, height = 900) {
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

/**
 * Read the snap menu's rows: the raw target id and the wording.
 * @param {any} page
 */
async function readSnapMenu(page) {
  return page.evaluate(() => {
    const menu = document.querySelector('.snap-menu');
    if (!menu) return null;
    return {
      head: menu.querySelector('.snap-menu-head')?.textContent?.trim() ?? '',
      rows: [...menu.querySelectorAll('.snap-opt')].map((row) => ({
        key: row.querySelector('input')?.getAttribute('data-snap') ?? '',
        label: row.querySelector('span')?.textContent?.trim() ?? '',
        checked: !!row.querySelector('input')?.checked,
      })),
    };
  });
}

const skip = !executablePath || !hasPuppeteer ? 'no Chromium-based browser on this machine' : false;

test('the snap menu speaks the chosen language and keeps its raw ids', { skip }, async (t) => {
  const { app, page, errors } = await openEditor(t);
  t.after(async () => { await app.dispose(); });

  /* The page starts in the browser's language: the test asks for English. */
  await switchLanguage(page, 'en');
  await page.click('#btnSnapMenu');
  await page.waitForSelector('.snap-menu', { timeout: 15000 });

  const en = await readSnapMenu(page);
  assert.ok(en, 'the snap menu did not open');
  /* The ids are the ones the setting is stored under: they never change. */
  assert.deepEqual(en.rows.map((r) => r.key),
    ['clips', 'playhead', 'markers', 'inout', 'keyframes', 'frames'],
    'the snap targets lost their ids');
  assert.deepEqual(en.rows.map((r) => r.label),
    ['Clip edges', 'Playhead', 'Markers', 'IN / OUT', 'Keyframes', 'Frame grid'],
    'the snap menu does not name the targets');
  assert.equal(en.head, 'Snap to');

  /* The language changes while the menu is open: the wording follows and the
     ids and the ticked targets stay. */
  await switchLanguage(page, 'zh-CN');
  const zh = await readSnapMenu(page);
  assert.ok(zh, 'the snap menu closed when the language changed');
  assert.deepEqual(zh.rows.map((r) => r.key), en.rows.map((r) => r.key),
    'the snap targets changed their ids with the language');
  assert.deepEqual(zh.rows.map((r) => r.checked), en.rows.map((r) => r.checked),
    'the snap targets lost their state with the language');
  for (const row of zh.rows) {
    assert.match(row.label, /[一-鿿]/, `the snap target is not Chinese: ${row.label}`);
  }
  assert.notEqual(zh.head, en.head, 'the snap menu header did not follow the language');

  /* The stored setting keeps the raw ids, in every language: a target is
     stored under its id and as a yes / no, never under its wording. */
  await page.evaluate(() => {
    const input = document.querySelector('.snap-menu .snap-opt input[data-snap="keyframes"]');
    input.click();
  });
  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem('fablecut-settings');
    return raw ? JSON.parse(raw).snapTargets : null;
  });
  assert.ok(stored, 'the snap targets were not stored');
  assert.deepEqual(Object.keys(stored).sort(),
    ['clips', 'frames', 'inout', 'keyframes', 'markers', 'playhead'],
    'the stored snap targets changed their ids');
  assert.equal(stored.keyframes, true, 'the snap target was not stored as a yes / no');

  await switchLanguage(page, 'en');
  const back = await readSnapMenu(page);
  assert.ok(back, 'the snap menu closed when the language changed back');
  assert.deepEqual(back.rows.map((r) => r.label), en.rows.map((r) => r.label),
    'the snap menu did not come back in English');

  assert.deepEqual(errors, [], 'the page logged errors');
});

test('the monitor head keeps one row at every size', { skip }, async (t) => {
  const { app, page, errors } = await openEditor(t);
  t.after(async () => { await app.dispose(); });

  for (const [width, height] of SIZES) {
    await page.setViewport({ width, height });
    await new Promise((resolve) => setTimeout(resolve, 500));

    const geo = await page.evaluate(() => {
      const head = document.querySelector('.monitor-head');
      const hr = head.getBoundingClientRect();
      const buttons = [...head.querySelectorAll('button')]
        .filter((el) => el.offsetParent !== null && el.getBoundingClientRect().width > 0);
      const tops = buttons.map((el) => Math.round(el.getBoundingClientRect().top));
      const centers = buttons.map((el) => {
        const r = el.getBoundingClientRect();
        return r.top + r.height / 2;
      });
      const title = head.querySelector('.panel-head-title').getBoundingClientRect();
      const actions = head.querySelector('.panel-head-actions').getBoundingClientRect();
      return {
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        headHeight: Math.round(hr.height),
        headLeft: Math.round(hr.left),
        headRight: Math.round(hr.right),
        /* How many rows the controls sit in: one row means one shared top. */
        rows: new Set(tops).size,
        /* How far the controls drift from their shared centre line. */
        centerSpread: Math.round(Math.max(...centers) - Math.min(...centers)),
        titleRight: Math.round(title.right),
        titleBottom: Math.round(title.bottom),
        actionsLeft: Math.round(actions.left),
        actionsRight: Math.round(actions.right),
        actionsTop: Math.round(actions.top),
        /* The canvas selects belong to the popover now, not to the head. */
        selectsInHead: head.querySelectorAll('select').length,
        resolutionInHead: !!head.querySelector('#monitorRes'),
        transport: [...document.querySelectorAll('.transport > *')]
          .filter((el) => el.getBoundingClientRect().width > 0)
          .map((el) => {
            const r = el.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
          }),
        /* The switches keep their names. */
        named: [...head.querySelectorAll('.monitor-actions button')].map((el) => ({
          id: el.id,
          label: el.getAttribute('aria-label') ?? '',
          title: el.getAttribute('title') ?? '',
        })),
      };
    });

    const where = `${width}x${height}`;
    assert.equal(geo.pageOverflow, 0, `the page scrolls sideways at ${where}`);
    assert.equal(geo.rows, 1, `the monitor head is in ${geo.rows} rows at ${where}`);
    assert.ok(geo.centerSpread <= 2, `the monitor controls are not on one line at ${where}`);
    assert.ok(geo.titleRight <= geo.actionsLeft + 1,
      `the title and the actions overlap at ${where}: ${geo.titleRight} > ${geo.actionsLeft}`);
    assert.ok(geo.actionsRight <= geo.headRight + 1, `the actions stick out of the head at ${where}`);
    assert.ok(geo.headHeight <= 60, `the monitor head is too tall at ${where}: ${geo.headHeight}px`);
    assert.equal(geo.selectsInHead, 0, `a canvas select is still in the head at ${where}`);
    assert.equal(geo.resolutionInHead, false, `the resolution is still in the head at ${where}`);
    for (let i = 0; i < geo.transport.length; i++) {
      for (let j = i + 1; j < geo.transport.length; j++) {
        const a = geo.transport[i], b = geo.transport[j];
        const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
          && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
        assert.equal(overlap, false, `transport groups ${i} and ${j} overlap at ${where}`);
      }
    }

    /* Every switch names itself: the icon carries the meaning, the label and
       the tooltip carry the words. */
    const ids = geo.named.map((b) => b.id);
    for (const id of ['btnCanvasSettings', 'btnExportFrame', 'btnGuides', 'btnProxy']) {
      assert.ok(ids.includes(id), `${id} is not in the monitor head at ${where}`);
    }
    for (const button of geo.named) {
      assert.ok(button.label, `${button.id} has no accessible name at ${where}`);
      assert.ok(button.title, `${button.id} has no tooltip at ${where}`);
    }
  }

  assert.deepEqual(errors, [], 'the page logged errors');
});

test('the canvas settings live in a popover that opens, works and closes', { skip }, async (t) => {
  const { app, page, errors } = await openEditor(t);
  t.after(async () => { await app.dispose(); });

  const before = await page.evaluate(() => ({
    width: document.getElementById('preview').width,
    height: document.getElementById('preview').height,
    aspect: document.getElementById('aspectSel').value,
    fps: document.getElementById('fpsSel').value,
  }));

  await page.click('#btnCanvasSettings');
  await page.waitForFunction(() => !document.getElementById('canvasSettingsPop')?.hidden, { timeout: 15000 });

  const open = await page.evaluate(() => {
    const pop = document.getElementById('canvasSettingsPop');
    const r = pop.getBoundingClientRect();
    return {
      expanded: document.getElementById('btnCanvasSettings')?.getAttribute('aria-expanded'),
      parent: pop.parentElement?.tagName,
      rect: { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) },
      viewport: { w: window.innerWidth, h: window.innerHeight },
      rows: [...pop.querySelectorAll('.canvas-pop-row')].map((row) => ({
        id: row.querySelector('select')?.id ?? '',
        label: row.querySelector('label')?.textContent?.trim() ?? '',
        visible: row.offsetParent !== null,
      })),
      focus: document.activeElement?.id ?? '',
    };
  });

  assert.equal(open.expanded, 'true', 'the button does not say that the popover is open');
  assert.equal(open.parent, 'BODY', 'the popover must not live inside a clipping ancestor');
  assert.ok(open.rect.left >= 0 && open.rect.right <= open.viewport.w,
    `the popover is outside the window: ${open.rect.left}…${open.rect.right} in ${open.viewport.w}`);
  assert.ok(open.rect.top >= 0 && open.rect.bottom <= open.viewport.h,
    `the popover is outside the window: ${open.rect.top}…${open.rect.bottom} in ${open.viewport.h}`);
  assert.deepEqual(open.rows.map((r) => r.id), ['aspectSel', 'fpsSel', 'exportFrameSel'],
    'the popover does not hold the three canvas selects');
  for (const row of open.rows) {
    assert.ok(row.label, `${row.id} has no label in the popover`);
    assert.ok(row.visible, `${row.id} is not visible in the popover`);
  }
  assert.ok(open.focus, 'the keyboard did not go into the popover');

  /* The selects are moved, not copied: there is exactly one of each. */
  const counts = await page.evaluate(() => ({
    aspect: document.querySelectorAll('#aspectSel').length,
    fps: document.querySelectorAll('#fpsSel').length,
    exportFrame: document.querySelectorAll('#exportFrameSel').length,
  }));
  assert.deepEqual(counts, { aspect: 1, fps: 1, exportFrame: 1 },
    'a canvas select is duplicated');

  /* Opening the popover changes nothing in the project. */
  const afterOpen = await page.evaluate(() => ({
    width: document.getElementById('preview').width,
    height: document.getElementById('preview').height,
    aspect: document.getElementById('aspectSel').value,
    fps: document.getElementById('fpsSel').value,
  }));
  assert.deepEqual(afterOpen, before, 'opening the popover changed the canvas');

  /* The selects still work: they are the ones the editor already used. */
  await page.select('#aspectSel', '4');
  await page.waitForFunction(() => document.getElementById('preview').width === 1080, { timeout: 15000 });
  const resized = await page.evaluate(() => ({
    width: document.getElementById('preview').width,
    height: document.getElementById('preview').height,
    res: document.getElementById('monitorRes')?.textContent ?? '',
  }));
  assert.equal(resized.width, 1080);
  assert.equal(resized.height, 1080);
  assert.match(resized.res, /1080\s*×\s*1080/, `the canvas summary is wrong: ${resized.res}`);

  /* Escape closes the popover and gives the keyboard back to the button. */
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('canvasSettingsPop')?.hidden, { timeout: 15000 });
  const closed = await page.evaluate(() => ({
    expanded: document.getElementById('btnCanvasSettings')?.getAttribute('aria-expanded'),
    focus: document.activeElement?.id ?? '',
  }));
  assert.equal(closed.expanded, 'false', 'the button still says the popover is open');
  assert.equal(closed.focus, 'btnCanvasSettings', 'the keyboard did not go back to the button');

  /* And a click outside closes it too. */
  await page.click('#btnCanvasSettings');
  await page.waitForFunction(() => !document.getElementById('canvasSettingsPop')?.hidden, { timeout: 15000 });
  await page.mouse.click(20, 300);
  await page.waitForFunction(() => document.getElementById('canvasSettingsPop')?.hidden, { timeout: 15000 });
  assert.equal(await page.evaluate(() => document.getElementById('btnCanvasSettings')?.getAttribute('aria-expanded')),
    'false', 'a click outside did not close the popover');

  assert.deepEqual(errors, [], 'the page logged errors');
});

test('the canvas popover stays inside a narrow window', { skip }, async (t) => {
  const { app, page, errors } = await openEditor(t, 720, 800);
  t.after(async () => { await app.dispose(); });

  await page.click('#btnCanvasSettings');
  await page.waitForFunction(() => !document.getElementById('canvasSettingsPop')?.hidden, { timeout: 15000 });

  const narrow = await page.evaluate(() => {
    const pop = document.getElementById('canvasSettingsPop');
    const r = pop.getBoundingClientRect();
    return {
      rect: { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) },
      viewport: { w: window.innerWidth, h: window.innerHeight },
      clipped: pop.scrollWidth > pop.clientWidth + 1,
    };
  });
  assert.ok(narrow.rect.left >= 0 && narrow.rect.right <= narrow.viewport.w,
    `the popover is outside the window: ${narrow.rect.left}…${narrow.rect.right} in ${narrow.viewport.w}`);
  assert.ok(narrow.rect.top >= 0 && narrow.rect.bottom <= narrow.viewport.h,
    `the popover is outside the window: ${narrow.rect.top}…${narrow.rect.bottom} in ${narrow.viewport.h}`);
  assert.equal(narrow.clipped, false, 'the popover is cut off');

  assert.deepEqual(errors, [], 'the page logged errors');
});

test('the sequence menu speaks the chosen language and keeps the name', { skip }, async (t) => {
  const { app, page, errors } = await openEditor(t);
  t.after(async () => { await app.dispose(); });

  /** @returns {Promise<any>} */
  const readMenu = () => page.evaluate(() => {
    const menu = document.querySelector('.seq-menu');
    if (!menu) return null;
    return [...menu.querySelectorAll('.ctx-item')].map((item) => ({
      text: item.textContent?.trim() ?? '',
      disabled: item.disabled,
      title: item.getAttribute('title') ?? '',
      html: item.querySelector('span')?.innerHTML ?? '',
      children: item.querySelector('span')?.children.length ?? 0,
    }));
  });

  /* The page starts in the browser's language: the test asks for English. */
  await switchLanguage(page, 'en');
  await page.click('#btnSequences');
  await page.waitForSelector('.seq-menu', { timeout: 15000 });
  const en = await readMenu();
  assert.ok(en, 'the sequence menu did not open');
  const enActions = en.slice(1).map((i) => i.text);
  assert.ok(enActions.some((t) => t.includes('New sequence')), `the menu has no new-sequence action: ${enActions.join(' | ')}`);
  assert.ok(enActions.some((t) => t.includes('Duplicate') && t.includes('Main')),
    `the menu does not offer to duplicate the sequence: ${enActions.join(' | ')}`);
  assert.ok(enActions.some((t) => t.includes('Rename') && t.includes('Main')),
    `the menu does not offer to rename the sequence: ${enActions.join(' | ')}`);
  assert.ok(enActions.some((t) => t.includes('Delete') && t.includes('Main')),
    `the menu does not offer to delete the sequence: ${enActions.join(' | ')}`);

  /* The language changes while the menu is open: the menu closes rather than
     keeping its old wording, and the name — the user's own text — is still
     exactly as it was when it opens again. */
  await switchLanguage(page, 'zh-CN');
  assert.equal(await readMenu(), null, 'the sequence menu kept its old wording');
  await page.click('#btnSequences');
  await page.waitForSelector('.seq-menu', { timeout: 15000 });
  const zh = await readMenu();
  assert.ok(zh, 'the sequence menu did not open again');
  const zhActions = zh.slice(1).map((i) => i.text);
  assert.ok(zhActions.some((t) => t.includes('Main')),
    `the sequence name was translated: ${zhActions.join(' | ')}`);
  assert.ok(zhActions.some((t) => /[一-鿿]/.test(t)), `the sequence menu is not Chinese: ${zhActions.join(' | ')}`);
  for (const action of zhActions) {
    assert.doesNotMatch(action, /Duplicate|Rename|Delete|New sequence/,
      `an action kept its English wording: ${action}`);
  }
  /* The name is never markup: it is escaped once, as a whole. */
  for (const item of zh) {
    assert.equal(item.children, 0, `the name injected markup: ${item.html}`);
  }

  /* The stored sequence keeps its id and its name. */
  const stored = await page.evaluate(async () => {
    const res = await fetch('/api/project');
    const doc = await res.json();
    return { sequence: doc.sequence ?? null, names: (doc.sequences ?? []).map((s) => s.name) };
  });
  assert.deepEqual(stored.names, [], 'the project grew a sequence list on its own');

  await switchLanguage(page, 'en');
  await page.click('#btnSequences');
  await page.waitForSelector('.seq-menu', { timeout: 15000 });
  const back = await readMenu();
  assert.ok(back, 'the sequence menu did not open again');
  assert.deepEqual(back.slice(1).map((i) => i.text), enActions,
    'the sequence menu did not come back in English');

  assert.deepEqual(errors, [], 'the page logged errors');
});

test('a sequence name with markup in it stays text', { skip }, async (t) => {
  const { app, page, errors } = await openEditor(t);
  t.after(async () => { await app.dispose(); });

  /* The page starts in the browser's language: the test asks for English. */
  await switchLanguage(page, 'en');

  /* Rename the open sequence through the menu, the way a user does. */
  await page.click('#btnSequences');
  await page.waitForSelector('.seq-menu', { timeout: 15000 });
  await page.evaluate(() => {
    const item = [...document.querySelectorAll('.seq-menu .ctx-item')]
      .find((b) => (b.textContent ?? '').includes('Rename'));
    item?.click();
  });
  await page.waitForSelector('.bin-pop input.bin-pop-input', { timeout: 15000 });
  await page.evaluate(() => {
    const input = document.querySelector('.bin-pop input.bin-pop-input');
    input.value = '<>&';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await page.waitForFunction(() => !document.querySelector('.seq-menu'), { timeout: 15000 });

  await page.click('#btnSequences');
  await page.waitForSelector('.seq-menu', { timeout: 15000 });
  const menu = await page.evaluate(() => [...document.querySelectorAll('.seq-menu .ctx-item')].map((item) => ({
    text: item.textContent?.trim() ?? '',
    html: item.querySelector('span')?.innerHTML ?? '',
    children: item.querySelector('span')?.children.length ?? 0,
  })));
  const actions = menu.slice(1).map((i) => i.text);
  assert.ok(actions.some((t) => t.includes('<>&')), `the name was lost: ${actions.join(' | ')}`);
  for (const item of menu) {
    assert.equal(item.children, 0, `the name injected markup: ${item.html}`);
  }
  assert.ok(menu.some((i) => i.html.includes('&lt;&gt;&amp;')), 'the name was not escaped');

  assert.deepEqual(errors, [], 'the page logged errors');
});
