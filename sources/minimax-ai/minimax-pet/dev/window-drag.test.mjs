import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const source = await readFile(new URL('../miniapp/client/pet-app.js', import.meta.url), 'utf8');
const handler = source.slice(source.indexOf('function onSpritePointerDown'), source.indexOf('function finishDrag'));

// The Host keeps the window origin; a pointer inside the window is measured
// from that origin, so the pointer offset shrinks while the window follows it.
function harness({ reject = false } = {}) {
  const calls = [];
  const host = { x: 1000, y: 500 };
  const app = {
    mode: 'window', pet: {}, winPos: { ...host }, drag: null, dragging: false,
    oneShotToken: 0, oneShot: false, menuOpen: false, workbenchOpen: false,
  };
  const context = vm.createContext({
    app,
    els: { sprite: {
      setPointerCapture() {}, hasPointerCapture: () => false, releasePointerCapture() {},
      classList: { add() {}, remove() {} },
    } },
    win: {
      update(patch) {
        calls.push(['update', patch.x, patch.y]);
        if (reject) return Promise.reject(Object.assign(new Error('off screen'), { code: 'not_permitted' }));
        host.x = patch.x;
        host.y = patch.y;
        app.winPos = { x: patch.x, y: patch.y };
        return Promise.resolve({ mode: 'window', window: { ...host, width: 280, height: 340 } });
      },
    },
    callBridge: (fn) => { try { return Promise.resolve(fn()); } catch (error) { return Promise.reject(error); } },
    errCode: (error) => error?.code || error?.message || 'result_unknown',
    logError: () => () => {},
    player: { play: (name) => { calls.push(['play', name]); return Promise.resolve(); } },
    noteInteraction() {}, closeMenu() {}, hideQuickbar() {}, stopLook() {}, refreshInteractivity() {},
    DRAG_THRESHOLD: 4, DIRECTION_HYSTERESIS: 12,
    console: { warn() {}, debug() {}, error() {} },
  });
  vm.runInContext(`${handler}\nglobalThis.dragApi = { onSpritePointerDown, onSpritePointerMove };`, context);
  const api = context.dragApi;
  // screenMode 'local' reproduces the popped-out window, where screenX is the
  // pointer position inside the window instead of a screen coordinate. The
  // drag must not read screenX in either mode.
  const event = (type, pointer, screenMode) => {
    const clientX = pointer.x - host.x;
    const clientY = pointer.y - host.y;
    return {
      pointerId: 1, button: 0, buttons: 1, clientX, clientY,
      screenX: screenMode === 'absolute' ? pointer.x : clientX,
      screenY: screenMode === 'absolute' ? pointer.y : clientY,
      preventDefault() {},
    };
  };
  return {
    calls, app, host,
    press: (pointer, screenMode) => api.onSpritePointerDown(event('pointerdown', pointer, screenMode)),
    move: (pointer, screenMode) => api.onSpritePointerMove(event('pointermove', pointer, screenMode)),
    updates: () => calls.filter((call) => call[0] === 'update'),
    plays: () => calls.filter((call) => call[0] === 'play').map((call) => call[1]),
  };
}

for (const screenMode of ['local', 'absolute']) {
  test(`a held pointer keeps the window still (${screenMode} screenX)`, () => {
    const h = harness();
    const pointer = { x: 1100, y: 700 };
    h.press(pointer, screenMode);
    // The cursor moves 30px to the right; the window follows.
    pointer.x = 1130;
    h.move(pointer, screenMode);
    assert.deepEqual(h.updates(), [['update', 1030, 500]]);
    // The cursor stops. The window moved under it, so the pointer offset inside
    // the window shrinks back to the grab point: the window must not move.
    h.move(pointer, screenMode);
    h.move(pointer, screenMode);
    assert.deepEqual(h.updates(), [['update', 1030, 500]]);
    assert.deepEqual(h.host, { x: 1030, y: 500 });
  });

  test(`the window follows a moving pointer (${screenMode} screenX)`, () => {
    const h = harness();
    const pointer = { x: 1100, y: 700 };
    h.press(pointer, screenMode);
    pointer.x = 1130;
    h.move(pointer, screenMode);
    pointer.x = 1200;
    h.move(pointer, screenMode);
    // The window origin is the pointer position minus the grab offset.
    assert.deepEqual(h.updates(), [['update', 1030, 500], ['update', 1100, 500]]);
    assert.deepEqual(h.host, { x: 1100, y: 500 });
  });

  test(`a refused move resumes from the window the Host kept (${screenMode} screenX)`, async () => {
    const h = harness({ reject: true });
    const pointer = { x: 1100, y: 700 };
    h.press(pointer, screenMode);
    pointer.x = 1130;
    h.move(pointer, screenMode);
    await Promise.resolve();
    // The Host refused the move, so the window stayed at 1000.
    pointer.x = 1160;
    h.move(pointer, screenMode);
    assert.deepEqual(h.updates(), [['update', 1030, 500], ['update', 1060, 500]]);
  });
}

test('the drag direction follows the window target, not the pointer inside the window', () => {
  const h = harness();
  const pointer = { x: 1100, y: 700 };
  h.press(pointer, 'local');
  pointer.x = 1200;
  h.move(pointer, 'local');
  // The window caught up, so the pointer offset inside the window is back to
  // the grab point while the window keeps moving to the right.
  h.move(pointer, 'local');
  assert.deepEqual(h.plays(), ['running-right']);
});

test('a movement below the threshold does not move the window', () => {
  const h = harness();
  const pointer = { x: 1100, y: 700 };
  h.press(pointer, 'local');
  pointer.x = 1102;
  h.move(pointer, 'local');
  assert.deepEqual(h.updates(), []);
  assert.equal(h.app.dragging, false);
});
