import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRecoveryStore } from '../miniapp/node/recovery-store.mjs';
const root = await mkdtemp(join(tmpdir(), 'photo-recovery-'));
try {
  const store = await createRecoveryStore(root);
  const id = 'document-00000000-0000-4000-8000-000000000001';
  const value = { name: 'Layered work', data: 'YWJj' };
  const writes = await Promise.allSettled([store.put(id, { revision: 0, value }), store.put(id, { revision: 0, value })]);
  assert.equal(writes.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(writes.find(x => x.status === 'rejected').reason.status, 409);
  const restarted = await createRecoveryStore(root);
  assert.deepEqual((await restarted.get(id)).value, value);
  assert.equal((await restarted.list())[0].name, value.name);
  await assert.rejects(store.put(id, { revision: 1, value: { name: 'invalid', data: '!!' } }));
  assert.equal((await store.get(id)).revision, 1);
  await assert.rejects(store.get('../../outside'));
  console.log('PASS Recovery: restart, concurrent stale writes, invalid data and path boundaries');
} finally { await rm(root, { recursive: true, force: true }); }
