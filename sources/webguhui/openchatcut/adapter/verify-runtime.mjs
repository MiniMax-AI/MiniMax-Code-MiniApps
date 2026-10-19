import assert from 'node:assert/strict';
import { readFile, stat, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
// 隔离解析守卫：测试驱动可用开发 SDK，但运行缓存的所有模块禁止借用祖先依赖。
import Module, { register } from 'node:module';
const runtimeRoot = resolve(import.meta.dirname, '.validation-data/runtime') + '/';
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (specifier, parent, ...rest) {
  const result = originalResolve.call(this, specifier, parent, ...rest);
  if (parent?.filename?.startsWith(runtimeRoot) && typeof result === 'string' && result.startsWith('/') && !result.startsWith(runtimeRoot)) {
    throw new Error(`ISOLATION_VIOLATION: ${specifier} from ${parent.filename} resolved outside runtime: ${result}`);
  }
  return result;
};
register('data:text/javascript,' + encodeURIComponent(`
  const root = ${JSON.stringify(pathToFileURL(runtimeRoot).href)};
  export async function resolve(specifier, context, next) {
    const result = await next(specifier, context);
    if (context.parentURL?.startsWith(root) && result.url.startsWith('file:') && !result.url.startsWith(root)) {
      throw new Error('ISOLATION_VIOLATION: ' + specifier + ' from ' + context.parentURL + ' resolved outside runtime: ' + result.url);
    }
    return result;
  }
`), import.meta.url);
console.log('Isolation guard enabled for ESM and CommonJS runtime dependencies');
const packageRoot = resolve(import.meta.dirname, process.argv[2] ?? 'release');
const { start } = await import(pathToFileURL(resolve(packageRoot, 'miniapp/node/server.mjs')).href);
const probe = createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
const conflictCheck = process.argv.includes('--port-conflict');
if (!conflictCheck) await new Promise(resolve => probe.close(resolve));
const controller = new AbortController();
let app;
try {
  app = await start({ pluginRoot: packageRoot, dataDir: resolve(import.meta.dirname, '.validation-data'), listen: { host: '127.0.0.1', port }, signal: controller.signal, logger: { info: console.log, debug: () => {}, error: console.error } });
  assert.equal(conflictCheck, false, 'occupied port must reject startup');
  const upstream = JSON.parse(await readFile(resolve(packageRoot, 'miniapp/node/upstream.json'), 'utf8'));
  const restore = JSON.parse(await readFile(resolve(packageRoot, 'miniapp/node/restore-files.json'), 'utf8'));
  for (const entry of restore.files) {
    const path = resolve(import.meta.dirname, '.validation-data/runtime', upstream.buildId, entry.target);
    const bytes = await readFile(path);
    assert.equal(bytes.length, entry.size);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    assert.equal((await stat(path)).mode & 0o777, entry.mode);
  }
  console.log('PASS all restored file hashes and permissions', restore.files.length);
  const response = await fetch(`http://127.0.0.1:${port}/dashboard`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /OpenChatCut/);
  // 以源码资产为期望集，逐个真实 HTTP 请求，防止漏复制和 HTML 伪 200。
  const assetRoot = resolve(import.meta.dirname, 'upstream/assets');
  let assetCount = 0;
  async function verifyAsset(relative) {
    const expected = await readFile(resolve(assetRoot, relative));
    const response = await fetch(`http://127.0.0.1:${port}/${relative.split('/').map(encodeURIComponent).join('/')}`);
    assert.equal(response.status, 200, relative);
    const type = response.headers.get('content-type') ?? '';
    assert.ok(!type.includes('text/html'), `${relative}: unexpected HTML`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(bytes, expected, `${relative}: HTTP content differs from source`);
    const ext = relative.split('.').pop().toLowerCase();
    if (ext === 'jpg' || ext === 'jpeg') { assert.match(type, /image\/jpeg/); assert.equal(bytes.subarray(0, 3).toString('hex'), 'ffd8ff'); }
    if (ext === 'png') { assert.match(type, /image\/png/); assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a'); }
    if (ext === 'woff2') { assert.match(type, /font\/woff2/); assert.equal(bytes.subarray(0, 4).toString(), 'wOF2'); }
    if (ext === 'woff') { assert.match(type, /font\/woff/); assert.equal(bytes.subarray(0, 4).toString(), 'wOFF'); }
    if (ext === 'ttf' || ext === 'otf') { assert.match(type, /font\//); assert.ok(['00010000', '4f54544f', '74727565', '74746366'].includes(bytes.subarray(0, 4).toString('hex'))); }
    if (ext === 'mp3') { assert.match(type, /audio\//); assert.ok(bytes.subarray(0, 3).toString() === 'ID3' || bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0, relative); }
    if (ext === 'json') { assert.match(type, /application\/json/); JSON.parse(bytes.toString()); }
    assetCount++;
  }
  async function verifyAssets(directory = '') {
    for (const entry of await readdir(resolve(assetRoot, directory), { withFileTypes: true })) {
      if (entry.name === 'README.md' || entry.name === 'readme-pic') continue;
      const relative = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await verifyAssets(relative);
      else if (entry.isFile()) await verifyAsset(relative);
    }
  }
  await verifyAssets();
  for (const file of ['openchatcut-templates.json', 'koubo-scenes-templates.json', 'social-shorts-templates.json']) {
    const templates = JSON.parse(await readFile(resolve(assetRoot, 'templates', file), 'utf8'));
    for (const template of templates) {
      assert.ok(typeof template.code === 'string' && template.code.length > 0, `missing template code: ${template.name}`);
      if (template.thumb?.startsWith('/')) await verifyAsset(template.thumb.slice(1));
    }
  }
  const missingAsset = await fetch(`http://127.0.0.1:${port}/thumbnails/does-not-exist.jpg`);
  assert.equal(missingAsset.status, 404, 'missing asset must not return SPA HTML');
  console.log('PASS real HTTP product assets: MIME, signatures, exact bytes and template references', assetCount);
  const store = await fetch(`http://127.0.0.1:${port}/api/project-store`, { headers: { 'sec-fetch-site': 'same-origin' } });
  assert.equal(store.status, 200);
  const snapshot = await store.json();
  assert.equal(snapshot.version, 1);
  assert.equal(typeof snapshot.entries, 'object');
  const { Client } = await import('./upstream/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js');
  const { StreamableHTTPClientTransport } = await import('./upstream/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js');
  const mcp = new Client({ name: 'miniapp-verifier', version: '1.0.0' });
  try {
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp/openchatcut`)));
    const initialTools = await mcp.listTools();
    for (const name of ['list_edit_sessions', 'recover_edit_session']) {
      assert.ok(initialTools.tools.some(tool => tool.name === name), `recovery tool missing before browser registration: ${name}`);
    }
    console.log('PASS real MCP initial tools/list exposes recovery before browser registration');
    const created = await mcp.callTool({ name: 'create_project', arguments: { name: 'MiniApp MCP validation', fps: 24, compositionWidth: 320, compositionHeight: 240 } });
    assert.notEqual(created.isError, true, JSON.stringify(created));
    const listed = await mcp.callTool({ name: 'list_projects', arguments: {} });
    assert.notEqual(listed.isError, true);
    assert.match(JSON.stringify(listed), /MiniApp MCP validation/);
    console.log('PASS real MCP create_project and durable list_projects readback');
  } finally { await mcp.close(); }
  const image = await readFile(resolve(packageRoot, 'icon.png'));
  const upload = await fetch(`http://127.0.0.1:${port}/upload?name=miniapp-check.png`, {
    method: 'POST', headers: { 'Content-Type': 'image/png', 'sec-fetch-site': 'same-origin', origin: `http://127.0.0.1:${port}` }, body: image,
  });
  assert.equal(upload.status, 200);
  const uploaded = await upload.json();
  assert.match(uploaded.path, /^\/media\/uploads\//);
  const download = await fetch(`http://127.0.0.1:${port}${uploaded.path}`, { headers: { 'sec-fetch-site': 'same-origin' } });
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), image);
  console.log('PASS image upload and byte-identical readback');
  const capabilities = await fetch(`http://127.0.0.1:${port}/export/capabilities`, { headers: { 'sec-fetch-site': 'same-origin' } });
  assert.equal(capabilities.status, 200);
  const encoding = await capabilities.json();
  assert.ok(encoding.h264, 'H.264 capability must be reported');
  console.log('PASS standalone packaged startup, page, project store and export capability');
  if (process.argv.includes('--render')) {
    const rendered = await fetch(`http://127.0.0.1:${port}/export`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'sec-fetch-site': 'same-origin', origin: `http://127.0.0.1:${port}` },
      body: JSON.stringify({ state: { fps: 24, width: 320, height: 240, selectedId: null, items: [{ id: 'miniapp-image-check', kind: 'image', track: 'V1', name: '导入图片检查', startFrame: 0, durationInFrames: 24, src: uploaded.path, width: 320, height: 240 }] }, format: 'video', codec: 'h264', filename: 'miniapp-render-check' }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!rendered.ok) throw new Error(`Render failed (${rendered.status}): ${await rendered.text()}`);
    const bytes = new Uint8Array(await rendered.arrayBuffer());
    assert.ok(bytes.byteLength > 1000);
    assert.equal(new TextDecoder().decode(bytes.slice(4, 8)), 'ftyp');
    console.log('PASS real 1-second H.264 render', bytes.byteLength, 'bytes');
  }
} catch (error) {
  if (!conflictCheck || error.code !== 'EADDRINUSE') throw error;
  console.log('PASS occupied-port startup rejection and cleanup');
} finally {
  if (probe.listening) await new Promise(resolve => probe.close(resolve));
  if (app) await app.dispose();
}
