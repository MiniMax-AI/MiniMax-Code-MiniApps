// @ts-check
// The editor's own routes on the Host's port: the page, the static payload,
// the REST API and the live-reload channel.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { getJson, mcpSession, mcpTool, PACKAGE_ROOT, sleep, startApp } from './helpers.mjs';

const app = await startApp();

/**
 * Opens the live-reload channel and collects the frames it sends.
 *
 * @param {number} port
 */
function openEvents(port) {
  /** @type {string[]} */
  const frames = [];
  /** @type {(() => void) | undefined} */
  let done;
  const finished = new Promise((resolve) => {
    done = resolve;
  });
  const request = http.get({ host: '127.0.0.1', port, path: '/api/events' }, (response) => {
    response.setEncoding('utf8');
    response.on('data', (chunk) => frames.push(chunk));
    response.on('close', () => done?.());
  });
  request.on('error', () => done?.());
  return { frames, finished, close: () => request.destroy() };
}

test('the surface route serves the editor page', async () => {
  const response = await fetch(`${app.base}${app.surfacePath}`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/);
  const html = await response.text();
  assert.match(html, /<title>MiniMax Cut - Video Editor<\/title>/, 'the page carries the MiniMax Cut title');
  assert.match(html, /MiniMax <b>Cut<\/b>/, 'the top bar shows the MiniMax Cut brand');
  assert.match(html, /app\.js/);
});

test('the package manifests and the Skill carry the MiniMax Cut identity', async () => {
  const manifest = JSON.parse(
    await readFile(path.join(PACKAGE_ROOT, '.minimax-plugin', 'plugin.json'), 'utf8'),
  );
  assert.equal(manifest.name, 'minimax-cut');
  assert.equal(manifest.displayName, 'MiniMax Cut');
  assert.deepEqual(manifest.skills, ['skills/minimax-cut/SKILL.md']);

  const miniapp = JSON.parse(await readFile(path.join(PACKAGE_ROOT, 'miniapp', 'miniapp.json'), 'utf8'));
  assert.deepEqual(miniapp.mcpEndpoints, [{ server: 'minimax-cut', path: '/mcp/minimax-cut' }]);

  const servers = JSON.parse(await readFile(path.join(PACKAGE_ROOT, 'servers.mcp.json'), 'utf8'));
  assert.deepEqual(Object.keys(servers.mcpServers), ['minimax-cut']);
  assert.match(servers.mcpServers['minimax-cut'].url, /\/mcp\/minimax-cut$/);

  const skill = await readFile(path.join(PACKAGE_ROOT, 'skills', 'minimax-cut', 'SKILL.md'), 'utf8');
  assert.match(skill, /^name: minimax-cut$/m, 'the Skill is named after the package');
  assert.doesNotMatch(skill, /media-generation\.md/, 'the removed generation guidance is not referenced');
});

test('the surface route keeps its query string', async () => {
  const response = await fetch(`${app.base}${app.surfacePath}?exportJob=x_123`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/);
});

test('the static payload is served from the client root', async () => {
  const script = await fetch(`${app.base}/app.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type') ?? '', /javascript/);
  const body = await script.text();
  assert.match(body, /FableCutEdit/, 'the upstream editor modules keep their upstream names');

  const style = await fetch(`${app.base}/style.css`);
  assert.equal(style.status, 200);
  assert.match(style.headers.get('content-type') ?? '', /text\/css/);

  const icon = await fetch(`${app.base}/icons/favicon-32.png`);
  assert.equal(icon.status, 200);
  assert.equal(icon.headers.get('content-type'), 'image/png');
});

test('the editor modules the page loads are all served', async () => {
  const html = await (await fetch(`${app.base}${app.surfacePath}`)).text();
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(scripts.length > 10, 'the page loads the upstream editor modules');
  for (const src of scripts) {
    const response = await fetch(`${app.base}/${src}`);
    assert.equal(response.status, 200, `${src} is served`);
  }
});

test('the REST API answers', async () => {
  const project = await getJson(app.base, '/api/project');
  assert.equal(project.status, 200);
  assert.equal(typeof project.json.name, 'string');
  assert.equal(project.json.width, 1280);
  assert.equal(project.json.fps, 30);
  assert.deepEqual(project.json.clips, []);
  assert.deepEqual(project.json.media, []);

  const media = await getJson(app.base, '/api/media');
  assert.equal(media.status, 200);
  assert.ok(Array.isArray(media.json));

  const profiles = await getJson(app.base, '/api/export/profiles');
  assert.equal(profiles.status, 200);
  assert.ok(profiles.json.profiles, 'the encode profiles are readable');
});

test('a dotfile and a traversal are refused', async () => {
  const dotfile = await fetch(`${app.base}/.gitignore`);
  assert.equal(dotfile.status, 403);

  const traversal = await fetch(`${app.base}/..%2f..%2fpackage.json`);
  assert.ok(traversal.status === 403 || traversal.status === 404, 'the traversal is refused');
});

test('the live-reload channel greets and reports a change', async () => {
  const events = openEvents(app.port);
  try {
    await sleep(150);
    assert.match(events.frames.join(''), /data: hello/, 'the channel greets');

    const { sessionId } = await mcpSession(app.base);
    const { reply } = await mcpTool(app.base, sessionId, 'fablecut_patch_project', {
      ops: [{ op: 'setProject', set: { name: 'SSE Test' } }],
    });
    assert.equal(reply.json.result.isError, undefined);

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !events.frames.join('').includes('event: change')) {
      await sleep(100);
    }
    assert.match(events.frames.join(''), /event: change/, 'the change reaches the channel');
  } finally {
    events.close();
  }
});

test('the page and the tools share one project document', async () => {
  const { sessionId } = await mcpSession(app.base);
  await mcpTool(app.base, sessionId, 'fablecut_patch_project', {
    ops: [{ op: 'setProject', set: { name: 'Shared Document' } }],
  });

  const project = await getJson(app.base, '/api/project');
  assert.equal(project.status, 200);
  assert.equal(project.json.name, 'Shared Document');

  const { text } = await mcpTool(app.base, sessionId, 'fablecut_get_project');
  assert.match(text, /Shared Document/);
});

test.after(async () => {
  await app.dispose();
});
