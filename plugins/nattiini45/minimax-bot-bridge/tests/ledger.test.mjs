import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { Ledger } from '../miniapp/node/ledger.mjs';
import { PendingSet } from '../miniapp/node/pending.mjs';

async function withLedger(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-ledger-'));
  try {
    const ledger = await new Ledger(dir).init();
    await fn(ledger);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('the ledger starts empty', async () => {
  await withLedger(async (ledger) => {
    const report = ledger.report({ days: 7 });
    assert.equal(report.totals.turns, 0);
    assert.equal(report.byBot.length, 0);
  });
});

test('the ledger counts turns and tools per bot', async () => {
  await withLedger(async (ledger) => {
    ledger.recordTurn({ botId: 'b1', botName: 'Writer', chars: 120, durationMs: 900 });
    ledger.recordTool({ botId: 'b1', toolName: 'recall', ok: true, durationMs: 40 });

    const report = ledger.report({ days: 7 });
    assert.equal(report.totals.turns, 1);
    assert.equal(report.totals.tools, 1);
    assert.equal(report.totals.chars, 120);
    assert.equal(report.byBot[0].botId, 'b1');
    assert.equal(report.byBot[0].name, 'Writer');
    assert.equal(report.byBot[0].tools, 1);
  });
});

test('the ledger counts errors', async () => {
  await withLedger(async (ledger) => {
    ledger.recordTurn({ botId: 'b1', error: true });
    const report = ledger.report({ days: 7 });
    assert.equal(report.totals.errors, 1);
  });
});

test('the ledger buckets by day over a week', async () => {
  await withLedger(async (ledger) => {
    ledger.recordTurn({ botId: 'b1' });
    const report = ledger.report({ days: 7 });
    assert.equal(report.buckets.length, 7);
    assert.equal(report.buckets[report.buckets.length - 1].turns, 1);
  });
});

test('the ledger buckets by hour over a day', async () => {
  await withLedger(async (ledger) => {
    ledger.recordTurn({ botId: 'b1' });
    const report = ledger.report({ days: 1 });
    assert.equal(report.buckets.length, 24);
  });
});

test('the ledger survives a reload', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-ledger-'));
  try {
    const ledger = await new Ledger(dir).init();
    ledger.recordTurn({ botId: 'b1', botName: 'Writer' });
    await ledger.persist();

    const reloaded = await new Ledger(dir).init();
    assert.equal(reloaded.report({ days: 7 }).totals.turns, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the ledger keeps only the most recent entries', async () => {
  await withLedger(async (ledger) => {
    ledger.maxEntries = 3;
    for (let i = 0; i < 10; i += 1) ledger.recordTurn({ botId: 'b1' });
    assert.equal(ledger.entries.length, 3);
  });
});

test('pending approvals expire', () => {
  let now = 1000;
  const pending = new PendingSet({ ttlMs: 100, now: () => now });
  pending.add('permission', { requestId: 'r1' }, 'session');

  assert.equal(pending.size, 1);
  now = 2000;
  assert.equal(pending.size, 0);
  assert.equal(pending.get('r1'), undefined);
});

test('pending requests are resolved once', () => {
  const pending = new PendingSet();
  pending.add('question', { requestId: 'q1' }, 'session');
  assert.equal(pending.resolve('q1'), true);
  assert.equal(pending.resolve('q1'), false);
});

test('pending requests are filtered by kind', () => {
  const pending = new PendingSet();
  pending.add('permission', { requestId: 'p1' }, 's');
  pending.add('question', { requestId: 'q1' }, 's');

  assert.equal(pending.list('permission').length, 1);
  assert.equal(pending.list('question').length, 1);
  assert.equal(pending.list().length, 2);
});

test('pending requests carry an expiry', () => {
  let now = 5000;
  const pending = new PendingSet({ ttlMs: 60000, now: () => now });
  const stored = pending.add('permission', { requestId: 'p1' }, 's');
  assert.equal(stored.expiresAt, 65000);
});
