import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { FFMPEG_SKIP, startApp, fixtureDir, makeClip, mcpSession, mcpTool } from './helpers.mjs';
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

test('reference analysis refuses non-media files before copying them into media', async () => {
  const privateFile = path.join(fixtureDir('reference-input'), 'private.pem');
  writeFileSync(privateFile, 'not a media file');
  const out = await mcpTool(app.base, sessionId, 'fablecut_analyze_reference', {
    path: privateFile,
    registerMusic: false,
  });
  assert.equal(out.reply.json.result.isError, true);
  assert.match(out.text, /Unsupported reference media extension \.pem/);
  assert.equal(existsSync(path.join(app.dataDir, 'media', 'private.pem')), false);
});

test('managed media symlinks cannot expose files outside media', async (t) => {
  const outside = path.join(app.dataDir, 'outside-secret.txt');
  writeFileSync(outside, 'private');
  const media = path.join(app.dataDir, 'media');
  mkdirSync(media, { recursive: true });
  const link = path.join(media, 'outside-link.txt');
  try {
    symlinkSync(outside, link, 'file');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip(`symlinks unavailable: ${error.code}`);
    throw error;
  }

  const direct = await mcpTool(app.base, sessionId, 'fablecut_frame', { path: '/media/outside-link.txt', t: 0 });
  assert.equal(direct.reply.json.result.isError, true);
  const served = await fetch(`${app.base}/media/outside-link.txt`);
  assert.equal(served.status, 404);
  assert.notEqual(await served.text(), 'private');
});

test('reference analysis accepts nested media and explicit source paths', { skip: FFMPEG_SKIP }, async () => {
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
