import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkMcode } from '../scripts/lib/rules/mcode.mjs';
import { createReport } from '../scripts/lib/report.mjs';
import { codes } from './helpers.mjs';

const run = (packageJson) => {
  const report = createReport();
  checkMcode(report, { packageJson });
  return report.diagnostics;
};

test('mcode: exact declaration passes, extra top-level keys are fine', () => {
  assert.deepEqual(run({ mcode: { schemaVersion: 2, miniApp: './miniapp/miniapp.json' } }), []);
  assert.deepEqual(run({ name: 'x', type: 'module', mcode: { schemaVersion: 2, miniApp: './miniapp/miniapp.json' } }), []);
});

test('mcode: any deviation is the same single error', () => {
  const expectedMessage = 'package.json#mcode must be exactly { "schemaVersion": 2, "miniApp": "./miniapp/miniapp.json" }';
  for (const packageJson of [
    {},
    { mcode: { schemaVersion: 1, miniApp: './miniapp/miniapp.json' } },
    { mcode: { schemaVersion: 2, miniApp: './miniapp/miniapp.json', extra: 1 } },
    { mcode: { schemaVersion: 2, miniApp: 'miniapp/miniapp.json' } },
    { mcode: 'nope' },
    null,
  ]) {
    const diagnostics = run(packageJson);
    assert.deepEqual(codes(diagnostics), ['MCODE_INVALID']);
    assert.equal(diagnostics[0].message, expectedMessage);
  }
});
