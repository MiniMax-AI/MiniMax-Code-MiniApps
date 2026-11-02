// @ts-check
// A browser test for "Send to chat": right-click a clip, an empty spot on a
// track, the ruler, a marker or a media file, pick the item, and the text the
// Host is asked to append names what was pointed at.
//
// The Host's `window.mcode.miniapp.message.append` is replaced by a recorder
// before the page loads, so the test sees exactly the text the editor hands
// over. A second page with no bridge checks that the items stay visible but
// disabled, with the reason as the tooltip.
//
// The test skips itself when the machine has no Chromium-based browser.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

/* The upstream modules read their data directory from the environment the
   first time they are loaded: point it at a scratch folder first. */
const SCRATCH_DIR = path.resolve(PACKAGE_ROOT, '../../../.fablecut-acceptance/send-to-chat');
fs.mkdirSync(SCRATCH_DIR, { recursive: true });
process.env.FABLECUT_DATA_DIR = SCRATCH_DIR;

const { startApp, mcpSession, mcpTool } = await import('./helpers.mjs');

/** @returns {string|null} */
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
const skip = !executablePath || !fs.existsSync(puppeteerPath) ? 'no Chromium-based browser on this machine' : false;

/** A small timeline: a title on V2, a shape on V1 after a gap, a marker, an unused still. */
async function seedProject(base) {
  const { sessionId } = await mcpSession(base);
  /* The data folder outlives one test: start every test from the same document. */
  const current = JSON.parse((await mcpTool(base, sessionId, 'fablecut_get_project')).text);
  const { reply, text } = await mcpTool(base, sessionId, 'fablecut_patch_project', {
    ops: [
      ...(current.clips || []).map((/** @type {any} */ c) => ({ op: 'removeClip', id: c.id })),
      ...(current.media || []).map((/** @type {any} */ m) => ({ op: 'removeMedia', id: m.id })),
      { op: 'setProject', set: { name: 'Chat Test', fps: 30, markers: [{ t: 8, label: 'drop', color: 'red' }] } },
      { op: 'addMedia', media: { id: 'm_still', name: 'poster.png', kind: 'image', src: '/media/poster.png', width: 640, height: 360 } },
      { op: 'addClip', clip: { id: 'c_title', kind: 'text', track: 'V2', start: 0, duration: 2, props: { text: 'Opening line\nsecond line' } } },
      { op: 'addClip', clip: { id: 'c_shape', kind: 'shape', track: 'V1', start: 4, duration: 3, name: 'Box', props: { shapes: [{ type: 'rect', w: 100, h: 100, fill: '#ff0000' }] } } },
    ],
  });
  assert.equal(reply.json?.result?.isError, undefined, text);
}

/**
 * @param {import('node:test').TestContext} t
 * @param {{ bridge: 'record' | 'cancel' | 'none' }} options
 */
async function openEditor(t, { bridge }) {
  /* One runtime for the whole file: a disposed runtime stays stopped in this
     process (the media-process adapter refuses new work after shutdown). */
  const app = await startApp();
  await seedProject(app.base);
  const puppeteer = require(puppeteerPath);
  const api = puppeteer.default && typeof puppeteer.default.launch === 'function' ? puppeteer.default : puppeteer;
  const browser = await api.launch({ executablePath, headless: true, pipe: true, args: ['--no-sandbox'] });
  t.after(async () => { await browser.close(); });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (/** @type {Error} */ err) => { errors.push(String(err)); });
  page.on('console', (/** @type {any} */ msg) => { if (msg.type() === 'error' && !/404|Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  await page.evaluateOnNewDocument((/** @type {string} */ mode) => {
    localStorage.setItem('fablecut-locale', 'en');
    if (mode === 'none') return;
    /** @type {string[]} */
    const sent = [];
    Object.defineProperty(window, '__sent', { value: sent });
    Object.defineProperty(window, 'mcode', {
      value: {
        miniapp: {
          message: {
            append: async (/** @type {string} */ text) => {
              sent.push(text);
              if (mode === 'cancel') throw new Error('user_cancelled');
            },
          },
        },
      },
    });
  }, bridge);
  await page.goto(`${app.base}${app.surfacePath}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('.clip[data-id="c_shape"]') && document.querySelector('.clip[data-id="c_title"]'), { timeout: 20000 });
  return { page, errors };
}

/**
 * Right-click a point of the page, at fractions of an element's box.
 * @param {any} page
 * @param {string} selector
 * @param {number} fx
 * @param {number} fy
 */
async function rightClick(page, selector, fx = 0.5, fy = 0.5) {
  await page.evaluate((/** @type {string} */ sel, /** @type {number} */ x, /** @type {number} */ y) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`nothing matches ${sel}`);
    const r = el.getBoundingClientRect();
    const clientX = r.left + r.width * x, clientY = r.top + r.height * y;
    const target = document.elementFromPoint(clientX, clientY) || el;
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX, clientY, button: 2 }));
  }, selector, fx, fy);
  await page.waitForSelector('#trackCtxMenu', { timeout: 10000 });
}

/** @param {any} page */
const menuItems = (page) => page.evaluate(() => [...document.querySelectorAll('#trackCtxMenu .ctx-item')].map((b) => ({
  text: (b.textContent ?? '').trim(), disabled: /** @type {HTMLButtonElement} */ (b).disabled, title: b.getAttribute('title') ?? '',
})));

/**
 * Click the menu item whose text starts with `label` and wait for one more recorded text.
 * @param {any} page
 * @param {string} label
 */
async function pick(page, label) {
  const before = await page.evaluate(() => /** @type {any} */ (window).__sent.length);
  await page.evaluate((/** @type {string} */ l) => {
    const item = [...document.querySelectorAll('#trackCtxMenu .ctx-item')].find((b) => (b.textContent ?? '').trim().startsWith(l));
    if (!item) throw new Error(`no menu item ${l}`);
    /** @type {HTMLButtonElement} */ (item).click();
  }, label);
  await page.waitForFunction((/** @type {number} */ n) => /** @type {any} */ (window).__sent.length > n, { timeout: 10000 }, before);
  return page.evaluate(() => { const s = /** @type {any} */ (window).__sent; return s[s.length - 1]; });
}

test.after(async () => { if (!skip) await (await startApp()).dispose(); });

test('a clip, a moment, a marker and a media file can be sent to the chat', { skip }, async (t) => {
  const { page, errors } = await openEditor(t, { bridge: 'record' });

  /* A clip: its id, kind, track, time and the moment it was right-clicked. */
  await rightClick(page, '.clip[data-id="c_shape"]');
  const clipMenu = await menuItems(page);
  const send = clipMenu.find((i) => i.text === 'Send to chat');
  assert.ok(send, `the clip menu has no Send to chat: ${clipMenu.map((i) => i.text).join(' | ')}`);
  assert.equal(send.disabled, false);
  assert.equal(clipMenu[clipMenu.length - 1].text, 'Send to chat', 'Send to chat closes the clip menu');
  const clipText = await pick(page, 'Send to chat');
  assert.match(clipText, /^\[Cutline reference\]\n- Clip: c_shape · shape · track V1 · “Box”\n/);
  assert.match(clipText, /^ {2}Timeline: 00:04:00 → 00:07:00 \(4s → 7s, 3s\)$/m);
  const pointed = /^- Pointed at: \d\d:\d\d:\d\d \(([\d.]+)s\) · frame (\d+)$/m.exec(clipText);
  assert.ok(pointed, `no moment in ${clipText}`);
  assert.ok(+pointed[1] >= 4 && +pointed[1] < 7, `the moment ${pointed[1]} s is not on the clip`);
  assert.equal(Math.round(+pointed[1] * 30), +pointed[2], 'the moment is not on a frame');
  assert.match(clipText, /^- Sequence: Main \(id main\)$/m);
  assert.match(clipText, /^- Project: Chat Test · revision \d+ · 30 fps$/m);
  const toast = await page.$eval('#toast', (/** @type {Element} */ el) => el.textContent);
  assert.match(toast ?? '', /Added to the chat input/);

  /* An empty spot on V1 before the shape: the moment, the track, what plays there. */
  await page.evaluate(() => {
    const row = document.querySelector('.track[data-track="V1"]');
    const shape = document.querySelector('.clip[data-id="c_shape"]');
    if (!row || !shape) throw new Error('no V1 row');
    const r = row.getBoundingClientRect(), s = shape.getBoundingClientRect();
    const clientX = s.left - (s.width / 3) * 2.5; // 2.5 s before the shape: inside the title's span on V2
    const clientY = r.top + r.height / 2;
    (document.elementFromPoint(clientX, clientY) || row).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX, clientY, button: 2 }));
  });
  await page.waitForSelector('#trackCtxMenu', { timeout: 10000 });
  assert.deepEqual((await menuItems(page)).map((i) => i.text), ['Send this moment to chat']);
  const momentText = await pick(page, 'Send this moment to chat');
  assert.match(momentText, /^- Time: 00:01:\d\d \(1(\.\d+)?s\) · frame \d+$/m);
  assert.match(momentText, /^- Track: V1$/m);
  assert.match(momentText, /^ {2}- c_title · text · track V2 · “Opening line” · 0s → 2s$/m, 'the title plays at that moment');
  assert.doesNotMatch(momentText, /c_shape/, 'the shape does not play at that moment');

  /* The ruler away from any marker: the moment, no track. */
  await rightClick(page, '#ruler', 0.02, 0.3);
  assert.deepEqual((await menuItems(page)).map((i) => i.text), ['Send this moment to chat']);
  const rulerText = await pick(page, 'Send this moment to chat');
  assert.match(rulerText, /^- Time: /m);
  assert.doesNotMatch(rulerText, /^- Track:/m);

  /* A marker: the editor stays one click away, the marker can be sent. */
  await page.evaluate(() => {
    const ruler = document.getElementById('ruler');
    const scroll = document.getElementById('timelineScroll');
    const shape = document.querySelector('.clip[data-id="c_shape"]');
    if (!ruler || !scroll || !shape) throw new Error('no ruler');
    const r = ruler.getBoundingClientRect(), s = shape.getBoundingClientRect();
    const clientX = s.left + (s.width / 3) * 4; // 8 s: the marker
    const clientY = r.bottom - 4;
    ruler.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX, clientY, button: 2 }));
  });
  await page.waitForSelector('#trackCtxMenu', { timeout: 10000 });
  assert.deepEqual((await menuItems(page)).map((i) => i.text), ['Edit marker…', 'Send marker to chat']);
  const markerText = await pick(page, 'Send marker to chat');
  assert.match(markerText, /^- Marker: 00:08:00 \(8s\) · frame 240 · “drop” · red$/m);

  /* A media file in the bin, used nowhere. */
  await rightClick(page, '.bin-item');
  const mediaMenu = await menuItems(page);
  assert.equal(mediaMenu[1]?.text, 'Send to chat', 'Send to chat follows Open in Source');
  const mediaText = await pick(page, 'Send to chat');
  assert.match(mediaText, /^- Media: m_still · image · “poster\.png”$/m);
  assert.match(mediaText, /^ {2}File: poster\.png$/m);
  assert.match(mediaText, /^ {2}On the timeline: not used$/m);

  /* Sending never changed the project. */
  const doc = await page.evaluate(async () => (await fetch('/api/project')).json());
  assert.deepEqual(doc.clips.map((/** @type {any} */ c) => c.id).sort(), ['c_shape', 'c_title']);
  assert.deepEqual(doc.markers, [{ t: 8, label: 'drop', color: 'red' }]);

  assert.deepEqual(errors, [], 'the page logged errors');
});

test('the menu follows the interface language; the reference keeps raw ids', { skip }, async (t) => {
  const { page, errors } = await openEditor(t, { bridge: 'record' });
  await page.evaluate(() => {
    const sel = /** @type {HTMLSelectElement} */ (document.getElementById('setLang'));
    sel.value = 'zh-CN';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN', { timeout: 15000 });
  await rightClick(page, '.clip[data-id="c_title"]');
  const items = await menuItems(page);
  assert.ok(items.some((i) => i.text === '发送到对话'), `no Chinese item: ${items.map((i) => i.text).join(' | ')}`);
  const text = await pick(page, '发送到对话');
  assert.match(text, /^\[Cutline 引用\]$/m);
  assert.match(text, /^- 片段: c_title · text · 轨道 V2 · “Opening line”$/m, 'ids, kinds and user text stay as stored');
  assert.deepEqual(errors, [], 'the page logged errors');
});

test('a cancelled confirmation adds nothing and says so', { skip }, async (t) => {
  const { page, errors } = await openEditor(t, { bridge: 'cancel' });
  await rightClick(page, '.clip[data-id="c_title"]');
  await pick(page, 'Send to chat');
  await page.waitForFunction(() => /Not added/.test(document.getElementById('toast')?.textContent ?? ''), { timeout: 10000 });
  /* The editor keeps working: the menu opens again. */
  await rightClick(page, '.clip[data-id="c_title"]');
  assert.ok((await menuItems(page)).some((i) => i.text === 'Send to chat' && !i.disabled));
  assert.deepEqual(errors, [], 'the page logged errors');
});

test('without the Host bridge the items are disabled and say why', { skip }, async (t) => {
  const { page, errors } = await openEditor(t, { bridge: 'none' });
  for (const [selector, label, fx, fy] of /** @type {[string, string, number, number][]} */ ([
    ['.clip[data-id="c_title"]', 'Send to chat', 0.5, 0.5],
    ['#ruler', 'Send this moment to chat', 0.02, 0.3],
    ['.bin-item', 'Send to chat', 0.5, 0.5],
  ])) {
    await rightClick(page, selector, fx, fy);
    const item = (await menuItems(page)).find((i) => i.text === label);
    assert.ok(item, `${selector}: no ${label}`);
    assert.equal(item.disabled, true, `${selector}: ${label} is enabled without the bridge`);
    assert.match(item.title, /cannot add text to the chat input/);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('trackCtxMenu'), { timeout: 5000 });
  }
  assert.deepEqual(errors, [], 'the page logged errors');
});
