// The automatic retry of a failed turn: the real exported default window and retry rule.
// The retry loop itself is driven end to end in turn-retry-veto.test.mjs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../miniapp/node/store.mjs';
import { MemoryStore } from '../miniapp/node/memory.mjs';
import { Engine, NO_RETRY_REASONS, TURN_RETRY_DELAYS_MS, mayRetryFailure } from '../miniapp/node/engine.mjs';

test('the default window is two retries, after 8 s and 20 s, and the engine uses it', async (t) => {
  assert.deepEqual([...TURN_RETRY_DELAYS_MS], [8000, 20000]);
  assert.ok(Object.isFrozen(TURN_RETRY_DELAYS_MS));
  const dir = await mkdtemp(join(tmpdir(), 'bot-turn-retry-default-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const engine = new Engine({ store: new Store(dir), memory: new MemoryStore(dir), logger: { warn() {} }, broadcast() {} });
  assert.equal(engine.retryDelays, TURN_RETRY_DELAYS_MS);
  engine.dispose();
});

test('mayRetryFailure: retryable:false, AGENT_OUTCOME_UNKNOWN and unfixable reasons always veto', () => {
  for (const thrown of [true, false]) {
    assert.equal(mayRetryFailure({ thrown, retryable: false }), false);
    assert.equal(mayRetryFailure({ thrown, retryable: true, code: 'AGENT_OUTCOME_UNKNOWN' }), false);
    assert.equal(mayRetryFailure({ thrown, code: 'AGENT_OUTCOME_UNKNOWN' }), false);
    for (const reason of NO_RETRY_REASONS) {
      assert.equal(mayRetryFailure({ thrown, retryable: true, reason }), false, reason);
    }
  }
});

test('mayRetryFailure: a thrown error needs retryable:true; a returned error result needs no flag', () => {
  assert.equal(mayRetryFailure({ thrown: true }), false);
  assert.equal(mayRetryFailure({ thrown: true, retryable: true, code: 'AGENT_UNAVAILABLE' }), true);
  assert.equal(mayRetryFailure({ thrown: false, code: 'TURN_FAILED' }), true);
  assert.equal(mayRetryFailure({ thrown: false, retryable: true }), true);
});
