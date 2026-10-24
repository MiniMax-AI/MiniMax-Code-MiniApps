// Mini App 宿主适配：复用完整业务中间件，监听端口由宿主分配。
import { editorCredentialAuthorized } from '../server/editor-auth.ts';
import { readJsonBody, sendJson } from '../server/plugins/export-http.ts';
import { createServer } from 'node:http';
import { miniappPlugins } from '../server/plugins/miniapp.ts';
import { createMiniConnect } from './mini-connect.ts';
import { distStaticMiddleware, uploadsMiddleware, sendFile } from './static-files.ts';
import { registerProductAssetRoot, registerProductAssetLoader, ensureProductAssets } from '../server/product-assets.ts';
// 不导入 embedded-server：它会带入独立 Agent 与云生成后端。
import type { ViteDevServer } from 'vite';
import { disposeMediaProcesses } from '../server/media-process.ts';
import { disposeMcpSessions, handleMcpRequest } from '../server/external-agent/mcp.ts';
import { disposeExportJobs } from '../server/plugins/export-runtime.ts';
import { closeSqliteStore } from '../server/storage/sqlite-store.ts';
// Mini App 无独立 Agent run 生命周期。
import { disposeGenerationJobStore } from '../server/plugins/generation-job-store.ts';
import { resetSearchForTests } from '../server/storage/fulltext-search.ts';
import { resetSemanticVectorsForTests } from '../server/storage/semantic-vectors.ts';

interface ResourceStore {
  root: string;
  has(path: string): boolean;
  ensure(path: string): Promise<string | null>;
  status(): Promise<unknown>;
  setRegion(region: unknown): Promise<void>;
}
export async function startEditor(clientDir: string, host: string, port: number, existingServer?: ReturnType<typeof createServer>, resources?: ResourceStore) {
  registerProductAssetRoot(clientDir);
  if (resources) { registerProductAssetRoot(resources.root); registerProductAssetLoader(resources.ensure); }
  // 推理模型和密钥由宿主管理。
  const app = createMiniConnect(() => console.error('[miniapp] request failed'));
  let stopping = false;
  const server = existingServer ?? createServer();
  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    if (stopping) { res.writeHead(503); res.end('服务正在关闭'); return; }
    app.handle(req, res);
  });
  // 此入口由 Mini App 宿主在 HTTP 层认证，不再套用上游外部客户端令牌。
  app.use('/mcp/openchatcut', (req, res) => handleMcpRequest(req, res, `http://${host}:${port}`));
  app.use('/__setup/status', (_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({state:'ready'})); });
  if (resources) {
    app.use('/api/product-resources', async (req, res) => {
      if (!editorCredentialAuthorized(req, req.method !== 'GET')) { sendJson(res, 403, { error: 'local editor request required' }); return; }
      try {
        if (req.method === 'GET') { sendJson(res, 200, await resources.status()); return; }
        if (req.method === 'POST' && req.url === '/region') {
          const body = await readJsonBody(req) as { region?: unknown };
          await resources.setRegion(body.region);
        } else if (req.method === 'POST' && req.url === '/prepare') {
          await ensureProductAssets(await readJsonBody(req));
        } else { sendJson(res, 405, { error: 'method not allowed' }); return; }
        sendJson(res, 200, await resources.status());
      } catch (error) { sendJson(res, 503, { error: error instanceof Error ? error.message : String(error) }); }
    });
    app.use(async (req, res, next) => {
      if (!['GET', 'HEAD'].includes(req.method ?? '') || !resources.has(req.url ?? '')) { next(); return; }
      if (!editorCredentialAuthorized(req, false)) { sendJson(res, 403, { error: 'local editor request required' }); return; }
      try { const file = await resources.ensure(req.url!); if (file) await sendFile(req, res, file); else next(); }
      catch (error) { sendJson(res, 503, { error: error instanceof Error ? error.message : String(error) }); }
    });
  }
  app.use('/api/keys' , (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ caps: {}, keys: {}, models: {} }));
  });
  const logger = { info() {}, warn() {}, error() { console.error('[miniapp] service error'); } };
  const fake = {
    middlewares: { use: app.use.bind(app) }, httpServer: server, config: { logger },
  } as unknown as ViteDevServer;
  const plugins = miniappPlugins();
  const cleanupResources = async () => {
    const results = await Promise.allSettled([disposeExportJobs(), disposeMcpSessions(), disposeMediaProcesses()]);
    try { await disposeGenerationJobStore(); }
    finally {
      resetSearchForTests();
      resetSemanticVectorsForTests();
      closeSqliteStore();
    }
    if (results.some(result => result.status === 'rejected')) throw new Error('Some editor resources did not stop');
  };
  try {
    for (const plugin of plugins) {
      const hook = plugin.configureServer;
      const fn = typeof hook === 'function' ? hook : hook?.handler;
      await fn?.call(plugin as never, fake);
    }
    app.use('/media/uploads', uploadsMiddleware());
    app.use(distStaticMiddleware(clientDir));
    if (!server.listening) await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => { server.off('error', reject); resolve(); });
    });
  } catch (error) {
    stopping = true;
    server.closeAllConnections();
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    await cleanupResources().catch(() => console.error('[miniapp] startup cleanup failed'));
    throw error;
  }
  let disposal: Promise<void> | undefined;
  const dispose = () => disposal ??= (async () => {
    stopping = true;
    server.closeAllConnections();
    const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    const results = await Promise.allSettled([cleanupResources(), closed]);
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) throw new Error('Some editor resources did not stop');
  })();
  return { server, plugins, dispose };
}
