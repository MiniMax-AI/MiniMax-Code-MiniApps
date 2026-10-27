import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkbenchWindow } from '../miniapp/client/workbench-window.mjs';

const settle = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const clone = (value) => structuredClone(value);
function harness(options = {}) {
  let state = { mode: 'window', window: { x: 1500, y: 680, width: 280, height: 340, minWidth: 240, minHeight: 280, resizable: true }, ...options.state };
  let listener, disposed = false;
  const calls = [];
  const api = {
    getState: async () => clone(state),
    update: async (patch) => { calls.push(clone(patch)); state = { ...state, window: { ...state.window, ...patch } }; listener?.(clone(state)); return clone(state); },
    onDidChangeState(callback) { listener = callback; return { dispose() { disposed = true; listener = null; } }; },
    ...options.api,
  };
  const controller = createWorkbenchWindow({ windowAPI: api, screenRect: () => ({ x: 0, y: 25, width: 1920, height: 1055 }), expandedSize: { width: 420, height: 640 }, ...options });
  return { controller, api, calls, state: () => clone(state), setState(value) { state = value; }, emit(value) { state = value; listener?.(clone(value)); }, unsubscribed: () => disposed };
}

test('the default companion bubble keeps the compact height and only adds a small width', async () => {
  const h = harness({ expandedSize: undefined });
  await h.controller.setExpanded(true);
  assert.deepEqual(h.calls[0], { x: 1480, y: 680, width: 300, height: 340 });
  await h.controller.setExpanded(false);
  assert.deepEqual(h.calls[1], { x: 1500, y: 680, width: 280, height: 340 });
});

test('expands once at the bottom-right anchor and closes to the original compact size', async () => {
  const h = harness();
  assert.deepEqual(await h.controller.setExpanded(true), { ok: true });
  assert.deepEqual(h.calls, [{ x: 1360, y: 380, width: 420, height: 640 }]);
  assert.deepEqual(await h.controller.setExpanded(true), { ok: true });
  assert.equal(h.calls.length, 1, 'opening an already expanded workbench is idempotent');
  assert.deepEqual(await h.controller.setExpanded(false), { ok: true });
  assert.deepEqual(h.calls[1], { x: 1500, y: 680, width: 280, height: 340 });
  h.controller.dispose(); assert.equal(h.unsubscribed(), true);
});

test('clamps into a negative-origin work area instead of assuming the primary display', async () => {
  const h = harness({ state: { mode: 'window', window: { x: -1900, y: -200, width: 280, height: 340, resizable: true } }, screenRect: () => ({ x: -1920, y: -300, width: 1920, height: 1080 }) });
  await h.controller.setExpanded(true);
  assert.deepEqual(h.calls[0], { x: -1920, y: -300, width: 420, height: 640 });
});

test('closing after an expanded drag retains the new bottom-right position', async () => {
  const h = harness(); await h.controller.setExpanded(true);
  h.setState({ mode: 'window', window: { ...h.state().window, x: 100, y: 100 } });
  await h.controller.setExpanded(false);
  assert.deepEqual(h.calls[1], { x: 240, y: 400, width: 280, height: 340 });
});

test('small screens bound dimensions and declared minimums are respected', async () => {
  const h = harness({ screenRect: () => ({ x: 0, y: 0, width: 400, height: 600 }) });
  await h.controller.setExpanded(true);
  assert.deepEqual(h.calls[0], { x: 0, y: 0, width: 400, height: 600 });
  const tooSmall = harness({ screenRect: () => ({ x: 0, y: 0, width: 200, height: 600 }) });
  assert.deepEqual(await tooSmall.controller.setExpanded(true), { ok: false, code: 'screen_too_small' });
  assert.deepEqual(tooSmall.calls, []);
});

test('unknown work area makes no geometry change and a failed opening does not capture a compact size', async () => {
  let rect;
  const h = harness({ screenRect: () => rect });
  assert.deepEqual(await h.controller.setExpanded(true), { ok: false, code: 'screen_unavailable' });
  assert.deepEqual(h.calls, []);
  h.setState({ mode: 'window', window: { ...h.state().window, width: 300, height: 360 } });
  rect = { x: 0, y: 0, width: 1920, height: 1080 };
  await h.controller.setExpanded(true); await h.controller.setExpanded(false);
  assert.equal(h.calls[1].width, 300); assert.equal(h.calls[1].height, 360);
});

test('open then close before a state read settles drops the stale open', async () => {
  const read = deferred(); let reads = 0;
  const h = harness({ api: { getState() { reads += 1; return reads === 1 ? read.promise : Promise.resolve(h.state()); } } });
  const open = h.controller.setExpanded(true); await settle();
  const close = h.controller.setExpanded(false);
  read.resolve(h.state());
  assert.deepEqual(await open, { ok: false, code: 'superseded' });
  assert.deepEqual(await close, { ok: true }); assert.deepEqual(h.calls, []);
});

test('open already committed in flight is serialized before the latest close', async () => {
  const update = deferred();
  const h = harness({ api: { update(patch) { h.calls.push(clone(patch)); if (h.calls.length === 1) return update.promise; h.setState({ mode: 'window', window: { ...h.state().window, ...patch } }); return Promise.resolve(h.state()); } } });
  const open = h.controller.setExpanded(true); await settle();
  const close = h.controller.setExpanded(false); await settle();
  assert.equal(h.calls.length, 1, 'second geometry request waits for the first');
  h.setState({ mode: 'window', window: { ...h.state().window, ...h.calls[0] } }); update.resolve(h.state());
  assert.deepEqual(await open, { ok: false, code: 'superseded' });
  assert.deepEqual(await close, { ok: true });
  assert.deepEqual(h.calls[1], { x: 1500, y: 680, width: 280, height: 340 });
});

test('multiple queued intents apply only the latest requested geometry', async () => {
  const h = harness();
  const results = await Promise.all([h.controller.setExpanded(true), h.controller.setExpanded(false), h.controller.setExpanded(true)]);
  assert.deepEqual(results, [{ ok: false, code: 'superseded' }, { ok: false, code: 'superseded' }, { ok: true }]);
  assert.equal(h.calls.length, 1);
});

test('inline event or external lifetime invalidation fences a pending state read', async () => {
  for (const cause of ['inline', 'current', 'dispose']) {
    const read = deferred(); let current = true;
    const h = harness({ isCurrent: () => current, api: { getState: () => read.promise } });
    const open = h.controller.setExpanded(true); await settle();
    if (cause === 'inline') h.emit({ mode: 'inline' });
    if (cause === 'current') current = false;
    if (cause === 'dispose') h.controller.dispose();
    read.resolve({ mode: 'window', window: { x: 10, y: 10, width: 280, height: 340 } });
    assert.deepEqual(await open, { ok: false, code: 'cancelled' }, cause); assert.deepEqual(h.calls, [], cause);
  }
});

test('late update resolution after inline or disposal never causes a second geometry patch', async () => {
  for (const cause of ['inline', 'dispose']) {
    const update = deferred();
    const h = harness({ api: { update(patch) { h.calls.push(clone(patch)); return update.promise; } } });
    const open = h.controller.setExpanded(true); await settle();
    const close = h.controller.setExpanded(false);
    if (cause === 'inline') h.emit({ mode: 'inline' }); else h.controller.dispose();
    update.resolve({ mode: 'window', window: { x: 0, y: 0, width: 420, height: 640 } });
    assert.deepEqual(await open, { ok: false, code: 'cancelled' });
    assert.deepEqual(await close, { ok: false, code: 'cancelled' }); assert.equal(h.calls.length, 1);
  }
});

test('mode changes between expansion cycles reset the saved compact dimensions', async () => {
  const h = harness(); await h.controller.setExpanded(true);
  h.emit({ mode: 'inline' });
  h.emit({ mode: 'window', window: { x: 100, y: 100, width: 320, height: 380, resizable: true } });
  await h.controller.setExpanded(true); await h.controller.setExpanded(false);
  assert.equal(h.calls.at(-1).width, 320); assert.equal(h.calls.at(-1).height, 380);
});

test('read and resize failures are explicit, preserve state and permit a deliberate retry', async () => {
  const h = harness(); const original = h.state();
  h.api.getState = async () => { throw new Error('runtime_unavailable'); };
  assert.deepEqual(await h.controller.setExpanded(true), { ok: false, code: 'runtime_unavailable' });
  h.api.getState = async () => h.state();
  const update = h.api.update;
  h.api.update = async () => { throw { code: 'not_permitted' }; };
  assert.deepEqual(await h.controller.setExpanded(true), { ok: false, code: 'not_permitted' });
  assert.deepEqual(h.state(), original); assert.deepEqual(h.calls, []);
  h.api.update = update;
  await h.controller.setExpanded(true);
  h.api.update = async () => { throw new Error('busy'); };
  assert.deepEqual(await h.controller.setExpanded(false), { ok: false, code: 'busy' });
  assert.equal(h.state().window.width, 420);
  h.api.update = update; assert.deepEqual(await h.controller.setExpanded(false), { ok: true });
  assert.equal(h.state().window.width, 280);
});

test('unavailable, inline and non-resizable handles fail without writing geometry', async () => {
  assert.deepEqual(await createWorkbenchWindow().setExpanded(true), { ok: false, code: 'unsupported' });
  const inline = harness({ state: { mode: 'inline' } });
  assert.deepEqual(await inline.controller.setExpanded(true), { ok: false, code: 'inline_mode' });
  const fixed = harness({ state: { mode: 'window', window: { x: 0, y: 0, width: 280, height: 340, resizable: false } } });
  assert.deepEqual(await fixed.controller.setExpanded(true), { ok: false, code: 'not_permitted' });
  assert.deepEqual(fixed.calls, []); assert.deepEqual(inline.calls, []);
});
