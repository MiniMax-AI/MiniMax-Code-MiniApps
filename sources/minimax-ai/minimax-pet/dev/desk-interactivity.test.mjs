import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

// Click-through and the hover animation both depend on state the page keeps in `app`.
// These tests drive the production functions with a fake bridge and record the patches.
const source = await readFile(new URL('../miniapp/client/pet-app.js', import.meta.url), 'utf8');

function slice(from, to) {
  const start = source.indexOf(from);
  assert.ok(start >= 0, `missing ${from}`);
  const end = source.indexOf(to, start);
  assert.ok(end > start, `missing ${to}`);
  return source.slice(start, end);
}

const geometry = slice('function isOverPet(', 'function isOverOverlay(');
const overlays = slice('function isOverOverlay(', 'function refreshInteractivity(');
const interactivity = slice('function refreshInteractivity()', 'function armForwardingWatchdog()');
const animation = slice('function desiredAnimation()', 'function availabilityText()');

function harness({ overrides = {} } = {}) {
  const updates = [];
  const app = {
    mode: 'window', modeSwitching: false, restoringPosition: false, awaitingPointer: false,
    workbenchOpen: false, menuOpen: false, dragging: false, hovered: false, pet: {},
    pointer: null, clickThrough: null, ctForwarding: 'verified', ctSafeHold: false, ctRetryAt: 0,
    source: 'real', availability: 'ready', demoStatus: 'idle',
    ...overrides,
  };
  const elements = {
    bubble: { hidden: true, getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0 }) },
    notificationStack: { hidden: true, getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0 }) },
    quickbar: { hidden: true, getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0 }) },
    menu: { hidden: true, getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0 }) },
    workbench: { hidden: true, getBoundingClientRect: () => ({ x: 8, y: 209, width: 284, height: 147 }) },
  };
  const context = vm.createContext({
    app, els: elements, win: { update: async (patch) => { updates.push(patch); } },
    performance: { now: () => 0 }, clearTimeout() {}, setTimeout: () => 1,
    console: { warn() {}, info() {}, error() {} }, errCode: (error) => error?.code ?? 'unknown',
    armForwardingWatchdog() {}, clearForwardingWatchdog() {},
    callBridge: (run) => Promise.resolve(run()),
    player: { isOpaqueAt: (x, y) => x >= 78 && x <= 222 && y >= 360 && y <= 516 },
    pointInRect: (rect, x, y) => x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height,
    reminders: { getState: () => ({ primary: null, animationKey: 'k' }) },
    activity: () => ({ status: 'idle', session: null, key: 'k' }),
    activityAnim: () => 'idle', animationGate: { apply: () => {} }, stopLook() {},
  });
  vm.runInContext(`${geometry}\n${overlays}\n${interactivity}\n${animation}
    globalThis.api = { refreshInteractivity, desiredAnimation, isOverOverlay };`, context);
  return { app, elements, updates, api: context.api };
}

test('an open card keeps only its own pixels interactive', () => {
  const h = harness({ overrides: { workbenchOpen: true, clickThrough: false } });
  h.elements.workbench.hidden = false;
  h.app.pointer = { x: 150, y: 250 };
  h.api.refreshInteractivity();
  assert.equal(h.app.clickThrough, false, 'the card itself stays clickable');
  // Above the card is transparent: clicks there must reach whatever is behind the window.
  h.app.pointer = { x: 150, y: 40 };
  h.api.refreshInteractivity();
  assert.equal(h.app.clickThrough, true, 'the margin above an open card forwards clicks');
  assert.equal(h.api.isOverOverlay(150, 40), false);
});

test('the transparent margin forwards clicks, and the pet does not', () => {
  const h = harness({ overrides: { clickThrough: false } });
  h.app.pointer = { x: 150, y: 432 };
  h.api.refreshInteractivity();
  assert.equal(h.app.clickThrough, false, 'the pet is opaque and stays interactive');
  h.app.pointer = { x: 5, y: 5 };
  h.api.refreshInteractivity();
  assert.equal(h.app.clickThrough, true, 'empty space forwards clicks');
});

test('a card opened without a pointer sample stays clickable', () => {
  // Enter on the focused pet opens the card with no mousemove behind it.
  const h = harness({ overrides: { workbenchOpen: true, pointer: null, clickThrough: true } });
  h.api.refreshInteractivity();
  assert.equal(h.app.clickThrough, false);
});

test('a drag or an open menu keeps the whole window interactive', () => {
  for (const flag of ['dragging', 'menuOpen']) {
    const h = harness({ overrides: { [flag]: true, clickThrough: false } });
    h.app.pointer = { x: 5, y: 5 };
    h.api.refreshInteractivity();
    assert.equal(h.app.clickThrough, false, flag);
  }
});

test('opening the card does not cut the hover animation short', () => {
  const h = harness({ overrides: { hovered: true, workbenchOpen: true } });
  // Reverting to the base state restarts the sprite at frame 0, which reads as a flicker.
  // The objects come from the sandbox realm, so compare the fields rather than the prototype.
  const state = () => { const a = h.api.desiredAnimation(); return `${a.state}:${a.key}`; };
  assert.equal(state(), 'jumping:hover');
  h.app.menuOpen = true;
  assert.equal(state(), 'idle:k', 'the menu still owns the pet');
  h.app.menuOpen = false;
  h.app.hovered = false;
  assert.equal(state(), 'idle:k');
});

test('the card never resizes the window, and the fixed height always fits it', async () => {
  // A resize moves the native window origin; the old layout is repainted at the new
  // top-left for a frame, which is the up-and-left jump seen on every click.
  const source = await readFile(new URL('../miniapp/client/pet-app.js', import.meta.url), 'utf8');
  const open = source.slice(source.indexOf('async function openWorkbench('), source.indexOf('async function closeWorkbench('));
  const close = source.slice(source.indexOf('async function closeWorkbench('), source.indexOf('function renderReminders('));
  for (const [name, body] of [['openWorkbench', open], ['closeWorkbench', close]]) {
    assert.equal(/win\.update|setExpanded|createWorkbenchWindow/u.test(body), false, `${name} must not touch window geometry`);
  }
  const declared = source.match(/const deskHeight = \(scale\) => ([^;]+);/u);
  assert.ok(declared, 'deskHeight declares the fixed window height');
  const deskHeight = new Function('scale', `return ${declared[1]};`);
  for (const scale of [0.5, 0.75, 1]) {
    assert.ok(deskHeight(scale) >= Math.ceil(208 * scale) + 216, `scale ${scale} leaves room for the card`);
  }
});

function dragHarness(scale, screenMode = 'local') {
  const updates = [];
  const directions = [];
  let nativeBounds = { x: -100, y: 160 };
  let pending;
  const app = { mode: 'window', workbenchOpen: true, pet: {}, winPos: nativeBounds, oneShotToken: 0 };
  const state = () => ({ mode: 'window', window: nativeBounds });
  const context = vm.createContext({
    app, prefs: { scale }, DRAG_THRESHOLD: 4, DIRECTION_HYSTERESIS: 12,
    els: { sprite: { setPointerCapture() {}, hasPointerCapture: () => false, classList: { add() {}, remove() {} } } },
    win: {
      getState: async () => state(),
      update: (patch) => {
        assert.equal(pending, undefined, 'only one move reaches the Host at a time');
        updates.push({ ...patch });
        return new Promise((resolve, reject) => { pending = { patch, resolve, reject }; });
      },
    },
    console: { warn() {}, debug() {} }, errCode: (error) => error.message, logError: () => () => {},
    callBridge: (run) => Promise.resolve(run()),
    onWindowState: ({ window }) => { app.winPos = { x: window.x, y: window.y }; },
    player: { play: async (direction) => { directions.push(direction); } },
    noteInteraction() {}, stopLook() {}, hideQuickbar() {}, refreshInteractivity() {},
    desiredAnimation: () => ({ state: 'idle' }), playOneShot() {}, openWorkbench() {},
  });
  vm.runInContext(`${slice('const DESK_WIDTH', '// Saved positions')}\n${slice('function onSpritePointerDown(', 'function cancelDrag(')}
    globalThis.api = { onSpritePointerDown, onSpritePointerMove, finishDrag };`, context);
  const pointer = (dx, dy) => {
    const x = -50 + dx;
    const y = 230 + dy;
    const clientX = x - nativeBounds.x;
    const clientY = y - nativeBounds.y;
    return { pointerId: 1, button: 0, preventDefault() {}, clientX, clientY,
      screenX: screenMode === 'local' ? clientX : x, screenY: screenMode === 'local' ? clientY : y };
  };
  context.api.onSpritePointerDown(pointer(0, 0));
  const apply = () => { nativeBounds = { ...pending.patch }; };
  async function settle(reject = false) {
    const request = pending;
    if (!reject) apply();
    pending = undefined;
    if (reject) request.reject(new Error('not_permitted'));
    else request.resolve(state());
    await app.dragMove;
  }
  return { app, updates, directions, apply, settle,
    move: (dx, dy) => context.api.onSpritePointerMove(pointer(dx, dy)),
    release: (dx, dy) => context.api.finishDrag(pointer(dx, dy), false) };
}

test('desktop drag gives the Host absolute position and the same size on every move', async () => {
  // A position-only request was followed by growing native bounds on Windows. The page must
  // keep requesting the designed size, not feed back whatever bounds the Host last reported.
  for (const [scale, height] of [[0.5, 436], [0.75, 488], [1, 540]]) {
    const h = dragHarness(scale);
    h.move(1, 1); // Below the click/drag threshold.
    assert.deepEqual(h.updates, []);
    h.move(35, 18);
    await h.settle();
    h.app.winBounds = { width: 975, height: 1090 };
    h.move(-22, -10);
    await h.settle();
    assert.deepEqual(h.updates, [
      { x: -65, y: 178, width: 280, height },
      { x: -122, y: 150, width: 280, height },
    ]);
    assert.equal(h.app.workbenchOpen, true);
  }
});

test('a drag cannot send its size while an intentional scale change owns the window', () => {
  const h = dragHarness(0.5);
  h.app.scaleChanging = true;
  h.move(35, 18);
  assert.deepEqual(h.updates, []);
});

for (const screenMode of ['local', 'absolute']) {
  test(`a held pointer does not resend the same position (${screenMode} screenX)`, async () => {
    const h = dragHarness(0.75, screenMode);
    h.move(30, 20);
    await h.settle();
    h.move(30, 20);
    h.move(30, 20);
    assert.deepEqual(h.updates, [{ x: -70, y: 180, width: 280, height: 488 }]);
    assert.deepEqual(h.directions, ['running-right']);
  });
}

for (const applied of [false, true]) {
  const phase = applied ? 'after the Host moves but before its reply' : 'before the Host moves';
  test(`a pointer move ${phase} is not replayed against a different origin`, async () => {
    const h = dragHarness(0.75);
    h.move(30, 0);
    if (applied) h.apply();
    h.move(60, 0);
    await h.settle();
    assert.deepEqual(h.updates.map(({ x }) => x), [-70]);
    h.move(60, 0);
    await h.settle();
    assert.deepEqual(h.updates.map(({ x }) => x), [-70, -40]);
  });

  test(`releasing ${phase} keeps the last Host-confirmed target`, async () => {
    const h = dragHarness(0.75);
    h.move(30, 0);
    if (applied) h.apply();
    h.release(60, 0);
    await h.settle();
    assert.deepEqual(h.updates.map(({ x }) => x), [-70]);
    assert.deepEqual(h.app.winPos, { x: -70, y: 160 });
    assert.equal(h.app.drag, null);
  });
}

test('a rejected move keeps the confirmed origin for the final release', async () => {
  const h = dragHarness(0.75);
  h.move(30, 0);
  await h.settle();
  h.move(60, 0);
  await h.settle(true);
  h.release(10, 0);
  await h.settle();
  assert.deepEqual(h.updates.map(({ x }) => x), [-70, -40, -90]);
  assert.deepEqual(h.directions, ['running-right', 'running-left']);
});
