// @ts-check
/**
 * Server integration harness: starts the real Node service on an ephemeral
 * port and drives it over HTTP exactly like the Client does.
 *
 * It covers the path the DOM harness cannot: real HTTP headers, the asset
 * upload route, package generation and the download route.
 *
 * Run: node tests/server-harness.mjs
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

import { start } from '../miniapp/node/server.mjs';

let passed = 0;
let failed = 0;

/**
 * @param {string} name
 * @param {boolean} condition
 * @param {string} [detail]
 */
function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` :: ${detail}` : ''}`);
  }
}

/**
 * @returns {Promise<number>}
 */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

const dataDir = await mkdtemp(join(tmpdir(), 'miniapp-listing-'));
// Resolve the package root from this file so the harness works from any cwd.
const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = await freePort();
const controller = new AbortController();

const lifecycle = await start({
  pluginId: 'test',
  pluginRoot,
  dataDir,
  listen: { host: '127.0.0.1', port },
  signal: controller.signal,
  logger: { info() {}, warn() {}, error() {}, debug() {} },
  capabilities: { has: () => false },
});

const base = `http://127.0.0.1:${port}`;

try {
  // ---- meta ----
  const meta = await (await fetch(`${base}/api/meta`)).json();
  check('meta lists the official categories', (meta.categories ?? []).length === 10, JSON.stringify(meta.categories));

  // ---- validate an incomplete draft ----
  const emptyDraft = {
    manifestText: '',
    marketName: '',
    summary: '',
    documentation: '',
    category: '',
    exampleQueries: [],
    regions: [],
    enabledEnds: [],
    operation: 'new',
    existingName: '',
    previousVersion: '',
    submitEmail: '',
    submitAccount: '',
    organization: '',
  };
  const emptyResult = await (await fetch(`${base}/api/validate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(emptyDraft),
  })).json();
  check('empty draft reports missing items', (emptyResult.summary?.missing ?? 0) > 0, JSON.stringify(emptyResult.summary));
  check('empty draft has errors', (emptyResult.summary?.errors ?? 0) > 0);

  // ---- upload assets ----
  const manifest = {
    schemaVersion: 1,
    name: 'acme-research',
    displayName: 'Acme 研究助手',
    version: '1.0.0',
    description: '检索研究资料并生成结构化综述。',
    author: 'Acme',
    icon: 'icon.png',
    category: 'Science & Healthcare',
    exampleQueries: ['检索近期研究并总结主要结论'],
    apps: [],
    mcpServers: [],
    skills: ['skills/literature-review/SKILL.md'],
  };
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const uploads = [
    { name: 'icon.png', role: 'icon', mime: 'image/png', contentBase64: png.toString('base64') },
    { name: 'screenshot-01.png', role: 'screenshot', mime: 'image/png', contentBase64: png.toString('base64') },
    {
      name: 'skills/literature-review/SKILL.md',
      role: 'skill',
      mime: 'text/markdown',
      contentBase64: Buffer.from('---\nname: literature-review\ndescription: 综述。\n---\n', 'utf8').toString('base64'),
    },
  ];
  for (const upload of uploads) {
    const response = await fetch(`${base}/api/assets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(upload),
    });
    check(`upload ${upload.name} accepted`, response.status === 201, `status=${response.status}`);
  }

  // ---- package generation ----
  const draft = {
    ...emptyDraft,
    manifestText: JSON.stringify(manifest, null, 2),
    marketName: 'Acme 研究助手',
    summary: '检索研究资料并生成结构化综述。',
    documentation: '# Acme 研究助手\n\n正式说明文档。',
    category: 'Science & Healthcare',
    exampleQueries: ['检索近期研究并总结主要结论'],
    regions: ['CN'],
    enabledEnds: ['desktop', 'cloud'],
    submitEmail: '545965171@qq.com',
    submitAccount: '宋昊',
    organization: 'Acme',
  };
  const packageResponse = await fetch(`${base}/api/package`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(draft),
  });
  check('package generated', packageResponse.status === 201, `status=${packageResponse.status}`);
  const packagePayload = await packageResponse.json();
  const record = packagePayload.package;
  check('package has an id', typeof record?.id === 'string');
  check('package has a sha256', /^[0-9a-f]{64}$/.test(record?.sha256 ?? ''), record?.sha256);
  check('package lists 7 entries', record?.entries?.length === 7, JSON.stringify(record?.entries?.map((e) => e.path)));

  // ---- download route (the route that broke on non-ASCII file names) ----
  const download = await fetch(`${base}/api/package/download?id=${encodeURIComponent(record.id)}`);
  check('download returns 200', download.status === 200, `status=${download.status}`);
  check('download is application/zip', download.headers.get('content-type') === 'application/zip', download.headers.get('content-type'));
  const disposition = download.headers.get('content-disposition') ?? '';
  check(
    'content-disposition is ASCII-safe',
    /^[^\u0080-\uFFFF]*$/.test(disposition),
    disposition,
  );
  check(
    'content-disposition carries the UTF-8 file name',
    disposition.includes("filename*=UTF-8''"),
    disposition,
  );
  const bytes = Buffer.from(await download.arrayBuffer());
  check('downloaded size matches the record', bytes.length === record.size, `${bytes.length} vs ${record.size}`);
  check('downloaded bytes match the sha256', (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex') === record.sha256);

  // ---- parse the downloaded archive independently ----
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  check('EOCD record found', eocd >= 0);
  const total = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  /** @type {any[]} */
  const entries = [];
  for (let i = 0; i < total; i += 1) {
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const method = view.getUint16(offset + 10, true);
    const localOffset = view.getUint32(offset + 42, true);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const compressedSize = view.getUint32(localOffset + 18, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const payload = bytes.subarray(dataStart, dataStart + compressedSize);
    entries.push({
      name: bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'),
      method,
      text: method === 0 ? payload.toString('utf8') : inflateRawSync(payload).toString('utf8'),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  const names = entries.map((entry) => entry.name);
  check('plugin.json sits at the ZIP root', names.includes('.minimax-plugin/plugin.json'), JSON.stringify(names));
  check('no wrapper directory', !names.some((name) => name.split('/')[0] === 'acme-research'), JSON.stringify(names));
  check('README included', names.includes('README.md'));
  check('icon included', names.includes('icon.png'));
  check('skill included', names.includes('skills/literature-review/SKILL.md'));
  check('review report included', names.includes('listing-materials/review-report.md'));
  check('market preview included', names.includes('listing-materials/market-preview.md'));
  check('screenshot included', names.includes('listing-materials/screenshots/screenshot-01.png'), JSON.stringify(names));
  const pluginEntry = entries.find((entry) => entry.name === '.minimax-plugin/plugin.json');
  check('plugin.json in the zip parses and matches', JSON.parse(pluginEntry?.text ?? '{}').name === 'acme-research');
  const reportEntry = entries.find((entry) => entry.name === 'listing-materials/review-report.md');
  check('report states the package is not submitted', (reportEntry?.text ?? '').includes('尚未提交'));
  check('report cites the official guide', (reportEntry?.text ?? '').includes('plugin-submission.md'));

  // ---- state survived and is readable ----
  const state = await (await fetch(`${base}/api/state`)).json();
  check('state keeps the draft', state.draft?.marketName === 'Acme 研究助手', JSON.stringify(state.draft?.marketName));
  check('state keeps the assets', (state.assets ?? []).length === 3, String((state.assets ?? []).length));
  check('state keeps the generated package', (state.packages ?? []).length >= 1);

  // ---- unknown route ----
  const missing = await fetch(`${base}/api/nope`);
  check('unknown route returns 404', missing.status === 404, `status=${missing.status}`);
} finally {
  await lifecycle.dispose();
  await rm(dataDir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
