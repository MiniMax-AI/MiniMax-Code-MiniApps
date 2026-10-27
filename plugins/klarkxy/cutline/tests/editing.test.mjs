// @ts-check
// Editing the timeline through the tools: import, place, replace a file, look
// at a moment, and the conflict rules that keep two writers from clobbering
// each other.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { fixtureDir, getJson, makeClip, mcpSession, mcpTool, startApp } from './helpers.mjs';

const app = await startApp();
const { sessionId } = await mcpSession(app.base);

/** @type {string} */
let longClip = '';
/** @type {string} */
let shortClip = '';

/**
 * @param {string} text
 * @returns {any}
 */
function firstJson(text) {
  return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
}

test('a file is imported into the library and registered in the project', async () => {
  longClip = path.join(app.dataDir, 'source', 'long.mp4');
  shortClip = path.join(app.dataDir, 'source', 'short.mp4');
  await makeClip(longClip, 4);
  await makeClip(shortClip, 1);

  const { reply, text } = await mcpTool(app.base, sessionId, 'fablecut_import_media', { path: longClip });
  assert.equal(reply.json.result.isError, undefined, text);

  const entry = firstJson(text);
  assert.equal(entry.kind, 'video');
  assert.match(entry.src, /^\/media\//);
  assert.ok(entry.duration > 3.5, `the imported clip is probed (${entry.duration}s)`);

  const copied = path.join(app.dataDir, 'media', path.basename(entry.src.slice('/media/'.length)));
  assert.ok(existsSync(copied), 'the file is copied into the data directory');
  assert.ok(statSync(copied).size > 0);
});

test('a frame is taken from a non-zero moment of the clip', async () => {
  const project = JSON.parse((await mcpTool(app.base, sessionId, 'fablecut_get_project')).text);
  const src = project.media[0].src;

  const { reply, content } = await mcpTool(app.base, sessionId, 'fablecut_frame', { path: src, t: 2 });
  assert.equal(reply.json.result.isError, undefined);
  const image = content.find((/** @type {any} */ block) => block.type === 'image');
  assert.ok(image, 'the tool answers with an image');
  assert.equal(image.mimeType, 'image/jpeg');
  assert.ok(image.data.length > 100, 'the image has pixels');
});

test('a contact sheet surveys a range that starts at a non-zero moment', async () => {
  const project = JSON.parse((await mcpTool(app.base, sessionId, 'fablecut_get_project')).text);
  const src = project.media[0].src;

  const { reply, content } = await mcpTool(app.base, sessionId, 'fablecut_frame', {
    path: src,
    frames: 3,
    from: 1,
    to: 3,
  });
  assert.equal(reply.json.result.isError, undefined);
  const image = content.find((/** @type {any} */ block) => block.type === 'image');
  assert.ok(image, 'the tool answers with an image');
  assert.ok(image.data.length > 100, 'the image has pixels');
});

test('a clip is placed on the timeline', async () => {
  const project = JSON.parse((await mcpTool(app.base, sessionId, 'fablecut_get_project')).text);
  const media = project.media[0];

  const { reply, text } = await mcpTool(app.base, sessionId, 'fablecut_patch_project', {
    ops: [
      {
        op: 'addClip',
        clip: { track: 'V1', start: 0, duration: 3, kind: 'video', mediaId: media.id, in: 0 },
      },
    ],
  });
  assert.equal(reply.json.result.isError, undefined, text);

  const after = JSON.parse((await mcpTool(app.base, sessionId, 'fablecut_get_project')).text);
  assert.equal(after.clips.length, 1);
  assert.equal(after.clips[0].track, 'V1');
  assert.equal(after.clips[0].mediaId, media.id);
});

test('replacing the file behind a media entry trims the clips to fit', async () => {
  const project = JSON.parse((await mcpTool(app.base, sessionId, 'fablecut_get_project')).text);
  const media = project.media[0];

  const imported = await mcpTool(app.base, sessionId, 'fablecut_import_media', { path: shortClip });
  assert.equal(imported.reply.json.result.isError, undefined, imported.text);
  const replacement = firstJson(imported.text);

  const { reply, text } = await mcpTool(app.base, sessionId, 'fablecut_patch_project', {
    ops: [{ op: 'replaceMedia', id: media.id, src: replacement.src }],
  });
  assert.equal(reply.json.result.isError, undefined, text);

  const after = JSON.parse((await mcpTool(app.base, sessionId, 'fablecut_get_project')).text);
  const replaced = after.media.find((/** @type {any} */ m) => m.id === media.id);
  assert.equal(replaced.src, replacement.src, 'the media entry points at the new file');
  assert.ok(replaced.duration < 1.5, `the new duration is read (${replaced.duration}s)`);

  const clip = after.clips[0];
  assert.ok(clip.duration <= replaced.duration + 0.01, `the clip fits the shorter file (${clip.duration}s)`);
  assert.ok(clip.in <= replaced.duration, 'the in point fits the shorter file');
});

test('the project is written under the data directory', async () => {
  const file = path.join(app.dataDir, 'project.json');
  assert.ok(existsSync(file), 'project.json lives in the data directory');
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  assert.ok(saved.revision > 0, `the revision grows (${saved.revision})`);
  assert.equal(saved.clips.length, 1);
});

test('a patch with the wrong base revision is refused', async () => {
  const { reply, text } = await mcpTool(app.base, sessionId, 'fablecut_patch_project', {
    baseRevision: 9999,
    ops: [{ op: 'setProject', set: { name: 'Should not land' } }],
  });
  assert.equal(reply.json.result.isError, true);
  assert.match(text, /CONFLICT/);
});

test('a stale document is refused even after another read', async () => {
  // The document a writer holds…
  const stale = JSON.parse((await mcpTool(app.base, sessionId, 'fablecut_get_project')).text);
  const staleRevision = stale.revision;

  // …while somebody else moves the project on…
  await mcpTool(app.base, sessionId, 'fablecut_patch_project', {
    ops: [{ op: 'setProject', set: { name: 'Moved On' } }],
  });

  // …and another writer reads the new document. That read must not make the
  // first writer's stale document look current.
  const fresh = JSON.parse((await mcpTool(app.base, sessionId, 'fablecut_get_project')).text);
  assert.ok(fresh.revision > staleRevision, 'the project moved on');

  stale.name = 'Stale Write';
  const { reply, text } = await mcpTool(app.base, sessionId, 'fablecut_set_project', {
    project: stale,
    baseRevision: staleRevision,
  });
  assert.equal(reply.json.result.isError, true, 'the stale write is refused');
  assert.match(text, /CONFLICT/);

  const current = await getJson(app.base, '/api/project');
  assert.notEqual(current.json.name, 'Stale Write', 'the stale write did not land');
});

test('a save without a base revision is refused', async () => {
  const current = JSON.parse((await mcpTool(app.base, sessionId, 'fablecut_get_project')).text);
  current.name = 'No Base Revision';
  const { reply, text } = await mcpTool(app.base, sessionId, 'fablecut_set_project', { project: current });
  assert.equal(reply.json.result.isError, true, 'the base revision is required');
  assert.match(text, /baseRevision/);

  const after = await getJson(app.base, '/api/project');
  assert.notEqual(after.json.name, 'No Base Revision', 'the write did not land');
});

test('a stale document with an incremented revision is refused', async () => {
  // The document a writer holds…
  const stale = JSON.parse((await mcpTool(app.base, sessionId, 'fablecut_get_project')).text);

  // …while somebody else moves the project on…
  await mcpTool(app.base, sessionId, 'fablecut_patch_project', {
    ops: [{ op: 'setProject', set: { name: 'Newer Work' } }],
  });
  const current = await getJson(app.base, '/api/project');

  // …and the writer puts a NEWER revision in its stale document, the way the
  // old instructions told agents to do, to get past the check. The number in
  // the document proves nothing: the base revision is the caller's own claim.
  stale.revision = current.json.revision + 1;
  stale.name = 'Stale Write With A Newer Number';
  const { reply, text } = await mcpTool(app.base, sessionId, 'fablecut_set_project', {
    project: stale,
    baseRevision: stale.revision,
  });
  assert.equal(reply.json.result.isError, true, 'the inflated revision does not buy a write');
  assert.match(text, /CONFLICT/);

  const after = await getJson(app.base, '/api/project');
  assert.equal(after.json.name, 'Newer Work', 'the newer work is still there');
  assert.equal(after.json.revision, current.json.revision, 'the revision did not move');
});

test('a document at the current revision is saved', async () => {
  const current = JSON.parse((await mcpTool(app.base, sessionId, 'fablecut_get_project')).text);
  const currentRevision = current.revision;
  current.name = 'Accepted Write';
  const { reply, text } = await mcpTool(app.base, sessionId, 'fablecut_set_project', {
    project: current,
    baseRevision: currentRevision,
  });
  assert.equal(reply.json.result.isError, undefined, text);
  assert.match(text, /Saved \(revision \d+\)/);

  const after = await getJson(app.base, '/api/project');
  assert.equal(after.json.name, 'Accepted Write');
  assert.equal(after.json.revision, currentRevision + 1, 'the server owns the revision');
});

test('a forced save overwrites a project that moved on', async () => {
  const stale = JSON.parse((await mcpTool(app.base, sessionId, 'fablecut_get_project')).text);
  const staleRevision = stale.revision;
  await mcpTool(app.base, sessionId, 'fablecut_patch_project', {
    ops: [{ op: 'setProject', set: { name: 'Moved On Before The Force' } }],
  });
  const current = await getJson(app.base, '/api/project');

  stale.name = 'Forced Write';
  const { reply, text } = await mcpTool(app.base, sessionId, 'fablecut_set_project', {
    project: stale,
    baseRevision: staleRevision,
    force: true,
  });
  assert.equal(reply.json.result.isError, undefined, text);

  const after = await getJson(app.base, '/api/project');
  assert.equal(after.json.name, 'Forced Write');
  assert.equal(after.json.revision, current.json.revision + 1, 'the revision is the current one + 1');
});

test('a forced save never rewinds the revision', async () => {
  const before = await getJson(app.base, '/api/project');
  const onDisk = before.json.revision;

  // A document from long ago, carrying an old revision: a deliberate
  // overwrite. The revision counter must not go back with it.
  const forced = await fetch(`${app.base}/api/project?force=1`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...before.json, name: 'Old Document Forced In', revision: 1 }),
  });
  assert.equal(forced.status, 200);
  assert.equal((await forced.json()).revision, onDisk + 1, 'the revision moved forward');

  const afterForce = await getJson(app.base, '/api/project');
  assert.equal(afterForce.json.revision, onDisk + 1, 'the file holds the new revision');
  assert.equal(afterForce.json.name, 'Old Document Forced In');

  // A stale document from before the forced save: with the counter rewound it
  // would have passed the check and clobbered the newer work.
  const stale = await fetch(`${app.base}/api/project`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...before.json, name: 'Stale Clobber' }),
  });
  assert.equal(stale.status, 409, 'the stale save is refused');

  const final = await getJson(app.base, '/api/project');
  assert.equal(final.json.name, 'Old Document Forced In', 'the newer work is still there');
  assert.equal(final.json.revision, onDisk + 1, 'the revision did not move again');
});

test('the MCP client may look at a file outside the library', async () => {
  // The user asked for it: the local MCP client can read any file the user
  // can, exactly as upstream. The page cannot — that is the next test.
  const outsideDir = fixtureDir('external-frame');
  const outside = path.join(outsideDir, 'elsewhere.mp4');
  await makeClip(outside, 2);

  const { reply, text } = await mcpTool(app.base, sessionId, 'fablecut_frame', { path: outside, t: 1 });
  assert.equal(reply.json.result.isError, undefined, text);
  assert.ok(reply.json.result.content.some((/** @type {any} */ block) => block.type === 'image'));
});

test('the page may not read a file outside the library', async () => {
  const outsideDir = fixtureDir('external-frame');
  const outside = path.join(outsideDir, 'elsewhere.mp4');

  // A plain request from the browser: no trusted marker, so the absolute-path
  // capability is refused. The header alone does not grant it.
  const response = await fetch(
    `${app.base}/api/frame?path=${encodeURIComponent(outside)}&t=1&w=64`,
    { headers: { 'X-FableCut-Client': 'mcp' } },
  );
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.match(body.error, /local MCP transport/);

  // And the same without the header.
  const plain = await fetch(`${app.base}/api/frame?path=${encodeURIComponent(outside)}&t=1&w=64`);
  assert.equal(plain.status, 403);
});

test('a path inside the data directory is readable', async () => {
  const { reply, text } = await mcpTool(app.base, sessionId, 'fablecut_frame', { path: longClip, t: 1 });
  assert.equal(reply.json.result.isError, undefined, text);
  assert.ok(reply.json.result.content.some((/** @type {any} */ block) => block.type === 'image'));
});

test.after(async () => {
  await app.dispose();
});
