// @ts-check
// Importing a project folder must not reach outside the folder it was given,
// must not leave a media entry pointing at an unrelated file, must never
// overwrite work that happened while it was running, and must not bring a
// file the browser would execute into the folder the page reads.

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

test('a file that is not media stops the import', async () => {
  // The media folder is served from the editor's own origin: a file a browser
  // would run there would run there.
  const root = fixtureDir('safety-active');
  await makeSourceMedia(root, 'ok.mp4', 1);
  writeFileSync(path.join(root, 'media', 'evil.html'), '<script>alert(1)</script>');
  await makeSource(root, {
    name: 'Active Content',
    media: [
      { id: 'm_ok', name: 'ok.mp4', kind: 'video', src: '/media/ok.mp4' },
      { id: 'm_evil', name: 'evil.html', kind: 'image', src: '/media/evil.html' },
    ],
  });
  const before = await getJson(app.base, '/api/project');
  const mediaBefore = mediaFiles();

  const { reply, text } = await mcpTool(app.base, sessionId, 'fablecut_import_project', { folder: root });
  assert.equal(reply.json.result.isError, true, 'the import is refused');
  assert.match(text, /is not a media file/, text);

  const after = await getJson(app.base, '/api/project');
  assert.equal(after.json.revision, before.json.revision, 'the open project was not touched');
  assert.deepEqual(mediaFiles(), mediaBefore, 'not even the media file was copied');
  assert.ok(!existsSync(path.join(app.dataDir, 'media', 'evil.html')), 'the file was not copied');
});

test('an upload of a file that is not media is refused', async () => {
  const before = mediaFiles();

  const refused = await fetch(`${app.base}/api/upload?name=evil.html`, {
    method: 'POST',
    headers: { 'content-type': 'text/html' },
    body: '<script>alert(1)</script>',
  });
  assert.equal(refused.status, 400, 'the upload is refused');
  const body = await refused.json();
  assert.match(body.error, /is not a media file/);
  assert.deepEqual(mediaFiles(), before, 'nothing was written');

  // The media types that are supported still go in.
  for (const name of ['shot.png', 'logo.svg', 'take.mp4']) {
    const ok = await fetch(`${app.base}/api/upload?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: 'bytes',
    });
    assert.equal(ok.status, 200, `${name} is accepted`);
    const answer = await ok.json();
    assert.match(answer.src, /^\/media\//);
  }
  assert.ok(mediaFiles().includes('shot.png'), 'the image is in the media folder');
  assert.ok(mediaFiles().includes('logo.svg'), 'the SVG is in the media folder');
  assert.ok(mediaFiles().includes('take.mp4'), 'the video is in the media folder');
});

test('a file that was already in the media folder is served safely', async () => {
  // The upload boundary refuses an HTML page, but a file that was there before
  // it can still be served: it must not run on the editor's origin.
  const name = 'preexisting.html';
  writeFileSync(path.join(app.dataDir, 'media', name), '<script>alert(1)</script>');

  const response = await fetch(`${app.base}/media/${name}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff', 'the type is not guessed');
  assert.match(
    response.headers.get('content-security-policy') || '',
    /sandbox/,
    'a document is served sandboxed',
  );
  await response.text();

  // The editor's own page is not sandboxed: it has to run.
  const page = await fetch(`${app.base}/editor`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(page.headers.get('content-security-policy'), null, 'the editor page may run');
  await page.text();
});

test('a font is not media content', async () => {
  const root = fixtureDir('safety-font');
  mkdirSync(path.join(root, 'media'), { recursive: true });
  const font = path.join(root, 'media', 'font.ttf');
  writeFileSync(font, 'not really a font');
  await makeSource(root, {
    name: 'Font In Media',
    media: [{ id: 'm_font', name: 'font.ttf', kind: 'image', src: '/media/font.ttf' }],
  });
  const before = await getJson(app.base, '/api/project');
  const mediaBefore = mediaFiles();

  // A font in the source folder's media/ is not media: the import stops.
  const { reply, text } = await mcpTool(app.base, sessionId, 'fablecut_import_project', { folder: root });
  assert.equal(reply.json.result.isError, true, 'the import is refused');
  assert.match(text, /is not a media file/, text);

  const after = await getJson(app.base, '/api/project');
  assert.equal(after.json.revision, before.json.revision, 'the open project was not touched');
  assert.deepEqual(mediaFiles(), mediaBefore, 'nothing was copied');
  assert.ok(!existsSync(path.join(app.dataDir, 'media', 'font.ttf')), 'the font was not copied');

  // And a font cannot be imported as media either: the kind is detected
  // before anything is copied.
  const imported = await mcpTool(app.base, sessionId, 'fablecut_import_media', { path: font });
  assert.equal(imported.reply.json.result.isError, true, 'the font import is refused');
  assert.match(imported.text, /Unsupported extension \.ttf/, imported.text);
  assert.deepEqual(mediaFiles(), mediaBefore, 'the font was not copied into media/');
});

test('every response says what type it is', async () => {
  const project = await getJson(app.base, '/api/project');
  assert.equal(project.status, 200);
  assert.equal(project.headers.get('x-content-type-options'), 'nosniff', 'the API answers carry it');

  const refused = await fetch(`${app.base}/api/upload?name=evil.html`, {
    method: 'POST',
    headers: { 'content-type': 'text/html' },
    body: '<script>alert(1)</script>',
  });
  assert.equal(refused.status, 400);
  assert.equal(refused.headers.get('x-content-type-options'), 'nosniff', 'the error answers carry it');
  await refused.text();

  const missing = await fetch(`${app.base}/media/nothing-here.mp4`);
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('x-content-type-options'), 'nosniff', 'the not-found answers carry it');
  await missing.text();
});

test('a differing library font stays in the library', async () => {
  // This installation has its own file under that name and the source folder
  // has a different one: the source's copy is brought over. A font is not
  // media, so it must not end up in media/.
  const rel = 'fonts/font-under-test.woff2';
  const ours = path.join(app.dataDir, 'library', ...rel.split('/'));
  mkdirSync(path.dirname(ours), { recursive: true });
  writeFileSync(ours, 'our own font');

  const root = fixtureDir('safety-library-font');
  mkdirSync(path.join(root, 'library', 'fonts'), { recursive: true });
  writeFileSync(path.join(root, 'library', 'fonts', 'font-under-test.woff2'), 'the source font');
  await makeSource(root, {
    name: 'Library Font',
    media: [{ id: 'm_f', name: 'font-under-test.woff2', kind: 'image', src: '/library/fonts/font-under-test.woff2' }],
  });
  const mediaBefore = mediaFiles();

  const { reply, text } = await mcpTool(app.base, sessionId, 'fablecut_import_project', { folder: root });
  assert.equal(reply.json.result.isError, undefined, text);

  const after = await getJson(app.base, '/api/project');
  assert.equal(after.json.name, 'Library Font');
  const src = String(after.json.media[0].src);
  assert.match(src, /^\/library\/fonts\/font-under-test(_1)?\.woff2$/, 'the entry points at the library');
  assert.deepEqual(mediaFiles(), mediaBefore, 'no font was copied into media/');

  const copied = path.join(app.dataDir, 'library', 'fonts', 'font-under-test_1.woff2');
  assert.ok(existsSync(copied), 'the source font is in the library');
  assert.equal(readFileSync(copied, 'utf8'), 'the source font', 'the source content was brought over');
  assert.equal(readFileSync(ours, 'utf8'), 'our own font', 'our own file was not overwritten');
});

test.after(async () => {
  await app.dispose();
});