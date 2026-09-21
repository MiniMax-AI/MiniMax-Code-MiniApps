// Model Manager — Mini App Node runtime
// Edits enabled: flags for models in the MiniMax Code config.yaml.
// Discovers any provider block containing discovered models (OpenRouter,
// custom providers, locally hosted endpoints such as Ollama/LM Studio).

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { homedir, platform } from 'node:os';
import { spawn } from 'node:child_process';

/** @typedef {import('./miniapp-api.js').MiniAppContext} MiniAppContext */
/** @typedef {import('./miniapp-api.js').MiniAppLifecycle} MiniAppLifecycle */

const CONFIG_PATH = join(homedir(), '.minimax', 'config.yaml');

async function readConfigText() {
  return readFile(CONFIG_PATH, 'utf8');
}

/** Split config text into lines, remembering the dominant EOL so writes preserve it. */
export function splitConfigText(text) {
  return {
    lines: text.split(/\r?\n/),
    eol: text.includes('\r\n') ? '\r\n' : '\n',
  };
}

async function writeConfigLines(lines, eol) {
  const tmp = join(dirname(CONFIG_PATH), '.config.yaml.mm-tmp');
  await writeFile(tmp, lines.join(eol), 'utf8');
  await rename(tmp, CONFIG_PATH);
}

/**
 * Parse one YAML-ish line: a key ends at the first ':' followed by
 * whitespace or end-of-line (the real YAML rule, so keys like
 * `llama3.1:latest` or `deepseek/deepseek-chat-v3.1:free` still parse).
 * Returns { indent, key, value } or null for lines with no key separator.
 */
function splitKeyLine(line) {
  const m = line.match(/^(\s*)(.*)$/);
  const rest = m[2];
  if (!rest || rest.startsWith('#')) return null;
  const sep = rest.search(/:(\s|$)/);
  if (sep === -1) return null;
  const key = rest.slice(0, sep).replace(/^["']|["']$/g, '').trim();
  if (!key) return null;
  let value = rest.slice(sep + 1).trim();
  if (value.startsWith('#')) value = ''; // `key:` with only a trailing comment
  return { indent: m[1].length, key, value };
}

/**
 * Walk the YAML lines and find every "models:" block whose entries look like
 * MiniMax Code model definitions: model keys two indentation levels under
 * "models:", enabled:/name: one more level in, context: one more again.
 * Returns providers: { path: [...ancestor keys], label, models }.
 * Purely line/indent based — no YAML library needed.
 */
export function parseProviders(lines) {
  const stack = []; // { indent, key }
  const providers = [];
  for (let i = 0; i < lines.length; i++) {
    const k = splitKeyLine(lines[i]);
    if (!k || k.value !== '') continue;
    while (stack.length && stack[stack.length - 1].indent >= k.indent) stack.pop();
    stack.push({ indent: k.indent, key: k.key });
    if (k.key !== 'models') continue;
    const modelsIndent = k.indent;
    const models = [];
    let current = null;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '') continue;
      const c = splitKeyLine(lines[j]);
      if (!c) continue;
      if (c.indent <= modelsIndent) break; // left the models block
      const rel = c.indent - modelsIndent;
      if (rel === 2 && c.value === '') {
        current = { id: c.key, enabledIndex: -1, enabled: false, name: '', contextLimit: 0 };
        models.push(current);
        continue;
      }
      if (!current) continue;
      if (rel === 4 && c.key === 'enabled') {
        const vm = c.value.match(/^(true|false)\b/);
        if (vm) { current.enabledIndex = j; current.enabled = vm[1] === 'true'; }
        continue;
      }
      if (rel === 4 && c.key === 'name') {
        current.name = c.value.replace(/^['"]|['"]$/g, '');
        continue;
      }
      if (rel === 6 && c.key === 'context' && /^\d+$/.test(c.value)) {
        current.contextLimit = parseInt(c.value, 10);
        continue;
      }
    }
    if (models.some((x) => x.enabledIndex !== -1)) {
      // provider label = ancestor keys of the models block (skip 'models' itself)
      const pathKeys = stack.slice(0, -1).map((s) => s.key).filter((n) => n !== 'models');
      const label = pathKeys.length ? pathKeys.join(' / ') : 'models';
      providers.push({ path: pathKeys, label, models: models.filter((x) => x.enabledIndex !== -1) });
    }
  }
  return providers;
}

function findProvider(providers, index) {
  if (typeof index !== 'number' || Number.isNaN(index) || index < 0 || index >= providers.length) return null;
  return providers[index];
}

/** One-level undo: raw config text taken before the most recent mutation. */
let lastSnapshot = null;

async function takeSnapshot(text, withBackup, dataDir) {
  lastSnapshot = text;
  if (withBackup && dataDir) {
    try {
      const backupDir = join(dataDir, 'backups');
      await mkdir(backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await writeFile(join(backupDir, `config-${stamp}.yaml`), text, 'utf8');
    } catch {
      // backup is best-effort; never block the mutation
    }
  }
}

async function undo() {
  if (lastSnapshot === null) return { undone: false };
  const tmp = join(dirname(CONFIG_PATH), '.config.yaml.mm-tmp');
  await writeFile(tmp, lastSnapshot, 'utf8');
  await rename(tmp, CONFIG_PATH);
  lastSnapshot = null;
  return { undone: true };
}

function currentEnabled(line) {
  const m = line.match(/enabled:\s*(true|false)/);
  return m ? m[1] : null;
}

function setEnabledOnLine(line, enabled) {
  return line.replace(/(enabled:\s*)(true|false)/, `$1${enabled}`);
}

async function setModelEnabled(providerIndex, modelId, enabled) {
  const text = await readConfigText();
  const { lines, eol } = splitConfigText(text);
  const provider = findProvider(parseProviders(lines), providerIndex);
  if (!provider) throw new Error('Provider not found');
  const model = provider.models.find((m) => m.id === modelId);
  if (!model) throw new Error(`Unknown model: ${modelId}`);
  const line = lines[model.enabledIndex];
  if (currentEnabled(line) === String(enabled)) return { changed: false };
  await takeSnapshot(text, false);
  lines[model.enabledIndex] = setEnabledOnLine(line, enabled);
  await writeConfigLines(lines, eol);
  return { changed: true };
}

async function setModelsEnabled(providerIndex, ids, enabled, dataDir) {
  const text = await readConfigText();
  const { lines, eol } = splitConfigText(text);
  const provider = findProvider(parseProviders(lines), providerIndex);
  if (!provider) throw new Error('Provider not found');
  const wanted = new Set(ids);
  const touched = provider.models.filter(
    (m) => wanted.has(m.id) && currentEnabled(lines[m.enabledIndex]) !== String(enabled),
  );
  if (touched.length > 0) {
    await takeSnapshot(text, true, dataDir);
    for (const m of touched) {
      lines[m.enabledIndex] = setEnabledOnLine(lines[m.enabledIndex], enabled);
    }
    await writeConfigLines(lines, eol);
  }
  return touched.length;
}

function json(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request, response, maxBytes = 1024 * 1024) {
  let body = '';
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      json(response, 413, { error: 'payload_too_large' });
      return null;
    }
    body += chunk;
  }
  if (!body) return {};
  try {
    const parsed = JSON.parse(body);
    if (parsed === null || typeof parsed !== 'object') {
      json(response, 400, { error: 'invalid_json_body' });
      return null;
    }
    return parsed;
  } catch {
    json(response, 400, { error: 'invalid_json_body' });
    return null;
  }
}

/** Open a URL in the OS default browser (Windows / macOS / Linux),
 *  falling back through launch strategies until one spawns cleanly. */
function openExternal(url, logger) {
  let strategies;
  const p = platform();
  if (p === 'win32') {
    strategies = [
      ['rundll32.exe', ['url.dll,FileProtocolHandler', url]],
      ['cmd.exe', ['/c', 'start', '', url]],
      ['explorer.exe', [url]],
    ];
  } else if (p === 'darwin') {
    strategies = [['open', [url]]];
  } else {
    strategies = [['xdg-open', [url]]];
  }
  const tryNext = (i) => {
    if (i >= strategies.length) {
      logger.error('miniapp.open_external.failed', { message: 'all launch strategies failed', url });
      return;
    }
    const [cmd, args] = strategies[i];
    let child;
    try {
      child = spawn(cmd, args, { stdio: 'ignore', windowsHide: true });
    } catch (error) {
      logger.error('miniapp.open_external.retry', { cmd, message: String(error?.message ?? error) });
      tryNext(i + 1);
      return;
    }
    child.on('error', (error) => {
      logger.error('miniapp.open_external.retry', { cmd, message: String(error?.message ?? error) });
      tryNext(i + 1);
    });
    child.unref();
  };
  tryNext(0);
}

export async function start(context) {
  const clientIndex = await readFile(
    join(context.pluginRoot, 'miniapp/client/index.html'),
    'utf8',
  );

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://miniapp.local');
    const route = `${request.method} ${url.pathname}`;

    try {
      if (request.method === 'GET' && url.pathname === '/dashboard') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(clientIndex);
        return;
      }

      // List providers that contain manageable models.
      if (request.method === 'GET' && url.pathname === '/api/providers') {
        const { lines } = splitConfigText(await readConfigText());
        const providers = parseProviders(lines);
        json(response, 200, {
          configPath: CONFIG_PATH,
          providers: providers.map((p, i) => ({
            index: i,
            label: p.label,
            modelCount: p.models.length,
            enabledCount: p.models.filter((m) => m.enabled).length,
          })),
        });
        return;
      }

      // Models for one provider.
      if (request.method === 'GET' && url.pathname === '/api/models') {
        const providerIndex = parseInt(url.searchParams.get('provider') ?? '0', 10);
        const { lines } = splitConfigText(await readConfigText());
        const provider = findProvider(parseProviders(lines), providerIndex);
        if (!provider) {
          json(response, 404, { error: 'provider_not_found' });
          return;
        }
        const isOpenRouter = /openrouter/i.test(provider.label);
        json(response, 200, {
          provider: provider.label,
          isOpenRouter,
          models: provider.models.map((m) => ({
            id: m.id,
            name: m.name,
            enabled: m.enabled,
            contextLimit: m.contextLimit,
          })),
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/set') {
        const body = await readJsonBody(request, response);
        if (body === null) return;
        const { provider, model, enabled } = body;
        if (typeof model !== 'string' || model.length === 0 || typeof enabled !== 'boolean') {
          json(response, 400, { error: 'invalid_arguments' });
          return;
        }
        const result = await setModelEnabled(typeof provider === 'number' ? provider : 0, model, enabled);
        json(response, 200, result);
        return;
      }

      // Bulk update scoped to the given model ids of one provider.
      if (request.method === 'POST' && url.pathname === '/api/bulk') {
        const body = await readJsonBody(request, response);
        if (body === null) return;
        const { provider, enabled, models } = body;
        if (typeof enabled !== 'boolean' || !Array.isArray(models) ||
            !models.every((x) => typeof x === 'string' && x.length > 0)) {
          json(response, 400, { error: 'invalid_arguments' });
          return;
        }
        const changedCount = await setModelsEnabled(
          typeof provider === 'number' ? provider : 0,
          [...new Set(models)],
          enabled,
          context.dataDir,
        );
        json(response, 200, { changedCount });
        return;
      }

      // One-level undo of the most recent mutation.
      if (request.method === 'POST' && url.pathname === '/api/undo') {
        const result = await undo();
        json(response, 200, result);
        return;
      }

      // Open an OpenRouter model page in the user's external browser.
      if (request.method === 'POST' && url.pathname === '/api/open-external') {
        const body = await readJsonBody(request, response);
        if (body === null) return;
        const target = typeof body.url === 'string' ? body.url : '';
        const ok = /^https:\/\/openrouter\.ai\/[A-Za-z0-9_.~-]+\/[A-Za-z0-9_.~:-]+$/.test(target);
        if (!ok) {
          json(response, 400, { error: 'url_not_allowed' });
          return;
        }
        openExternal(target, context.logger);
        json(response, 200, { opened: true });
        return;
      }

      json(response, 404, { error: 'not_found' });
    } catch (error) {
      context.logger.error('miniapp.request.failed', { route, message: String(error?.message ?? error) });
      json(response, 500, { error: 'internal_error', message: String(error?.message ?? error) });
    }
  });

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

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
