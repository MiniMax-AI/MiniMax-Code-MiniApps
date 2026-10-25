// @ts-check
// Preparing an export job.
//
// The Mini App does not render anything itself. It copies what a render needs
// into a job directory under its private data dir and hands the Agent an exact
// path to a standalone runner. After that handoff the job no longer depends on
// this process, on the Host's port, or on the installed package directory.
//
// What lands in the job directory:
//
//   project.json   the saved project document, as it is right now
//   media/         copies of every media file the document names
//   library/       copies of every library file the document names, plus the
//                  user's saved presets, templates and delivery presets
//   client/        a copy of the editor's client payload
//   runtime/       a copy of the FableCut runtime the renderer drives
//   runner/        a copy of the standalone runner
//
// The copies are byte-for-byte. Nothing is hard-linked: the source files keep
// changing under the editor, and a job must not change with them.

import fs from 'node:fs';
import path from 'node:path';

import {
  collectRenderClips,
  describeJob,
  isTerminal,
  jobDir,
  jobsRoot,
  newJobId,
  readJob,
  resolveJobDir,
  writeJob,
} from './job-state.mjs';

/** The library folders whose contents the export reads (settings, not footage). */
const LIBRARY_SETTING_DIRS = ['presets', 'templates', 'delivery', 'fonts'];

/**
 * How long a runner may go without writing a heartbeat before its job is
 * reported as interrupted. The runner writes one every two seconds, also
 * while it verifies the finished file, so a minute of silence means the
 * runner is not reporting any more.
 */
const STALE_HEARTBEAT_MS = 60_000;

/**
 * Every source the document names, with the folder it belongs to.
 *
 * The media entries are the authority: each of them has to name a file inside
 * the project's own media or library folder. Other `src` fields deeper in the
 * document are collected too, but only when they name such a file — a `src`
 * that points anywhere else is left to the part of the document that owns it.
 *
 * @param {unknown} doc
 * @returns {{ inside: string[], outside: string[] }}
 */
function collectSources(doc) {
  /** @type {Set<string>} */
  const inside = new Set();
  /** @type {Set<string>} */
  const outside = new Set();

  const media = doc && typeof doc === 'object' && Array.isArray(/** @type {any} */ (doc).media)
    ? /** @type {any} */ (doc).media
    : [];
  for (const entry of media) {
    const src = entry && typeof entry === 'object' ? /** @type {any} */ (entry).src : null;
    if (typeof src !== 'string' || !src) continue;
    if (src.startsWith('/media/') || src.startsWith('/library/')) inside.add(src);
    else outside.add(src);
  }

  /** @param {unknown} node */
  const walk = (node) => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const record = /** @type {Record<string, unknown>} */ (node);
    if (typeof record.src === 'string' && record.src.startsWith('/')) {
      if (record.src.startsWith('/media/') || record.src.startsWith('/library/')) inside.add(record.src);
    }
    for (const value of Object.values(record)) walk(value);
  };
  walk(doc);

  return { inside: [...inside].sort(), outside: [...outside].sort() };
}

/**
 * A source path is only usable when it stays inside the folder it names.
 *
 * The relative path is the one the document wrote, which may be percent
 * encoded ("/media/my%20clip.mp4"). The editor decodes it once when it
 * resolves the file, so the copy has to land under the decoded name - the
 * renderer asks for the same decoded path.
 *
 * @param {string} root
 * @param {string} rel
 * @returns {{ real: string, rel: string } | null} the real path and the
 *   decoded relative path, or null when the source escapes or is missing
 */
function containedRealPath(root, rel) {
  const base = path.resolve(root);
  let decoded;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const candidate = path.resolve(base, decoded);
  if (candidate !== base && !candidate.startsWith(base + path.sep)) return null;
  let real;
  try {
    real = fs.realpathSync(candidate);
  } catch {
    return null;
  }
  let realBase;
  try {
    realBase = fs.realpathSync(base);
  } catch {
    return null;
  }
  if (real !== realBase && !real.startsWith(realBase + path.sep)) return null;
  try {
    if (!fs.statSync(real).isFile()) return null;
  } catch {
    return null;
  }
  return { real, rel: decoded };
}

/**
 * A stable 32-bit seed from a job id. The same job always renders the same
 * grain; a different job does not.
 *
 * @param {string} id
 * @returns {number}
 */
function seedFrom(id) {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash || 1;
}

/**
 * @param {string} from
 * @param {string} to
 */
function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

/**
 * Copy a folder, without following a single link.
 *
 * The library folders hold what the user put there, so they may contain a
 * symbolic link or a Windows junction that points anywhere on the disk. Such
 * an entry is left out and reported, never followed: a job must not read a
 * file outside the folder it was told to copy.
 *
 * @param {string} from
 * @param {string} to
 * @returns {{ files: number, skipped: string[] }}
 */
function copyTree(from, to) {
  /** @type {string[]} */
  const skipped = [];
  let count = 0;
  /** @type {Set<string>} */
  const visited = new Set();

  /**
   * @param {string} src
   * @param {string} dest
   * @param {number} depth
   */
  const walk = (src, dest, depth) => {
    if (depth > 32) return;
    /** @type {fs.Stats} */
    let stat;
    try {
      stat = fs.lstatSync(src);
    } catch {
      return;
    }
    if (stat.isSymbolicLink()) {
      skipped.push(src);
      return;
    }
    if (stat.isDirectory()) {
      let real;
      try {
        real = fs.realpathSync(src);
      } catch {
        return;
      }
      if (visited.has(real)) return; // a folder that leads back to itself
      visited.add(real);
      fs.mkdirSync(dest, { recursive: true });
      /** @type {fs.Dirent[]} */
      let entries = [];
      try {
        entries = fs.readdirSync(src, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        walk(path.join(src, entry.name), path.join(dest, entry.name), depth + 1);
      }
      return;
    }
    if (!stat.isFile()) return;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    count += 1;
  };

  if (fs.existsSync(from)) walk(from, to, 0);
  return { files: count, skipped };
}

/**
 * The files a package ships that a job needs. The runner is copied from the
 * package directory, so the job does not depend on where the package is
 * installed — or on it still being there.
 */
const RUNTIME_FILES = ['runner.mjs', 'job-state.mjs'];

/**
 * @param {{
 *   dataDir: string,
 *   pluginRoot: string,
 *   logger?: { info?: (message: string, fields?: Record<string, unknown>) => void, warn?: (message: string, fields?: Record<string, unknown>) => void, error?: (message: string, fields?: Record<string, unknown>) => void },
 * }} options
 */
export function createExportJobs({ dataDir, pluginRoot, logger }) {
  const nodeDir = path.join(pluginRoot, 'miniapp', 'node');
  const clientDir = path.join(pluginRoot, 'miniapp', 'client');
  const vendorDir = path.join(nodeDir, 'vendor', 'fablecut');
  const exportDir = path.join(nodeDir, 'export');
  const puppeteerBundle = path.join(nodeDir, 'vendor', 'puppeteer', 'puppeteer-core.cjs');

  const mediaRoot = path.join(dataDir, 'media');
  const libraryRoot = path.join(dataDir, 'library');
  const projectFile = path.join(dataDir, 'project.json');

  /**
   * Copy the current project, its media and the runtime into a new job.
   *
   * @param {Record<string, any>} args
   * @returns {Record<string, any>} the job descriptor the Agent needs
   */
  function prepare(args = {}) {
    const range = args.range === undefined || args.range === null ? null : String(args.range);
    if (range !== null && range !== 'entire' && range !== 'in-out') {
      throw new Error('range must be "entire" or "in-out"');
    }
    const profile = args.profile ? String(args.profile) : null;
    const preset = args.preset ? String(args.preset) : null;
    const delivery = args.delivery && typeof args.delivery === 'object' && !Array.isArray(args.delivery) ? args.delivery : null;
    if (profile && (preset || delivery)) {
      throw new Error('pass a profile (raw ffmpeg args) or a preset / delivery spec, not both');
    }
    if (delivery && preset && delivery.preset && delivery.preset !== preset) {
      throw new Error('delivery.preset and preset name different presets');
    }

    let raw;
    try {
      raw = fs.readFileSync(projectFile, 'utf8').replace(/^\uFEFF/u, '');
    } catch {
      throw new Error('there is no saved project to export yet');
    }
    /** @type {Record<string, any>} */
    let doc;
    try {
      doc = JSON.parse(raw);
    } catch (error) {
      throw new Error(`the saved project could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!doc || typeof doc !== 'object') throw new Error('the saved project is not a document');
    if (!Array.isArray(doc.clips) || !doc.clips.length) {
      throw new Error('the timeline is empty — there is nothing to export');
    }

    // Background removal needs a model the renderer would have to download.
    // The standalone renderer has no network access, so a clip that uses it
    // is refused here instead of being rendered without its mask. The check
    // covers the compositions the timeline draws, not only its own clips.
    const renderClips = collectRenderClips(doc);
    const masked = renderClips.find(
      (/** @type {any} */ clip) =>
        clip && clip.props && clip.props.bgRemove && (clip.kind === 'video' || clip.kind === 'image'),
    );
    if (masked) {
      throw new Error(
        `clip ${masked.id} uses background removal, and the standalone renderer cannot download the model it needs. ` +
          'Remove the background-removal effect from that clip, or render it with fablecut_export in the editor.',
      );
    }

    // A raw encoding profile is checked here, so a bad id never becomes a
    // runnable job that fails halfway through the render. The file holds the
    // profiles as a map of id to profile; an older list shape is read too.
    if (profile) {
      const profilesFile = path.join(vendorDir, 'encoding-profiles.json');
      /** @type {string[]} */
      let ids = [];
      try {
        const parsed = JSON.parse(fs.readFileSync(profilesFile, 'utf8'));
        const list = parsed && typeof parsed === 'object' ? parsed.profiles : null;
        if (Array.isArray(list)) {
          ids = list.map((entry) => (typeof entry === 'string' ? entry : entry?.id)).filter(Boolean);
        } else if (list && typeof list === 'object') {
          ids = Object.keys(list);
        }
      } catch {
        ids = [];
      }
      if (ids.length && !ids.includes(profile)) {
        throw new Error(`unknown encoding profile "${profile}"`);
      }
    }

    const { inside: sources, outside: outside } = collectSources(doc);
    /** @type {Array<{src: string, bytes: number}>} */
    const copied = [];
    /** @type {string[]} */
    const missing = [];
    /** @type {string[]} */
    const escaped = [...outside];

    for (const src of sources) {
      const isMedia = src.startsWith('/media/');
      const isLibrary = src.startsWith('/library/');
      if (!isMedia && !isLibrary) {
        escaped.push(src);
        continue;
      }
      const root = isMedia ? mediaRoot : libraryRoot;
      const rel = src.slice(isMedia ? '/media/'.length : '/library/'.length);
      const found = containedRealPath(root, rel);
      if (!found) {
        missing.push(src);
        continue;
      }
      copied.push({ src, bytes: fs.statSync(found.real).size });
    }

    if (escaped.length || missing.length) {
      const problems = [];
      if (escaped.length) problems.push(`not inside the project folder: ${escaped.join(', ')}`);
      if (missing.length) problems.push(`missing or outside the project folder: ${missing.join(', ')}`);
      throw new Error(`the job cannot be prepared — ${problems.join('; ')}`);
    }

    const id = newJobId();
    const dir = jobDir(dataDir, id);
    fs.mkdirSync(dir, { recursive: true });

    try {
      // 1. the snapshot
      fs.writeFileSync(path.join(dir, 'project.json'), `${JSON.stringify(doc, null, 2)}\n`);

      // The delivery spec the renderer will use. A preset on its own is a
      // delivery with that preset; the renderer normalises it the same way
      // fablecut_export does.
      const effectiveDelivery =
        preset || delivery ? { ...(delivery ?? {}), preset: preset ?? delivery?.preset } : null;

      // A fixed seed for the film grain, which the editor draws from
      // Math.random. It is only set when the timeline actually uses grain, so
      // the ids an ordinary render makes stay untouched. The compositions the
      // timeline draws count as well.
      const usesGrain = renderClips.some(
        (/** @type {any} */ clip) => clip && clip.props && Number(clip.props.grain) > 0,
      );
      const seed = usesGrain ? seedFrom(id) : null;

      // 2. the media and library files the snapshot names. The destination
      //    uses the decoded name, because that is the name the renderer asks
      //    the server for.
      /** @type {string[]} */
      const skipped = [];
      for (const src of sources) {
        const isMedia = src.startsWith('/media/');
        const root = isMedia ? mediaRoot : libraryRoot;
        const rel = src.slice(isMedia ? '/media/'.length : '/library/'.length);
        const found = containedRealPath(root, rel);
        if (!found) throw new Error(`the source ${src} disappeared while the job was prepared`);
        const dest = path.join(dir, isMedia ? 'media' : 'library', found.rel);
        copyFile(found.real, dest);
      }

      // 3. the user's library settings and fonts
      for (const name of LIBRARY_SETTING_DIRS) {
        const copiedTree = copyTree(path.join(libraryRoot, name), path.join(dir, 'library', name));
        skipped.push(...copiedTree.skipped);
      }

      // 4. the renderer: the editor's client payload, the FableCut runtime and
      //    the standalone runner
      copyTree(clientDir, path.join(dir, 'client'));
      copyTree(vendorDir, path.join(dir, 'runtime'));
      // The copied runtime is CommonJS, and it says so itself. Without this
      // file the nearest package.json above the job folder decides how the
      // runtime's .js files are read, and an ancestor that says "type":
      // "module" would turn them into ES modules: the runner's require of
      // server.js then fails with "require is not defined".
      fs.writeFileSync(
        path.join(dir, 'runtime', 'package.json'),
        `${JSON.stringify(
          {
            name: 'minimax-cut-export-runtime',
            private: true,
            type: 'commonjs',
            description:
              'The copied FableCut runtime. It is CommonJS; this file says so, so no ancestor folder can change that.',
          },
          null,
          2,
        )}\n`,
      );
      if (fs.existsSync(puppeteerBundle)) {
        copyFile(puppeteerBundle, path.join(dir, 'runtime', 'puppeteer-core.cjs'));
      }
      for (const name of RUNTIME_FILES) {
        const from = path.join(exportDir, name);
        if (!fs.existsSync(from)) throw new Error(`the package is incomplete: ${name} is missing`);
        copyFile(from, path.join(dir, 'runner', name));
      }

      // 5. the state
      const job = {
        id,
        version: 1,
        status: 'prepared',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        progress: 0,
        attempt: null,
        owner: { kind: 'minimax-cut-export', plugin: 'minimax-cut' },
        spec: {
          range,
          profile,
          preset,
          delivery: effectiveDelivery,
          deliveries: null,
          seed,
        },
        project: {
          name: typeof doc.name === 'string' ? doc.name : 'Untitled Project',
          revision: Number.isFinite(doc.revision) ? doc.revision : null,
          fps: Number.isFinite(doc.fps) ? doc.fps : null,
          width: Number.isFinite(doc.width) ? doc.width : null,
          height: Number.isFinite(doc.height) ? doc.height : null,
          clips: Array.isArray(doc.clips) ? doc.clips.length : 0,
          media: Array.isArray(doc.media) ? doc.media.length : 0,
        },
        media: copied,
        outputs: [],
        error: null,
        notes: skipped.length
          ? [`left out ${skipped.length} link(s) in the library folder: ${skipped.join(', ')}`]
          : [],
      };
      writeJob(dir, job);

      const runnerPath = path.join(dir, 'runner', 'runner.mjs');
      return {
        ...describeJob(job),
        jobDir: dir,
        runnerPath,
        argv: [runnerPath, '--job', dir],
        // The Mini App's own process may be the desktop app, not plain Node.
        // The Agent runs the runner with the node it has on its PATH.
        node: 'node',
      };
    } catch (error) {
      // A job that cannot be assembled is not a job. Leave nothing half-made.
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* the caller reports the original failure */
      }
      throw error;
    }
  }

  /**
   * Read a job's state.
   *
   * The state file is written by the runner. If the runner stopped without
   * saying so - the machine was rebooted, the task was killed - the state
   * still says "running". The status says so too, as an observation: the
   * heartbeat is older than a runner that is alive could leave behind, so the
   * job is reported as interrupted. Nothing is killed and nothing is
   * rewritten: a runner that is still working keeps its own state.
   *
   * @param {unknown} id
   * @returns {Record<string, any>}
   */
  function status(id) {
    const dir = resolveJobDir(dataDir, id);
    const job = readJob(dir);
    if (!job) throw new Error(`no export job "${String(id)}" — the id is not one this plugin created`);
    const described = describeJob(job);
    const heartbeatAt = job?.attempt?.heartbeatAt ?? 0;
    const age = heartbeatAt ? Date.now() - heartbeatAt : null;
    // A runner that is alive keeps its heartbeat going while it renders and
    // while it verifies the file it made, so a job that has gone quiet in
    // either of those states is a job that has gone quiet.
    const alive = job?.status === 'running' || job?.status === 'verifying';
    const stale = alive && age !== null && age > STALE_HEARTBEAT_MS;
    // A lock is there for every job a runner ever took, so its presence
    // only says something when the job never got past "prepared" or when the
    // runner went quiet: then an earlier attempt took the lock and stopped,
    // and a new runner would refuse to start. The lock is reported and
    // nothing more - it is never reclaimed, and no recorded pid is killed.
    const locked = fs.existsSync(path.join(dir, 'runner.lock'));
    /** @type {string[]} */
    const notes = [...described.notes];
    if (locked && (job?.status === 'prepared' || stale)) {
      notes.push(
        'A runner.lock from an earlier attempt is still in the job folder, so a new runner would refuse to start. ' +
          'Nothing was reclaimed and no process was killed - prepare a new job to render again.',
      );
    }
    return {
      ...described,
      jobDir: dir,
      observedStatus: stale ? 'interrupted' : described.status,
      observed: stale
        ? `the last heartbeat was ${Math.round(age / 1000)} seconds ago, so the runner is not reporting any more. It may have stopped. Nothing was killed and nothing was changed - prepare a new job to render again.`
        : null,
      locked,
      notes,
    };
  }

  /**
   * Ask a running job to stop. The request is a file inside the job's own
   * directory: the runner reads it before it starts the browser and keeps
   * reading it while it renders.
   *
   * @param {unknown} id
   * @returns {Record<string, any>}
   */
  function cancel(id) {
    const dir = resolveJobDir(dataDir, id);
    const job = readJob(dir);
    if (!job) throw new Error(`no export job "${String(id)}" — the id is not one this plugin created`);
    if (isTerminal(job)) {
      throw new Error(`the job already finished (${job.status}) — nothing to cancel`);
    }
    const request = path.join(dir, 'cancel.request');
    fs.writeFileSync(request, `${JSON.stringify({ at: Date.now() })}\n`);
    return {
      ...describeJob(job),
      jobDir: dir,
      cancelRequested: true,
      note:
        'The request is recorded. A runner that is already working notices it within a second and stops the render, ' +
        'and a runner that has not started yet stops before it opens a browser. Nothing is killed by this call.',
    };
  }

  return { prepare, status, cancel, jobsRoot: () => jobsRoot(dataDir) };
}