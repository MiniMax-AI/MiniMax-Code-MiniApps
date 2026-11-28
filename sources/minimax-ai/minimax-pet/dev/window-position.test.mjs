import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { restoreWindowPosition, fitWindowToScreen } from '../miniapp/client/window-position.mjs';

function frameBridge() {
  let pending = [];
  const calls = [];
  const state = { mode: 'window', window: { x: 100, y: 100, clickThrough: true } };
  return {
    calls, state,
    update(patch) { calls.push(patch); return new Promise((resolve, reject) => { pending.push({ patch, resolve, reject }); }); },
    flush() {
      const batch = pending; pending = [];
      const patch = Object.assign({}, ...batch.map((item) => item.patch));
      // Model the public frame-merged update contract: reject the whole patch before any mutation.
      if (Math.abs(patch.x ?? 0) > 10000 || Math.abs(patch.y ?? 0) > 10000) {
        for (const item of batch) item.reject({ message: 'not_permitted' });
      } else {
        Object.assign(state.window, patch);
        for (const item of batch) item.resolve({ mode: state.mode, window: { ...state.window } });
      }
    },
  };
}

const advance = async () => { await Promise.resolve(); await Promise.resolve(); };

test('initial safe interaction settles independently before an off-screen geometry rejection', async () => {
  const handle = frameBridge();
  const restoring = restoreWindowPosition(handle, { x: 99999, y: 99999 });
  assert.deepEqual(handle.calls, [{ clickThrough: false }]);
  handle.flush(); await advance();
  assert.equal(handle.state.window.clickThrough, false);
  assert.deepEqual(handle.calls, [{ clickThrough: false }, { x: 99999, y: 99999 }]);
  handle.flush();
  const result = await restoring;
  assert.equal(result.error, 'not_permitted');
  assert.equal(result.interactive, true);
  assert.equal(result.restored, false);
  assert.equal(handle.state.window.clickThrough, false);
  assert.deepEqual([handle.state.window.x, handle.state.window.y], [100, 100]);
});

test('valid restoration only patches interaction then x/y; it never changes mode', async () => {
  const calls = [];
  const state = { mode: 'window', window: { x: 42, y: 51, clickThrough: false } };
  const result = await restoreWindowPosition({ update(patch) { calls.push(patch); return state; } }, { x: 42, y: 51 });
  assert.equal(result.restored, true);
  assert.equal(result.interactive, true);
  assert.deepEqual(calls, [{ clickThrough: false }, { x: 42, y: 51 }]);
});

test('a window without saved geometry still starts interactive', async () => {
  const calls = [];
  const result = await restoreWindowPosition({ update(patch) { calls.push(patch); return { mode: 'window' }; } }, null);
  assert.deepEqual(calls, [{ clickThrough: false }]);
  assert.equal(result.interactive, true);
  assert.equal(result.restored, false);
});

test('closing, replacement or disposal fences work before and after the safe interaction roundtrip', async () => {
  const inactive = frameBridge();
  assert.equal((await restoreWindowPosition(inactive, { x: 42, y: 51 }, { isCurrent: () => false })).cancelled, true);
  assert.deepEqual(inactive.calls, []);
  const handle = frameBridge();
  let live = true;
  const restoring = restoreWindowPosition(handle, { x: 42, y: 51 }, { isCurrent: () => live });
  live = false;
  handle.flush();
  assert.equal((await restoring).cancelled, true);
  assert.deepEqual(handle.calls, [{ clickThrough: false }]);
});

test('interaction failure never attempts geometry; uncertain geometry does not undo the accepted safe patch', async () => {
  const calls = [];
  const unsafe = await restoreWindowPosition({ update(patch) { calls.push(patch); throw { message: 'runtime_unavailable' }; } }, { x: 42, y: 51 });
  assert.equal(unsafe.interactive, false);
  assert.deepEqual(calls, [{ clickThrough: false }]);
  const uncertain = await restoreWindowPosition({ update(patch) { if ('x' in patch) throw { message: 'result_unknown' }; return { mode: 'window', window: { clickThrough: false } }; } }, { x: 42, y: 51 });
  assert.equal(uncertain.interactive, true);
  assert.equal(uncertain.error, 'result_unknown');
});

test('resize preparation brings a partly off-screen transparent window fully into its work area', async () => {
  for (const rect of [{ x: 0, y: 23, width: 1920, height: 1057 }, { x: -1920, y: -1080, width: 1920, height: 1057 }]) {
    for (const [x, y] of [[rect.x + 1864, rect.y + 1040], [rect.x - 224, rect.y - 290]]) {
      let state = { mode: 'window', window: { x, y, width: 280, height: 340, clickThrough: false } };
      const calls = [];
      const result = await fitWindowToScreen({ getState: async () => state, update: async (patch) => {
        calls.push(patch); state = { ...state, window: { ...state.window, ...patch } }; return state;
      } }, { screenRect: () => rect });
      assert.equal(result.error, null);
      assert.equal(calls.length, 1);
      assert.deepEqual(Object.keys(calls[0]).sort(), ['x', 'y']);
      const bounds = result.state.window;
      assert.ok(bounds.x >= rect.x && bounds.x + bounds.width <= rect.x + rect.width);
      assert.ok(bounds.y >= rect.y && bounds.y + bounds.height <= rect.y + rect.height);
    }
  }
});

test('a fully visible window needs no move; unavailable geometry and rejected moves are explicit', async () => {
  const state = { mode: 'window', window: { x: 100, y: 100, width: 280, height: 340 } };
  const handle = { getState: async () => state, update: () => assert.fail('No unnecessary move') };
  const screenRect = () => ({ x: 0, y: 0, width: 1920, height: 1080 });
  assert.equal((await fitWindowToScreen(handle, { screenRect })).state, state);
  assert.equal((await fitWindowToScreen(handle)).error, 'screen_unavailable');
  assert.equal((await fitWindowToScreen(handle, { screenRect: () => ({ x: 0, y: 0, width: 100, height: 100 }) })).error, 'screen_too_small');
  const failed = await fitWindowToScreen({ ...handle, getState: async () => ({ ...state, window: { ...state.window, x: 1864 } }),
    update() { throw { message: 'runtime_unavailable' }; } }, { screenRect });
  assert.equal(failed.error, 'runtime_unavailable');
});

test('closing during resize preparation never sends geometry to a different surface', async () => {
  let resolve, live = true;
  const pending = new Promise((yes) => { resolve = yes; });
  const operation = fitWindowToScreen({ getState: () => pending, update: () => assert.fail('No stale move') }, {
    screenRect: () => ({ x: 0, y: 0, width: 1920, height: 1080 }), isCurrent: () => live,
  });
  live = false; resolve({ mode: 'window', window: { x: 1864, y: 100, width: 280, height: 340 } });
  assert.equal((await operation).cancelled, true);
});

// Run the page's real window-entry handler with a controlled bridge. The fake Host permits
// partial overlap, like the desktop Host; it deliberately does not keep the sprite on-screen.
const page = await readFile(new URL('../miniapp/client/pet-app.js', import.meta.url), 'utf8');
const sizing = page.slice(page.indexOf('const DESK_WIDTH'), page.indexOf('let notificationPreviews'));
const windowEntry = page.slice(page.indexOf('function onWindowState('), page.indexOf('function applyMode('));

async function popOut({ origin, saved = null, workArea = { availLeft: 0, availTop: 0, availWidth: 1707, availHeight: 1019 } }) {
  const calls = [], notices = [], savedPositions = [];
  const prefs = { scale: 0.5, windowPosition: saved };
  const app = { mode: 'inline', positionRestoreToken: 0 };
  const bounds = { x: origin.x, y: origin.y, width: 280, height: 436, clickThrough: true };
  const state = () => ({ mode: 'window', window: { ...bounds } });
  const win = {
    getState: async () => state(),
    update: async (patch) => {
      calls.push({ ...patch });
      if (patch.x === 50000) throw new Error('not_permitted');
      Object.assign(bounds, patch);
      return state();
    },
  };
  const screen = typeof workArea === 'function' ? workArea(bounds) : workArea;
  const context = vm.createContext({
    app, prefs, win, screen, start: state(), disposed: false, restoreWindowPosition, fitWindowToScreen,
    applyMode: (mode) => { app.mode = mode; }, showTransient: (message) => notices.push(message),
    t: (key) => key, errCode: (error) => error.message,
    clearTimeout() {}, setTimeout: (fn) => { fn(); return 1; },
    savePreferences: (patch) => { savedPositions.push({ ...patch.windowPosition }); },
  });
  vm.runInContext(`${sizing}\n${windowEntry}\nonWindowState(start);`, context);
  await new Promise((resolve) => setImmediate(resolve));
  return { app, calls, notices, savedPositions };
}

test('pop-out fits an off-screen Host default even without a saved position', async () => {
  const h = await popOut({ origin: { x: 1090, y: 846 } });
  // 1019 is the reproduced work-area bottom; 436 is the small pet's designed height.
  assert.deepEqual(h.calls, [{ clickThrough: false }, { x: 1090, y: 583, width: 280, height: 436 }]);
  assert.equal(h.app.restoringPosition, false);
  assert.deepEqual(h.savedPositions, [{ x: 1090, y: 679 }], 'persist only the corrected bottom anchor');
});

test('pop-out fits a partially visible saved position above the display', async () => {
  const h = await popOut({ origin: { x: 200, y: 200 }, saved: { x: 1093, y: -322 } });
  assert.equal(h.calls[1].y, -418, 'the stored bottom anchor resolves to the old off-screen origin');
  assert.deepEqual(h.calls.at(-1), { x: 1093, y: 0, width: 280, height: 436 });
  assert.deepEqual(h.savedPositions, [{ x: 1093, y: 96 }]);
});

test('pop-out keeps a valid saved position on a display left of the primary one', async () => {
  const h = await popOut({ origin: { x: 200, y: 200 }, saved: { x: -1000, y: 146 }, workArea: (bounds) => ({
    get availLeft() { return bounds.x < 0 ? -1920 : 0; }, availTop: 0, availWidth: 1920, availHeight: 1080,
  }) });
  assert.equal(h.calls.length, 2, 'a valid position should not be moved again');
  assert.equal(h.app.winBounds.x, -1000);
  assert.equal(h.app.winBounds.y, 50);
  assert.deepEqual(h.savedPositions, []);
});

test('pop-out recovers from a rejected position on a disconnected display', async () => {
  const h = await popOut({ origin: { x: 1090, y: 846 }, saved: { x: 50000, y: 100 } });
  assert.deepEqual(h.calls.at(-1), { x: 1090, y: 583, width: 280, height: 436 });
  assert.deepEqual(h.notices, [], 'the fallback fit succeeded');
});

test('pop-out keeps the sprite at the bottom on a display shorter than the window', async () => {
  const h = await popOut({ origin: { x: 30, y: 50 }, workArea: { availLeft: 0, availTop: 0, availWidth: 260, availHeight: 400 } });
  assert.deepEqual(h.calls.at(-1), { x: -10, y: -36, width: 280, height: 436 });
  assert.equal(h.app.winBounds.y + h.app.winBounds.height, 400);
  assert.deepEqual(h.notices, []);
});
