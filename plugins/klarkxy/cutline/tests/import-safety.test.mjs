// @ts-check
// Importing a project folder must not reach outside the folder it was given,
// must not leave a media entry pointing at an unrelated file, and must never
// overwrite work that happened while it was running.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { fixtureDir, getJson, makeClip, mcpSession, mcpTool, sleep, startApp } from './helpers.mjs';

const app = await startApp();
const { sessionId } = await mcpSession(app.base);

/**
 * A source folder with one project document.
 *
 * @param {string} root
 * @param {{name?: string, media?: any[], clips?: any[]}} [options]
 */
async function makeSource(root, { name = 'Source Project', media = [], clips = [] } = {}) {
  mkdirSync(path.join(root, 'media'), { recursive: true });
  const doc = { name, width: 1280, height: 720, fps: 30, revision: 7, media, clips };
  writeFileSync(path.join(root, 'project.json'), JSON.stringify(doc, null, 2));
  return { root, doc };
}

/**
 * A media file in the source folder's media folder (a subfolder is fine).
 *
 * @param {string} root
 * @param {string} rel
 * @param {number} [seconds]
 */
async function makeSourceMedia(root, rel, seconds = 1) {
  const file = path.join(root, 'media', ...rel.split('/'));
  await makeClip(file, seconds);
  return file;
}

/**
 * The project documents kept in the version history of the data folder.
 *
 * @param {string} dataDir
 * @returns {any[]}
 */
function versionDocs(dataDir) {
  const projects = path.join(dataDir, 'projects');
  /** @type {any[]} */
  const out = [];
  let ids = [];
  try { ids = readdirSync(projects); } catch { return out; }
  for (const id of ids) {
    const dir = path.join(projects, id, 'history');
    let files = [];
    try { files = readdirSync(dir); } catch { continue; }
    for (const file of files) {
      if (!/^v\d+\.json$/.test(file)) continue;
      try { out.push(JSON.parse(readFileSync(path.join(dir, file), 'utf8'))); } catch { /* unreadable */ }
    }
  }
  return out;
}

/**
 * Waits for a condition, or gives up.
 *
 * @param {() => boolean} check
 * @param {number} [timeout]
 */
async function waitFor(check, timeout = 15_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (check()) return true;
    await sleep(10);
  }
  return false;
}

/**
 * The files in this installation's media folder.
 *
 * @returns {string[]}
 */
function mediaFiles() {
  try { return readdirSync(path.join(app.dataDir, 'media')).sort(); } catch { return []; }
}

test('a project id that is a path is refused', async () => {
  const root = fixtureDir('safety-id');
  const outside = fixtureDir('safety-id-outside');
  mkdirSync(path.join(root, 'projects'), { recursive: true });
  writeFileSync(
    path.join(outside, 'project.json'),
    JSON.stringify({ name: 'Sneaky', width: 1280, height: 720, fps: 30, revision: 1, media: [], clips: [] }),
  );
  const before = await getJson(app.base, '/api/project');

  for (const id of ['..', '../..', 'a/b', 'a\\b']) {
    const { reply, text } = await mcpTool(app.base, sessionId, 'fablecut_import_project', { folder: root, project: id });
    assert.equal(reply.json.result.isError, true, `${id} is refused`);
    assert.match(text, /not a plain project id/, text);
  }

  const after = await getJson(app.base, '/api/project');
  assert.equal(after.json.revision, before.json.revision, 'the open project was not touched');
  assert.notEqual(after.json.name, 'Sneaky', 'the project outside the folder was not imported');
});

test('a media path that climbs out of the source folder is refused', async () => {
  const root = fixtureDir('safety-traversal');
  // a file next to the media folder, not inside it
  await makeClip(path.join(root, 'secret.mp4'), 1);
  await makeSource(root, {
    name: 'Escape',
    media: [{ id: 'm_x', name: 'secret.mp4', kind: 'video', src: '/media/../secret.mp4' }],
  });
  const before = await getJson(app.base, '/api/project');
  const mediaBefore = mediaFiles();

  const { reply, text } = await mcpTool(app.base, sessionId, 'fablecut_import_project', { folder: root });
  assert.equal(reply.json.result.isError, true);
  assert.match(text, /points outside/, text);

  const after = await getJson(app.base, '/api/project');
  assert.equal(after.json.revision, before.json.revision, 'the open project was not touched');
  assert.deepEqual(mediaFiles(), mediaBefore, 'no file was copied');
  assert.ok(!existsSync(path.join(app.dataDir, 'media', 'secret.mp4')), 'the file outside media/ was not copied');
});

test('an encoded media path that climbs out of the source folder is refused', async () => {
  const root = fixtureDir('safety-encoded');
  await makeClip(path.join(root, 'secret.mp4'), 1);
  await makeSource(root, {
    name: 'Encoded Escape',
    media: [{ id: 'm_x', name: 'secret.mp4', kind: 'video', src: '/media/..%2Fsecret.mp4' }],
  });
  const before = await getJson(app.base, '/api/project');
  const mediaBefore = mediaFiles();

  const { reply, text } = await mcpTool(app.base, sessionId, 'fablecut_import_project', { folder: root });
  assert.equal(reply.json.result.isError, true);
  assert.match(text, /points outside/, text);

  const after = await getJson(app.base, '/api/project');
  assert.equal(after.json.revision, before.json.revision, 'the open project was not touched');
  assert.deepEqual(mediaFiles(), mediaBefore, 'no file was copied');
});

test('a link out of the source media folder is refused', async () => {
  const root = fixtureDir('safety-junction');
  const outside = fixtureDir('safety-junction-outside');
  await makeClip(path.join(outside, 'linked.mp4'), 1);
  mkdirSync(path.join(root, 'media'), { recursive: true });
  const link = path.join(root, 'media', 'linked');
  try {
    symlinkSync(outside, link, 'junction');
  } catch {
    return;   // this platform does not allow junctions: nothing to prove here
  }
  try {
    await makeSource(root, {
      name: 'Linked',
      media: [{ id: 'm_l', name: 'linked.mp4', kind: 'video', src: '/media/linked/linked.mp4' }],
    });
    const before = await getJson(app.base, '/api/project');
    const mediaBefore = mediaFiles();

    const { reply, text } = await mcpTool(app.base, sessionId, 'fablecut_import_project', { folder: root });
    assert.equal(reply.json.result.isError, true);
    assert.match(text, /points outside/, text);

    const after = await getJson(app.base, '/api/project');
    assert.equal(after.json.revision, before.json.revision, 'the open project was not touched');
    assert.deepEqual(mediaFiles(), mediaBefore, 'no file was copied');
  } finally {
    // only the link is taken away again — the folder it pointed at stays where
    // it is, and a package holds no links of its own
    try { unlinkSync(link); } catch { /* already gone */ }
  }
});

test('a media file in a subfolder of the source media folder is imported', async () => {
  const root = fixtureDir('safety-nested');
  const clip = await makeSourceMedia(root, 'sub/shot.mp4', 2);
  await makeSource(root, {
    name: 'Nested',
    media: [{ id: 'm_n', name: 'shot.mp4', kind: 'video', src: '/media/sub/shot.mp4', duration: 2 }],
    clips: [{ id: 'c_n', track: 'V1', start: 0, duration: 2, kind: 'video', mediaId: 'm_n', in: 0 }],
  });

  const { reply, text } = await mcpTool(app.base, sessionId, 'fablecut_import_project', { folder: root });
  assert.equal(reply.json.result.isError, undefined, text);
  assert.match(text, /sub\/shot\.mp4 → shot/, text);

  const project = await getJson(app.base, '/api/project');
  assert.equal(project.json.name, 'Nested');
  assert.equal(project.json.clips.length, 1);
  const src = String(project.json.media[0].src);
  assert.match(src, /^\/media\/shot(_\d+)?\.mp4$/, 'the copy is named after the file, in media/');
  const copied = path.join(app.dataDir, 'media', decodeURIComponent(src.slice('/media/'.length)));
  assert.ok(existsSync(copied), 'the copy is directly in the media folder');
  assert.ok(existsSync(clip), 'the original file is still there');
});

test('a media file that is not in the source folder stops the import', async () => {
  const root = fixtureDir('safety-missing');
  await makeSourceMedia(root, 'here.mp4', 1);
  await makeSource(root, {
    name: 'Half There',
    media: [
      { id: 'm_ok', name: 'here.mp4', kind: 'video', src: '/media/here.mp4' },
      { id: 'm_gone', name: 'gone.mp4', kind: 'video', src: '/media/gone.mp4' },
    ],
  });
  const before = await getJson(app.base, '/api/project');
  const mediaBefore = mediaFiles();

  const { reply, text } = await mcpTool(app.base, sessionId, 'fablecut_import_project', { folder: root });
  assert.equal(reply.json.result.isError, true);
  assert.match(text, /not in the source folder/, text);

  const after = await getJson(app.base, '/api/project');
  assert.equal(after.json.revision, before.json.revision, 'the open project was not replaced');
  assert.equal(after.json.name, before.json.name, 'the open project is still the same one');
  assert.deepEqual(mediaFiles(), mediaBefore, 'not even the file that was there was copied');
});

test('the project that was open is kept as a version before the import', async () => {
  const patch = await mcpTool(app.base, sessionId, 'fablecut_patch_project', {
    ops: [{ op: 'setProject', set: { name: 'Work In Progress' } }],
  });
  assert.equal(patch.reply.json.result.isError, undefined, patch.text);
  const before = await getJson(app.base, '/api/project');

  const root = fixtureDir('safety-version');
  await makeSourceMedia(root, 'v.mp4', 1);
  await makeSource(root, {
    name: 'Imported Over It',
    media: [{ id: 'm_v', name: 'v.mp4', kind: 'video', src: '/media/v.mp4' }],
  });

  const { reply, text } = await mcpTool(app.base, sessionId, 'fablecut_import_project', { folder: root });
  assert.equal(reply.json.result.isError, undefined, text);

  const after = await getJson(app.base, '/api/project');
  assert.equal(after.json.name, 'Imported Over It');
  assert.equal(after.json.revision, before.json.revision + 1);

  // the version history holds the project as it was before the import
  const kept = versionDocs(app.dataDir).find((doc) => doc.name === 'Work In Progress');
  assert.ok(kept, 'the project from before the import is in the version history');
  assert.equal(kept.revision, before.json.revision, 'the version is the revision from before the import');

  const versions = await mcpTool(app.base, sessionId, 'fablecut_versions', { action: 'list' });
  assert.equal(versions.reply.json.result.isError, undefined, versions.text);
  assert.match(versions.text, /before agent edits/, versions.text);
});

test('an import refuses to overwrite a project that changed while it ran', async () => {
  const root = fixtureDir('safety-race');
  await makeSourceMedia(root, 'race-a.mp4', 1);
  await makeSourceMedia(root, 'race-b.mp4', 1);
  await makeSourceMedia(root, 'race-c.mp4', 1);
  await makeSource(root, {
    name: 'Racing',
    media: [
      { id: 'm_a', name: 'race-a.mp4', kind: 'video', src: '/media/race-a.mp4' },
      { id: 'm_b', name: 'race-b.mp4', kind: 'video', src: '/media/race-b.mp4' },
      { id: 'm_c', name: 'race-c.mp4', kind: 'video', src: '/media/race-c.mp4' },
    ],
  });
  const before = await getJson(app.base, '/api/project');

  // the import is started and not waited for: it copies and probes its files
  const running = mcpTool(app.base, sessionId, 'fablecut_import_project', { folder: root });
  // the first copy shows that the import is in flight
  const copied = await waitFor(() => existsSync(path.join(app.dataDir, 'media', 'race-a.mp4')));
  assert.ok(copied, 'the import started copying');

  // somebody saves the project while the import is still working
  const patch = await mcpTool(app.base, sessionId, 'fablecut_patch_project', {
    ops: [{ op: 'setProject', set: { name: 'Edited While Importing' } }],
  });
  assert.equal(patch.reply.json.result.isError, undefined, patch.text);

  const { reply, text } = await running;
  assert.equal(reply.json.result.isError, true, 'the import was refused');
  assert.match(text, /changed while the import was running/, text);

  const after = await getJson(app.base, '/api/project');
  assert.equal(after.json.name, 'Edited While Importing', 'the newer work is still there');
  assert.equal(after.json.revision, before.json.revision + 1, 'the import did not write over it');
  assert.ok(!existsSync(path.join(app.dataDir, 'media', 'race-a.mp4')), 'the copies of the refused import were taken away');
});

test.after(async () => {
  await app.dispose();
});
