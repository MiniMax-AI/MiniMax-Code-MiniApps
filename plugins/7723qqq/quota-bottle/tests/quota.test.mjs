import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeQuota, resolveCounts } from '../miniapp/node/quota.mjs';

test('resolveCounts selects the consumed reading that agrees with the percentage', () => {
  assert.deepEqual(resolveCounts(60, 100, 40), { used: 60, remaining: 40, total: 100 });
  assert.deepEqual(resolveCounts(40, 100, 40), { used: 60, remaining: 40, total: 100 });
});

test('normalizeQuota rejects a row whose reported count conflicts with its percentage', () => {
  const result = normalizeQuota({
    model_remains: [{
      model_name: 'conflict',
      current_interval_total_count: 100,
      current_interval_usage_count: 250,
      current_interval_remaining_percent: 40,
    }],
  });
  // The conflicting count is dropped, but the percentage still describes the
  // window, so the row survives with the percentage it reported.
  assert.equal(result.ok, true);
  assert.equal(result.percent, 40);
  assert.equal(result.total, null);
  assert.equal(result.remaining, null);
});

test('normalizeQuota rejects negative and over-100 percentages', () => {
  for (const percent of [-20, 140]) {
    const result = normalizeQuota({
      model_remains: [{
        model_name: 'bad-percent',
        current_interval_total_count: 100,
        current_interval_remaining_percent: percent,
      }],
    });
    assert.equal(result.ok, false);
  }
});

test('normalizeQuota uses a percentage only when a count is absent', () => {
  const result = normalizeQuota({
    model_remains: [{
      model_name: 'percent-only',
      current_interval_total_count: 100,
      current_interval_remaining_percent: 25,
      end_time: 1_800_000_000_000,
      remains_time: 3_600_000,
    }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.percent, 25);
  assert.equal(result.usedPercent, 75);
  assert.equal(result.models[0].resetAt, 1_800_000_000_000);
  assert.equal(result.models[0].remainsMs, 3_600_000);
});

test('normalizeQuota keeps a counted row and reports its counts', () => {
  const result = normalizeQuota({
    model_remains: [
      { model_name: 'general', current_interval_total_count: 100, current_interval_usage_count: 20, current_interval_remaining_percent: 80 },
      { model_name: 'other', current_interval_total_count: 300, current_interval_usage_count: 100, current_interval_remaining_percent: 200 / 3 },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.total, 100);
  assert.equal(result.remaining, 80);
  assert.equal(result.used, 20);
  assert.equal(result.percent, 80);
  assert.equal(result.models.length, 2);
});

test('normalizeQuota refuses an invalid numeric percentage even with a usage count', () => {
  for (const percent of [-20, 140, Number.POSITIVE_INFINITY]) {
    const result = normalizeQuota({
      model_remains: [{
        model_name: 'bad-percent-with-count',
        current_interval_total_count: 100,
        current_interval_usage_count: 60,
        current_interval_remaining_percent: percent,
      }],
    });
    assert.equal(result.ok, false, String(percent));
  }
});

test('normalizeQuota rejects non-integer and unsafe counts', () => {
  const result = normalizeQuota({
    model_remains: [
      { model_name: 'fractional', current_interval_total_count: 100.5, current_interval_usage_count: 20 },
      { model_name: 'unsafe', current_interval_total_count: Number.MAX_SAFE_INTEGER + 1, current_interval_usage_count: 1 },
    ],
  });
  assert.equal(result.ok, false);
});

test('the weekly aggregate is the text model window, unlimited included', () => {
  const result = normalizeQuota({
    model_remains: [
      { model_name: 'general', current_interval_total_count: 0, current_interval_usage_count: 0, current_interval_remaining_percent: 33, current_weekly_status: 3, current_weekly_remaining_percent: 100 },
      { model_name: 'video', current_interval_total_count: 3, current_interval_usage_count: 3, current_interval_remaining_percent: 100, current_weekly_total_count: 21, current_weekly_usage_count: 21 },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.primaryModel, 'general');
  // The text model's weekly window is unlimited, exactly as the service reports.
  assert.equal(result.weekly.unlimited, true);
  assert.equal(result.weekly.percent, 100);
  // The video row keeps its own weekly counts.
  assert.equal(result.models[1].weekly.total, 21);
  assert.equal(result.models[1].weekly.remaining, 21);
});
