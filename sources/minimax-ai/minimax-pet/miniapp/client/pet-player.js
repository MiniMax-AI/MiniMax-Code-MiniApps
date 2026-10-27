// Codex-compatible atlas player. Zero dependencies; no DOM access at import time.
// Desktop playback: three action cycles, then slow idle; explicit loop is for previews.

export const CELL = { width: 192, height: 208, columns: 8 };

export const STATES = ['idle', 'running-right', 'running-left', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review'];

const frames = (count, ms, last) => [...Array(count - 1).fill(ms), last];

/** @type {Record<string, { row: number, durations: number[] }>} */
export const ANIMATIONS = {
  idle: { row: 0, durations: [1680, 660, 660, 840, 840, 1920] },
  'running-right': { row: 1, durations: frames(8, 120, 220) },
  'running-left': { row: 2, durations: frames(8, 120, 220) },
  waving: { row: 3, durations: frames(4, 140, 280) },
  jumping: { row: 4, durations: frames(5, 140, 280) },
  failed: { row: 5, durations: frames(8, 140, 240) },
  waiting: { row: 6, durations: frames(6, 150, 260) },
  running: { row: 7, durations: frames(6, 120, 220) },
  review: { row: 8, durations: frames(6, 150, 280) },
};

const ATLAS_WIDTH = CELL.width * CELL.columns; // 1536
const ROWS = { 1: 9, 2: 11 };
const LOOK_ROW = 9;
const ALPHA_THRESHOLD = 24;

/** 1536×1872 → 1, 1536×2288 → 2, otherwise null. */
export function atlasVersionFromSize(width, height) {
  if (width !== ATLAS_WIDTH) return null;
  if (height === ROWS[1] * CELL.height) return 1;
  if (height === ROWS[2] * CELL.height) return 2;
  return null;
}

function petError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;

function validatePetJson(petJson) {
  if (!petJson || typeof petJson !== 'object' || Array.isArray(petJson)) {
    throw petError('pet_json_invalid', 'pet.json must be a JSON object');
  }
  for (const key of ['id', 'displayName', 'spritesheetPath']) {
    if (!isNonEmptyString(petJson[key])) throw petError('pet_json_invalid', `pet.json "${key}" must be a non-empty string`);
  }
  if (petJson.description !== undefined && typeof petJson.description !== 'string') {
    throw petError('pet_json_invalid', 'pet.json "description" must be a string');
  }
  const v = petJson.spriteVersionNumber;
  if (v !== undefined && v !== 1 && v !== 2) {
    throw petError('pet_json_invalid', `pet.json "spriteVersionNumber" must be 1 or 2 (got ${JSON.stringify(v)})`);
  }
  return v === 2 ? 2 : 1;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(petError('sprite_unreadable', `Could not load spritesheet: ${url}`));
    image.src = url;
  });
}

/**
 * @typedef {{ id: string, displayName: string, description: string, spriteUrl: string, version: 1|2, image: HTMLImageElement }} LoadedPet
 * @param {any} petJson parsed pet.json object
 * @param {string} spriteUrl directly loadable image URL (http(s):, blob:, data:)
 * @returns {Promise<LoadedPet>}
 */
export async function loadPetFromParts(petJson, spriteUrl) {
  const declared = validatePetJson(petJson);
  const image = await loadImage(spriteUrl);
  const { naturalWidth: w, naturalHeight: h } = image;
  const actual = atlasVersionFromSize(w, h);
  if (actual === null) {
    throw petError('sprite_size_invalid', `Spritesheet is ${w}×${h}; expected 1536×1872 (v1) or 1536×2288 (v2)`);
  }
  if (actual !== declared) {
    throw petError('sprite_version_mismatch', `pet.json declares v${declared} but spritesheet size ${w}×${h} is v${actual}`);
  }
  return {
    id: petJson.id,
    displayName: petJson.displayName,
    description: petJson.description ?? '',
    spriteUrl,
    version: actual,
    image,
  };
}

/** @param {string} petJsonUrl @returns {Promise<LoadedPet>} */
export async function loadPet(petJsonUrl) {
  const absolute = new URL(petJsonUrl, globalThis.document?.baseURI ?? globalThis.location?.href).href;
  let text;
  try {
    const res = await fetch(absolute);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (cause) {
    throw petError('pet_json_unreadable', `Could not fetch ${absolute}: ${cause.message}`);
  }
  let petJson;
  try {
    petJson = JSON.parse(text);
  } catch (cause) {
    throw petError('pet_json_invalid', `pet.json is not valid JSON: ${cause.message}`);
  }
  validatePetJson(petJson);
  return loadPetFromParts(petJson, new URL(petJson.spritesheetPath, absolute).href);
}

// One ImageData per sprite image, shared across players. Value null = sampling unavailable (tainted etc.).
const pixelCache = new WeakMap();

function pixelsFor(image) {
  if (!pixelCache.has(image)) {
    let pixels = null;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(image, 0, 0);
      pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } catch {
      pixels = null;
    }
    pixelCache.set(image, pixels);
  }
  return pixelCache.get(image);
}

const assertState = (state) => {
  if (!STATES.includes(state)) throw new RangeError(`Unknown pet state: ${state}`);
};

export class SpritePlayer {
  /** @param {HTMLElement} element empty element; player owns its width/height/background-* */
  constructor(element, { scale = 1 } = {}) {
    this._el = element;
    this._pet = null;
    this._scale = clampScale(scale);
    this._reduced = false;
    this._lookIndex = null;
    this._state = 'idle'; // requested semantic state, independent of the rendered pose
    this._pose = 'idle';
    this._loop = false;
    this._repeat = 3;
    this._round = 0;
    this._transientThen = null;
    this._col = 0;
    this._resolve = null; // pending transient resolver
    this._timer = null;
    this._due = 0;
    this._remaining = null; // ms left on the current frame while paused (hidden)
    this._destroyed = false;
    this._onVisibility = () => this._handleVisibility();
    document.addEventListener('visibilitychange', this._onVisibility);
  }

  /** @param {LoadedPet} loadedPet */
  setPet(loadedPet) {
    if (this._destroyed) return;
    this._pet = loadedPet;
    if (loadedPet.version !== 2) this._lookIndex = null;
    this._restart();
  }

  get state() { return this._state; }

  /** Actual rendered pose; 'look' denotes the v2 static direction override. */
  get pose() {
    if (this._reduced) return this._state;
    return this._lookIndex === null ? this._pose : 'look';
  }

  get frame() {
    if (this._reduced) return { row: ANIMATIONS[this._state].row, col: 0 };
    if (this._lookIndex !== null) return { row: LOOK_ROW + Math.floor(this._lookIndex / 8), col: this._lookIndex % 8 };
    return { row: ANIMATIONS[this._pose].row, col: this._col };
  }

  get supportsLook() { return this._pet?.version === 2; }

  /**
   * Request a normal playback track. Non-idle actions play three cycles, then
   * render slow idle while `state` retains the request. Callers deduplicate
   * their task/event identity; an explicit repeat call intentionally restarts.
   * @returns {Promise<void>} resolves immediately
   */
  play(state, { loop = false } = {}) {
    assertState(state);
    if (this._destroyed) return Promise.resolve();
    this._settle();
    this._setNormal(state, loop);
    this._restart();
    return Promise.resolve();
  }

  /**
   * Temporary action, then a normal track for `then`. Resolves when the action
   * finishes or is interrupted. Reduced motion / no loaded pet finishes it
   * immediately so callers never wait for a non-existent animation timer.
   * @returns {Promise<void>}
   */
  playTransient(state, { then = 'idle', repeat = 3 } = {}) {
    assertState(state);
    assertState(then);
    if (!Number.isSafeInteger(repeat) || repeat < 1) throw new RangeError('repeat must be a positive integer');
    if (this._destroyed) return Promise.resolve();
    this._settle();
    this._state = state;
    this._loop = false;
    this._repeat = repeat;
    this._transientThen = then;
    const done = new Promise((resolve) => { this._resolve = resolve; });
    this._restart();
    return done;
  }

  look(angleDegOrNull) {
    if (this._destroyed || !this.supportsLook) return;
    if (angleDegOrNull === null || angleDegOrNull === undefined || !Number.isFinite(angleDegOrNull)) {
      if (this._lookIndex === null) return;
      this._lookIndex = null;
      this._restart();
      return;
    }
    const index = ((Math.round(angleDegOrNull / 22.5) % 16) + 16) % 16;
    const wasLooking = this._lookIndex !== null;
    this._lookIndex = index;
    if (!wasLooking) {
      this._stopTimer();
      if (this._transientThen !== null) this._finishTransient();
    }
    this._render();
  }

  setScale(scale) {
    this._scale = clampScale(scale);
    this._render();
  }

  setReducedMotion(enabled) {
    if (this._destroyed || this._reduced === !!enabled) return;
    this._reduced = !!enabled;
    this._restart();
  }

  isOpaqueAt(clientX, clientY) {
    if (!this._pet || this._destroyed) return false;
    const rect = this._el.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return false;
    const pixels = pixelsFor(this._pet.image);
    if (!pixels) return true; // bounding-box fallback
    const { row, col } = this.frame;
    const px = col * CELL.width + Math.min(CELL.width - 1, Math.floor((x * CELL.width) / rect.width));
    const py = row * CELL.height + Math.min(CELL.height - 1, Math.floor((y * CELL.height) / rect.height));
    return pixels.data[(py * pixels.width + px) * 4 + 3] > ALPHA_THRESHOLD;
  }

  destroy() {
    if (this._destroyed) return;
    this._stopTimer();
    this._settle();
    document.removeEventListener('visibilitychange', this._onVisibility);
    const s = this._el.style;
    for (const prop of ['width', 'height', 'backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat']) s[prop] = '';
    this._destroyed = true;
    this._pet = null;
  }

  // --- internals ---

  _settle() {
    const resolve = this._resolve;
    this._resolve = null;
    resolve?.();
  }

  _stopTimer() {
    clearTimeout(this._timer);
    this._timer = null;
    this._remaining = null;
  }

  _setNormal(state, loop = false) {
    this._state = state;
    this._pose = state;
    this._loop = !!loop;
    this._repeat = 3;
    this._round = 0;
    this._transientThen = null;
    this._col = 0;
  }

  _finishTransient() {
    const then = this._transientThen;
    if (then === null) return;
    this._setNormal(then);
    this._settle();
  }

  /** Rebuild the requested track from its first frame (also used on look exit). */
  _restart() {
    this._stopTimer();
    this._pose = this._state;
    this._round = 0;
    this._col = 0;
    if (!this._pet || this._reduced || this._lookIndex !== null) {
      if (this._transientThen !== null) this._finishTransient();
      this._render();
      return;
    }
    this._render();
    this._schedule(ANIMATIONS[this._pose].durations[0]);
  }

  _schedule(ms) {
    if (document.hidden) {
      this._remaining = ms;
      return;
    }
    this._due = performance.now() + ms;
    this._timer = setTimeout(() => this._tick(), ms);
  }

  _tick() {
    this._timer = null;
    if (this._destroyed) return;
    this._col += 1;
    if (this._col >= ANIMATIONS[this._pose].durations.length) {
      this._col = 0;
      this._round += 1;
      if (!this._loop && this._round >= this._repeat) {
        if (this._transientThen !== null) this._finishTransient();
        else this._pose = 'idle';
      }
    }
    this._render();
    this._schedule(ANIMATIONS[this._pose].durations[this._col]);
  }

  _handleVisibility() {
    if (this._destroyed) return;
    if (document.hidden) {
      if (this._timer === null) return;
      clearTimeout(this._timer);
      this._timer = null;
      this._remaining = Math.max(0, this._due - performance.now());
    } else if (this._remaining !== null) {
      const ms = this._remaining;
      this._remaining = null;
      this._schedule(ms);
    }
  }

  _render() {
    if (!this._pet || this._destroyed) return;
    const k = this._scale;
    const { row, col } = this.frame;
    const s = this._el.style;
    s.width = `${CELL.width * k}px`;
    s.height = `${CELL.height * k}px`;
    s.backgroundImage = `url("${this._pet.spriteUrl}")`;
    s.backgroundRepeat = 'no-repeat';
    s.backgroundSize = `${ATLAS_WIDTH * k}px ${ROWS[this._pet.version] * CELL.height * k}px`;
    s.backgroundPosition = `-${col * CELL.width * k}px -${row * CELL.height * k}px`;
  }
}

function clampScale(scale) {
  const n = Number(scale);
  return Number.isFinite(n) ? Math.min(1.5, Math.max(0.5, n)) : 1;
}
