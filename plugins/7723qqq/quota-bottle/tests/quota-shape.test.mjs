import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeQuota } from '../miniapp/node/quota.mjs';

test('a percentage-only window is a real quota and is not dropped', () => {
  // The Token Plan reports the text quota without token counts: a zero total
  // and a remaining percentage. Dropping this row would hide the whole quota.
  const result = normalizeQuota({
    model_remains: [{
      model_name: 'general',
      current_interval_total_count: 0,
      current_interval_usage_count: 0,
      current_interval_status: 1,
      current_interval_remaining_percent: 33,
      current_weekly_status: 3,
      current_weekly_remaining_percent: 100,
      end_time: 1_800_000_000_000,
      remains_time: 3_600_000,
    }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.percent, 33);
  assert.equal(result.usedPercent, 67);
  assert.equal(result.total, null);
  assert.equal(result.remaining, null);
  assert.equal(result.primaryModel, 'general');
  assert.equal(result.models[0].weekly.unlimited, true);
  assert.equal(result.models[0].resetAt, 1_800_000_000_000);
});

test('a counted window still reports counts', () => {
  const result = normalizeQuota({
    model_remains: [{
      model_name: 'general',
      current_interval_total_count: 100,
      current_interval_usage_count: 40,
      current_interval_remaining_percent: 60,
    }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.total, 100);
  assert.equal(result.remaining, 60);
  assert.equal(result.used, 40);
  assert.equal(result.percent, 60);
});

test('the first model row is the headline', () => {
  const result = normalizeQuota({
    model_remains: [
      { model_name: 'video', current_interval_total_count: 3, current_interval_usage_count: 3, current_interval_remaining_percent: 100 },
      { model_name: 'general', current_interval_total_count: 0, current_interval_usage_count: 0, current_interval_remaining_percent: 33 },
    ],
  });
  assert.equal(result.ok, true);
  // Row order is the service's, and the plan's own panel reads its first row.
  // Picking a different row here would show a second number next to that
  // panel, so the bottle follows the same rule.
  assert.equal(result.primaryModel, 'video');
  assert.equal(result.percent, 100);
  assert.equal(result.models.length, 2);
  assert.equal(result.models[1].name, 'general');
  assert.equal(result.models[1].percent, 33);
});

test('a used percentage is read when no remaining percentage is sent', () => {
  const result = normalizeQuota({
    model_remains: [{
      model_name: 'general',
      current_interval_used_percent: 67,
      current_interval_total_count: 0,
    }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.percent, 33);
  assert.equal(result.usedPercent, 67);
});

test('a row with neither a percentage nor a count says nothing and is skipped', () => {
  const result = normalizeQuota({
    model_remains: [{ model_name: 'empty', current_interval_status: 1 }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'no_quota');
});
