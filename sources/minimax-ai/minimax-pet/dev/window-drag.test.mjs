import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const source = await readFile(new URL('../miniapp/client/pet-app.js', import.meta.url), 'utf8');
const handler = source.slice(source.indexOf('function onSpritePointerDown'), source.indexOf('function cancelDrag'));

// The Host keeps the window origin; a pointer inside the window is measured
// from that origin, so the pointer offset shrinks while the window follows it.
function harness({ failFirst = 0 } = {}) {
  const calls = [];
  const host = { x: 1000, y: 500 };
  let failed = 0;
  let request = null;
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
        return new Promise((resolve, reject) => { request = { patch, resolve, reject }; });
      },
      getState() { return { mode: 'window', window: { ...host, width: 280, height: 340 } }; },
    },
    callBridge: (fn) => { try { return Promise.resolve(fn()); } catch (error) { return Promise.reject(error); } },
    errCode: (error) => error?.code || error?.message || 'result_unknown',
    logError: () => () => {},
    player: { play: (name) => { calls.push(['play', name]); return Promise.resolve(); } },
    noteInteraction() {}, closeMenu() {}, hideQuickbar() {}, stopLook() {}, refreshInteractivity() {},
    playOneShot() {}, desiredAnimation: () => ({ state: 'idle' }), openWorkbench() {}, applyActivity() {},
    onWindowState() {},
    DRAG_THRESHOLD: 4, DIRECTION_HYSTERESIS: 12,
    console: { warn() {}, debug() {}, error() {} },
  });
  vm.runInContext(`${handler}\nglobalThis.dragApi = { onSpritePointerDown, onSpritePointerMove, finishDrag };`, context);
  const api = context.dragApi;
  // screenMode 'local' reproduces the popped-out window, where screenX is the
  // pointer position inside the window instead of a screen coordinate. The
  // drag must not read screenX in either mode.
  const event = (type, pointer, screenMode) => {
    const clientX = pointer.x - host.x;
    const clientY = pointer.y - host.y;
    return {
      pointerId: 1, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX, clientY,
      screenX: screenMode === 'absolute' ? pointer.x : clientX,
      screenY: screenMode === 'absolute' ? pointer.y : clientY,
      preventDefault() {},
    };
  };
  // The Host moves the window at the next animation frame and answers the
  // request a moment later, so a pointermove can land in between.
  function applyMove() {
    if (!request) return;
    if (failed < failFirst) {
      failed += 1;
      const refused = request;
      request = null;
      refused.reject(Object.assign(new Error('off screen'), { code: 'not_permitted' }));
      return;
    }
    host.x = request.patch.x;
    host.y = request.patch.y;
    app.winPos = { x: host.x, y: host.y };
  }
  function answer() {
    if (!request) return;
    const answered = request;
    request = null;
    answered.resolve({ mode: 'window', window: { ...host, width: 280, height: 340 } });
  }
  return {
    calls, app, host,
    press: (pointer, screenMode) => api.onSpritePointerDown(event('pointerdown', pointer, screenMode)),
    move: (pointer, screenMode) => api.onSpritePointerMove(event('pointermove', pointer, screenMode)),
    release: (pointer, screenMode) => api.finishDrag(event('pointerup', pointer, screenMode), false),
    updates: () => calls.filter((call) => call[0] === 'update'),
    plays: () => calls.filter((call) => call[0] === 'play').map((call) => call[1]),
    applyMove,
    answer,
    // One Host frame: the window moves, then the request is answered.
    advance: async () => {
      applyMove();
      answer();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

for (const screenMode of ['local', 'absolute']) {
  test(`a held pointer keeps the window still (${screenMode} screenX)`, async () => {
    const h = harness();
    const pointer = { x: 1100, y: 700 };
    h.press(pointer, screenMode);
    // The cursor moves 30px to the right; the window follows.
    pointer.x = 1130;
    h.move(pointer, screenMode);
    await h.advance();
    // The cursor stops. The window moved under it, so the pointer offset inside
    // the window shrinks back to the grab point: the window must not move.
    h.move(pointer, screenMode);
    await h.advance();
    assert.deepEqual(h.updates(), [['update', 1030, 500]]);
    assert.deepEqual(h.host, { x: 1030, y: 500 });
  });

  test(`the window follows a moving pointer (${screenMode} screenX)`, async () => {
    const h = harness();
    const pointer = { x: 1100, y: 700 };
    h.press(pointer, screenMode);
    pointer.x = 1130;
    h.move(pointer, screenMode);
    await h.advance();
    pointer.x = 1200;
    h.move(pointer, screenMode);
    await h.advance();
    // The window origin is the pointer position minus the grab offset.
    assert.deepEqual(h.updates(), [['update', 1030, 500], ['update', 1100, 500]]);
    assert.deepEqual(h.host, { x: 1100, y: 500 });
  });

  test(`a refused move resumes from the window the Host kept (${screenMode} screenX)`, async () => {
    const h = harness({ failFirst: Infinity });
    const pointer = { x: 1100, y: 700 };
    h.press(pointer, screenMode);
    pointer.x = 1130;
    h.move(pointer, screenMode);
    await h.advance();
    // The Host refused the move, so the window stayed at 1000.
    pointer.x = 1160;
    h.move(pointer, screenMode);
    await h.advance();
    assert.deepEqual(h.updates(), [['update', 1030, 500], ['update', 1060, 500]]);
  });
}

test('the drag direction follows the window target, not the pointer inside the window', async () => {
  const h = harness();
  const pointer = { x: 1100, y: 700 };
  h.press(pointer, 'local');
  pointer.x = 1200;
  h.move(pointer, 'local');
  await h.advance();
  // The window caught up, so the pointer offset inside the window is back to
  // the grab point while the window keeps moving to the right.
  h.move(pointer, 'local');
  await h.advance();
  assert.deepEqual(h.plays(), ['running-right']);
});

test('a movement below the threshold does not move the window', async () => {
  const h = harness();
  const pointer = { x: 1100, y: 700 };
  h.press(pointer, 'local');
  pointer.x = 1102;
  h.move(pointer, 'local');
  await h.advance();
  assert.deepEqual(h.updates(), []);
  assert.equal(h.app.dragging, false);
});

test('a refused update does not roll the origin back past a later accepted one', async () => {
  const h = harness({ failFirst: 1 });
  const pointer = { x: 1100, y: 700 };
  h.press(pointer, 'local');
  // The second move arrives while the first update is still in flight, so the
  // refused answer comes back after a later update was already accepted.
  pointer.x = 1130;
  h.move(pointer, 'local');
  pointer.x = 1190;
  h.move(pointer, 'local');
  await h.advance();
  // The refused update did not move the window; the accepted one did.
  assert.deepEqual(h.updates(), [['update', 1030, 500], ['update', 1090, 500]]);
  // The Host applied the accepted update at the next frame, so the pointer is
  // measured against the window it already moved.
  h.applyMove();
  pointer.x = 1170;
  h.move(pointer, 'local');
  await h.advance();
  // The next target is measured against the position the Host holds (1090),
  // not against the one the refused update rolled back to (1000).
  assert.deepEqual(h.updates(), [['update', 1030, 500], ['update', 1090, 500], ['update', 1070, 500]]);
  await h.advance();
  assert.deepEqual(h.host, { x: 1070, y: 500 });
});

test('a fast drag counts a movement that has not landed yet only once', async () => {
  const h = harness();
  const pointer = { x: 1100, y: 700 };
  h.press(pointer, 'local');
  pointer.x = 1130;
  h.move(pointer, 'local');
  // The Host moved the window to 1030 but has not answered the request yet.
  h.applyMove();
  // The second move arrives before the answer, measured against the window
  // the Host already moved.
  pointer.x = 1160;
  h.move(pointer, 'local');
  await h.advance();
  await h.advance();
  // One update is in flight at a time, and the window lands on the pointer
  // instead of past it.
  assert.deepEqual(h.updates(), [['update', 1030, 500], ['update', 1060, 500]]);
  assert.deepEqual(h.host, { x: 1060, y: 500 });
});

test('a pending move of one pointer step keeps the target on the pointer', async () => {
  const h = harness();
  const pointer = { x: 1100, y: 700 };
  h.press(pointer, 'local');
  // s = 10: the update in flight moves the window by one pointer step.
  pointer.x = 1110;
  h.move(pointer, 'local');
  h.applyMove();
  // v = 10: the pointer moves one more step while the answer is pending.
  pointer.x = 1120;
  h.move(pointer, 'local');
  await h.advance();
  await h.advance();
  // The confirmed origin plus the pointer offset is the only target that
  // holds when the pending move and the pointer step are the same size.
  assert.deepEqual(h.updates(), [['update', 1010, 500], ['update', 1020, 500]]);
  assert.deepEqual(h.host, { x: 1020, y: 500 });
});

test('a pending move of two pointer steps keeps the target on the pointer', async () => {
  const h = harness();
  const pointer = { x: 1100, y: 700 };
  h.press(pointer, 'local');
  // s = 20: the update in flight moves the window by two pointer steps.
  pointer.x = 1120;
  h.move(pointer, 'local');
  h.applyMove();
  // v = 10: the pointer moves one step while the answer is pending.
  pointer.x = 1130;
  h.move(pointer, 'local');
  await h.advance();
  await h.advance();
  assert.deepEqual(h.updates(), [['update', 1020, 500], ['update', 1030, 500]]);
  assert.deepEqual(h.host, { x: 1030, y: 500 });
});

test('the release waits for the update in flight before the final position', async () => {
  const h = harness();
  const pointer = { x: 1100, y: 700 };
  h.press(pointer, 'local');
  pointer.x = 1130;
  h.move(pointer, 'local');
  h.applyMove();
  pointer.x = 1160;
  h.move(pointer, 'local');
  // The release happens while the update is still in flight: nothing goes out
  // yet, the final position waits for the answer.
  h.release(pointer, 'local');
  assert.deepEqual(h.updates(), [['update', 1030, 500]]);
  await h.advance();
  await h.advance();
  assert.deepEqual(h.updates(), [['update', 1030, 500], ['update', 1060, 500]]);
  assert.deepEqual(h.host, { x: 1060, y: 500 });
});
