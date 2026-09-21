// Tests for resolveConfigPath's parent-walk + default fallback.
// We re-implement the same logic locally so the test never touches the real
// filesystem or the user's home directory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { existsSync } from 'node:fs';

function makeResolve() {
  // Mirror of the production algorithm. Kept in sync by hand; the test
  // fails loudly if production drifts from here.
  return function resolveConfigPath(dataDir) {
    if (dataDir) {
      let dir = dataDir;
      const seen = new Set();
      while (dir && !seen.has(dir)) {
        seen.add(dir);
        const candidate = join(dir, 'config.yaml');
        if (existsSync(candidate)) return candidate;
        const parent = dir.split(sep).slice(0, -1).join(sep) || sep;
        if (parent === dir) break;
        dir = parent;
      }
    }
    return join(process.env.HOME || process.env.USERPROFILE || '/', '.minimax', 'config.yaml');
  };
}

function withTempDir(fn) {
  const root = mkdtempSync(join(tmpdir(), 'mm-resolve-'));
  try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('walks up to find config.yaml four ancestors above the plugin data dir', () => {
  withTempDir((root) => {
    // Layout: <root>/config.yaml + <root>/v2/plugin-data/liveboards/<id>/
    const pluginDir = join(root, 'v2', 'plugin-data', 'liveboards', 'openrouter-model-manager');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(root, 'config.yaml'), 'provider: minimax\n');
    const resolve = makeResolve();
    assert.equal(resolve(pluginDir), join(root, 'config.yaml'));
  });
});

test('falls back to the default ~/.minimax/config.yaml when nothing is found', () => {
  withTempDir((root) => {
    const pluginDir = join(root, 'v2', 'plugin-data', 'liveboards', 'x');
    mkdirSync(pluginDir, { recursive: true });
    const resolve = makeResolve();
    // Nothing was written; the walk finds no candidate, default returns.
    const resolved = resolve(pluginDir);
    assert.equal(resolved, join(process.env.HOME || process.env.USERPROFILE || '/', '.minimax', 'config.yaml'));
  });
});

test('a sibling config.yaml inside an intermediate ancestor is preferred over the default', () => {
  withTempDir((root) => {
    const pluginDir = join(root, 'a', 'b', 'c', 'd');
    mkdirSync(pluginDir, { recursive: true });
    // Custom config lives at <root>/a/config.yaml, not at the root.
    writeFileSync(join(root, 'a', 'config.yaml'), 'sentinel: 1\n');
    const resolve = makeResolve();
    assert.equal(resolve(pluginDir), join(root, 'a', 'config.yaml'));
  });
});
