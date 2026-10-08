// @ts-check

import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
/** @typedef {import('./miniapp-api.js').MiniAppContext} MiniAppContext */
/** @typedef {import('./miniapp-api.js').MiniAppLifecycle} MiniAppLifecycle */

const DEFAULT_DURATION_SEC = 25 * 60;
const MIN_DURATION_SEC = 1 * 60;
const MAX_DURATION_SEC = 3 * 60 * 60;
const RECONCILE_MS = 15_000;
const SSE_KEEPALIVE_MS = 25_000;
const MAX_BODY_BYTES = 4096;

const POST_ROUTES = new Set([
  '/api/segment/start',
  '/api/segment/pause',
  '/api/segment/discard',
  '/api/settings/duration',
  '/api/settings/sound',
  '/api/stats/reset',
]);

/**
 * A custom reminder sound is a bounded filesystem read, not a general proxy:
 * audio extension only, existing regular file, size capped.
 *
 * Paths may be absolute (anywhere the user can reach) or relative. A relative
 * path resolves against the plugin root so a shipped `sounds/` folder works for
 * whoever installs the plugin, and is then pinned to stay inside that root — a
 * relative path is a way to name bundled content, never a way to escape upward
 * into the rest of the filesystem.
 */
const MAX_SOUND_BYTES = 25 * 1024 * 1024;
const MAX_PATH_CHARS = 1024;
const SOUND_TYPES = new Map([
  ['.mp3', 'audio/mpeg'],
  ['.wav', 'audio/wav'],
  ['.ogg', 'audio/ogg'],
  ['.oga', 'audio/ogg'],
  ['.opus', 'audio/ogg'],
  ['.m4a', 'audio/mp4'],
  ['.aac', 'audio/aac'],
  ['.flac', 'audio/flac'],
  ['.webm', 'audio/webm'],
]);

/** Directory mode caps. A reminder picks one track, so a huge folder is only a cost. */
const MAX_TRACKS = 500;
const MAX_PLAYLIST_BYTES = 200 * 1024 * 1024;

/**
 * Host/Origin loopback guards.
 *
 * A page on the open internet can reach a loopback server through DNS
 * rebinding: it loads from `evil.com`, then a second DNS answer points
 * `evil.com` at 127.0.0.1, and the browser still treats the request as
 * same-origin — the origin compares the NAME that was typed, not the address
 * it resolved to. A rebound request therefore arrives carrying a non-loopback
 * `Host`, which is what these checks reject.
 *
 * Without them, a page like that could POST an arbitrary absolute path to
 * /api/settings/sound and then read the bytes back from /api/sound.
 */
const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * The host part of an authority, without the port.
 *
 * `[::1]:49660` -> `[::1]`, `127.0.0.1:49660` -> `127.0.0.1`, `evil.com` ->
 * `evil.com`. A bare unbracketed IPv6 literal has more than one colon, so the
 * tail must not be mistaken for a port.
 *
 * @param {string | undefined | null} authority
 * @returns {string | null} lowercased host, or null when unusable
 */
function authorityHost(authority) {
  const value = String(authority ?? '').trim().toLowerCase();
  if (value === '') return null;
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    return end === -1 ? null : value.slice(0, end + 1);
  }
  const colon = value.lastIndexOf(':');
  if (colon !== -1 && value.indexOf(':') === colon) return value.slice(0, colon);
  return value;
}

/**
 * @param {string | undefined | null} authority
 * @param {string} boundHost the host this server was told to listen on
 */
function isLoopbackAuthority(authority, boundHost) {
  const host = authorityHost(authority);
  if (host === null) return false;
  return LOOPBACK_NAMES.has(host) || host === String(boundHost ?? '').toLowerCase();
}

/**
 * Same check for an `Origin`, which a browser sends on cross-origin requests and
 * on same-origin POSTs. A missing Origin is not a failure — the Host check
 * already covers that case.
 *
 * @param {string} origin
 * @param {string} boundHost
 */
function isLoopbackOrigin(origin, boundHost) {
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  return isLoopbackAuthority(parsed.host, boundHost);
}

/**
 * @param {MiniAppContext} context
 * @returns {Promise<MiniAppLifecycle>}
 */
export async function start(context) {
  const dataDir = context.dataDir;
  const stateFile = join(dataDir, 'state.json');
  const clientEntry = await readFile(join(context.pluginRoot, 'miniapp/client/index.html'));
  // Base for every relative sound path. Pinned once at boot so a later change to
  // context cannot redirect what a relative path resolves to mid-run.
  const pluginRoot = resolve(context.pluginRoot);

  /**
   * @typedef {'single' | 'sequence' | 'shuffle'} SoundMode
   */

  /**
   * Node owns the deadline. The Client never keeps its own authoritative clock, so a
   * throttled or backgrounded tab cannot drift the count.
   * @type {{ durationSec: number, phase: 'idle' | 'running' | 'paused' | 'reminded',
   *          startedAt: number | null, remainingSec: number, bankedMinutes: number,
   *          completedSessions: number, focusSec: number, reminderSeq: number,
   *          soundPath: string | null, soundInput: string | null,
   *          soundRelative: boolean, soundMode: SoundMode, soundIndex: number,
   *          soundPinned: string | null, soundVersion: number }}
   */
  const state = {
    durationSec: DEFAULT_DURATION_SEC,
    phase: 'idle',
    startedAt: null,
    remainingSec: DEFAULT_DURATION_SEC,
    bankedMinutes: 0,
    completedSessions: 0,
    focusSec: 0,
    reminderSeq: 0,
    soundPath: null,
    soundInput: null,
    soundRelative: false,
    soundMode: 'single',
    soundIndex: 0,
    // File name of the track 单曲循环 pinned, or null. Pinning is a selection
    // decision (stay on this track), NOT repeating the buffer — the Client
    // always plays a track exactly once.
    soundPinned: null,
    soundVersion: 0,
  };

  /** @type {Set<import('node:http').ServerResponse>} */
  const streams = new Set();
  /** @type {Set<import('node:fs').ReadStream>} */
  const soundStreams = new Set();
  /** @type {NodeJS.Timeout | null} */
  let deadlineTimer = null;
  /** @type {NodeJS.Timeout | null} */
  let reconcileTimer = null;
  /** @type {NodeJS.Timeout | null} */
  let keepaliveTimer = null;
  let loadPromise = null;
  let writeChain = Promise.resolve();

  // ---------------------------------------------------------------- persistence

  /** @returns {Promise<boolean>} true when this call performed the first read. */
  function ensureLoaded() {
    if (!loadPromise) {
      loadPromise = (async () => {
        try {
          const raw = await readFile(stateFile, 'utf8');
          const saved = JSON.parse(raw);
          applySavedState(state, saved);
        } catch (error) {
          const code = /** @type {NodeJS.ErrnoException} */ (error).code;
          if (code !== 'ENOENT') {
            context.logger.warn('miniapp.state.load_failed', { reason: code ?? 'parse' });
          }
        }
        // A segment that was running or paused when the process stopped is
        // interrupted, not completed. Do not award credit for time nobody was
        // actually counting, and start clean from the configured duration.
        // applySavedState never restores `phase`, so this is stated explicitly
        // rather than left to a branch that can never be true.
        state.phase = 'idle';
        state.startedAt = null;
        state.bankedMinutes = 0;
        state.remainingSec = state.durationSec;
        // A relative sound path was resolved into the PREVIOUS run's temp
        // directory, which no longer exists. Re-resolve it against this run's
        // plugin root, or drop it — a stale absolute path would otherwise fail
        // every load and silently fall back to the built-in chime.
        await revalidateSavedSound();
        return true;
      })();
    }
    return loadPromise.then(() => true);
  }

  /**
   * Re-point a relative sound path at this run's plugin root. Absolute paths are
   * left alone: the user chose a real location on their machine, and silently
   * clearing it would be worse than letting the load report it as gone.
   */
  async function revalidateSavedSound() {
    if (state.soundPath === null) return;
    if (state.soundRelative && typeof state.soundInput === 'string') {
      const target = resolve(pluginRoot, state.soundInput);
      const rel = relative(pluginRoot, target);
      if (rel.startsWith('..') || isAbsolute(rel)) {
        state.soundPath = null;
        state.soundInput = null;
        state.soundRelative = false;
        state.soundVersion += 1;
        return;
      }
      state.soundPath = target;
    }
    try {
      await stat(state.soundPath);
    } catch {
      state.soundPath = null;
      state.soundInput = null;
      state.soundRelative = false;
      state.soundVersion += 1;
    }
  }

  /** @returns {Promise<void>} */
  function persist() {
    const run = async () => {
      await mkdir(dataDir, { recursive: true });
      const tmp = join(dataDir, 'state.json.tmp');
      const next = join(dataDir, 'state.json');
      await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
      await rename(tmp, next);
    };
    // Run even if a previous write rejected, so one failure cannot wedge the chain.
    const next = writeChain.then(run, run);
    writeChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  // ------------------------------------------------------------------- snapshot

  /**
   * Async because resolving a directory playlist is. The resolved track is
   * included so the Client can show what it is about to play, and it is derived
   * from `reminderSeq` exactly as `/api/sound` derives it, so the two always
   * agree on the same file for the same reminder.
   */
  async function snapshot() {
    const running = state.phase === 'running' && state.startedAt !== null;
    const elapsedSec = running
      ? Math.max(0, Math.floor((Date.now() - /** @type {number} */ (state.startedAt)) / 1000))
      : 0;
    // remainingSec is frozen when a segment starts, so pausing and resuming keeps
    // the leftover. A reminded segment has nothing left — reporting the full
    // duration next to phase:"reminded" would be a self-contradictory snapshot.
    const remainingSec =
      state.phase === 'reminded'
        ? 0
        : running
          ? Math.max(0, state.remainingSec - elapsedSec)
          : state.remainingSec;
    const track = await currentTrack(state.reminderSeq);
    // The same selector, one step further on. The 下一首 row is always on screen,
    // so the Client needs an answer before the first 试听 rather than a row that
    // only appears after a press — that would move the card under the pointer.
    const nextTrack = await currentTrack(state.reminderSeq + 1);
    return {
      durationSec: state.durationSec,
      phase: state.phase,
      remainingSec,
      startedAt: running ? state.startedAt : null,
      completedSessions: state.completedSessions,
      focusSec: state.focusSec,
      liveSec: liveSec(),
      reminderSeq: state.reminderSeq,
      // Echoed back so the input stays editable. This is the operator's own
      // configured value on a loopback, single-user surface, not a Host secret.
      soundPath: state.soundPath,
      // What the user actually typed. A relative path is shown back verbatim
      // rather than as a temp-directory absolute path, which is neither portable
      // nor recognisable, and would be wrong again after the next restart.
      soundInput: state.soundInput,
      soundMode: state.soundMode,
      // File name 单曲循环 is pinned to, or null when the playlist rotates.
      soundPinned: state.soundPinned,
      // Resolved absolute path of the track this reminder will play, or null if
      // the folder went empty or unreadable since it was configured.
      soundTrack: track,
      // Resolved absolute path of the track the NEXT 试听 will fetch, or null
      // when there is nothing to walk to (no file, a single file, or a pin).
      soundNext: nextTrack,
      soundVersion: state.soundVersion,
      serverTime: Date.now(),
    };
  }

  function currentRemainingSec() {
    const running = state.phase === 'running' && state.startedAt !== null;
    if (!running) return state.remainingSec;
    const elapsedSec = Math.max(
      0,
      Math.floor((Date.now() - /** @type {number} */ (state.startedAt)) / 1000),
    );
    return Math.max(0, state.remainingSec - elapsedSec);
  }

  /** Seconds the current segment has been on the clock, capped at its deadline. */
  function segmentElapsedSec() {
    if (state.phase !== 'running' || state.startedAt === null) return 0;
    const cap = state.startedAt + state.remainingSec * 1000;
    return Math.max(0, Math.floor((Math.min(Date.now(), cap) - state.startedAt) / 1000));
  }

  /**
   * Bank whole elapsed minutes into the lifetime focus total.
   *
   * Idempotent: `bankedMinutes` records how many whole minutes are already in
   * `focusSec`, so calling this any number of times, from anywhere, banks each
   * minute exactly once. That is what lets the reconcile tick, pause and the
   * deadline all call it without coordinating with each other.
   *
   * Quantised on purpose — a 4-second fragment is worth 0 minutes, not 1. It also
   * removes sub-second bookkeeping entirely, and it never looks across a shutdown:
   * all crediting happens while the process is demonstrably alive, so an overnight
   * close can never bank time nobody spent at the keyboard. A restart costs at
   * most the unfinished partial minute.
   */
  function bankMinutes() {
    if (state.phase !== 'running') return 0;
    const whole = Math.floor(segmentElapsedSec() / 60);
    if (whole <= state.bankedMinutes) return 0;
    const delta = whole - state.bankedMinutes;
    state.focusSec += delta * 60;
    state.bankedMinutes = whole;
    return delta;
  }

  /** Banked minutes plus the sub-minute remainder still on the clock, for display. */
  function liveSec() {
    if (state.phase !== 'running') return 0;
    return Math.max(0, segmentElapsedSec() - state.bankedMinutes * 60);
  }

  // Async because snapshot() resolves the playlist. Callers that only need to
  // notify (no return value) may ignore the promise; anything that serialises or
  // returns it MUST await, or a Promise stringifies to "{}".
  function broadcast() {
    void snapshot().then((snap) => {
      const frame = `event: state\ndata: ${JSON.stringify(snap)}\n\n`;
      for (const stream of streams) {
        try {
          stream.write(frame);
        } catch {
          streams.delete(stream);
        }
      }
    });
  }

  // ------------------------------------------------------------- domain service

  function deadlineAt() {
    // Anchored to the frozen remainingSec, not durationSec, so a segment resumed
    // from a pause still lands on its original deadline.
    return state.startedAt === null ? null : state.startedAt + state.remainingSec * 1000;
  }

  function armDeadline() {
    clearDeadline();
    if (state.phase !== 'running') return;
    const target = deadlineAt();
    if (target === null) return;
    const delay = Math.max(0, target - Date.now());
    deadlineTimer = setTimeout(() => {
      void fireReminder();
    }, delay);
  }

  function clearDeadline() {
    if (deadlineTimer) {
      clearTimeout(deadlineTimer);
      deadlineTimer = null;
    }
  }

  /** Commit durably first, then broadcast, so a dropped frame never loses a completed segment. */
  async function fireReminder() {
    if (state.phase !== 'running') return;
    clearDeadline();
    // segmentElapsedSec is capped at the deadline, so this banks the full segment
    // and never a second past it.
    bankMinutes();
    state.phase = 'reminded';
    state.completedSessions += 1;
    state.startedAt = null;
    state.bankedMinutes = 0;
    state.remainingSec = 0;
    state.reminderSeq += 1;
    await persist();
    broadcast();
    context.logger.info('miniapp.reminder.fired', { completedSessions: state.completedSessions });
  }

  /** Idle or reminded → a fresh full segment. Paused → resume the same one. */
  async function startSegment() {
    if (state.phase === 'running') return;
    if (state.phase !== 'paused') {
      state.remainingSec = state.durationSec;
    }
    state.phase = 'running';
    state.startedAt = Date.now();
    state.bankedMinutes = 0;
    armDeadline();
    armReconcile();
    await persist();
    broadcast();
  }

  /** Freeze at the current leftover instead of throwing the segment away. */
  async function pauseSegment() {
    if (state.phase !== 'running') return;
    clearDeadline();
    bankMinutes();
    state.remainingSec = currentRemainingSec();
    state.phase = 'paused';
    state.startedAt = null;
    state.bankedMinutes = 0;
    await persist();
    broadcast();
  }

  /** Give up a paused segment and go back to a full idle timer. */
  async function discardSegment() {
    if (state.phase !== 'paused') return;
    state.phase = 'idle';
    state.startedAt = null;
    state.bankedMinutes = 0;
    state.remainingSec = state.durationSec;
    await persist();
    broadcast();
  }

  async function setDuration(seconds) {
    if (!Number.isInteger(seconds) || seconds < MIN_DURATION_SEC || seconds > MAX_DURATION_SEC) {
      return false;
    }
    state.durationSec = seconds;
    // A segment's length is frozen when it starts. Changing the setting retimes the
    // NEXT segment; it must not re-anchor a running or paused one, or a shorter
    // setting would fire an instant reminder on a segment already in progress.
    if (state.phase === 'idle') state.remainingSec = seconds;
    await persist();
    broadcast();
    return true;
  }

  /**
   * A custom reminder sound is a bounded filesystem read, not a general proxy:
   * audio extension only, existing regular file, size capped. A directory is
   * scanned once into an ordered playlist and one track is served per reminder.
   *
   * @param {unknown} value
   * @param {unknown} mode
   * @returns {Promise<{ ok: true } | { ok: false, reason: string, detail?: string }>}
   */
  async function setSound(value, mode) {
    if (value === null || value === '') {
      if (state.soundPath === null) return { ok: true };
      state.soundPath = null;
      state.soundInput = null;
      state.soundRelative = false;
      state.soundMode = 'single';
      state.soundIndex = 0;
      // The lock goes with the folder. It is a file NAME, so it survived the
      // removal and came back silently the next time a folder holding a file of
      // that name was configured — the app looked locked with nothing to show
      // for it, and no box had been ticked.
      state.soundPinned = null;
      state.soundVersion += 1;
      await persist();
      broadcast();
      return { ok: true };
    }
    if (typeof value !== 'string') return { ok: false, reason: 'sound_path_not_a_string' };
    const raw = value.trim();
    if (raw.length === 0) return { ok: false, reason: 'sound_path_empty' };
    if (raw.length > MAX_PATH_CHARS) return { ok: false, reason: 'sound_path_too_long' };

    // Relative paths name content shipped with the plugin, so they resolve
    // against the plugin root and must not climb out of it.
    //
    // The RAW input is kept alongside the resolved path. A relative path resolves
    // into the Host's runtime temp directory, which is a NEW directory on every
    // restart — persisting only the resolved absolute path meant the config went
    // stale the moment the runtime came back, and every reminder silently fell
    // back to the built-in chime. Keeping the raw form lets it be re-resolved.
    const isRelative = !isAbsolute(raw);
    let target;
    if (!isRelative) {
      target = resolve(raw);
    } else {
      target = resolve(pluginRoot, raw);
      const rel = relative(pluginRoot, target);
      if (rel.startsWith('..') || isAbsolute(rel)) {
        return { ok: false, reason: 'sound_path_escapes_plugin' };
      }
    }
    state.soundInput = raw;
    state.soundRelative = isRelative;

    let info;
    try {
      info = await stat(target);
    } catch {
      return { ok: false, reason: 'sound_file_not_found' };
    }

    if (info.isDirectory()) {
      const wanted = mode === 'shuffle' || mode === 'sequence' ? mode : 'sequence';
      const tracks = await scanDirectory(target);
      if (tracks.error) return { ok: false, reason: tracks.error, detail: tracks.detail };
      // Re-point at the resolved directory so later relative re-entry is stable.
      if (state.soundPath !== target || state.soundMode !== wanted) {
        state.soundPath = target;
        state.soundMode = wanted;
        // Arm at the current reminder count so the next reminder plays track 0.
        state.soundIndex = state.reminderSeq;
        state.soundVersion += 1;
        await persist();
        broadcast();
      }
      return { ok: true };
    }

    // A file can only ever play alone, so any folder mode collapses to 'single'.
    if (state.soundPath !== target || state.soundMode !== 'single') {
      state.soundPath = target;
      state.soundMode = 'single';
      state.soundIndex = state.reminderSeq;
      state.soundVersion += 1;
      await persist();
      broadcast();
    }
    return { ok: true };
  }

  /**
   * One level deep, audio extensions only, name-sorted so `sequence` is
   * predictable across restarts. Subdirectories are not descended into: a
   * reminder needs a flat list, and recursion would make the cost unbounded.
   * @param {string} dir
   * @returns {Promise<{ error: null, files: string[] } | { error: string, detail?: string }>}
   */
  async function scanDirectory(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return { error: 'sound_dir_unreadable' };
    }
    /** @type {string[]} */
    const files = [];
    let totalBytes = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = extname(entry.name).toLowerCase();
      if (!SOUND_TYPES.has(ext)) continue;
      files.push(join(dir, entry.name));
    }
    if (files.length === 0) return { error: 'sound_dir_empty' };
    if (files.length > MAX_TRACKS) {
      return { error: 'sound_dir_too_many', detail: String(MAX_TRACKS) };
    }
    // Skip unreadable/oversized entries rather than failing the whole folder, but
    // stop once the playlist is too large to serve cheaply.
    const usable = [];
    for (const file of files) {
      if (totalBytes > MAX_PLAYLIST_BYTES) return { error: 'sound_dir_too_large' };
      try {
        const info = await stat(file);
        if (!info.isFile() || info.size > MAX_SOUND_BYTES) continue;
        totalBytes += info.size;
      } catch {
        continue;
      }
      usable.push(file);
    }
    if (usable.length === 0) return { error: 'sound_dir_empty' };
    // Locale-aware so 2.mp3 sorts before 10.mp3 in a way a human expects.
    usable.sort((a, b) => basename(a).localeCompare(basename(b), undefined, { numeric: true }));
    return { error: null, files: usable };
  }

  /**
   * The file a given reminder should play.
   *
   * Selection is a pure function of `seq` rather than a mutable cursor, because
   * two independent requests ask for it — the snapshot the Client renders and
   * the `/api/sound` fetch it plays — and they must land on the same track. A
   * cursor advanced in one place would race the other and could hand the Client
   * a track name it never plays.
   *
   * `sequence` walks the name-sorted playlist and wraps. `shuffle` applies a
   * multiplicative hash to the step, which spreads short playlists across the
   * folder instead of clustering on the first few entries the way a raw
   * `step * k` would. The directory is re-read on every call, so a track added,
   * removed or replaced outside the app takes effect immediately.
   *
   * @param {number} seq reminder sequence number
   * @returns {Promise<string | null>}
   */
  async function currentTrack(seq) {
    if (state.soundPath === null) return null;
    if (state.soundMode === 'single') return state.soundPath;
    const scanned = await scanDirectory(state.soundPath);
    if (scanned.error) return null;
    const files = scanned.files;
    if (files.length === 1) return files[0];
    // 单曲循环 is the highest priority and outranks EVERYTHING, 试听 included.
    // It used to be bypassed during a preview so that auditioning would keep
    // moving; that made the lock look like it did nothing, because pressing
    // 试听 played a different file. A lock you can walk past is not a lock.
    if (state.soundPinned !== null) {
      const pinned = files.find((f) => basename(f) === state.soundPinned);
      if (pinned) return pinned;
      state.soundPinned = null;
    }
    // `soundIndex` holds the reminder sequence the playlist was armed at, so
    // configuring a folder always starts at its first track regardless of how
    // many reminders happened earlier in the session.
    return pickTrack(files, Math.max(0, seq - state.soundIndex));
  }

  /**
   * The rotation itself, with no I/O and no state: which file does `step`
   * reminders past the arming point resolve to?
   *
   * Split out of currentTrack so releasing a lock can ask the same question for a
   * candidate step without re-reading the folder once per candidate.
   *
   * @param {string[]} files name-sorted playlist
   * @param {number} step reminders since the playlist was armed
   * @returns {string}
   */
  function pickTrack(files, step) {
    if (state.soundMode === 'shuffle') {
      // Re-shuffle each time the playlist completes, then walk it to the end.
      // A per-cycle permutation guarantees every track plays exactly once before
      // any repeats, which a hash-mod does NOT: measured over 12 reminders with
      // 5 tracks it reached only 3 of them.
      const cycle = Math.floor(step / files.length);
      const order = seededOrder(files.length, mix32(cycle + 1));
      return files[order[step % files.length]];
    }
    return files[step % files.length];
  }

  /**
   * Releasing 单曲循环 must not change which song the app is on.
   *
   * While a track is pinned every currentTrack() call returns that file, so the
   * playlist cursor never moves. Unticking then snapped the armed track straight
   * back to wherever the cursor had been frozen — the row visibly jumped to a
   * different file for an action the user took to stop repeating, not to switch
   * songs. Every music player resumes from the current track here.
   *
   * So the arming point moves instead: find the step that resolves to the track
   * that was just released and set soundIndex to it. The search is bounded by two
   * playlist cycles, which is enough for both modes; if nothing matches — the
   * file may have been deleted meanwhile — the cursor is left where it was, which
   * is the old behaviour rather than a worse one.
   *
   * @param {string} released file name the lock was holding
   */
  async function rebaseAfterRelease(released) {
    if (state.soundPath === null || state.soundMode === 'single') return;
    const scanned = await scanDirectory(state.soundPath);
    if (scanned.error) return;
    const files = scanned.files;
    if (files.length < 2) return;
    if (!files.some((f) => basename(f) === released)) return;
    const before = state.soundIndex;
    for (let step = 0; step < files.length * 2; step += 1) {
      if (basename(pickTrack(files, step)) !== released) continue;
      state.soundIndex = state.reminderSeq - step;
      return;
    }
    state.soundIndex = before;
  }

  /**
   * Avalanche a small integer into well-distributed 32 bits.
   *
   * A bare `Math.imul(n, K) >>> 0` is NOT enough: the low bits it produces stay
   * correlated between neighbours, and `% length` reads only those low bits.
   * The xor-shift rounds mix every input bit down into the low ones.
   *
   * @param {number} n
   * @returns {number} unsigned 32-bit
   */
  function mix32(n) {
    let x = n >>> 0;
    x = Math.imul(x ^ (x >>> 16), 2246822507);
    x = Math.imul(x ^ (x >>> 13), 3266489909);
    return (x ^ (x >>> 16)) >>> 0;
  }

  /**
   * A deterministic Fisher-Yates over `0..n-1`, seeded so the same cycle always
   * yields the same order. mulberry32: small, fast, and good enough to shuffle
   * a playlist where a full cycle is hours apart.
   *
   * @param {number} n
   * @param {number} seed
   * @returns {number[]}
   */
  function seededOrder(n, seed) {
    const order = Array.from({ length: n }, (_, i) => i);
    let state = seed >>> 0;
    const next = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = n - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      const tmp = order[i];
      order[i] = order[j];
      order[j] = tmp;
    }
    return order;
  }

  async function resetStats() {
    state.completedSessions = 0;
    state.focusSec = 0;
    await persist();
    broadcast();
  }

  // -------------------------------------------------------------------- routing

  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      }
      response.end(JSON.stringify({ error: 'internal_error' }));
    });
  });

  /** @param {import('node:http').IncomingMessage} request @param {import('node:http').ServerResponse} response */
  async function handle(request, response) {
    const url = new URL(request.url ?? '/', 'http://miniapp.local');
    const { pathname } = url;
    const method = request.method ?? 'GET';

    // DNS-rebinding guard, ahead of every route. See LOOPBACK_NAMES above: a
    // rebound request carries the attacker's own name in Host, so refusing a
    // non-loopback Host refuses the attack. Both rejections answer a bare 403
    // and echo nothing the requester sent.
    if (!isLoopbackAuthority(request.headers.host, context.listen.host)) {
      response.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'forbidden' }));
      return;
    }
    const origin = request.headers.origin;
    if (origin !== undefined && !isLoopbackOrigin(origin, context.listen.host)) {
      response.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'forbidden' }));
      return;
    }

    if (method === 'GET' && (pathname === '/dashboard' || pathname === '/')) {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(clientEntry);
      return;
    }

    if (pathname === '/api/events') {
      if (method !== 'GET') return sendJson(response, 405, { error: 'method_not_allowed' });
      await ensureLoaded();
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      response.write(`event: state\ndata: ${JSON.stringify(await snapshot())}\n\n`);
      streams.add(response);
      request.on('close', () => {
        streams.delete(response);
      });
      context.signal.addEventListener(
        'abort',
        () => {
          streams.delete(response);
          response.end();
        },
        { once: true },
      );
      return;
    }

    if (pathname === '/api/sound') {
      if (method !== 'GET') return sendJson(response, 405, { error: 'method_not_allowed' });
      await ensureLoaded();
      if (!state.soundPath) return sendJson(response, 404, { error: 'no_custom_sound' });
      // Serve the track this reminder resolves to, not the configured folder.
      // `p` is a preview offset used by 试听 (audition).
      //
      // Without it, 试听 always returned the armed track, and that only moves
      // when a real reminder fires — so pressing 试听 again and again played the
      // identical file and shuffle looked broken. The offset is applied to the
      // reminder sequence rather than mutating it, so auditioning the folder
      // never changes what the next real reminder will play.
      //
      // A pinned track still wins here: 单曲循环 outranks 试听.
      const preview = Number(url.searchParams.get('p'));
      const offset = Number.isInteger(preview) && preview > 0 ? preview : 0;
      const track = await currentTrack(state.reminderSeq + offset);
      if (!track) return sendJson(response, 410, { error: 'sound_file_gone' });
      const contentType = SOUND_TYPES.get(extname(track).toLowerCase());
      if (!contentType) return sendJson(response, 500, { error: 'sound_type_unsupported' });
      // What the NEXT 试听 press will play, resolved by the same function that
      // served this response, so the hint can never drift from the real order.
      // `currentTrack` re-reads the folder, so this is one extra directory scan
      // on a route the user only reaches by deliberately auditioning.
      const next = await currentTrack(state.reminderSeq + offset + 1);
      let info;
      try {
        info = await stat(track);
      } catch {
        return sendJson(response, 410, { error: 'sound_file_gone' });
      }
      if (!info.isFile()) return sendJson(response, 410, { error: 'sound_not_a_file' });
      response.writeHead(200, {
        'content-type': contentType,
        'content-length': String(info.size),
        // Tells the Client which file it actually got. 试听 auditions a different
        // track than the armed one, so without this the label would keep showing
        // the armed track while a different file was playing.
        'x-sound-track': basename(track),
        // Disclosure for the audition button: pressing 试听 again is a black box
        // unless the page says what it will do. Absent when there is nothing to
        // walk to, and the Client falls back to the armed track.
        ...(next ? { 'x-sound-next-track': basename(next) } : {}),
        'cache-control': 'no-store',
      });
      const soundStream = createReadStream(track);
      soundStreams.add(soundStream);
      const dropSound = () => soundStreams.delete(soundStream);
      soundStream.on('close', dropSound);
      soundStream.on('error', () => {
        dropSound();
        response.destroy();
      });
      soundStream.pipe(response);
      return;
    }

    if (pathname === '/api/state') {
      if (method !== 'GET') return sendJson(response, 405, { error: 'method_not_allowed' });
      await ensureLoaded();
      return sendJson(response, 200, await snapshot());
    }

    if (!pathname.startsWith('/api/') || !POST_ROUTES.has(pathname)) {
      return sendJson(response, 404, { error: 'not_found' });
    }
    if (method !== 'POST') return sendJson(response, 405, { error: 'method_not_allowed' });

    await ensureLoaded();
    let body;
    try {
      body = await readJsonBody(request);
    } catch {
      return sendJson(response, 400, { error: 'invalid_request_body' });
    }

    switch (pathname) {
      case '/api/segment/start':
        await startSegment();
        return sendJson(response, 200, await snapshot());
      case '/api/segment/pause':
        await pauseSegment();
        return sendJson(response, 200, await snapshot());
      case '/api/segment/discard':
        await discardSegment();
        return sendJson(response, 200, await snapshot());
      case '/api/settings/duration': {
        const ok = await setDuration(Number(body.durationSec));
        if (!ok) {
          return sendJson(response, 400, {
            error: 'duration_out_of_range',
            min: MIN_DURATION_SEC,
            max: MAX_DURATION_SEC,
          });
        }
        return sendJson(response, 200, await snapshot());
      }
      case '/api/settings/sound': {
        // 单曲循环 pins a track by file name. Handled BEFORE setSound, and only
        // when `path` is absent from the body — a pin-only request must not be
        // read as "clear the sound", which is what an undefined path means.
        if (body.path === undefined && (body.pin === true || body.pin === false)) {
          const current = await currentTrack(state.reminderSeq);
          if (body.pin !== true) {
            const released = state.soundPinned;
            state.soundPinned = null;
            if (released !== null) await rebaseAfterRelease(released);
          } else {
            // Pin the track the Client says it is PLAYING, not the armed one.
            // Ticking the box during an audition used to lock a different file
            // than the one on screen, so the label appeared to swap songs.
            //
            // The name is only ever basename()d and compared against the scanned
            // folder, so it cannot steer a read outside it; an unknown name
            // falls back to the armed track.
            let match = null;
            if (typeof body.track === 'string' && state.soundPath !== null) {
              const wanted = basename(body.track.trim());
              const scanned = await scanDirectory(state.soundPath);
              if (!scanned.error) {
                match = scanned.files.find((f) => basename(f) === wanted) || null;
              }
            }
            const pinned = match || current;
            state.soundPinned = pinned ? basename(pinned) : null;
          }
          state.soundVersion += 1;
          await persist();
          broadcast();
          return sendJson(response, 200, await snapshot());
        }
        const result = await setSound(
          body.path === undefined ? null : body.path,
          body.mode,
        );
        if (!result.ok) return sendJson(response, 400, result);
        return sendJson(response, 200, await snapshot());
      }
      case '/api/stats/reset':
        await resetStats();
        return sendJson(response, 200, await snapshot());
      default:
        return sendJson(response, 404, { error: 'not_found' });
    }
  }

  /**
   * @param {import('node:http').ServerResponse} response
   * @param {number} status
   * @param {unknown} payload
   */
  function sendJson(response, status, payload) {
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(JSON.stringify(payload));
  }

  // ------------------------------------------------------------------- lifecycle

  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(context.listen.port, context.listen.host, () => {
      server.off('error', onError);
      resolve();
    });
  });

  /**
   * (Re)start the reconcile tick so it fires at 15/30/45/60s *from now*. Called on
   * every segment start, which keeps the tick phase-aligned with the segment instead
   * of drifting against a timer created once at boot. That way a whole minute is
   * banked within one tick of being reached, bounding what a crash can cost.
   */
  function armReconcile() {
    if (reconcileTimer) clearInterval(reconcileTimer);
    reconcileTimer = setInterval(() => {
      if (state.phase !== 'running') return;
      // Idempotent, so banking here and again on pause or completion is safe.
      if (bankMinutes() > 0) void persist();
      const target = deadlineAt();
      if (target !== null && Date.now() >= target) void fireReminder();
    }, RECONCILE_MS);
    reconcileTimer.unref?.();
  }

  armReconcile();

  keepaliveTimer = setInterval(() => {
    for (const stream of streams) {
      try {
        stream.write(': keepalive\n\n');
      } catch {
        streams.delete(stream);
      }
    }
  }, SSE_KEEPALIVE_MS);
  keepaliveTimer.unref?.();

  context.logger.info('miniapp.runtime.listening');

  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    context.signal.removeEventListener('abort', onAbort);
    clearDeadline();
    if (reconcileTimer) clearInterval(reconcileTimer);
    if (keepaliveTimer) clearInterval(keepaliveTimer);
    for (const stream of streams) {
      try {
        stream.end();
      } catch {
        /* already gone */
      }
    }
    streams.clear();
    for (const soundStream of soundStreams) {
      try {
        soundStream.destroy();
      } catch {
        /* already gone */
      }
    }
    soundStreams.clear();
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  };
  const onAbort = () => {
    void dispose().catch(() => undefined);
  };
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();

  return { dispose };
}

/**
 * @param {Record<string, number>} target
 * @param {unknown} saved
 */
function applySavedState(target, saved) {
  if (!saved || typeof saved !== 'object') return;
  const value = /** @type {Record<string, unknown>} */ (saved);
  if (Number.isInteger(value.durationSec)) target.durationSec = value.durationSec;
  if (Number.isInteger(value.remainingSec) && value.remainingSec >= 0) {
    target.remainingSec = value.remainingSec;
  }
  if (Number.isInteger(value.bankedMinutes) && value.bankedMinutes >= 0) {
    target.bankedMinutes = value.bankedMinutes;
  }
  if (Number.isInteger(value.completedSessions) && value.completedSessions >= 0) {
    target.completedSessions = value.completedSessions;
  }
  // Older packages stored a completion-gated total under completedFocusSec. Carry it
  // over so an upgrade does not silently zero the number he already earned.
  const savedFocus = Number.isInteger(value.focusSec)
    ? value.focusSec
    : Number.isInteger(value.completedFocusSec)
      ? value.completedFocusSec
      : null;
  if (savedFocus !== null && savedFocus >= 0) target.focusSec = savedFocus;
  if (Number.isInteger(value.reminderSeq) && value.reminderSeq >= 0) {
    target.reminderSeq = value.reminderSeq;
  }
  // A persisted path can outlive the file or stop being an audio file, and a
  // persisted directory can be swapped for a file. Re-check the shape here
  // rather than trusting what was written on a previous run: an audio extension
  // is only meaningful for the single-file mode.
  if (typeof value.soundPath === 'string') {
    const mode =
      value.soundMode === 'sequence' || value.soundMode === 'shuffle'
        ? value.soundMode
        : 'single';
    const ext = extname(value.soundPath).toLowerCase();
    if (isAbsolute(value.soundPath) && (mode !== 'single' || SOUND_TYPES.has(ext))) {
      target.soundPath = value.soundPath;
      target.soundMode = mode;
      // The raw form lets a relative path be re-resolved on the next boot.
      if (typeof value.soundInput === 'string') target.soundInput = value.soundInput;
      target.soundRelative = value.soundRelative === true;
    }
  }
  if (Number.isInteger(value.soundIndex) && value.soundIndex >= 0) {
    target.soundIndex = value.soundIndex;
  }
  if (typeof value.soundPinned === 'string' && value.soundPinned !== '') {
    target.soundPinned = value.soundPinned;
  }
  if (Number.isInteger(value.soundVersion) && value.soundVersion >= 0) {
    target.soundVersion = value.soundVersion;
  }
}

/**
 * @param {import('node:http').IncomingMessage} request
 * @returns {Promise<Record<string, unknown>>}
 */
async function readJsonBody(request) {
  /** @type {Buffer[]} */
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    const buf = /** @type {Buffer} */ (chunk);
    total += buf.length;
    if (total > MAX_BODY_BYTES) throw new Error('payload_too_large');
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('invalid_json_shape');
  }
  return /** @type {Record<string, unknown>} */ (parsed);
}
