// @ts-check
// The vendored runtime must never guess where durable state belongs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const pathsModule = fileURLToPath(new URL('../miniapp/node/vendor/fablecut/paths.js', import.meta.url));

test('paths.js refuses to load without an explicit data directory', () => {
  const env = { ...process.env };
  delete env.FABLECUT_DATA_DIR;
  const result = spawnSync(process.execPath, ['-e', 'require(process.argv[1])', pathsModule], {
    env,
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0, 'loading without FABLECUT_DATA_DIR fails');
  assert.match(result.stderr, /FABLECUT_DATA_DIR must be set by the Mini App entry/);
});
