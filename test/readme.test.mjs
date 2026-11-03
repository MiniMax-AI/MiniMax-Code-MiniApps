import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { checkReadme } from '../scripts/lib/rules/readme.mjs';
import { createReport } from '../scripts/lib/report.mjs';
import { codes, copyExample, makeTmpRoot } from './helpers.mjs';

async function run(transform, { features, engines } = {}) {
  const root = await makeTmpRoot();
  const { dir } = await copyExample(root);
  const file = path.join(dir, 'README.md');
  if (transform) await writeFile(file, transform(await readFile(file, 'utf8')));
  const report = createReport();
  await checkReadme(report, { packageDir: dir, features, engines });
  return report.diagnostics;
}

const TESTED_ON_3_0_73 = /- MiniMax Code 3\.0\.73 on macOS\./u;

test('readme: baseline has both headings', async () => {
  assert.deepEqual(await run(), []);
});

test('readme: CRLF line endings still match', async () => {
  assert.deepEqual(await run((text) => text.replace(/\n/gu, '\r\n')), []);
});

test('readme: each missing heading is one warning', async () => {
  const diagnostics = await run((text) => text.replace('## Data & access', '## Privacy'));
  assert.deepEqual(codes(diagnostics), ['README_HEADING_MISSING']);
  assert.equal(diagnostics[0].level, 'warning');
  assert.match(diagnostics[0].message, /## Data & access/u);
});

test('readme: missing README is not reported here (layout owns it)', async () => {
  const root = await makeTmpRoot();
  const { dir } = await copyExample(root);
  const { rm } = await import('node:fs/promises');
  await rm(path.join(dir, 'README.md'));
  const report = createReport();
  await checkReadme(report, { packageDir: dir });
  assert.deepEqual(report.diagnostics, []);
});

test('readme: a feature that needs a newer client warns until Tested environment names that version', async () => {
  const stale = await run(undefined, { features: ['agentAccess', 'surface.window'] });
  assert.deepEqual(codes(stale), ['README_MIN_VERSION_MISSING']);
  assert.equal(stale[0].level, 'warning');
  assert.match(stale[0].message, /agentAccess, surface\.window/u);
  assert.match(stale[0].message, /MiniMax Code 3\.1\.2/u);
  for (const line of ['- MiniMax Code 3.1.2 on macOS.', '- MiniMax Code >= 3.2.0 on Windows 11.', '- MiniMax Code v3.10.0.']) {
    assert.deepEqual(await run((text) => text.replace(TESTED_ON_3_0_73, line), { features: ['agentAccess'] }), [], line);
  }
});

test('readme: only a MiniMax Code version inside Tested environment satisfies the minimum', async () => {
  const otherRuntime = await run((text) => text.replace(TESTED_ON_3_0_73, '- MiniMax Code 3.1.1, Node 22.0.0.'), { features: ['agents'] });
  assert.deepEqual(codes(otherRuntime), ['README_MIN_VERSION_MISSING']);
  const otherSection = await run((text) => text.replace('## Install', '## Install\n\nNeeds MiniMax Code 3.1.2.'), { features: ['agents'] });
  assert.deepEqual(codes(otherSection), ['README_MIN_VERSION_MISSING']);
  const noSection = await run((text) => text.replace('## Tested environment', '## Tested'), { features: ['agents'] });
  assert.deepEqual(codes(noSection), ['README_HEADING_MISSING', 'README_MIN_VERSION_MISSING']);
});

const testedOn = (line) => (text) => text.replace(TESTED_ON_3_0_73, line);

test('readme: each feature names the first release with installers for both platforms', async () => {
  const cases = [
    [['agentAccess.session.read', 'toolAccess', 'deviceAccess', 'engines'], '3.1.6', ['3.1.4-preview.4773', '3.1.5']],
    [['deviceAccess.camera', 'deviceAccess.notifications'], '3.1.9', ['3.1.8']],
    [['hostAccess'], '3.1.11', ['3.1.10', '3.1.11-preview.4900']],
  ];
  for (const [features, minimum, tooOld] of cases) {
    for (const feature of features) {
      for (const version of tooOld) {
        const stale = await run(testedOn(`- MiniMax Code ${version} on macOS.`), { features: [feature] });
        assert.deepEqual(codes(stale), ['README_MIN_VERSION_MISSING'], `${feature} on ${version}`);
        assert.match(stale[0].message, new RegExp(`MiniMax Code ${minimum.replaceAll('.', '\\.')} or later`, 'u'));
      }
      assert.deepEqual(await run(testedOn(`- MiniMax Code ${minimum} on macOS.`), { features: [feature] }), [], feature);
    }
  }
  assert.deepEqual(await run(testedOn('- MiniMax Code 3.1.6-3.1.11 on macOS.'), { features: ['toolAccess'] }), []);
});

test('readme: an engines bound above the feature minimum raises the version the README must name', async () => {
  const below = await run((text) => text.replace(TESTED_ON_3_0_73, '- MiniMax Code 3.1.6 on macOS.'), { features: ['engines'], engines: '3.2.0' });
  assert.deepEqual(codes(below), ['README_MIN_VERSION_MISSING']);
  assert.match(below[0].message, /MiniMax Code 3\.2\.0/u);
  assert.deepEqual(await run((text) => text.replace(TESTED_ON_3_0_73, '- MiniMax Code 3.2.0 on macOS.'), { features: ['engines'], engines: '3.2.0' }), []);
});
