import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readInput } from '../miniapp/client/archive.js';

test('reads official ZIP exports whose entries use data descriptors', async () => {
  const bytes = readFileSync(new URL('./fixtures/data-descriptor-export.zip', import.meta.url));
  const file = { name: 'deepseek_data.zip', arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  const conversations = await readInput(file);
  assert.equal(conversations.length, 1);
  assert.ok(conversations[0].messages.length > 0);
});
