import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { checkManifest } from '../scripts/lib/rules/manifest.mjs';
import { createReport } from '../scripts/lib/report.mjs';
import { codes, copyExample, makeTmpRoot, readJson } from './helpers.mjs';

async function run(mutate, prepare) {
  const root = await makeTmpRoot();
  const { dir } = await copyExample(root);
  const manifest = await readJson(path.join(dir, '.minimax-plugin', 'plugin.json'));
  const result = mutate(manifest);
  const next = result === undefined ? manifest : result;
  if (prepare) await prepare(dir);
  const report = createReport();
  const identity = await checkManifest(report, { packageDir: dir, manifest: next });
  return { report, identity };
}

test('manifest: baseline passes and returns identity', async () => {
  const { report, identity } = await run((m) => m);
  assert.deepEqual(report.diagnostics, []);
  assert.deepEqual(identity, { name: 'hello-miniapp', icon: 'icon.png', features: [] });
});

test('manifest: $schema is an accepted optional string', async () => {
  const { report } = await run((m) => ({ $schema: 'https://example.com/plugin.schema.json', ...m }));
  assert.deepEqual(report.diagnostics, []);
});

test('manifest: unknown field, wrong schemaVersion, bad name, bad version', async () => {
  const { report } = await run((m) => ({ ...m, schemaVersion: 2, name: 'Bad Name', version: '1.0', extra: true }));
  assert.deepEqual(codes(report.diagnostics), [
    'MANIFEST_UNKNOWN_FIELD',
    'MANIFEST_SCHEMA_VERSION',
    'MANIFEST_FIELD_INVALID',
    'MANIFEST_FIELD_INVALID',
  ]);
});

test('manifest: category outside the list is an error', async () => {
  const { report } = await run((m) => ({ ...m, category: 'Utilities' }));
  assert.deepEqual(codes(report.diagnostics), ['MANIFEST_FIELD_INVALID']);
});

test('manifest: empty exampleQueries is a warning; blank entry is an error', async () => {
  const empty = await run((m) => ({ ...m, exampleQueries: [] }));
  assert.deepEqual(codes(empty.report.diagnostics), ['MANIFEST_EXAMPLE_QUERIES_EMPTY']);
  assert.equal(empty.report.diagnostics[0].level, 'warning');
  const blank = await run((m) => ({ ...m, exampleQueries: ['ok', '  '] }));
  assert.deepEqual(codes(blank.report.diagnostics), ['MANIFEST_FIELD_INVALID']);
});

test('manifest: apps entries are *.app.json files that exist and hold one Connector provider each', async () => {
  const writeApp = (name, value) => async (dir) => writeFile(path.join(dir, name), `${JSON.stringify(value)}\n`);
  const ok = await run((m) => ({ ...m, apps: ['notion.app.json'] }), writeApp('notion.app.json', { schemaVersion: 1, provider: 'notion' }));
  assert.deepEqual(ok.report.diagnostics, []);
  const badPattern = await run((m) => ({ ...m, apps: ['foo'] }));
  assert.deepEqual(codes(badPattern.report.diagnostics), ['MANIFEST_REFERENCE_INVALID']);
  const missing = await run((m) => ({ ...m, apps: ['notion.app.json'] }));
  assert.deepEqual(codes(missing.report.diagnostics), ['MANIFEST_REFERENCE_MISSING']);
  const directory = await run((m) => ({ ...m, apps: ['notion.app.json'] }), async (dir) => mkdir(path.join(dir, 'notion.app.json')));
  assert.deepEqual(codes(directory.report.diagnostics), ['MANIFEST_REFERENCE_MISSING']);
  const notJson = await run((m) => ({ ...m, apps: ['notion.app.json'] }), async (dir) => writeFile(path.join(dir, 'notion.app.json'), '{ provider: notion }'));
  assert.deepEqual(codes(notJson.report.diagnostics), ['MANIFEST_APP_INVALID']);
  const repeatedPath = await run((m) => ({ ...m, apps: ['notion.app.json', 'notion.app.json'] }), writeApp('notion.app.json', { schemaVersion: 1, provider: 'notion' }));
  assert.equal(repeatedPath.report.diagnostics.length, 1, JSON.stringify(repeatedPath.report.diagnostics));
  for (const value of [{ schemaVersion: 2, provider: 'notion' }, { schemaVersion: 1, provider: 'Notion' }, { schemaVersion: 1, provider: 'notion', name: 'x' }, { schemaVersion: 1 }]) {
    const bad = await run((m) => ({ ...m, apps: ['notion.app.json'] }), writeApp('notion.app.json', value));
    assert.deepEqual(codes(bad.report.diagnostics), ['MANIFEST_APP_INVALID'], JSON.stringify(value));
  }
  const duplicate = await run(
    (m) => ({ ...m, apps: ['a.app.json', 'b.app.json'] }),
    async (dir) => {
      await writeApp('a.app.json', { schemaVersion: 1, provider: 'notion' })(dir);
      await writeApp('b.app.json', { $schema: 'https://example.com/app.json', schemaVersion: 1, provider: 'notion' })(dir);
    },
  );
  assert.deepEqual(codes(duplicate.report.diagnostics), ['MANIFEST_APP_INVALID']);
  assert.match(duplicate.report.diagnostics[0].message, /provider "notion"/u);
});

test('manifest: skills, mcpServers, hooks, hostBindings need matching pattern and existing file', async () => {
  const missing = await run((m) => ({ ...m, skills: ['skills/demo/SKILL.md'], hostBindings: ['bindings/x.binding.json'] }));
  assert.deepEqual(codes(missing.report.diagnostics), ['MANIFEST_REFERENCE_MISSING', 'MANIFEST_REFERENCE_MISSING']);
  const present = await run(
    (m) => ({ ...m, skills: ['skills/demo/SKILL.md'], mcpServers: ['tools.mcp.json'], hooks: ['hooks/a.json'], hostBindings: ['bindings/x.binding.json'] }),
    async (dir) => {
      await mkdir(path.join(dir, 'skills', 'demo'), { recursive: true });
      await writeFile(path.join(dir, 'skills', 'demo', 'SKILL.md'), '# demo\n');
      await writeFile(path.join(dir, 'tools.mcp.json'), '{}\n');
      await mkdir(path.join(dir, 'hooks'), { recursive: true });
      await writeFile(path.join(dir, 'hooks', 'a.json'), '{}\n');
      await mkdir(path.join(dir, 'bindings'), { recursive: true });
      await writeFile(path.join(dir, 'bindings', 'x.binding.json'), '{}\n');
    },
  );
  assert.deepEqual(present.report.diagnostics, []);
  const badPattern = await run((m) => ({ ...m, skills: ['demo/SKILL.md'] }));
  assert.deepEqual(codes(badPattern.report.diagnostics), ['MANIFEST_REFERENCE_INVALID']);
  const duplicate = await run((m) => ({ ...m, hooks: ['hooks/a.json', 'hooks/a.json'] }));
  assert.deepEqual(codes(duplicate.report.diagnostics), ['MANIFEST_REFERENCE_INVALID']);
});

test('manifest: agents are agents/<name>.md files that exist, and report the feature', async () => {
  const present = await run(
    (m) => ({ ...m, agents: ['agents/route-planner.md'] }),
    async (dir) => {
      await mkdir(path.join(dir, 'agents'), { recursive: true });
      await writeFile(path.join(dir, 'agents', 'route-planner.md'), '# route planner\n');
    },
  );
  assert.deepEqual(present.report.diagnostics, []);
  assert.deepEqual(present.identity.features, ['agents']);
  const missing = await run((m) => ({ ...m, agents: ['agents/route-planner.md'] }));
  assert.deepEqual(codes(missing.report.diagnostics), ['MANIFEST_REFERENCE_MISSING']);
  for (const entry of ['agents/Planner.md', 'agents/nested/planner.md', 'planner.md', 'agents/planner.txt']) {
    const bad = await run((m) => ({ ...m, agents: [entry] }));
    assert.deepEqual(codes(bad.report.diagnostics), ['MANIFEST_REFERENCE_INVALID'], entry);
  }
});

test('manifest: hostCapabilities cannot be claimed by a manifest', async () => {
  const { report } = await run((m) => ({ ...m, hostCapabilities: [{ id: 'browser', version: 1 }] }));
  assert.deepEqual(codes(report.diagnostics), ['MANIFEST_UNKNOWN_FIELD']);
});

test('manifest: non-object is a single error', async () => {
  const { report } = await run(() => null);
  assert.deepEqual(codes(report.diagnostics), ['MANIFEST_NOT_OBJECT']);
});

test('manifest: a path with a dot segment is an error, even when it resolves inside the package', async () => {
  // `sub/../icon.png` names a file inside the package, but the segment is not portable and the Host
  // rejects it as PATH_TRAVERSAL, so a package that passed here would fail at install time.
  const inside = await run((m) => ({ ...m, icon: 'sub/../icon.png' }), async (dir) => {
    await mkdir(path.join(dir, 'sub'));
  });
  assert.deepEqual(codes(inside.report.diagnostics), ['MANIFEST_FIELD_INVALID']);
});

test('manifest: an image path must stay inside the package', async () => {
  // `../shared/icon.png` resolves outside the package. The validator must not read that file, so the
  // test places a real PNG one level up: a traversal that is accepted would otherwise pass silently.
  const shared = async (dir) => {
    const target = path.join(path.dirname(dir), 'shared');
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, 'icon.png'), await readFile(path.join(dir, 'icon.png')));
  };
  const escapedIcon = await run((m) => ({ ...m, icon: '../shared/icon.png' }), shared);
  assert.deepEqual(codes(escapedIcon.report.diagnostics), ['MANIFEST_FIELD_INVALID']);
  const escapedDarkIcon = await run((m) => ({ ...m, darkIcon: '../shared/icon.png' }), shared);
  assert.deepEqual(codes(escapedDarkIcon.report.diagnostics), ['MANIFEST_FIELD_INVALID']);
});

test('manifest: a reference with a dot segment is an error', async () => {
  const skills = await run((m) => ({ ...m, skills: ['skills/../SKILL.md'] }));
  assert.deepEqual(codes(skills.report.diagnostics), ['MANIFEST_REFERENCE_INVALID']);
  const servers = await run((m) => ({ ...m, mcpServers: ['../shared/probe.mcp.json'] }));
  assert.deepEqual(codes(servers.report.diagnostics), ['MANIFEST_REFERENCE_INVALID']);
  const hooks = await run((m) => ({ ...m, hooks: ['../shared/probe.json'] }));
  assert.deepEqual(codes(hooks.report.diagnostics), ['MANIFEST_REFERENCE_INVALID']);
});

test('manifest: canonical image and reference paths keep passing', async () => {
  const plain = await run((m) => m);
  assert.deepEqual(plain.report.diagnostics, []);
  const dotted = await run((m) => ({ ...m, icon: './icon.png' }));
  assert.deepEqual(dotted.report.diagnostics, []);
  const app = await run(
    (m) => ({ ...m, apps: ['./notion.app.json'] }),
    async (dir) => writeFile(path.join(dir, 'notion.app.json'), `${JSON.stringify({ schemaVersion: 1, provider: 'notion' })}\n`),
  );
  assert.deepEqual(app.report.diagnostics, []);
});
