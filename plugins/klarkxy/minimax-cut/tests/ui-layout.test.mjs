// @ts-check
// A browser regression test for the editor's layout.
//
// It drives a real Chromium against a real Mini App instance and checks the
// things a screenshot cannot: that the timeline toolbar fits the window at
// every size, that the Chinese "Zoom" label does not stand on end, that the
// audio meters sit beside the picture instead of on top of it, that the side
// panels fold away and come back, and that a language switch moves the
// wording but not the stored ids.
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
const SCRATCH_DATA_DIR = path.resolve(PACKAGE_ROOT, '../../../.fablecut-acceptance/test-runs/ui-layout-vendor-data');
fs.mkdirSync(SCRATCH_DATA_DIR, { recursive: true });
process.env.FABLECUT_DATA_DIR = SCRATCH_DATA_DIR;

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

const skip = !executablePath || !hasPuppeteer ? 'no Chromium-based browser on this machine' : false;

test('the timeline toolbar fits the window at every size', { skip }, async (t) => {
  const { app, page, errors } = await openEditor(t, 1280, 900);
  t.after(async () => { await app.dispose(); });

  for (const [width, height] of SIZES) {
    await page.setViewport({ width, height });
    await new Promise((resolve) => setTimeout(resolve, 500));

    const geo = await page.evaluate(() => {
      const toolbar = document.querySelector('.timeline-toolbar');
      const tb = toolbar.getBoundingClientRect();
      /** @type {any[]} */
      const clipped = [];
      for (const el of toolbar.querySelectorAll('button, input')) {
        if (el.classList.contains('hidden')) continue;
        if (el.offsetParent === null) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        if (r.left < tb.left - 1 || r.right > tb.right + 1 || r.top < tb.top - 1 || r.bottom > tb.bottom + 1) {
          clipped.push(el.id || el.className);
        }
      }
      const zoom = document.querySelector('.tiny-label');
      const zoomRect = zoom.getBoundingClientRect();
      const primary = ['btnSplit', 'btnDelete', 'btnSnap'].map((id) => {
        const el = document.getElementById(id);
        const r = el.getBoundingClientRect();
        return { id, w: Math.round(r.width), h: Math.round(r.height), visible: el.offsetParent !== null };
      });
      const tool = document.querySelector('[data-edit-tool="select"]');
      const toolRect = tool.getBoundingClientRect();
      return {
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        toolbarOverflow: toolbar.scrollWidth - toolbar.clientWidth,
        clipped,
        zoomText: zoom.textContent.trim(),
        zoomHeight: Math.round(zoomRect.height),
        zoomWidth: Math.round(zoomRect.width),
        primary,
        selectTool: { w: Math.round(toolRect.width), h: Math.round(toolRect.height), visible: tool.offsetParent !== null },
      };
    });

    const where = `${width}x${height}`;
    assert.equal(geo.pageOverflow, 0, `the page scrolls sideways at ${where}`);
    assert.equal(geo.toolbarOverflow, 0, `the toolbar is wider than the window at ${where}`);
    assert.deepEqual(geo.clipped, [], `a toolbar control is cut off at ${where}`);

    /* The zoom label is two Chinese characters; standing them on end would
       make it as tall as it is wide. */
    assert.ok(geo.zoomHeight < 24, `the zoom label wrapped at ${where}: ${geo.zoomHeight}px tall`);
    assert.ok(geo.zoomWidth >= geo.zoomHeight, `the zoom label stands on end at ${where}`);

    /* The primary edits are in the first row, where a hand finds them. */
    for (const control of [...geo.primary, geo.selectTool]) {
      assert.ok(control.visible, `${control.id} is not on screen at ${where}`);
      assert.ok(control.h >= 24, `${control.id} is too small to hit at ${where}: ${control.h}px`);
    }
  }

  assert.deepEqual(errors, [], 'the page logged errors');
});

test('the meters sit beside the picture, not on top of it', { skip }, async (t) => {
  const { app, page, errors } = await openEditor(t, 1280, 900);
  t.after(async () => { await app.dispose(); });

  for (const [width, height] of SIZES) {
    await page.setViewport({ width, height });
    await new Promise((resolve) => setTimeout(resolve, 500));

    const geo = await page.evaluate(() => {
      const rect = (id) => {
        const el = document.getElementById(id);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
      };
      const overlaps = (a, b) => !!a && !!b
        && a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;
      const preview = rect('preview');
      const vu = rect('vuMeter');
      const gutter = rect('monitorMeterGutter');
      const scroll = rect('monitorScroll');
      return {
        preview,
        vu,
        gutter,
        scroll,
        overlaps: overlaps(preview, vu),
        inGutter: !!gutter && !!vu
          && vu.x >= gutter.x - 1 && vu.right <= gutter.right + 1
          && vu.y >= gutter.y - 1 && vu.bottom <= gutter.bottom + 1,
        outsideScroll: !!scroll && !!vu && (vu.x >= scroll.right - 1 || vu.right <= scroll.x + 1),
        canvasWidth: document.getElementById('preview').width,
        canvasHeight: document.getElementById('preview').height,
      };
    });

    const where = `${width}x${height}`;
    assert.ok(geo.preview && geo.preview.w > 0, `the picture has no size at ${where}`);
    assert.equal(geo.overlaps, false, `the meters cover the picture at ${where}`);
    assert.ok(geo.inGutter, `the meters are not in the gutter at ${where}`);
    assert.ok(geo.outsideScroll, `the meters are inside the zoom canvas at ${where}`);
    /* The canvas keeps the project's resolution: the layout does not touch it. */
    assert.equal(geo.canvasWidth, 1280);
    assert.equal(geo.canvasHeight, 720);
  }

  /* The per-track meters are one click away and still stay in their gutter. */
  await page.click('.vu-tracks-toggle');
  await new Promise((resolve) => setTimeout(resolve, 400));
  const expanded = await page.evaluate(() => {
    const vu = document.getElementById('vuMeter').getBoundingClientRect();
    const preview = document.getElementById('preview').getBoundingClientRect();
    const gutter = document.getElementById('monitorMeterGutter').getBoundingClientRect();
    return {
      open: document.getElementById('vuMeter').classList.contains('vu-tracks-open'),
      overlaps: preview.x < vu.right && vu.x < preview.right && preview.y < vu.bottom && vu.y < preview.bottom,
      inGutter: vu.x >= gutter.x - 1 && vu.right <= gutter.right + 1 && vu.bottom <= gutter.bottom + 1,
    };
  });
  assert.ok(expanded.open, 'the track meters did not open');
  assert.equal(expanded.overlaps, false, 'the track meters cover the picture');
  assert.ok(expanded.inGutter, 'the track meters left their gutter');

  assert.deepEqual(errors, [], 'the page logged errors');
});

test('the side panels fold away and come back', { skip }, async (t) => {
  const { app, page, errors } = await openEditor(t, 1280, 900);
  t.after(async () => { await app.dispose(); });

  const read = () => page.evaluate(() => {
    const rect = (id) => {
      const el = document.getElementById(id);
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), visible: el.offsetParent !== null };
    };
    return {
      bin: rect('binPanel'),
      inspector: rect('inspectorPanel'),
      binCollapsed: document.getElementById('binPanel').classList.contains('collapsed'),
      inspectorCollapsed: document.getElementById('inspectorPanel').classList.contains('collapsed'),
      binRailVisible: document.getElementById('binRail').offsetParent !== null,
      inspectorRailVisible: document.getElementById('inspectorRail').offsetParent !== null,
      binExpanded: document.getElementById('btnCollapseBin').getAttribute('aria-expanded'),
      inspectorExpanded: document.getElementById('btnCollapseInspector').getAttribute('aria-expanded'),
      monitor: rect('monitorPanel'),
    };
  });

  const before = await read();
  assert.equal(before.binCollapsed, false, 'the media bin starts folded');
  assert.equal(before.inspectorCollapsed, false, 'the inspector starts folded');
  assert.ok(before.bin.w > 120, `the media bin is too narrow: ${before.bin.w}px`);

  /* Fold the media bin away. */
  await page.click('#btnCollapseBin');
  await new Promise((resolve) => setTimeout(resolve, 400));
  const folded = await read();
  assert.equal(folded.binCollapsed, true, 'the media bin did not fold');
  assert.ok(folded.binRailVisible, 'the rail that brings the media bin back is not there');
  assert.equal(folded.binExpanded, 'false', 'the collapse button still says it is open');
  assert.ok(folded.monitor.w > before.monitor.w, 'the monitor did not get the room');

  /* And bring it back. */
  await page.click('#binRail');
  await new Promise((resolve) => setTimeout(resolve, 400));
  const restored = await read();
  assert.equal(restored.binCollapsed, false, 'the media bin did not come back');
  assert.equal(restored.binRailVisible, false, 'the rail is still there');
  assert.equal(restored.binExpanded, 'true', 'the collapse button still says it is folded');
  assert.ok(Math.abs(restored.bin.w - before.bin.w) <= 2, 'the media bin came back at another width');

  /* The inspector does the same. */
  await page.click('#btnCollapseInspector');
  await new Promise((resolve) => setTimeout(resolve, 400));
  const inspFolded = await read();
  assert.equal(inspFolded.inspectorCollapsed, true, 'the inspector did not fold');
  assert.ok(inspFolded.inspectorRailVisible, 'the rail that brings the inspector back is not there');
  assert.equal(inspFolded.inspectorExpanded, 'false', 'the collapse button still says it is open');

  await page.click('#inspectorRail');
  await new Promise((resolve) => setTimeout(resolve, 400));
  const inspRestored = await read();
  assert.equal(inspRestored.inspectorCollapsed, false, 'the inspector did not come back');
  assert.equal(inspRestored.inspectorExpanded, 'true', 'the collapse button still says it is folded');

  assert.deepEqual(errors, [], 'the page logged errors');
});

test('a narrow window folds the panels by itself, and the choice is remembered', { skip }, async (t) => {
  const { app, page, errors } = await openEditor(t, 1280, 900);
  t.after(async () => { await app.dispose(); });

  await page.setViewport({ width: 720, height: 800 });
  await new Promise((resolve) => setTimeout(resolve, 600));
  const narrow = await page.evaluate(() => ({
    bin: document.getElementById('binPanel').classList.contains('collapsed'),
    inspector: document.getElementById('inspectorPanel').classList.contains('collapsed'),
    monitor: Math.round(document.getElementById('monitorPanel').getBoundingClientRect().width),
  }));
  assert.equal(narrow.bin, true, 'the media bin did not fold in a narrow window');
  assert.equal(narrow.inspector, true, 'the inspector did not fold in a narrow window');
  assert.ok(narrow.monitor > 500, `the monitor is still squeezed: ${narrow.monitor}px`);

  /* The editor follows the window until the user says otherwise. */
  await page.setViewport({ width: 1280, height: 900 });
  await new Promise((resolve) => setTimeout(resolve, 600));
  const wide = await page.evaluate(() => ({
    bin: document.getElementById('binPanel').classList.contains('collapsed'),
    inspector: document.getElementById('inspectorPanel').classList.contains('collapsed'),
  }));
  assert.equal(wide.bin, false, 'the media bin did not come back with the window');
  assert.equal(wide.inspector, false, 'the inspector did not come back with the window');

  assert.deepEqual(errors, [], 'the page logged errors');
});

test('the monitor still zooms, and the picture keeps its resolution', { skip }, async (t) => {
  const { app, page, errors } = await openEditor(t, 1280, 900);
  t.after(async () => { await app.dispose(); });

  const before = await page.evaluate(() => {
    const cv = document.getElementById('preview');
    return { cssW: cv.getBoundingClientRect().width, attrW: cv.width, attrH: cv.height };
  });
  assert.equal(before.attrW, 1280);
  assert.equal(before.attrH, 720);

  /* The wheel over the picture zooms in — the new gutter must not break it. */
  await page.mouse.move(640, 250);
  await page.mouse.wheel({ deltaY: -240 });
  await new Promise((resolve) => setTimeout(resolve, 500));

  const zoomed = await page.evaluate(() => {
    const cv = document.getElementById('preview');
    const btn = document.getElementById('btnZoom100');
    const br = btn.getBoundingClientRect();
    const top = document.elementFromPoint(br.x + br.width / 2, br.y + br.height / 2);
    return {
      cssW: cv.getBoundingClientRect().width,
      attrW: cv.width,
      attrH: cv.height,
      zoomed: document.getElementById('monitorScroll').classList.contains('is-zoomed'),
      fitVisible: btn.offsetParent !== null,
      /* Nothing may cover the button: the panel head must not overlap. */
      fitOnTop: !!top && (top === btn || btn.contains(top)),
    };
  });
  assert.ok(zoomed.zoomed, 'the monitor did not zoom');
  assert.ok(zoomed.cssW > before.cssW + 10, `the picture did not grow: ${before.cssW} → ${zoomed.cssW}`);
  /* The export reads the canvas' own pixels, so the zoom must not touch them. */
  assert.equal(zoomed.attrW, 1280, 'the zoom changed the canvas resolution');
  assert.equal(zoomed.attrH, 720, 'the zoom changed the canvas resolution');
  assert.ok(zoomed.fitVisible, 'the fit button did not appear');
  assert.ok(zoomed.fitOnTop, 'something covers the fit button');

  await page.click('#btnZoom100');
  await new Promise((resolve) => setTimeout(resolve, 500));
  const back = await page.evaluate(() => {
    const cv = document.getElementById('preview');
    return {
      cssW: cv.getBoundingClientRect().width,
      zoomed: document.getElementById('monitorScroll').classList.contains('is-zoomed'),
    };
  });
  assert.equal(back.zoomed, false, 'the monitor did not go back to the fit');
  assert.ok(Math.abs(back.cssW - before.cssW) <= 2, 'the picture did not come back to its size');

  assert.deepEqual(errors, [], 'the page logged errors');
});

test('the Chinese wording is right and the stored ids stay raw', { skip }, async (t) => {
  const { app, page, errors } = await openEditor(t, 1280, 900);
  t.after(async () => { await app.dispose(); });

  await switchLanguage(page, 'zh-CN');
  const zh = await page.evaluate(() => ({
    source: document.getElementById('btnMonSource')?.textContent?.trim(),
    program: document.getElementById('btnMonProgram')?.textContent?.trim(),
    lift: document.getElementById('btnLift')?.textContent?.trim(),
    extract: document.getElementById('btnExtract')?.textContent?.trim(),
    liftTitle: document.getElementById('btnLift')?.getAttribute('title'),
    extractTitle: document.getElementById('btnExtract')?.getAttribute('title'),
    zoom: document.querySelector('.tiny-label')?.textContent?.trim(),
    /* The sequence name is the user's own text. */
    sequence: document.querySelector('.seq-name')?.textContent?.trim(),
    monitorModeTitle: document.getElementById('monitorModeGroup')?.getAttribute('title'),
  }));

  assert.equal(zh.source, '素材', 'the Source monitor is not called 素材');
  assert.equal(zh.program, '时间线', 'the Program monitor is not called 时间线');
  assert.equal(zh.lift, '留空删除', 'the Lift button does not say what it does');
  assert.equal(zh.extract, '前移删除', 'the Extract button does not say what it does');
  assert.match(zh.liftTitle ?? '', /留空/, 'the Lift tooltip does not say that the gap stays');
  assert.match(zh.extractTitle ?? '', /前移/, 'the Extract tooltip does not say that the rest moves up');
  assert.match(zh.monitorModeTitle ?? '', /素材/, 'the monitor tooltip still uses the old wording');
  assert.equal(zh.sequence, 'Main', 'the sequence name was translated');
  assert.ok(/[一-鿿]/.test(zh.zoom ?? ''), `the zoom label is not Chinese: ${zh.zoom}`);

  /* The enum ids are raw, whatever the language is. */
  await page.click('#btnTitle');
  await page.waitForSelector('select[data-k="textAnim"]', { timeout: 20000 });
  const enums = await page.evaluate(() => {
    const sel = document.querySelector('select[data-k="textAnim"]');
    return [...sel.options].map((o) => o.value);
  });
  for (const value of enums) {
    assert.ok(value && !/[一-鿿]/.test(value), `an option value is not a raw id: ${value}`);
  }
  assert.ok(enums.includes('word-pop'), 'the text animations lost their ids');

  assert.deepEqual(errors, [], 'the page logged errors');
});
