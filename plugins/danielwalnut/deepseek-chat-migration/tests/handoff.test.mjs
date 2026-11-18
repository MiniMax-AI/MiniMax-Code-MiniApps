import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { parseDeepSeekExport } from '../miniapp/client/deepseek.js';
import { APPEND_LIMIT, buildDraft } from '../miniapp/client/handoff.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/official-v3-session.json', import.meta.url), 'utf8'));

function synthetic(id, turns, size = 200) {
  const messages = [];
  for (let index = 0; index < turns; index += 1) {
    messages.push({
      id: `${id}-${index}`,
      parentId: index ? `${id}-${index - 1}` : null,
      role: index % 2 ? 'assistant' : 'user',
      blocks: [{ type: 'text', text: `turn ${index} ${'x'.repeat(size)}` }],
    });
  }
  return { stableId: id, title: `Conversation ${id}`, updatedAt: '2026-11-01T00:00:00Z', messages, currentMessageId: `${id}-${turns - 1}` };
}

test('drafts only the branch DeepSeek last showed, as background context', () => {
  const [conversation] = parseDeepSeekExport(fixture);
  const { text, omitted } = buildDraft([conversation]);
  assert.equal(omitted, 0);
  assert.match(text, /^Below is earlier conversation history exported from DeepSeek/);
  assert.match(text, /## Launch brief/);
  assert.match(text, /\(Attached in DeepSeek: brief\.pdf\)/);
  const visible = conversation.messages.filter((message) => !['1', '2', '3', '5'].includes(message.id));
  for (const message of visible) {
    for (const block of message.blocks.filter((item) => item.type === 'text' && item.text.trim())) {
      assert.equal(text.includes(block.text.trim()), false, 'an alternate branch leaked into the draft');
    }
  }
});

test('leaves reasoning and sources out unless asked', () => {
  const [conversation] = parseDeepSeekExport(fixture);
  const plain = buildDraft([conversation]).text;
  assert.doesNotMatch(plain, /\(Reasoning\)/);
  assert.doesNotMatch(plain, /\(Sources\)/);
  const full = buildDraft([conversation], { reasoning: true, sources: true }).text;
  assert.match(full, /\(Reasoning\)/);
  assert.match(full, /\(Sources\)/);
});

test('fits the chat input limit, keeping the first and latest turns', () => {
  const long = synthetic('long', 2000, 300);
  const { text, omitted } = buildDraft([long]);
  assert.ok(text.length <= APPEND_LIMIT);
  assert.ok(omitted > 0);
  assert.match(text, /turn 0 /);
  assert.match(text, /turn 1999 /);
  assert.match(text, new RegExp(`\\[… ${omitted} earlier message\\(s\\) omitted`));
});

test('shares the budget across several conversations and keeps short ones whole', () => {
  const short = synthetic('short', 4, 50);
  const long = synthetic('long', 1000, 300);
  const { text } = buildDraft([long, short], { limit: 20_000 });
  assert.ok(text.length <= 20_000);
  assert.match(text, /## Conversation short[\s\S]*turn 3 /);
  assert.match(text, /## Conversation long/);
  assert.ok(text.indexOf('## Conversation long') < text.indexOf('## Conversation short'), 'selection order is kept');
});

test('keeps the end of a single turn longer than the whole budget', () => {
  const huge = synthetic('huge', 1, 50_000);
  const { text } = buildDraft([huge], { limit: 5_000 });
  assert.ok(text.length <= 5_000);
  assert.match(text, /x…?$/);
});
