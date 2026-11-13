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
