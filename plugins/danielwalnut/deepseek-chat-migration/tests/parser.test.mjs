import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { activeBranch, parseDeepSeekExport, stableHash } from '../miniapp/client/deepseek.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/official-v3-session.json', import.meta.url), 'utf8'));

test('parses official v3 blocks without mixing reasoning and search into answers', () => {
  const [conversation] = parseDeepSeekExport(fixture);
  assert.equal(conversation.title, 'Launch brief');
  assert.equal(conversation.turnCount, 2);
  assert.equal(conversation.branchCount, 1);
  assert.deepEqual(conversation.messages[1].blocks.map((block) => block.type), ['reasoning', 'search', 'text']);
  assert.equal(conversation.messages[0].blocks[1].files[0].name, 'brief.pdf');
});

test('reconstructs the selected branch and preserves regenerated alternatives', () => {
  const [conversation] = parseDeepSeekExport(fixture);
  assert.deepEqual(activeBranch(conversation).map((message) => message.id), ['1', '2', '3', '5']);
  assert.equal(conversation.messages.find((message) => message.id === '4').blocks[0].text, 'First version: a dense comparison table.');
});

test('stable identity dedupes identical exports and changes with content', () => {
  const first = parseDeepSeekExport(fixture)[0].stableId;
  const second = parseDeepSeekExport(structuredClone(fixture))[0].stableId;
  const changed = structuredClone(fixture);
  changed.messages[4].fragments[0].content += ' Updated.';
  assert.equal(first, second);
  assert.notEqual(first, parseDeepSeekExport(changed)[0].stableId);
  assert.equal(stableHash('same'), stableHash('same'));
});

test('parses legacy DeepSeek mapping and flat message schemas', () => {
  const legacy = {
    id: 'legacy-1', title: 'Legacy', current_node: 'a2',
    mapping: {
      root: { id: 'root', parent: null, children: ['u1'], message: null },
      u1: { id: 'u1', parent: 'root', children: ['a1', 'a2'], message: { fragments: [{ type: 'REQUEST', content: 'Question' }] } },
      a1: { id: 'a1', parent: 'u1', children: [], message: { fragments: [{ type: 'RESPONSE', content: 'Old' }] } },
      a2: { id: 'a2', parent: 'u1', children: [], message: { fragments: [{ type: 'THINK', content: 'Reason' }, { type: 'RESPONSE', content: 'New' }] } }
    }
  };
  const mapped = parseDeepSeekExport([legacy])[0];
  assert.equal(mapped.messages[0].role, 'user');
  assert.deepEqual(activeBranch(mapped).map((message) => message.id), ['u1', 'a2']);

  const flat = parseDeepSeekExport({
    chat_session: { id: 'flat-1', title: 'Flat', current_message_id: 'm2' },
    chat_messages: [
      { message_id: 'm1', parent_id: null, role: 'user', content: 'Hi' },
      { message_id: 'm2', parent_id: 'm1', role: 'assistant', content: 'Hello', thinking_content: 'Greet briefly', search_results: [{ title: 'Source', url: 'https://example.test', snippet: 'Synthetic' }] }
    ]
  })[0];
  assert.deepEqual(flat.messages[1].blocks.map((block) => block.type), ['reasoning', 'text', 'search']);
});
