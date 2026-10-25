// @ts-check
// Importing an existing FableCut project: the project folder travels with its
// media, the originals are left alone, and the imported document lands at the
// actual current revision.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { fixtureDir, getJson, makeClip, mcpSession, mcpTool, startApp } from './helpers.mjs';

const app = await startApp();
const { sessionId } = await mcpSession(app.base);

/**
 * Writes a FableCut data folder that looks like one from an earlier install.
 *
 * @param {string} root
 * @param {string} name
 * @param {number} seconds
 */
async function makeSourceFolder(root, name, seconds) {
  const mediaDir = path.join(root, 'media');
  mkdirSync(mediaDir, { recursive: true });
  const clip = path.join(mediaDir, 'shot.mp4');
  await makeClip(clip, seconds);
  const doc = {
    name,
    width: 1280,
    height: 720,
    fps: 30,
    revision: 7,
    media: [{ id: 'm_old1', name: 'shot.mp4', kind: 'video', src: '/media/shot.mp4', duration: seconds }],
    clips: [
      { id: 'c_old1', track: 'V1', start: 0, duration: seconds, kind: 'video', mediaId: 'm_old1', in: 0 },
    ],
  };
  writeFileSync(path.join(root, 'project.json'), JSON.stringify(doc, null, 2));
  return { root, clip, doc };
}

test('a project folder is imported with its media, and the originals stay', async () => {
  const source = await makeSourceFolder(fixtureDir('import-source'), 'Older Project', 3);

  // A file with the same name already sits in this library: the import must
  // not overwrite it.
  await mcpTool(app.base, sessionId, 'fablecut_import_media', { path: source.clip });

  const { reply, text } = await mcpTool(app.base, sessionId, 'fablecut_import_project', {
    folder: source.root,
  });
  assert.equal(reply.json.result.isError, undefined, text);
  assert.match(text, /Older Project/);
  assert.match(text, /shot\.mp4 → shot_1\.mp4/, 'the copy got a free name');

  // The original file is untouched.
  assert.ok(existsSync(source.clip), 'the source file is still there');
  assert.equal(
    readFileSync(path.join(source.root, 'project.json'), 'utf8').includes('"revision": 7'),
    true,
    'the source document is untouched',
  );

  // The imported project is open, with its media pointing at the copies.
  const project = await getJson(app.base, '/api/project');
  assert.equal(project.json.name, 'Older Project');
  assert.equal(project.json.clips.length, 1);
  assert.equal(project.json.clips[0].mediaId, project.json.media[0].id);
  assert.match(project.json.media[0].src, /^\/media\/shot_1\.mp4$/);
  assert.ok(project.json.media[0].duration > 2.5, 'the copied file is probed');

  // The copied file is in this installation's library.
  assert.ok(existsSync(path.join(app.dataDir, 'media', 'shot_1.mp4')), 'the copy is in the media folder');
  // …and the file that was already there is still there.
  assert.ok(existsSync(path.join(app.dataDir, 'media', 'shot.mp4')), 'the earlier file was not overwritten');
});

test('the imported project is saved at the actual current revision', async () => {
  const before = await getJson(app.base, '/api/project');
  const source = await makeSourceFolder(fixtureDir('import-source-2'), 'Another One', 2);

  const { reply, text } = await mcpTool(app.base, sessionId, 'fablecut_import_project', { folder: source.root });
  assert.equal(reply.json.result.isError, undefined, text);

  const after = await getJson(app.base, '/api/project');
  assert.equal(after.json.revision, before.json.revision + 1, 'the revision advanced by one');
  assert.equal(after.json.name, 'Another One');

  // The revision in the file on disk is the same one the editor reads.
  const onDisk = JSON.parse(readFileSync(path.join(app.dataDir, 'project.json'), 'utf8'));
  assert.equal(onDisk.revision, after.json.revision);
});

test('a folder with several projects takes the one that is named', async () => {
  const root = fixtureDir('import-source-3');
  const mediaDir = path.join(root, 'media');
  mkdirSync(path.join(root, 'projects', 'p_one'), { recursive: true });
  mkdirSync(path.join(root, 'projects', 'p_two'), { recursive: true });
  mkdirSync(mediaDir, { recursive: true });
  writeFileSync(
    path.join(root, 'projects', 'p_one', 'project.json'),
    JSON.stringify({ name: 'One', width: 1280, height: 720, fps: 30, revision: 1, media: [], clips: [] }),
  );
  writeFileSync(
    path.join(root, 'projects', 'p_two', 'project.json'),
    JSON.stringify({ name: 'Two', width: 1280, height: 720, fps: 30, revision: 1, media: [], clips: [] }),
  );

  const { reply, text } = await mcpTool(app.base, sessionId, 'fablecut_import_project', {
    folder: root,
    project: 'p_two',
  });
  assert.equal(reply.json.result.isError, undefined, text);
  const project = await getJson(app.base, '/api/project');
  assert.equal(project.json.name, 'Two');
});

test('a folder without a project is refused', async () => {
  const empty = fixtureDir('import-empty');
  mkdirSync(empty, { recursive: true });
  const { reply, text } = await mcpTool(app.base, sessionId, 'fablecut_import_project', { folder: empty });
  assert.equal(reply.json.result.isError, true);
  assert.match(text, /no project to import/);
});

test('the same import can be done with the existing tools alone', async () => {
  // The recipe the skill documents: import every file, then write the
  // document with the new ids and the actual current revision.
  const source = await makeSourceFolder(fixtureDir('import-source-4'), 'By Hand', 2);
  const sourceDoc = JSON.parse(readFileSync(path.join(source.root, 'project.json'), 'utf8'));

  /** @type {Map<string, any>} */
  const remapped = new Map();
  for (const media of sourceDoc.media) {
    const imported = await mcpTool(app.base, sessionId, 'fablecut_import_media', {
      path: path.join(source.root, 'media', path.basename(media.src)),
    });
    assert.equal(imported.reply.json.result.isError, undefined, imported.text);
    const entry = JSON.parse(imported.text.slice(imported.text.indexOf('{'), imported.text.lastIndexOf('}') + 1));
    remapped.set(media.id, entry);
  }

  const current = await getJson(app.base, '/api/project');
  const doc = {
    name: sourceDoc.name,
    width: sourceDoc.width,
    height: sourceDoc.height,
    fps: sourceDoc.fps,
    revision: current.json.revision,
    media: sourceDoc.media.map((/** @type {any} */ m) => ({
      ...m,
      id: remapped.get(m.id).id,
      src: remapped.get(m.id).src,
      duration: remapped.get(m.id).duration,
    })),
    clips: sourceDoc.clips.map((/** @type {any} */ c) => ({ ...c, mediaId: remapped.get(c.mediaId).id })),
  };

  const { reply, text } = await mcpTool(app.base, sessionId, 'fablecut_set_project', { project: doc });
  assert.equal(reply.json.result.isError, undefined, text);

  const after = await getJson(app.base, '/api/project');
  assert.equal(after.json.name, 'By Hand');
  assert.equal(after.json.clips.length, 1);
  assert.equal(after.json.clips[0].mediaId, after.json.media[0].id);
  assert.ok(existsSync(path.join(app.dataDir, 'media', path.basename(after.json.media[0].src))), 'the file is in the library');
});

test.after(async () => {
  await app.dispose();
});
