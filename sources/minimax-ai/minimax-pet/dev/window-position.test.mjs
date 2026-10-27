import assert from 'node:assert/strict';
import test from 'node:test';
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
