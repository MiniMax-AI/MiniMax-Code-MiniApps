import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Exercise the shipped module with deterministic browser/clock boundaries.
const source = await readFile(new URL('../miniapp/client/pet-player.js', import.meta.url), 'utf8');
const { SpritePlayer, ANIMATIONS, STATES, atlasVersionFromSize, loadPet, loadPetFromParts } =
  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const original = Object.fromEntries(['document', 'performance', 'setTimeout', 'clearTimeout', 'Image', 'fetch']
  .map((key) => [key, globalThis[key]]));

function harness(t) {
  let now = 0, next = 0;
  const timers = new Map(), listeners = new Set(), players = [];
  let imageResult = { width: 1536, height: 2288 };
  let pixels = null;
  const doc = {
    hidden: false,
    baseURI: 'https://pet.test/client/index.html',
    addEventListener(name, fn) { assert.equal(name, 'visibilitychange'); listeners.add(fn); },
    removeEventListener(name, fn) { assert.equal(name, 'visibilitychange'); listeners.delete(fn); },
    createElement(name) {
      assert.equal(name, 'canvas');
      return { getContext() { return { drawImage() {}, getImageData() {
        if (!pixels) throw new Error('pixel sampling unavailable');
        return pixels;
      } }; } };
    },
  };
  globalThis.document = doc;
  globalThis.performance = { now: () => now };
  globalThis.setTimeout = (fn, ms) => {
    assert.ok(ms >= 0 && Number.isFinite(ms));
    const id = ++next;
    timers.set(id, { at: now + ms, fn });
    return id;
  };
  globalThis.clearTimeout = (id) => timers.delete(id);
  globalThis.Image = class {
    set src(value) {
      this.srcValue = value;
      queueMicrotask(() => {
        if (imageResult.error) this.onerror?.();
        else {
          this.naturalWidth = imageResult.width;
          this.naturalHeight = imageResult.height;
          this.onload?.();
        }
      });
    }
  };
  t.after(() => {
    for (const p of players) p.destroy();
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });
  return {
    timers, listeners,
    element() {
      return {
        style: {},
        getBoundingClientRect() {
          return { left: 10, top: 20, width: parseFloat(this.style.width) || 192, height: parseFloat(this.style.height) || 208 };
        },
      };
    },
    pet(version = 2) {
      return { version, spriteUrl: '/atlas.webp', image: { naturalWidth: 1536, naturalHeight: version === 2 ? 2288 : 1872 } };
    },
    player({ loaded = true, version = 2, scale = 1 } = {}) {
      const element = this.element();
      const player = new SpritePlayer(element, { scale });
      players.push(player);
      if (loaded) player.setPet(this.pet(version));
      return { player, element };
    },
    advance(ms) {
      const until = now + ms;
      let steps = 0;
      while (true) {
        const first = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!first || first[1].at > until) break;
        assert.ok(++steps < 100000, 'clock must make forward progress');
        timers.delete(first[0]);
        now = first[1].at;
        first[1].fn();
      }
      now = until;
    },
    visibility(hidden) {
      doc.hidden = hidden;
      for (const listener of listeners) listener();
    },
    image(result) { imageResult = result; },
    pixels(value) { pixels = value; },
  };
}
const duration = (state) => ANIMATIONS[state].durations.reduce((sum, ms) => sum + ms, 0);

// These timings are from the installed Codex native overlay playback path,
// rather than its separate always-looping avatar preview.
test('idle holds all six frames for 6600 ms per cycle', (t) => {
  const h = harness(t), { player } = h.player();
  assert.equal(duration('idle'), 6600);
  for (let col = 0; col < 6; col += 1) {
    assert.deepEqual(player.frame, { row: 0, col });
    h.advance(ANIMATIONS.idle.durations[col] - 1);
    assert.deepEqual(player.frame, { row: 0, col });
    h.advance(1);
  }
  assert.deepEqual(player.frame, { row: 0, col: 0 });
});

for (const state of STATES.filter((name) => name !== 'idle')) {
  test(`${state} plays three original-speed cycles, then slow idle without changing requested state`, async (t) => {
    const h = harness(t), { player } = h.player();
    await player.play(state);
    for (let cycle = 0; cycle < 3; cycle += 1) {
      assert.deepEqual(player.frame, { row: ANIMATIONS[state].row, col: 0 });
      h.advance(duration(state) - 1);
      assert.equal(player.pose, state);
      assert.equal(player.frame.col, ANIMATIONS[state].durations.length - 1);
      h.advance(1);
    }
    assert.equal(player.state, state);
    assert.equal(player.pose, 'idle');
    assert.deepEqual(player.frame, { row: 0, col: 0 });
    h.advance(1679);
    assert.deepEqual(player.frame, { row: 0, col: 0 });
    h.advance(1);
    assert.deepEqual(player.frame, { row: 0, col: 1 });
    h.advance(20000);
    assert.equal(player.state, state);
    assert.equal(player.pose, 'idle');
  });
}

test('explicit loop keeps the requested animation repeating for resource preview', async (t) => {
  const h = harness(t), { player } = h.player();
  await player.play('running', { loop: true });
  h.advance(duration('running') * 10);
  assert.equal(player.state, 'running');
  assert.equal(player.pose, 'running');
  assert.deepEqual(player.frame, { row: 7, col: 0 });
});

test('a new explicit request with the same state restarts after the idle tail', async (t) => {
  const h = harness(t), { player } = h.player();
  await player.play('running');
  h.advance(duration('running') * 3 + 5000);
  assert.equal(player.state, 'running');
  assert.equal(player.pose, 'idle');
  await player.play('running');
  assert.equal(player.pose, 'running');
  assert.deepEqual(player.frame, { row: 7, col: 0 });
});

test('transient resolves after its repeat count and starts a normal then track', async (t) => {
  const h = harness(t), { player } = h.player();
  let finished = false;
  const done = player.playTransient('waving', { then: 'running' }).then(() => { finished = true; });
  h.advance(duration('waving') * 3 - 1);
  await Promise.resolve();
  assert.equal(finished, false);
  assert.equal(player.state, 'waving');
  h.advance(1);
  await done;
  assert.equal(player.state, 'running');
  assert.equal(player.pose, 'running');
  assert.deepEqual(player.frame, { row: 7, col: 0 });
  h.advance(duration('running') * 3);
  assert.equal(player.state, 'running');
  assert.equal(player.pose, 'idle');
});

test('transient supports an explicit one-cycle manual action', async (t) => {
  const h = harness(t), { player } = h.player();
  const done = player.playTransient('jumping', { repeat: 1 });
  h.advance(duration('jumping'));
  await done;
  assert.equal(player.state, 'idle');
  assert.equal(player.pose, 'idle');
  assert.equal(h.timers.size, 1);
});

test('a normal play interrupts and settles a pending transient without a late state change', async (t) => {
  const h = harness(t), { player } = h.player();
  const done = player.playTransient('waving', { then: 'review' });
  h.advance(100);
  await player.play('failed');
  await done;
  assert.equal(player.state, 'failed');
  h.advance(20000);
  assert.equal(player.state, 'failed');
  assert.equal(player.pose, 'idle');
});

test('a second transient settles the previous one and owns the final target', async (t) => {
  const h = harness(t), { player } = h.player();
  const first = player.playTransient('waving', { then: 'failed' });
  const second = player.playTransient('jumping', { then: 'review', repeat: 1 });
  await first;
  assert.equal(player.state, 'jumping');
  h.advance(duration('jumping'));
  await second;
  assert.equal(player.state, 'review');
});

test('v2 look is a static sixteen-direction frame and exit rebuilds the requested track', async (t) => {
  const h = harness(t), { player } = h.player();
  await player.play('running');
  h.advance(duration('running') * 3);
  assert.equal(player.pose, 'idle');
  player.look(-90);
  assert.equal(player.state, 'running');
  assert.equal(player.pose, 'look');
  assert.deepEqual(player.frame, { row: 10, col: 4 });
  assert.equal(h.timers.size, 0);
  h.advance(10000);
  assert.deepEqual(player.frame, { row: 10, col: 4 });
  player.look(90);
  assert.deepEqual(player.frame, { row: 9, col: 4 });
  player.look(null);
  assert.equal(player.pose, 'running');
  assert.deepEqual(player.frame, { row: 7, col: 0 });
  assert.equal(h.timers.size, 1);
});

test('look interrupts and settles a transient before rebuilding its normal target', async (t) => {
  const h = harness(t), { player } = h.player();
  const done = player.playTransient('waving', { then: 'failed' });
  player.look(0);
  await done;
  assert.equal(player.state, 'failed');
  assert.equal(player.pose, 'look');
  player.look(null);
  assert.equal(player.pose, 'failed');
  assert.deepEqual(player.frame, { row: 5, col: 0 });
});

test('v1 ignores look and changing a v2 pet to v1 clears its direction override', async (t) => {
  const h = harness(t), { player } = h.player({ version: 1 });
  await player.play('running');
  player.look(90);
  assert.equal(player.supportsLook, false);
  assert.equal(player.pose, 'running');
  assert.deepEqual(player.frame, { row: 7, col: 0 });
  player.setPet(h.pet(2));
  player.look(90);
  assert.equal(player.pose, 'look');
  player.setPet(h.pet(1));
  assert.equal(player.pose, 'running');
  assert.deepEqual(player.frame, { row: 7, col: 0 });
});

test('reduced motion shows the requested state first frame even after the track has reached idle', async (t) => {
  const h = harness(t), { player } = h.player();
  await player.play('review');
  h.advance(duration('review') * 3 + 1000);
  assert.equal(player.pose, 'idle');
  player.setReducedMotion(true);
  assert.equal(player.state, 'review');
  assert.equal(player.pose, 'review');
  assert.deepEqual(player.frame, { row: 8, col: 0 });
  assert.equal(h.timers.size, 0);
  h.advance(20000);
  assert.deepEqual(player.frame, { row: 8, col: 0 });
  await player.play('failed');
  assert.deepEqual(player.frame, { row: 5, col: 0 });
  player.setReducedMotion(false);
  assert.equal(h.timers.size, 1);
  assert.deepEqual(player.frame, { row: 5, col: 0 });
});

test('reduced motion settles transients immediately into their normal target', async (t) => {
  const h = harness(t), { player } = h.player();
  player.setReducedMotion(true);
  await player.playTransient('jumping', { then: 'running' });
  assert.equal(player.state, 'running');
  assert.deepEqual(player.frame, { row: 7, col: 0 });
  assert.equal(h.timers.size, 0);
});

test('hidden pages keep the current frame and its remaining hold across a long pause', async (t) => {
  const h = harness(t), { player } = h.player();
  await player.play('running');
  h.advance(75);
  h.visibility(true);
  assert.equal(h.timers.size, 0);
  h.advance(20000);
  assert.deepEqual(player.frame, { row: 7, col: 0 });
  h.visibility(false);
  h.advance(44);
  assert.deepEqual(player.frame, { row: 7, col: 0 });
  h.advance(1);
  assert.deepEqual(player.frame, { row: 7, col: 1 });
});

test('a request made while hidden starts only when the page becomes visible', async (t) => {
  const h = harness(t), { player } = h.player();
  h.visibility(true);
  await player.play('failed');
  h.advance(20000);
  assert.deepEqual(player.frame, { row: 5, col: 0 });
  h.visibility(false);
  h.advance(139);
  assert.deepEqual(player.frame, { row: 5, col: 0 });
  h.advance(1);
  assert.deepEqual(player.frame, { row: 5, col: 1 });
});

test('scale changes render the same animation phase rather than replaying it', async (t) => {
  const h = harness(t), { player, element } = h.player();
  await player.play('running');
  h.advance(150);
  assert.deepEqual(player.frame, { row: 7, col: 1 });
  player.setScale(0.75);
  assert.equal(element.style.width, '144px');
  assert.equal(element.style.height, '156px');
  assert.deepEqual(player.frame, { row: 7, col: 1 });
  h.advance(89);
  assert.deepEqual(player.frame, { row: 7, col: 1 });
  h.advance(1);
  assert.deepEqual(player.frame, { row: 7, col: 2 });
});

test('alpha hit testing samples the actual current pose, including the idle tail and look', async (t) => {
  const h = harness(t), { player } = h.player();
  const data = new Uint8ClampedArray(1536 * 2288 * 4);
  // Alpha > 24 only in running row7 col0 and look row9 col4 at local (0,0).
  data[((7 * 208) * 1536) * 4 + 3] = 25;
  data[((9 * 208) * 1536 + 4 * 192) * 4 + 3] = 255;
  h.pixels({ width: 1536, height: 2288, data });
  await player.play('running');
  assert.equal(player.isOpaqueAt(10, 20), true);
  assert.equal(player.isOpaqueAt(9, 20), false);
  assert.equal(player.isOpaqueAt(202, 20), false);
  h.advance(duration('running') * 3);
  assert.equal(player.state, 'running');
  assert.equal(player.isOpaqueAt(10, 20), false);
  player.look(90);
  assert.equal(player.isOpaqueAt(10, 20), true);
});

test('unavailable pixel sampling uses the established bounding-box fallback', (t) => {
  const h = harness(t), { player } = h.player();
  assert.equal(player.isOpaqueAt(10, 20), true);
  assert.equal(player.isOpaqueAt(9, 20), false);
});

test('destroy settles a transient, clears timers/listeners/styles, and ignores late operations', async (t) => {
  const h = harness(t), { player, element } = h.player();
  const done = player.playTransient('waving');
  player.destroy();
  await done;
  assert.equal(h.timers.size, 0);
  assert.equal(h.listeners.size, 0);
  assert.equal(player.isOpaqueAt(10, 20), false);
  for (const prop of ['width', 'height', 'backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat']) {
    assert.equal(element.style[prop], '');
  }
  await player.play('running');
  await player.playTransient('jumping');
  player.look(90);
  player.setPet(h.pet(2));
  player.setReducedMotion(true);
  h.advance(20000);
  assert.equal(h.timers.size, 0);
  player.destroy();
});

test('missing pet does not create timers or leave a transient promise pending', async (t) => {
  const h = harness(t), { player } = h.player({ loaded: false });
  await player.play('running');
  assert.equal(player.state, 'running');
  assert.equal(h.timers.size, 0);
  await player.playTransient('waving', { then: 'review' });
  assert.equal(player.state, 'review');
  player.setPet(h.pet(2));
  assert.equal(player.pose, 'review');
  assert.equal(h.timers.size, 1);
});

test('invalid requests fail without corrupting a running track', async (t) => {
  const h = harness(t), { player } = h.player();
  await player.play('running');
  assert.throws(() => player.play('unknown'), RangeError);
  assert.throws(() => player.playTransient('jumping', { then: 'unknown' }), RangeError);
  for (const repeat of [0, -1, 1.5, NaN, Infinity]) {
    assert.throws(() => player.playTransient('jumping', { repeat }), RangeError);
  }
  assert.equal(player.state, 'running');
  assert.equal(h.timers.size, 1);
});

test('atlas validation retains v1 legacy and v2 dimensions and rejects incompatible sheets', async (t) => {
  const h = harness(t);
  assert.equal(atlasVersionFromSize(1536, 1872), 1);
  assert.equal(atlasVersionFromSize(1536, 2288), 2);
  assert.equal(atlasVersionFromSize(1535, 2288), null);
  assert.equal(atlasVersionFromSize(1536, 2000), null);
  const json = { id: 'test', displayName: 'Test', spritesheetPath: './spritesheet.webp' };
  h.image({ width: 1536, height: 1872 });
  assert.equal((await loadPetFromParts(json, '/v1.webp')).version, 1);
  h.image({ width: 1536, height: 2288 });
  assert.equal((await loadPetFromParts({ ...json, spriteVersionNumber: 2 }, '/v2.webp')).version, 2);
  await assert.rejects(loadPetFromParts(json, '/mismatch.webp'), { code: 'sprite_version_mismatch' });
  h.image({ width: 1024, height: 1024 });
  await assert.rejects(loadPetFromParts(json, '/wrong-size.webp'), { code: 'sprite_size_invalid' });
  h.image({ error: true });
  await assert.rejects(loadPetFromParts(json, '/unreadable.webp'), { code: 'sprite_unreadable' });
  await assert.rejects(loadPetFromParts({ ...json, spriteVersionNumber: 3 }, '/invalid.webp'), { code: 'pet_json_invalid' });
});

test('pet loading resolves relative assets and reports fetch or malformed JSON errors', async (t) => {
  const h = harness(t);
  let requested;
  globalThis.fetch = async (url) => {
    requested = url;
    return { ok: true, text: async () => JSON.stringify({ id: 'test', displayName: 'Test', spritesheetPath: './sprite.webp', spriteVersionNumber: 2 }) };
  };
  const pet = await loadPet('./pets/test/pet.json');
  assert.equal(requested, 'https://pet.test/client/pets/test/pet.json');
  assert.equal(pet.spriteUrl, 'https://pet.test/client/pets/test/sprite.webp');
  globalThis.fetch = async () => ({ ok: true, text: async () => '{broken' });
  await assert.rejects(loadPet('./pet.json'), { code: 'pet_json_invalid' });
  globalThis.fetch = async () => ({ ok: false, status: 404 });
  await assert.rejects(loadPet('./pet.json'), { code: 'pet_json_unreadable' });
});
