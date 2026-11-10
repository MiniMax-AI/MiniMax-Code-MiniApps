import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { start } from '../miniapp/node/server.mjs';

const pluginRoot = fileURLToPath(new URL('..', import.meta.url));

test('the Mini App serves the page, scans a folder, and returns a fix prompt', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'site-qa-data-'));
  const project = await mkdtemp(path.join(tmpdir(), 'site-qa-project-'));
  await writeFile(path.join(project, 'index.html'), '<html><head></head><body><img src="a.png"></body></html>', 'utf8');
  const port = await freePort();
  const running = await start({
    pluginRoot,
    dataDir,
    listen: { host: '127.0.0.1', port },
    signal: new AbortController().signal,
    logger: { info() {}, warn() {}, error() {} },
  });
  try {
    const page = await fetch(`http://127.0.0.1:${port}/qa`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Find what is hurting the site/);

    const refused = await fetch(`http://127.0.0.1:${port}/api/scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: dataDir }),
    });
    assert.equal(refused.status, 400);
    assert.equal((await refused.json()).error, 'path_forbidden');

    const scanned = await fetch(`http://127.0.0.1:${port}/api/scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: project }),
    });
    assert.equal(scanned.status, 200);
    const report = await scanned.json();
    assert.ok(report.findings.length > 0);
    const finding = report.findings.find((item) => item.rule === 'img_missing_alt');
    assert.ok(finding);

    const prompt = await fetch(`http://127.0.0.1:${port}/api/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'finding', id: finding.id }),
    });
    assert.equal(prompt.status, 200);
    assert.match((await prompt.json()).text, /img_missing_alt/);
  } finally {
    await running.dispose();
  }
});

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = address && typeof address !== 'string' ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}
