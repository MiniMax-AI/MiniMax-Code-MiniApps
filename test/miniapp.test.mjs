import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { checkMiniApp } from '../scripts/lib/rules/miniapp.mjs';
import { createReport } from '../scripts/lib/report.mjs';
import { codes, copyExample, makeTmpRoot, readJson } from './helpers.mjs';

async function run(mutate, prepare) {
  const root = await makeTmpRoot();
  const { dir } = await copyExample(root);
  const manifest = await readJson(path.join(dir, 'miniapp', 'miniapp.json'));
  const result = mutate(manifest);
  const next = result === undefined ? manifest : result;
  if (prepare) await prepare(dir);
  const report = createReport();
  const resolved = await checkMiniApp(report, { packageDir: dir, manifest: next });
  return { report, resolved };
}

test('miniapp: baseline passes and resolves entry and roots', async () => {
  const { report, resolved } = await run((m) => m);
  assert.deepEqual(report.diagnostics, []);
  assert.deepEqual(resolved, { entry: 'miniapp/node/server.mjs', nodeRoots: ['miniapp/node'], clientRoots: ['miniapp/client'] });
});

test('miniapp: lifecycle may be omitted; other values are errors', async () => {
  const omitted = await run((m) => { delete m.runtime.lifecycle; return m; });
  assert.deepEqual(omitted.report.diagnostics, []);
  const other = await run((m) => { m.runtime.lifecycle = 'always'; return m; });
  assert.deepEqual(codes(other.report.diagnostics), ['MINIAPP_RUNTIME_INVALID']);
});

test('miniapp: entry must end in .js/.mjs/.cjs, exist, and sit under a node root', async () => {
  const ts = await run((m) => { m.runtime.entry = './miniapp/node/server.ts'; return m; });
  assert.deepEqual(codes(ts.report.diagnostics), ['MINIAPP_RUNTIME_INVALID']);
  const missing = await run((m) => { m.runtime.entry = './miniapp/node/other.mjs'; return m; });
  assert.deepEqual(codes(missing.report.diagnostics), ['MINIAPP_ENTRY_MISSING']);
  const outside = await run((m) => { m.artifacts.node = ['./miniapp/server']; return m; }, async (dir) => {
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(path.join(dir, 'miniapp', 'server'));
    await writeFile(path.join(dir, 'miniapp', 'server', 'keep.txt'), '');
  });
  assert.deepEqual(codes(outside.report.diagnostics), ['MINIAPP_ENTRY_NOT_COVERED']);
});

test('miniapp: an artifact root that is not on disk is an error (git drops empty directories)', async () => {
  const { report } = await run((m) => m, async (dir) => rm(path.join(dir, 'miniapp', 'client'), { recursive: true }));
  assert.deepEqual(codes(report.diagnostics), ['MINIAPP_ARTIFACT_MISSING']);
});

test('miniapp: artifact roots must be non-empty, unique, and under miniapp/', async () => {
  const empty = await run((m) => { m.artifacts.client = []; return m; });
  assert.deepEqual(codes(empty.report.diagnostics), ['MINIAPP_ARTIFACTS_INVALID']);
  const dup = await run((m) => { m.artifacts.client = ['./miniapp/client', 'miniapp/client']; return m; });
  assert.deepEqual(codes(dup.report.diagnostics), ['MINIAPP_ARTIFACTS_INVALID']);
  const outside = await run((m) => { m.artifacts.client = ['./client']; return m; });
  assert.deepEqual(codes(outside.report.diagnostics), ['MINIAPP_ARTIFACTS_INVALID']);
});

test('miniapp: surface.path accepts a missing leading slash and rejects transport syntax', async () => {
  const bare = await run((m) => { m.surface.path = 'dashboard'; return m; });
  assert.deepEqual(bare.report.diagnostics, []);
  const url = await run((m) => { m.surface.path = 'https://x/y'; return m; });
  assert.deepEqual(codes(url.report.diagnostics), ['MINIAPP_SURFACE_INVALID']);
});

test('miniapp: mcpEndpoints shape and uniqueness', async () => {
  const ok = await run((m) => { m.mcpEndpoints = [{ server: 'a', path: '/mcp' }]; return m; });
  assert.deepEqual(ok.report.diagnostics, []);
  const dupPath = await run((m) => { m.mcpEndpoints = [{ server: 'a', path: '/mcp' }, { server: 'b', path: '/mcp' }]; return m; });
  assert.deepEqual(codes(dupPath.report.diagnostics), ['MINIAPP_MCP_ENDPOINT_INVALID']);
  const badServer = await run((m) => { m.mcpEndpoints = [{ server: 'has space', path: '/mcp' }]; return m; });
  assert.deepEqual(codes(badServer.report.diagnostics), ['MINIAPP_MCP_ENDPOINT_INVALID']);
});

test('miniapp: hostConnectorAccess is validated for shape and reported as unverified', async () => {
  const ok = await run((m) => { m.hostConnectorAccess = { providers: ['notion'] }; return m; });
  assert.deepEqual(codes(ok.report.diagnostics), ['HOST_CONNECTOR_UNVERIFIED']);
  assert.equal(ok.report.diagnostics[0].level, 'warning');
  const bad = await run((m) => { m.hostConnectorAccess = { providers: ['Bad!'] }; return m; });
  assert.deepEqual(codes(bad.report.diagnostics), ['MINIAPP_HOST_CONNECTOR_INVALID']);
});

test('miniapp: unknown field and wrong schemaVersion', async () => {
  const { report } = await run((m) => ({ ...m, schemaVersion: 2, extra: true }));
  assert.deepEqual(codes(report.diagnostics), ['MINIAPP_UNKNOWN_FIELD', 'MINIAPP_SCHEMA_VERSION']);
});
