#!/usr/bin/env node
// @ts-check
// The standalone MiniMax Cut export runner.
//
// This is not a Mini App child. It is a plain Node process that the Agent
// starts itself, in the foreground of one of its own background tasks:
//
//   node "<job folder>/runner/runner.mjs" --job "<job folder>"
//
// It reads one job folder and nothing else: the project's snapshot, the copies
// of the media and library files that snapshot names, the copy of the editor's
// client payload and the copy of the FableCut runtime. It never asks the Host
// for anything, it never opens a port the Host knows about, and it never
// touches the live project.
//
// It serves the editor page on its own ephemeral loopback port, guarded by a
// fresh secret that never appears in a URL, an argument or a log line, and it
// drives a headless Chrome or Edge through that page. The render itself is the
// editor's own Fast export: the same compositor, the same audio mix and the
// same ffmpeg encoding.
//
// Logs go to stderr: stdout belongs to whoever started the process.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { isTerminal, newAttemptId, readJob, writeJob, collectRenderClips } from './job-state.mjs';

const require = createRequire(import.meta.url);

/** The header the runner's own page must carry. The value is a fresh secret per run. */
const TOKEN_HEADER = 'x-minimax-export-token';

/** How often the runner refreshes its heartbeat marker. */
const HEARTBEAT_MS = 2000;

/** The default time a render may take before the runner gives up. */
const DEFAULT_TIMEOUT_SECONDS = 3600;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.m4v': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * @param {string} message
 */
function log(message) {
  process.stderr.write(`[minimax-cut-export] ${message}\n`);
}

/**
 * @param {string[]} argv
 * @returns {Record<string, string>}
 */
function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const name = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      out[name] = 'true';
    } else {
      out[name] = value;
      i += 1;
    }
  }
  return out;
}

/**
 * A real path inside a root, or null. Both the lexical join and the resolved
 * path have to stay inside the root, so a link out of the folder cannot be read.
 *
 * @param {string} root
 * @param {string} rel
 * @returns {string | null}
 */
function resolveInside(root, rel) {
  if (rel.includes('\0')) return null;
  const base = path.resolve(root);
  const candidate = path.resolve(base, rel);
  if (candidate !== base && !candidate.startsWith(base + path.sep)) return null;
  let real;
  let realBase;
  try {
    real = fs.realpathSync(candidate);
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
  return real;
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} file
 */
function serveFile(req, res, file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/u.exec(String(range).trim());
    if (!match || (match[1] === '' && match[2] === '')) {
      res.writeHead(416, { 'content-range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    let start = match[1] === '' ? stat.size - Number(match[2]) : Number(match[1]);
    let end = match[2] === '' || match[1] === '' ? stat.size - 1 : Number(match[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= stat.size) {
      res.writeHead(416, { 'content-range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    end = Math.min(end, stat.size - 1);
    res.writeHead(206, {
      'content-type': type,
      'accept-ranges': 'bytes',
      'content-range': `bytes ${start}-${end}/${stat.size}`,
      'content-length': end - start + 1,
      'cache-control': 'no-store',
    });
    const stream = fs.createReadStream(file, { start, end });
    stream.on('error', () => res.destroy());
    stream.pipe(res);
    return;
  }
  res.writeHead(200, {
    'content-type': type,
    'content-length': stat.size,
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
  });
  const stream = fs.createReadStream(file);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} code
 * @param {unknown} body
 */
function sendJson(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/**
 * The environment the browser child gets. Only these names are passed on, so
 * no provider key, no Node injection flag and no Host setting rides along.
 */
const CHILD_ENV_NAMES = [
  'PATH',
  'SystemRoot',
  'SystemDrive',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'LOCALAPPDATA',
  'APPDATA',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_IDENTIFIER',
  'LANG',
  'LC_ALL',
  'TZ',
];

/**
 * @returns {Record<string, string>} the environment for the browser child
 */
function childEnvironment() {
  /** @type {Record<string, string>} */
  const env = {};
  for (const name of CHILD_ENV_NAMES) {
    const value = process.env[name];
    if (typeof value === 'string' && value !== '') env[name] = value;
  }
  return env;
}

/**
 * The font families the snapshot's text clips draw with.
 *
 * The clips of a composition are drawn too, and a "font cut" title draws with
 * a set of families rather than one.
 *
 * @param {string} jobDir
 * @returns {string[]}
 */
function fontFamilies(jobDir) {
  /** @type {Set<string>} */
  const families = new Set();
  let doc = null;
  try {
    doc = JSON.parse(fs.readFileSync(path.join(jobDir, 'project.json'), 'utf8').replace(/^\uFEFF/u, ''));
  } catch {
    return [];
  }
  for (const clip of collectRenderClips(doc)) {
    if (!clip || clip.kind !== 'text' || clip.disabled) continue;
    const props = clip.props && typeof clip.props === 'object' ? clip.props : {};
    families.add(typeof props.font === 'string' && props.font ? props.font : 'Segoe UI');
    if (props.textAnim === 'font-cut') {
      const set = Array.isArray(props.fontCutSet) && props.fontCutSet.length ? props.fontCutSet : [];
      for (const family of set) if (typeof family === 'string' && family) families.add(family);
    }
  }
  return [...families];
}

/**
 * The warnings the renderer reported about the file it made.
 *
 * The editor checks every finished file against what was asked - size, fps,
 * frames, codecs, length, loudness - and says which checks did not pass. A
 * file that was made but did not match is not the same as a file that matches.
 *
 * @param {unknown} result
 * @returns {string[]}
 */
function reportWarnings(result) {
  /** @type {string[]} */
  const warnings = [];
  if (!result || typeof result !== 'object') return warnings;
  const record = /** @type {Record<string, any>} */ (result);
  const outputs = Array.isArray(record.outputs) ? record.outputs : [];
  for (const output of outputs) {
    if (!output || typeof output !== 'object') continue;
    const report = output.report;
    if (!report || typeof report !== 'object') continue;
    if (report.ok) continue;
    const checks = Array.isArray(report.checks) ? report.checks : [];
    const failed = checks
      .filter((/** @type {any} */ check) => check && check.ok === false)
      .map((/** @type {any} */ check) => String(check.text ?? '').trim())
      .filter(Boolean);
    warnings.push(
      `${output.file ?? 'the file'}: ${failed.length ? failed.join('; ') : String(report.line ?? 'a check did not pass')}`,
    );
  }
  for (const note of Array.isArray(record.notes) ? record.notes : []) {
    if (typeof note === 'string' && note.trim()) warnings.push(note.trim());
  }
  return warnings;
}

/**
 * The children the runner owns. They are killed when the runner stops, so a
 * cancelled render leaves no ffmpeg behind.
 * @type {Set<import('node:child_process').ChildProcess>}
 */
const ownedChildren = new Set();

/**
 * Run a program and collect its output.
 *
 * The child is the runner's own: it is tracked, so a cancel or a shutdown
 * kills it, and the runner's event loop keeps running while it works - the
 * heartbeat and the cancel request are still read.
 *
 * @param {string} file
 * @param {string[]} args
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ code: number, stdout: string, stderr: string, error?: string }>}
 */
function runProgram(file, args, options = {}) {
  return new Promise((done) => {
    const child = spawn(file, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      // The same allowlist the browser gets: no provider key, no Node
      // injection flag and no Host setting rides along with ffprobe or
      // ffmpeg either.
      env: childEnvironment(),
    });
    ownedChildren.add(child);
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      ownedChildren.delete(child);
      clearTimeout(timer);
      done(result);
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* it is on its way out */
      }
      finish({ code: -1, stdout, stderr, error: `${file} did not finish in time` });
    }, options.timeoutMs ?? 10 * 60_000);
    timer.unref?.();
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => finish({ code: -1, stdout, stderr, error: error.message }));
    child.on('close', (code) => finish({ code: code ?? -1, stdout, stderr }));
  });
}

/**
 * @param {string} file
 * @returns {Promise<{ ok: boolean, info?: Record<string, any>, error?: string }>}
 */
async function probeFile(file) {
  const result = await runProgram(
    'ffprobe',
    ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file],
    { timeoutMs: 5 * 60_000 },
  );
  if (result.error) return { ok: false, error: `ffprobe could not be run: ${result.error}` };
  if (result.code !== 0) {
    const why = result.stderr.trim().split('\n').filter(Boolean).slice(-2).join(' · ');
    return { ok: false, error: `ffprobe could not read the file${why ? `: ${why}` : ''}` };
  }
  try {
    return { ok: true, info: JSON.parse(result.stdout || '{}') };
  } catch {
    return { ok: false, error: 'ffprobe did not answer with JSON' };
  }
}

/**
 * A file that ffmpeg cannot decode all the way through is not a finished file.
 *
 * @param {string} file
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function decodeFile(file) {
  const result = await runProgram('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], {
    timeoutMs: 60 * 60_000,
  });
  if (result.error) return { ok: false, error: `ffmpeg could not be run: ${result.error}` };
  const noise = result.stderr.trim();
  if (result.code !== 0) {
    return {
      ok: false,
      error: `ffmpeg could not decode the whole file${noise ? `: ${noise.split('\n').slice(-1)[0]}` : ''}`,
    };
  }
  if (noise) return { ok: false, error: `ffmpeg reported a problem while decoding: ${noise.split('\n').slice(-1)[0]}` };
  return { ok: true };
}

/**
 * Find the browser automation library: the copy that was packaged with the
 * job, or an installed one (development).
 *
 * @param {string} jobDir
 * @returns {{ launch: Function }}
 */
function loadPuppeteer(jobDir) {
  const candidates = [
    path.join(jobDir, 'runtime', 'puppeteer-core.cjs'),
    process.env.FABLECUT_EXPORT_PUPPETEER,
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const loaded = require(candidate);
    const api = loaded && loaded.default && typeof loaded.default.launch === 'function' ? loaded.default : loaded;
    if (api && typeof api.launch === 'function') return api;
  }
  try {
    const loaded = require('puppeteer-core');
    const api = loaded && loaded.default && typeof loaded.default.launch === 'function' ? loaded.default : loaded;
    if (api && typeof api.launch === 'function') return api;
  } catch {
    /* not installed */
  }
  throw new Error(
    'no browser automation library was found. The package ships one; a job prepared by an older package may not have it.',
  );
}

/**
 * The gate in front of the runner's HTTP server.
 *
 * Every request has to carry the run's secret and name a route on the
 * allowlist. The editor's own handler is only reached for the API routes that
 * a render needs; the files are served from the job's own copies.
 *
 * @param {{
 *   upstream: { handleRequest: (req: any, res: any) => Promise<void> },
 *   secret: string,
 *   job: Record<string, any>,
 *   roots: { client: string, media: string, library: string, exports: string },
 *   authority?: string,
 *   onReport: (body: Record<string, any>) => void,
 *   onClaim: () => boolean,
 * }} options
 */
function createGate({ upstream, secret, job, roots, authority, onReport, onClaim }) {
  const secretBytes = Buffer.from(secret, 'utf8');
  /** Routes that were refused, so each one is only mentioned once. */
  const refused = new Set();
  /**
   * @param {import('node:http').ServerResponse} res
   * @param {string} what
   */
  const refuse = (res, what) => {
    if (!refused.has(what)) {
      refused.add(what);
      log(`refused: ${what}`);
    }
    return sendJson(res, 404, { error: 'not found' });
  };
  /** @type {Map<string, {query: string[]}>} */
  const apiRoutes = new Map([
    ['GET /api/project', { query: [] }],
    ['GET /api/media', { query: [] }],
    ['POST /api/media-info', { query: [] }],
    ['GET /api/library', { query: ['dir'] }],
    ['GET /api/presets', { query: [] }],
    ['GET /api/templates', { query: [] }],
    ['GET /api/export/ffmpeg', { query: [] }],
    ['GET /api/export/profiles', { query: ['detail'] }],
    ['GET /api/export/presets', { query: [] }],
    ['POST /api/export/begin', { query: [] }],
    ['POST /api/export/frame', { query: ['id'] }],
    ['POST /api/export/audio', { query: ['id'] }],
    ['POST /api/export/end', { query: ['id', 'discard'] }],
  ]);

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {string} pathname
   * @param {URLSearchParams} query
   */
  async function handleApi(req, res, pathname, query) {
    const method = req.method ?? 'GET';
    const key = `${method} ${pathname}`;

    if (key === 'GET /api/events') {
      // The editor opens this stream to hear about live changes. A render works
      // from the snapshot, so the stream stays open and says nothing.
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      res.write('data: hello\n\n');
      return;
    }

    if (pathname === '/api/export/job/ticket') {
      if (method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
      const id = query.get('id') ?? '';
      if (id !== job.id) return sendJson(res, 404, { error: 'no such export job' });
      const spec = job.spec ?? {};
      sendJson(res, 200, {
        id: job.id,
        kind: 'export',
        status: 'pending',
        range: spec.range ?? null,
        profile: spec.profile ?? null,
        delivery: spec.delivery ?? null,
        deliveries: spec.deliveries ?? null,
        time: null,
        revision: null,
      });
      return;
    }

    if (pathname === '/api/export/job/claim') {
      if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      const id = query.get('id') ?? '';
      if (id !== job.id) return sendJson(res, 404, { error: 'no such export job' });
      if (!onClaim()) return sendJson(res, 409, { error: 'the job was already claimed' });
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname === '/api/export/job/report') {
      if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      const id = query.get('id') ?? '';
      if (id !== job.id) return sendJson(res, 404, { error: 'no such export job' });
      /** @type {Buffer[]} */
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        return sendJson(res, 400, { error: 'the report body is not JSON' });
      }
      onReport(body && typeof body === 'object' ? body : {});
      sendJson(res, 200, { cancel: false });
      return;
    }

    const route = apiRoutes.get(key);
    if (!route) return refuse(res, `${method} ${pathname}`);
    for (const name of query.keys()) {
      if (!route.query.includes(name)) return refuse(res, `${method} ${pathname}?${name}`);
    }
    await upstream.handleRequest(req, res);
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  return async function gate(req, res) {
    try {
      const raw = req.url ?? '/';
      const url = new URL(raw, 'http://127.0.0.1');
      let pathname;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        sendJson(res, 404, { error: 'not found' });
        return;
      }

      // The secret: a fresh value per run, compared in constant time.
      const given = String(req.headers[TOKEN_HEADER] ?? '');
      const givenBytes = Buffer.from(given, 'utf8');
      const ok =
        givenBytes.length === secretBytes.length && crypto.timingSafeEqual(givenBytes, secretBytes);
      if (!ok) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }

      // The Host header has to be the address this server was opened on, so
      // nothing can point a name at it and reach it from outside.
      if (authority) {
        const host = String(req.headers.host ?? '').toLowerCase();
        if (host !== authority.toLowerCase()) {
          sendJson(res, 403, { error: 'forbidden' });
          return;
        }
      }

      if (pathname.startsWith('/api/')) {
        await handleApi(req, res, pathname, url.searchParams);
        return;
      }

      if (pathname === '/' || pathname === '/index.html') {
        const file = resolveInside(roots.client, 'index.html');
        if (!file) {
          sendJson(res, 404, { error: 'not found' });
          return;
        }
        serveFile(req, res, file);
        return;
      }

      /** @type {[string, string][]} */
      const fileRoots = [
        ['/media/', roots.media],
        ['/library/', roots.library],
        ['/exports/', roots.exports],
      ];
      for (const [prefix, root] of fileRoots) {
        if (!pathname.startsWith(prefix)) continue;
        const rel = pathname.slice(prefix.length);
        const file = resolveInside(root, rel);
        if (!file) {
          sendJson(res, 404, { error: 'not found' });
          return;
        }
        serveFile(req, res, file);
        return;
      }

      // The packaged editor assets. Nothing outside the copied client folder
      // is served this way.
      const asset = resolveInside(roots.client, pathname.slice(1));
      if (!asset) {
        sendJson(res, 404, { error: 'not found' });
        return;
      }
      serveFile(req, res, asset);
    } catch (error) {
      log(`request failed: ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
      else res.end();
    }
  };
}

/**
 * @param {string} jobDir
 * @returns {Record<string, any>}
 */
function readJobOrThrow(jobDir) {
  const job = readJob(jobDir);
  if (!job) throw new Error(`there is no export job in ${jobDir}`);
  return job;
}
/**
 * @param {string} jobDir
 * @param {Record<string, any>} job
 */
function writeRunning(jobDir, job) {
  const marker = {
    jobId: job.id,
    attempt: job.attempt ?? null,
    pid: process.pid,
    updatedAt: Date.now(),
  };
  fs.writeFileSync(
    path.join(jobDir, 'running.json'),
    `${JSON.stringify(marker, null, 2)}\n`,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const here = path.dirname(fileURLToPath(import.meta.url));
  const jobDir = path.resolve(args.job ?? here);
  const timeoutSeconds = Number.isFinite(Number(args['timeout-seconds']))
    ? Number(args['timeout-seconds'])
    : DEFAULT_TIMEOUT_SECONDS;

  // The desktop app's own executable is not Node. A runner started with it
  // would fail in ways that have nothing to do with the render, so it says so
  // straight away.
  if (process.versions.electron) {
    log('this process is the desktop app, not plain Node. Start the runner with the node on your PATH.');
    process.exitCode = 2;
    return;
  }

  if (!fs.existsSync(path.join(jobDir, 'job.json'))) {
    log(`there is no export job in ${jobDir}`);
    process.exitCode = 2;
    return;
  }

  let job = readJobOrThrow(jobDir);
  if (isTerminal(job)) {
    log(`job ${job.id} already finished (${job.status}); prepare a new job to render again`);
    process.exitCode = 3;
    return;
  }
  if (job.status !== 'prepared') {
    log(`job ${job.id} is ${job.status}; another runner may already hold it`);
    process.exitCode = 3;
    return;
  }

  // The lock: one runner per job. It is created exclusively, so two runners
  // cannot both take the job, and it is never reclaimed by killing a recorded
  // pid — a recycled pid is not proof of anything.
  const lockPath = path.join(jobDir, 'runner.lock');
  /** @type {number} */
  let lockHandle = 0;
  try {
    lockHandle = fs.openSync(lockPath, 'wx');
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error).code;
    if (code === 'EEXIST') {
      let held = null;
      try {
        held = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      } catch {
        held = null;
      }
      log(
        `job ${job.id} is locked by an earlier attempt${held?.pid ? ` (pid ${held.pid})` : ''}. ` +
          'It may still be running, or it was interrupted. Nothing was started and nothing was killed. ' +
          'Check its status, and prepare a new job to render again.',
      );
      process.exitCode = 3;
      return;
    }
    throw error;
  }

  const attemptId = newAttemptId();
  const startedAt = Date.now();

  // A cancel that arrived before the runner started stops it here, before a
  // browser is opened. The request file is the same one the tool writes.
  if (fs.existsSync(path.join(jobDir, 'cancel.request'))) {
    log(`job ${job.id} was cancelled before it started`);
    job = {
      ...job,
      status: 'cancelled',
      updatedAt: startedAt,
      error: 'the job was cancelled before it started',
      attempt: { id: attemptId, pid: process.pid, startedAt, heartbeatAt: startedAt },
    };
    writeJob(jobDir, job);
    writeRunning(jobDir, job);
    process.exitCode = 130;
    try {
      fs.closeSync(lockHandle);
    } catch {
      /* the handle is closed on exit anyway */
    }
    return;
  }

  job = {
    ...job,
    status: 'running',
    updatedAt: startedAt,
    progress: 0,
    attempt: { id: attemptId, pid: process.pid, startedAt, heartbeatAt: startedAt },
    error: null,
  };
  writeJob(jobDir, job);
  writeRunning(jobDir, job);
  fs.writeSync(lockHandle, `${JSON.stringify({ pid: process.pid, attemptId, startedAt })}\n`);
  fs.closeSync(lockHandle);

  /** @type {any} */
  let browser = null;
  /** @type {any} */
  let upstream = null;
  /** @type {import('node:http').Server | null} */
  let server = null;
  /** @type {NodeJS.Timeout | null} */
  let heartbeat = null;
  /** @type {NodeJS.Timeout | null} */
  let cancelPoll = null;
  /** @type {NodeJS.Timeout | null} */
  let parentWatch = null;
  /** @type {NodeJS.Timeout | null} */
  let deadline = null;
  let cancelled = false;
  let finished = false;

  /**
   * @param {Record<string, any>} patch
   */
  const persist = (patch) => {
    const current = readJobOrThrow(jobDir);
    const next = { ...current, ...patch, updatedAt: Date.now() };
    writeJob(jobDir, next);
    writeRunning(jobDir, next);
    return next;
  };

  /**
   * @param {string} status
   * @param {string} [error]
   */
  const finish = (status, error) => {
    if (finished) return;
    finished = true;
    const patch = { status, error: error ?? null };
    if (status === 'succeeded') patch.progress = 1;
    persist(patch);
    // The exit code says what happened, so the task that started the runner
    // does not have to read the state file to know.
    process.exitCode = status === 'succeeded' ? 0 : status === 'cancelled' ? 130 : status === 'interrupted' ? 5 : 4;
    log(`job ${job.id} ${status}${error ? `: ${error}` : ''}`);
  };

  const cleanup = async () => {
    if (heartbeat) clearInterval(heartbeat);
    if (cancelPoll) clearInterval(cancelPoll);
    if (parentWatch) clearInterval(parentWatch);
    if (deadline) clearTimeout(deadline);
    heartbeat = null;
    cancelPoll = null;
    parentWatch = null;
    deadline = null;
    // The children this runner started - the verification's ffmpeg and
    // ffprobe - go with it.
    for (const child of [...ownedChildren]) {
      try {
        child.kill();
      } catch {
        /* it is on its way out */
      }
    }
    ownedChildren.clear();
    try {
      if (browser) {
        await browser.close().catch(() => {});
        const proc = browser.process();
        if (proc && proc.exitCode === null) {
          try {
            proc.kill();
          } catch {
            /* already gone */
          }
        }
      }
    } catch {
      /* the browser is gone either way */
    }
    browser = null;
    try {
      if (upstream) {
        upstream.shutdown();
        const processes = require(path.join(jobDir, 'runtime', 'processes.js'));
        await processes.shutdown();
      }
    } catch {
      /* nothing left to stop */
    }
    upstream = null;
    if (server) {
      await new Promise((done) => {
        server.close(() => done(undefined));
        server.closeAllConnections?.();
      });
      server = null;
    }
    try {
      fs.rmSync(path.join(jobDir, 'browser-profile'), { recursive: true, force: true });
    } catch {
      /* a leftover profile is harmless */
    }
  };

  /**
   * @param {string} signal
   */
  const onSignal = (signal) => {
    if (finished) return;
    log(`received ${signal}; stopping the render`);
    cancelled = true;
    finish('cancelled', `the runner received ${signal}`);
    void cleanup().then(() => process.exit(process.exitCode ?? 130));
  };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));
  process.on('SIGHUP', () => onSignal('SIGHUP'));

  const report = { done: false, src: null, result: null, error: null, progress: 0 };
  /** @type {(value: void) => void} */
  let settle = () => {};
  const reported = new Promise((resolve) => {
    settle = () => resolve();
  });

  // The overall bound. It is armed before the work starts, not after the
  // first frame: loading the runtime, opening the browser and checking the
  // fonts all count against it, so a job that never reaches the render still
  // ends instead of sitting there.
  deadline = setTimeout(() => {
    if (finished) return;
    finish('failed', `the job did not finish within ${timeoutSeconds} seconds`);
    void cleanup().then(() => process.exit(4));
  }, Math.max(30, timeoutSeconds) * 1000);
  deadline.unref?.();

  try {
    // The runtime reads its configuration from the environment when it is first
    // loaded, so the environment has to be in place before the require.
    const runtimeDir = path.join(jobDir, 'runtime');
    process.env.FABLECUT_DATA_DIR = jobDir;
    process.env.FABLECUT_STATIC_DIR = path.join(jobDir, 'client');
    process.env.FABLECUT_NO_FS_WATCH = '1';
    delete process.env.FABLECUT_TRUST_HOST;

    upstream = require(path.join(runtimeDir, 'server.js'));
    const { findBrowser } = require(path.join(runtimeDir, 'export-jobs.js'));

    const secret = crypto.randomBytes(32).toString('hex');
    /** @type {((req: any, res: any) => void) | null} */
    let gate = null;

    server = http.createServer((req, res) => {
      if (!gate) {
        sendJson(res, 503, { error: 'not ready' });
        return;
      }
      void gate(req, res);
    });
    server.requestTimeout = 0;
    server.headersTimeout = 120_000;
    await new Promise((done, fail) => {
      server.once('error', fail);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', fail);
        done(undefined);
      });
    });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    if (!port) throw new Error('the runner could not open its own loopback port');
    const origin = `http://127.0.0.1:${port}`;
    log(`job ${job.id}: serving the render on ${origin}`);

    gate = createGate({
      upstream,
      secret,
      job,
      roots: {
        client: path.join(jobDir, 'client'),
        media: path.join(jobDir, 'media'),
        library: path.join(jobDir, 'library'),
        exports: path.join(jobDir, 'exports'),
      },
      // The Host header has to be this address, so nothing can point a name
      // at the runner's port and reach it.
      authority: `127.0.0.1:${port}`,
      onReport: (body) => {
        if (Number.isFinite(body.progress)) {
          report.progress = Math.max(0, Math.min(1, Number(body.progress)));
          persist({ progress: report.progress });
        }
        if (body.status === 'done') {
          report.done = true;
          report.src = typeof body.src === 'string' ? body.src : null;
          report.result = body.result ?? null;
          settle();
        } else if (body.status === 'failed') {
          report.done = true;
          report.error = String(body.error || 'the render failed');
          settle();
        }
      },
      onClaim: () => {
        if (report.done) return false;
        report.progress = 0;
        return true;
      },
    });

    heartbeat = setInterval(() => {
      const current = readJobOrThrow(jobDir);
      if (finished) return;
      writeJob(jobDir, {
        ...current,
        updatedAt: Date.now(),
        attempt: { ...(current.attempt ?? {}), heartbeatAt: Date.now() },
      });
      writeRunning(jobDir, current);
    }, HEARTBEAT_MS);
    heartbeat.unref?.();

    // The cancel request is a file in the job folder. The runner notices it
    // and stops; nothing outside this job is touched. The job is marked
    // cancelled first, so the work that is torn down cannot report a failure
    // over it.
    cancelPoll = setInterval(() => {
      if (finished || cancelled) return;
      if (!fs.existsSync(path.join(jobDir, 'cancel.request'))) return;
      log('cancel requested');
      cancelled = true;
      finish('cancelled', 'the job was cancelled');
      void cleanup().then(() => process.exit(process.exitCode ?? 130));
    }, 500);
    cancelPoll.unref?.();

    // The runner belongs to the task that started it. Where the platform
    // tells us that the parent is gone, the render stops with it; where it
    // does not, the timeout above is the bound. Nothing is detached and
    // nothing outlives this process on purpose.
    const startParent = process.ppid;
    parentWatch = setInterval(() => {
      if (finished || cancelled) return;
      if (process.ppid !== startParent) {
        log('the process that started the runner is gone; stopping the render');
        cancelled = true;
        finish('interrupted', 'the process that started the runner ended');
        void cleanup().then(() => process.exit(process.exitCode ?? 5));
      }
    }, 5000);
    parentWatch.unref?.();

    const executable = findBrowser();
    if (!executable) {
      throw new Error(
        'no Chrome or Edge install was found for the renderer. Install one, or set FABLECUT_CHROME to a Chromium-based browser.',
      );
    }

    const puppeteer = loadPuppeteer(jobDir);
    const profileDir = path.join(jobDir, 'browser-profile');
    fs.mkdirSync(profileDir, { recursive: true });

    browser = await puppeteer.launch({
      executablePath: executable,
      headless: true,
      // A pipe instead of a WebSocket: the browser opens no debugging port
      // that anything else on the machine could reach.
      pipe: true,
      userDataDir: profileDir,
      env: childEnvironment(),
      args: [
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--mute-audio',
        '--autoplay-policy=no-user-gesture-required',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--window-size=1600,900',
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 900 });
    page.on('pageerror', (error) => log(`page error: ${error.message}`));
    page.on('console', (message) => {
      const type = message.type();
      if (type === 'error') log(`page console: ${message.text()}`);
    });

    // Two gates, not one: the server refuses a request without the secret, and
    // the browser only ever talks to this one origin.
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = request.url();
      const method = request.method().toUpperCase();
      // The origin is compared, not the text: "http://127.0.0.1:1234" and
      // "http://127.0.0.1:12340" share a prefix and nothing else.
      /** @type {URL | null} */
      let parsed = null;
      try {
        parsed = new URL(url);
      } catch {
        parsed = null;
      }
      if (!parsed || parsed.origin !== origin) {
        void request.abort('blockedbyclient').catch(() => {});
        return;
      }
      if (!['GET', 'HEAD', 'POST'].includes(method)) {
        void request.abort('blockedbyclient').catch(() => {});
        return;
      }
      void request
        .continue({ headers: { ...request.headers(), [TOKEN_HEADER]: secret } })
        .catch(() => {});
    });

    const seed = Number.isFinite(job.spec?.seed) ? Number(job.spec.seed) : null;
    if (seed !== null) {
      // A fixed seed for the grain tile, and only when the job asks for one.
      await page.evaluateOnNewDocument((value) => {
        let state = value >>> 0 || 1;
        Math.random = () => {
          state ^= state << 13;
          state ^= state >>> 17;
          state ^= state << 5;
          state >>>= 0;
          return state / 4294967296;
        };
      }, seed);
    }

    const target = `${origin}/?exportJob=${encodeURIComponent(job.id)}`;

    // The fonts first. The editor's own font loader asks Google Fonts for a
    // family it does not have locally, and this renderer has no network
    // access: a family that is not on the machine would quietly come out in
    // the fallback face. The editor is loaded once without a job so that the
    // check runs before any frame is drawn.
    const families = fontFamilies(jobDir);
    if (families.length) {
      log(`job ${job.id}: checking the fonts (${families.join(', ')})`);
      await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      await page.waitForFunction(() => typeof ensureFont === 'function', { timeout: 60_000 });
      const missing = await page.evaluate(async (wanted) => {
        /** @type {string[]} */
        const out = [];
        for (const family of wanted) {
          let ok = false;
          try {
            ok = await ensureFont(family);
          } catch {
            ok = false;
          }
          if (!ok) out.push(family);
        }
        return out;
      }, families);
      if (missing.length) {
        throw new Error(
          `the font${missing.length > 1 ? 's' : ''} ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} not on this machine, ` +
            'and the renderer cannot download fonts. Use a font from the library, a system font, or render it with fablecut_export in the editor.',
        );
      }
    }

    log(`job ${job.id}: opening the editor`);
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 120_000 });

    await reported;

    if (!report.done) throw new Error('the render ended without a result');

    if (report.error) {
      finish('failed', report.error);
      await cleanup();
      return;
    }

    // The file is provisional until ffprobe and a full decode have read it.
    persist({ status: 'verifying' });
    const src = String(report.src ?? '');
    const name = decodeURIComponent(src.split('/').pop() ?? '');
    const produced = path.join(jobDir, 'exports', path.basename(name));
    if (!name || !fs.existsSync(produced)) {
      finish('failed', `the render reported a file that is not there (${src || 'no name'})`);
      await cleanup();
      return;
    }

    const provisionalDir = path.join(jobDir, 'provisional');
    fs.mkdirSync(provisionalDir, { recursive: true });
    const provisional = path.join(provisionalDir, path.basename(name));
    fs.renameSync(produced, provisional);

    const problems = [];
    const probed = await probeFile(provisional);
    if (!probed.ok) {
      problems.push(probed.error ?? 'ffprobe could not read the file');
    } else {
      const streams = Array.isArray(probed.info?.streams) ? probed.info.streams : [];
      if (!streams.some((stream) => stream.codec_type === 'video')) problems.push('the file has no video stream');
      const duration = Number(probed.info?.format?.duration);
      if (!Number.isFinite(duration) || duration <= 0) problems.push('the file has no length');
    }
    const decoded = await decodeFile(provisional);
    if (!decoded.ok) problems.push(decoded.error ?? 'the file could not be decoded');

    if (problems.length) {
      finish('failed', problems.join(' · '));
      await cleanup();
      return;
    }

    // The renderer checks the file against what was asked and says which
    // checks did not pass. The file is made, but the warnings belong to the
    // user and are not hidden.
    const warnings = reportWarnings(report.result);
    const finalPath = path.join(jobDir, 'exports', path.basename(name));
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });
    fs.renameSync(provisional, finalPath);
    const stat = fs.statSync(finalPath);
    // The result is written before the status flips, so a reader never sees a
    // finished job without its file.
    persist({
      status: 'succeeded',
      progress: 1,
      outputs: [
        {
          file: path.basename(name),
          path: finalPath,
          bytes: stat.size,
          duration: Number(probed.info?.format?.duration ?? 0),
          note: 'ffprobe and a full decode both read the file',
        },
      ],
      result: report.result ?? null,
      warnings,
      notes: warnings,
    });
    finish('succeeded');
    await cleanup();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A cancel or an interruption has already said what happened.
    if (!cancelled) finish('failed', message);
    await cleanup();
  }
}

// The runner is the entry point when it is started directly. Importing it (the
// tests do) gives the gate and the helpers without starting a render.
const isEntryPoint = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isEntryPoint) await main();

export { createGate, resolveInside, serveFile, childEnvironment, TOKEN_HEADER };
