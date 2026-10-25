import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startApp, fixtureDir, makeClip, mcpSession, mcpTool } from './helpers.mjs';
const app = await startApp();
const { sessionId } = await mcpSession(app.base);
test.after(() => app.dispose());

test('reference analysis refuses managed traversal before reading or copying', async () => {
  writeFileSync(path.join(app.dataDir, 'outside.mp4'), 'not media');
  for (const src of ['/media/../outside.mp4', '/media/%2e%2e%2foutside.mp4', '/media/%2foutside.mp4']) {
    const out = await mcpTool(app.base, sessionId, 'fablecut_analyze_reference', { path: src, registerMusic: false });
    assert.equal(out.reply.json.result.isError, true);
    assert.match(out.text, /outside|inside/);
  }
});

test('reference analysis accepts nested media and explicit source paths', async () => {
  const external = path.join(fixtureDir('reference-input'), 'explicit.mp4');
  await makeClip(external, 1);
  mkdirSync(path.join(app.dataDir, 'media', 'nested'), { recursive: true });
  const nested = path.join(app.dataDir, 'media', 'nested', 'clip.mp4');
  await makeClip(nested, 1);
  for (const src of ['/media/nested/clip.mp4', external]) {
    const out = await mcpTool(app.base, sessionId, 'fablecut_analyze_reference', { path: src, registerMusic: false });
    assert.notEqual(out.reply.json.result.isError, true, out.text);
  }
});
