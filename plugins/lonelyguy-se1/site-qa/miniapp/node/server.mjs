// @ts-check

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';

import { PathError, promptForFinding, promptForSummary, scanProject } from './scan.mjs';
import { discoverSiteRoots } from './sites.mjs';

const PAGES = new Map([
  ['/qa', ['index.html', 'text/html; charset=utf-8']],
  ['/qa/', ['index.html', 'text/html; charset=utf-8']],
  ['/qa/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/qa/app.css', ['app.css', 'text/css; charset=utf-8']],
]);

/**
 * @param {object} context
 * @param {string} context.pluginRoot
 * @param {string} context.dataDir
 * @param {{ host: string, port: number }} context.listen
 * @param {AbortSignal} context.signal
 * @param {{ info: Function, warn: Function, error: Function }} context.logger
 */
export async function start(context) {
  /** @type {Awaited<ReturnType<typeof scanProject>> | null} */
  let latest = null;
  /** @type {string} */
  let selectedRoot = '';

  const pages = new Map();
  for (const [route, [file, type]] of PAGES) {
    pages.set(route, { type, body: await readFile(join(context.pluginRoot, 'miniapp/client', file)) });
  }

  const server = createServer((request, response) => {
    void handle(request, response).catch((error) => {
      if (response.headersSent || response.writableEnded) return;
      const known = error instanceof PathError ? error : new PathError('request_failed', 'Something went wrong while scanning.');
      if (error instanceof PathError) context.logger.warn(`siteqa.refused ${error.code}`);
      else context.logger.error('siteqa.failed');
      sendJson(response, statusFor(known.code), { error: known.code, message: known.message });
    });
  });

  /**
   * @param {import('node:http').IncomingMessage} request
   * @param {import('node:http').ServerResponse} response
   */
  async function handle(request, response) {
    const url = new URL(request.url ?? '/', 'http://miniapp.local');
    if (request.method === 'GET') {
      const page = pages.get(url.pathname);
      if (page) {
        response.writeHead(200, { 'content-type': page.type, 'cache-control': 'no-store' });
        response.end(page.body);
        return;
      }
      if (url.pathname === '/api/state') {
        sendJson(response, 200, {
          root: selectedRoot || latest?.root || '',
          report: latest ? publicReport(latest) : null,
        });
        return;
      }
    }

    if (request.method !== 'POST') {
      sendJson(response, 404, { error: 'not_found', message: 'That route is not part of Site QA.' });
      return;
    }

    const body = await readJson(request);
    if (url.pathname === '/api/workspace') {
      const root = String(body.path ?? body.root ?? '').trim();
      selectedRoot = root;
      sendJson(response, 200, { root });
      return;
    }
    if (url.pathname === '/api/sites') {
      const root = String(body.path ?? body.root ?? selectedRoot ?? '').trim();
      const controller = abortOnClose(response);
      const result = await discoverSiteRoots(root, {
        signal: controller.signal,
        minimaxDataDir: context.dataDir,
      });
      sendJson(response, 200, result);
      return;
    }
    if (url.pathname === '/api/scan') {
      const root = String(body.path ?? body.root ?? selectedRoot ?? '').trim();
      const controller = abortOnClose(response);
      const report = await scanProject(root, {
        signal: controller.signal,
        minimaxDataDir: context.dataDir,
      });
      latest = report;
      selectedRoot = report.root;
      context.logger.info(`siteqa.scanned ${report.filesScanned}`);
      sendJson(response, 200, publicReport(report));
      return;
    }
    if (url.pathname === '/api/prompt') {
      if (!latest) throw new PathError('scan_required', 'Run a scan before asking for a fix prompt.');
      const kind = String(body.kind ?? 'finding');
      const text =
        kind === 'summary' ? promptForSummary(latest) : promptForFinding(latest, String(body.id ?? ''));
      if (text.length > 100_000) throw new PathError('prompt_too_large', 'That prompt is too large for the chat input.');
      sendJson(response, 200, { text });
      return;
    }
    sendJson(response, 404, { error: 'not_found', message: 'That route is not part of Site QA.' });
  }

  await listen(server, context.listen.host, context.listen.port);
  context.logger.info('miniapp.runtime.listening');

  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    context.signal.removeEventListener('abort', onAbort);
    await close(server);
  };
  const onAbort = () => {
    void dispose();
  };
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();
  return { dispose };
}

/** @param {Awaited<ReturnType<typeof scanProject>>} report */
function publicReport(report) {
  return {
    root: report.root,
    scannedAt: report.scannedAt,
    filesScanned: report.filesScanned,
    filesSkipped: report.filesSkipped,
    truncated: report.truncated,
    skippedDirs: report.skippedDirs,
    counts: report.counts,
    pages: report.pages.map((page) => ({ relative: page.relative, bytes: page.bytes, skipped: page.skipped })),
    findings: report.findings,
  };
}

/** @param {import('node:http').ServerResponse} response */
function abortOnClose(response) {
  const controller = new AbortController();
  response.on('close', () => {
    if (!response.writableEnded) controller.abort();
  });
  return controller;
}

/** @param {import('node:http').IncomingMessage} request */
function readJson(request) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > 200_000) {
        reject(new PathError('body_too_large', 'That request is too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) {
        resolve({});
        return;
      }
      try {
        const value = JSON.parse(text);
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          reject(new PathError('body_invalid', 'Expected a JSON object.'));
          return;
        }
        resolve(value);
      } catch {
        reject(new PathError('body_invalid', 'The request body was not valid JSON.'));
      }
    });
    request.on('error', () => reject(new PathError('body_invalid', 'The request was interrupted.')));
  });
}

/** @param {string} code */
function statusFor(code) {
  if (code === 'not_found') return 404;
  if (code === 'aborted') return 499;
  return 400;
}

/** @param {import('node:http').ServerResponse} response @param {number} status @param {unknown} value */
function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

/** @param {import('node:http').Server} server @param {string} host @param {number} port */
function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve(undefined);
    });
  });
}

/** @param {import('node:http').Server} server */
function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve(undefined)));
  });
}
