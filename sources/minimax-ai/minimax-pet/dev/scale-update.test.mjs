import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const source = await readFile(new URL('../miniapp/client/pet-app.js', import.meta.url), 'utf8');
const handler = source.slice(source.indexOf('function setScale(value)'), source.indexOf('// Import', source.indexOf('function setScale(value)')));
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };
function harness(overrides = {}) {
  const calls = [], prefs = { scale: 1 }, app = { mode: 'window', workbenchOpen: false, menuOpen: false };
  const context = vm.createContext({
    app, prefs, scaleIntent: 0, scaleUpdates: Promise.resolve(), disposed: false, win: {},
    screen: { availLeft: 0, availTop: 0, availWidth: 1920, availHeight: 1080 },
    fitWindowToScreen: async () => { calls.push(['fit']); return { error: null }; },
    player: { setScale: (value) => calls.push(['scale', value]) },
    savePreferences: (patch) => calls.push(['save', patch.scale]), renderScale() {}, refreshInteractivity() {}, positionMenu() {}, onWindowState() {},
    closeWorkbench: async () => { app.workbenchOpen = false; calls.push(['close']); },
    showTransient: (text) => calls.push(['error', text]), logError: () => (error) => assert.fail(error), ...overrides,
  });
  vm.runInContext(`${handler}\nglobalThis.setScaleHandler = setScale;`, context);
  return { calls, prefs, app, context, setScale: context.setScaleHandler };
}

test('a desktop size change fits geometry before applying and persisting the scale', async () => {
  const h = harness(); h.app.workbenchOpen = true;
  await h.setScale(0.5);
  assert.deepEqual(h.calls, [['close'], ['fit'], ['scale', 0.5], ['save', 0.5]]);
});

test('failed reposition preserves the visible size and saved preference', async () => {
  const h = harness({ fitWindowToScreen: async () => ({ error: 'runtime_unavailable' }) });
  await h.setScale(0.5);
  assert.equal(h.prefs.scale, 1);
  assert.deepEqual(h.calls.map((call) => call[0]), ['error']);
});

test('latest size wins after an older in-flight geometry response', async () => {
  const pending = deferred(), started = deferred(); let count = 0;
  const h = harness({ fitWindowToScreen: async () => { if (++count === 1) { started.resolve(); return pending.promise; } return { error: null }; } });
  const old = h.setScale(0.5); await started.promise;
  const latest = h.setScale(0.75); pending.resolve({ error: null });
  await Promise.all([old, latest]);
  assert.deepEqual(h.calls, [['scale', 0.75], ['save', 0.75]]);
  assert.equal(h.prefs.scale, 0.75);
});

test('leaving the desktop during preparation invalidates a scale operation', async () => {
  const pending = deferred(), started = deferred();
  const h = harness({ fitWindowToScreen: async (_handle, options) => { started.resolve(); await pending.promise; return { cancelled: !options.isCurrent() }; } });
  const operation = h.setScale(0.5); await started.promise;
  h.app.mode = 'inline'; pending.resolve(); await operation;
  assert.equal(h.prefs.scale, 1); assert.deepEqual(h.calls, []);
});
