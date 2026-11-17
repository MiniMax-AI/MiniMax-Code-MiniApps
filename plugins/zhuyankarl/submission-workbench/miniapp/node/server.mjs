// @ts-check
/**
 * Mini App Node entry: 插件上架材料工作台.
 *
 * All business mutations go through one domain service: validate -> commit ->
 * respond. The Client never touches the filesystem or the network directly.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { Store, sha256 } from './lib/store.mjs';
import { validateDraft } from './lib/listing-rules.mjs';
import { buildPreview, buildPackage } from './lib/package-builder.mjs';
import { probeSubmissionChannel } from './lib/channel.mjs';
import { CATEGORIES, GUIDE_URL } from './lib/manifest-rules.mjs';

/** @typedef {import('./lib/store.mjs').Asset} Asset */
/** @typedef {import('./lib/listing-rules.mjs').Draft} Draft */
/** @typedef {import('./miniapp-api.js').MiniAppContext} MiniAppContext */
/** @typedef {import('./miniapp-api.js').MiniAppLifecycle} MiniAppLifecycle */

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const SURFACE_PATH = '/dashboard';

const ALLOWED_MIME = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['text/markdown', 'md'],
  ['text/plain', 'md'],
  ['application/json', 'json'],
]);

/**
 * @param {string} name
 * @returns {string}
 */
function safeName(name) {
  return name
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part !== '' && part !== '.' && part !== '..')
    .join('/');
}

/**
 * @param {import('node:http').IncomingMessage} request
 * @returns {Promise<Buffer>}
 */
function readBody(request) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) {
        reject(new Error('请求体超过大小上限'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

/**
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {unknown} payload
 */
function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(body);
}

/**
 * @param {Partial<Draft>} input
 * @returns {Draft}
 */
function normalizeDraft(input) {
  const value = /** @type {Record<string, unknown>} */ (input ?? {});
  const list = (key) =>
    Array.isArray(value[key]) ? (/** @type {unknown[]} */ (value[key])).map((item) => String(item)) : [];
  return {
    manifestText: String(value.manifestText ?? ''),
    marketName: String(value.marketName ?? ''),
    summary: String(value.summary ?? ''),
    documentation: String(value.documentation ?? ''),
    category: String(value.category ?? ''),
    exampleQueries: list('exampleQueries'),
    regions: list('regions'),
    enabledEnds: list('enabledEnds'),
    operation: value.operation === 'update' ? 'update' : 'new',
    existingName: String(value.existingName ?? ''),
    previousVersion: String(value.previousVersion ?? ''),
    submitEmail: String(value.submitEmail ?? ''),
    submitAccount: String(value.submitAccount ?? ''),
    organization: String(value.organization ?? ''),
  };
}

/**
 * @param {MiniAppContext} context
 * @returns {Promise<MiniAppLifecycle>}
 */
export async function start(context) {
  const store = new Store(context.dataDir);
  await store.init();

  const clientHtml = await readFile(join(context.pluginRoot, 'miniapp/client/index.html'), 'utf8');
  const clientScript = await readFile(join(context.pluginRoot, 'miniapp/client/app.js'), 'utf8');
  const clientStyle = await readFile(join(context.pluginRoot, 'miniapp/client/app.css'), 'utf8');

  /**
   * Run the full validation pass and shape the response shared by the
   * validate, preview and package endpoints.
   * @param {Draft} draft
   */
  async function inspect(draft) {
    const assets = await store.listAssets();
    const { issues, manifest } = validateDraft(draft, assets);
    const channel = await probeSubmissionChannel(/** @type {any} */ (context), draft);
    const preview = buildPreview(manifest, draft, assets);
    const missing = issues.filter((issue) => issue.missing);
    return {
      issues,
      manifest,
      preview,
      channel,
      assets,
      summary: {
        errors: issues.filter((issue) => issue.severity === 'error').length,
        warnings: issues.filter((issue) => issue.severity === 'warning').length,
        infos: issues.filter((issue) => issue.severity === 'info').length,
        missing: missing.length,
      },
    };
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://miniapp.local');
    const route = `${request.method ?? 'GET'} ${url.pathname}`;

    try {
      if (route === `GET ${SURFACE_PATH}`) {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(clientHtml);
        return;
      }
      if (route === 'GET /client/app.js') {
        response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
        response.end(clientScript);
        return;
      }
      if (route === 'GET /client/app.css') {
        response.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
        response.end(clientStyle);
        return;
      }
      if (route === 'GET /api/meta') {
        sendJson(response, 200, {
          categories: CATEGORIES,
          guideUrl: GUIDE_URL,
          surfacePath: SURFACE_PATH,
        });
        return;
      }
      if (route === 'GET /api/state') {
        const draft = normalizeDraft(/** @type {any} */ (await store.loadDraft()));
        const assets = await store.listAssets();
        const packages = await store.listPackages();
        sendJson(response, 200, { draft, assets, packages });
        return;
      }
      if (route === 'POST /api/validate') {
        const body = await readBody(request);
        const draft = normalizeDraft(JSON.parse(body.toString('utf8') || '{}'));
        await store.saveDraft(draft);
        const result = await inspect(draft);
        sendJson(response, 200, result);
        return;
      }
      if (route === 'POST /api/assets') {
        const body = await readBody(request);
        const payload = JSON.parse(body.toString('utf8') || '{}');
        const name = safeName(String(payload.name ?? ''));
        if (name === '') {
          sendJson(response, 400, { error: 'invalid_name', message: '素材路径不能为空。' });
          return;
        }
        const role = ['icon', 'screenshot', 'skill', 'mcp', 'app', 'doc'].includes(String(payload.role))
          ? /** @type {Asset['role']} */ (String(payload.role))
          : 'doc';
        const mime = String(payload.mime ?? 'application/octet-stream');
        if (!ALLOWED_MIME.has(mime)) {
          sendJson(response, 400, {
            error: 'unsupported_type',
            message: `不支持的素材类型：${mime}。允许 ${[...ALLOWED_MIME.keys()].join('、')}。`,
          });
          return;
        }
        const bytes = Buffer.from(String(payload.contentBase64 ?? ''), 'base64');
        if (bytes.length === 0) {
          sendJson(response, 400, { error: 'empty_file', message: '素材内容为空。' });
          return;
        }
        /** @type {Asset} */
        const asset = {
          id: randomUUID(),
          name,
          role,
          size: bytes.length,
          mime,
          createdAt: new Date().toISOString(),
        };
        await store.saveAsset(asset, bytes);
        sendJson(response, 201, { asset });
        return;
      }
      if (route === 'DELETE /api/assets') {
        const id = url.searchParams.get('id') ?? '';
        if (!id) {
          sendJson(response, 400, { error: 'missing_id', message: '缺少素材 id。' });
          return;
        }
        await store.deleteAsset(id);
        sendJson(response, 200, { ok: true });
        return;
      }
      if (route === 'POST /api/package') {
        const body = await readBody(request);
        const draft = normalizeDraft(JSON.parse(body.toString('utf8') || '{}'));
        await store.saveDraft(draft);
        const result = await inspect(draft);
        if (result.summary.errors > 0) {
          sendJson(response, 409, {
            error: 'not_ready',
            message: `仍有 ${result.summary.errors} 项错误，修正后再生成。`,
            ...result,
          });
          return;
        }
        const built = await buildPackage(
          draft,
          result.manifest,
          result.assets,
          (asset) => store.readAssetBytes(asset.id),
          result.issues,
          result.channel,
        );
        const record = {
          id: randomUUID(),
          fileName: `${draft.marketName || 'plugin'}-listing-package.zip`.replace(
            /[^\w.\-一-龥]+/g,
            '-',
          ),
          createdAt: new Date().toISOString(),
          size: built.bytes.length,
          sha256: sha256(built.bytes),
          entries: built.entries,
          manifest: result.manifest,
        };
        await store.savePackage(record, built.bytes);
        sendJson(response, 201, { package: record, preview: result.preview });
        return;
      }
      if (route === 'GET /api/package/download') {
        const id = url.searchParams.get('id') ?? '';
        const bytes = await store.readPackageBytes(id);
        if (!bytes) {
          sendJson(response, 404, { error: 'not_found', message: '找不到该上架材料包。' });
          return;
        }
        const packages = await store.listPackages();
        const record = packages.find((item) => item.id === id);
        // HTTP headers must stay ASCII: keep a sanitized fallback name and
        // carry the real (possibly Chinese) name in the RFC 5987 field.
        const fileName = record?.fileName ?? 'listing-package.zip';
        const fallbackName = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
        response.writeHead(200, {
          'content-type': 'application/zip',
          'content-disposition': `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
          'content-length': String(bytes.length),
        });
        response.end(bytes);
        return;
      }
      if (route === 'GET /api/channel') {
        const draft = normalizeDraft(/** @type {any} */ (await store.loadDraft()));
        const channel = await probeSubmissionChannel(/** @type {any} */ (context), draft);
        sendJson(response, 200, { channel });
        return;
      }

      sendJson(response, 404, { error: 'not_found', message: `未知的路由：${route}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      context.logger.error('miniapp.request.failed', { route, message });
      sendJson(response, 500, { error: 'server_error', message });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(context.listen.port, context.listen.host, () => {
      server.off('error', reject);
      resolve(undefined);
    });
  });
  context.logger.info('miniapp.runtime.listening');

  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    context.signal.removeEventListener('abort', onAbort);
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  };
  const onAbort = () => {
    void dispose();
  };
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();

  return { dispose };
}
