import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReport, formatReport, hasErrors } from '../scripts/lib/report.mjs';

test('createReport collects levels and hasErrors ignores warnings', () => {
  const report = createReport();
  report.warning('W1', 'soft', 'a.txt');
  assert.equal(hasErrors(report.diagnostics), false);
  report.error('E1', 'hard');
  assert.equal(hasErrors(report.diagnostics), true);
  assert.deepEqual(report.diagnostics, [
    { level: 'warning', code: 'W1', message: 'soft', path: 'a.txt' },
    { level: 'error', code: 'E1', message: 'hard' },
  ]);
});

test('formatReport prints one line per diagnostic and a summary', () => {
  const report = createReport();
  report.error('E1', 'hard', 'x.json');
  const text = formatReport('plugins/a/b', report.diagnostics);
  assert.match(text, /^plugins\/a\/b: 1 error, 0 warnings$/mu);
  assert.match(text, /^  error E1 hard \(x\.json\)$/mu);
  assert.equal(formatReport('ok', []), 'ok: OK');
});
