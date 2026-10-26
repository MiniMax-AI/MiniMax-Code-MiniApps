// @ts-check
// Shared helpers for the Cutline Mini App tests.
//
// The upstream modules read their configuration from the environment the first
// time they are loaded, so a process has exactly one data directory. Node's
// test runner gives every test file its own process, which is why one file
// here starts one Mini App and the others share it.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, existsSync } from 'node:fs';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { start } from '../miniapp/node/server.mjs';

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Keep test artifacts outside the installable package and the OS temp. */
const FIXTURE_ROOT = process.env.FABLECUT_TEST_ROOT || path.resolve(PACKAGE_ROOT, '../../../.fablecut-acceptance/test-runs');

/**
 * A directory for a test fixture. The fixtures are files the tests need to
 * exist (a clip outside the library, a Cutline data folder to import from);
 * they are written under the repository's .fablecut-acceptance/ directory.
 *
 * @param {string} name
 * @returns {string}
 */
export function fixtureDir(name) {
  const dir = path.join(FIXTURE_ROOT, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A port nothing is listening on. @returns {Promise<number>} */
export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/**
 * A context shaped like the one the Host hands to start().
 *
 * @param {string} dataDir
 * @param {number} port
 */
function makeContext(dataDir, port) {
  const controller = new AbortController();
  /** @type {string[]} */
  const logged = [];
  return {
    controller,
    logged,
    context: {
      pluginId: 'cutline',
      pluginRoot: PACKAGE_ROOT,
      dataDir,
      listen: { host: /** @type {const} */ ('127.0.0.1'), port },
      signal: controller.signal,
      logger: {
        debug: (/** @type {string} */ message) => logged.push(`debug ${message}`),
        info: (/** @type {string} */ message) => logged.push(`info ${message}`),
        warn: (/** @type {string} */ message) => logged.push(`warn ${message}`),
        error: (/** @type {string} */ message) => logged.push(`error ${message}`),
      },
    },
  };
}

/** @type {any} */
let instance = null;

/**
 * Starts the Mini App once per process.
 *
 * @returns {Promise<any>}
 */
export async function startApp() {
  if (instance) return instance;
  mkdirSync(FIXTURE_ROOT, { recursive: true });
  const dataDir = mkdtempSync(path.join(FIXTURE_ROOT, 'cutline-miniapp-'));
  const port = await freePort();
  const { context, controller, logged } = makeContext(dataDir, port);
  const lifecycle = await start(context);
  instance = {
    dataDir,
    port,
    base: `http://127.0.0.1:${port}`,
    surfacePath: '/editor',
    mcpPath: '/mcp/cutline',
    controller,
    logged,
    lifecycle,
    dispose: async () => {
      await lifecycle.dispose();
      instance = null;
    },
  };
  return instance;
}

/**
 * @param {string} pathname
 * @param {RequestInit} [init]
 */
export async function request(base, pathname, init) {
  return fetch(`${base}${pathname}`, init);
}

/**
 * @param {string} base
 * @param {string} pathname
 */
export async function getJson(base, pathname) {
  const response = await fetch(`${base}${pathname}`);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, headers: response.headers, text, json };
}

/**
 * Posts a JSON-RPC message to the MCP endpoint.
 *
 * @param {string} base
 * @param {unknown} body
 * @param {{ headers?: Record<string, string>, method?: string }} [options]
 */
export async function mcpRaw(base, body, options = {}) {
  const method = options.method ?? 'POST';
  const response = await fetch(`${base}/mcp/cutline`, {
    method,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, headers: response.headers, text, json };
}

/**
 * Opens an MCP session and returns its id.
 *
 * @param {string} base
 */
export async function mcpSession(base) {
  const reply = await mcpRaw(base, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
  });
  const sessionId = reply.headers.get('mcp-session-id');
  if (!sessionId) throw new Error(`initialize did not return a session id: ${reply.text}`);
  return { sessionId, reply };
}

/**
 * Calls one MCP tool and returns its content.
 *
 * @param {string} base
 * @param {string} sessionId
 * @param {string} name
 * @param {Record<string, unknown>} [args]
 */
export async function mcpTool(base, sessionId, name, args = {}) {
  const reply = await mcpRaw(
    base,
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } },
    { headers: { 'mcp-session-id': sessionId } },
  );
  const content = reply.json?.result?.content ?? [];
  return { reply, content, text: content.map((/** @type {any} */ block) => block.text ?? '').join('\n') };
}

/**
 * Runs ffmpeg to make a small test clip with a video and an audio track.
 *
 * @param {string} file
 * @param {number} seconds
 */
export function makeClip(file, seconds) {
  return new Promise((resolve, reject) => {
    mkdirSync(path.dirname(file), { recursive: true });
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `testsrc=duration=${seconds}:size=320x240:rate=15`,
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=440:duration=${seconds}`,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      file,
    ];
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0 && existsSync(file)) resolve(file);
      else reject(new Error(`ffmpeg failed (${code}): ${stderr.slice(-400)}`));
    });
  });
}

/** @param {number} ms */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
