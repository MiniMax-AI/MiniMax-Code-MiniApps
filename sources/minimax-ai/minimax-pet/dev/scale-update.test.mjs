import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const source = await readFile(new URL('../miniapp/client/pet-app.js', import.meta.url), 'utf8');
const handler = source.slice(source.indexOf('function setScale(value)'), source.indexOf('// Import', source.indexOf('function setScale(value)')));
const sizing = source.slice(source.indexOf('const DESK_WIDTH = 280;'), source.indexOf('// Saved positions'));
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };
function harness(overrides = {}) {
  const calls = [], prefs = { scale: 1 }, app = { mode: 'window', workbenchOpen: false, menuOpen: false };
  const win = {
    update: async (patch) => { calls.push(['update', patch]); return { mode: 'window', window: { x: 0, y: 0, width: 280, height: 340, ...patch } }; },
  };
  const context = vm.createContext({
    app, prefs, scaleIntent: 0, scaleUpdates: Promise.resolve(), disposed: false, win,
    screen: { availLeft: 0, availTop: 0, availWidth: 1920, availHeight: 1080 },
    fitWindowToScreen: async () => { calls.push(['fit']); return { error: null }; },
    player: { setScale: (value) => calls.push(['scale', value]) },
    savePreferences: (patch) => calls.push(['save', patch.scale]), renderScale() {}, refreshInteractivity() {}, positionMenu() {},
    onWindowState: (state) => calls.push(['state', state?.window?.height]),
    errCode: (error) => error?.code ?? error?.message ?? 'unknown',
    closeWorkbench: async () => { app.workbenchOpen = false; calls.push(['close']); },
    showTransient: (text) => calls.push(['error', text]), logError: () => (error) => assert.fail(error),
    t: (key) => key, ...overrides,
  });
  vm.runInContext(`${sizing}\n${handler}\nglobalThis.setScaleHandler = setScale;`, context);
  return { calls, prefs, app, context, setScale: context.setScaleHandler };
}

test('a desktop size change resizes the window, then fits it, before applying the scale', async () => {
  const h = harness(); h.app.workbenchOpen = true;
  await h.setScale(0.5);
  // 436 = the fixed window height for the small pet, so the open card always fits.
  // Snapshotted through JSON: the patch object is built inside the sandbox realm.
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [
    ['close'], ['update', { width: 280, height: 436 }], ['state', 436],
    ['fit'], ['scale', 0.5], ['save', 0.5],
  ]);
});

test('opening and closing the card never resizes the window', async () => {
  const source = await readFile(new URL('../miniapp/client/pet-app.js', import.meta.url), 'utf8');
  for (const name of ['openWorkbench', 'closeWorkbench']) {
    const start = source.indexOf(`async function ${name}(`);
    assert.ok(start >= 0, name);
    const body = source.slice(start, source.indexOf('\n}', start));
    // A resize here moves the native window origin, which repaints the pet somewhere else
    // for a frame: the flicker the user reported on every click.
    assert.equal(/win\.update|setExpanded|workbenchWindow/u.test(body), false, `${name} must not touch window geometry`);
  }
});

test('failed reposition preserves the visible size and saved preference', async () => {
  const h = harness({ fitWindowToScreen: async () => ({ error: 'runtime_unavailable' }) });
  await h.setScale(0.5);
  assert.equal(h.prefs.scale, 1);
  // The window was already resized for the new pet size; only the scale is held back.
  assert.deepEqual(h.calls.map((call) => call[0]), ['update', 'state', 'error']);
});

test('latest size wins after an older in-flight geometry response', async () => {
  const pending = deferred(), started = deferred(); let count = 0;
  const h = harness({ fitWindowToScreen: async () => { if (++count === 1) { started.resolve(); return pending.promise; } return { error: null }; } });
  const old = h.setScale(0.5); await started.promise;
  const latest = h.setScale(0.75); pending.resolve({ error: null });
  await Promise.all([old, latest]);
  // The first operation was superseded while its fit was still pending: only the second
  // one applies its scale, and the superseded fit never reports.
  assert.deepEqual(h.calls.map((call) => call[0]), ['update', 'state', 'update', 'state', 'scale', 'save']);
  assert.equal(h.prefs.scale, 0.75);
});

test('a pending fit is abandoned when a newer size arrives', async () => {
  const pending = deferred(), started = deferred(); let count = 0;
  const h = harness({ fitWindowToScreen: async () => { if (++count === 1) { started.resolve(); return pending.promise; } return { error: null }; } });
  const old = h.setScale(0.5); await started.promise;
  const latest = h.setScale(0.75); pending.resolve({ error: null });
  await Promise.all([old, latest]);
  assert.equal(h.calls.filter((call) => call[0] === 'save').length, 1, 'only the newest size persists');
});

test('leaving the desktop during preparation invalidates a scale operation', async () => {
  const pending = deferred(), started = deferred();
  const h = harness({ fitWindowToScreen: async (_handle, options) => { started.resolve(); await pending.promise; return { cancelled: !options.isCurrent() }; } });
  const operation = h.setScale(0.5); await started.promise;
  h.app.mode = 'inline'; pending.resolve(); await operation;
  assert.equal(h.prefs.scale, 1);
  // The resize and its state reached the Host before the mode changed; nothing after it may.
  assert.deepEqual(h.calls.map((call) => call[0]), ['update', 'state']);
});
