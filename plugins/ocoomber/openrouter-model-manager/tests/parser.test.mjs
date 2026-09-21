// Parser tests for the Model Manager mini app.
// These test the exported pure functions from miniapp/node/server.mjs —
// they never touch the real config.yaml or start the HTTP server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  splitConfigText,
  joinConfigText,
  parseProviders,
  currentEnabled,
  setEnabledOnLine,
} from '../miniapp/node/server.mjs';

// Structure mirrors a real config: top-level `provider:` (built-in models,
// no `enabled:` flags) and a nested `custom_provider` block with toggleable
// models. Note the model id containing ':' — a common OpenRouter id form.
const SAMPLE = [
  'provider:',
  '  name: MiniMax',
  '  models:',
  '    abab6.5s-chat:',
  '      name: abab6.5s-chat',
  '',
  'custom_provider:',
  '  openrouter:',
  '    models:',
  '      deepseek/deepseek-chat-v3.1:free:',
  '        enabled: true',
  '        name: DeepSeek V3.1 (free)',
  '        context: 163840',
  '      openai/gpt-4o:',
  '        enabled: false',
  '        name: GPT-4o',
  '        context: 128000',
  '#      commented-out/model:',
  '      meta-llama/llama-3.1-8b-instruct:',
  '        name: Llama 3.1 8B',
].join('\n');

test('splitConfigText remembers each line terminator (CRLF/LF/CR mixed)', () => {
  const text = 'a: 1\r\nb: 2\nc: 3\r# comment\nd: 4';
  const parsed = splitConfigText(text);
  assert.deepEqual(parsed.lines, ['a: 1', 'b: 2', 'c: 3', '# comment', 'd: 4']);
  assert.deepEqual(parsed.terms, ['\r\n', '\n', '\r', '\n', '']);
  assert.equal(joinConfigText(parsed), text);
});

test('joinConfigText restores exact text including a trailing newline', () => {
  const text = 'enabled: true\nenabled: false\n';
  const parsed = splitConfigText(text);
  assert.deepEqual(parsed.terms, ['\n', '\n', '']);
  assert.equal(joinConfigText(parsed), text);
});

test('parseProviders: toggles offered only for blocks with enabled: flags', () => {
  const { lines } = splitConfigText(SAMPLE);
  const providers = parseProviders(lines);
  assert.equal(providers.length, 1); // `provider:` has no enabled flags → skipped
  assert.equal(providers[0].label, 'custom_provider / openrouter');
  assert.deepEqual(providers[0].path, ['custom_provider', 'openrouter']);
});

test('parseProviders: keeps model ids that contain a colon, skips comments', () => {
  const { lines } = splitConfigText(SAMPLE);
  const providers = parseProviders(lines);
  const ids = providers[0].models.map((m) => m.id);
  assert.ok(ids.includes('deepseek/deepseek-chat-v3.1:free'));
  assert.ok(!ids.includes('commented-out/model'));
  assert.equal(ids.length, 2); // llama has no enabled: line → not toggleable
});

test('parseProviders: reports enabled state from the file', () => {
  const { lines } = splitConfigText(SAMPLE);
  const [provider] = parseProviders(lines);
  const deepseek = provider.models.find((m) => m.id === 'deepseek/deepseek-chat-v3.1:free');
  const gpt4o = provider.models.find((m) => m.id === 'openai/gpt-4o');
  assert.equal(deepseek.enabled, true);
  assert.equal(gpt4o.enabled, false);
});

test('currentEnabled reads the flag; setEnabledOnLine flips only that flag', () => {
  const line = '        enabled:   false   # keep comment';
  assert.equal(currentEnabled(line), 'false');
  const next = setEnabledOnLine(line, true);
  assert.equal(next, '        enabled:   true   # keep comment');
  assert.equal(currentEnabled(next), 'true');
});

test('multi-provider toggle: ids stay valid across two providers in one write', () => {
  // Mirrors setModelsEnabledMulti's invariant: indices parsed from the
  // original text remain valid after only-modifying enabled: lines, so
  // we can apply changes to provider A and provider B without re-parsing.
  const { lines } = splitConfigText(SAMPLE);
  const providers = parseProviders(lines);
  // `provider:` is not manageable; only the custom_provider block is.
  assert.equal(providers.length, 1);
  const [or] = providers;
  const targets = ['deepseek/deepseek-chat-v3.1:free', 'openai/gpt-4o'];
  const before = targets.map((id) => currentEnabled(lines[or.models.find((m) => m.id === id).enabledIndex]));
  assert.deepEqual(before, ['true', 'false']);
  for (const id of targets) {
    const idx = or.models.find((m) => m.id === id).enabledIndex;
    lines[idx] = setEnabledOnLine(lines[idx], true);
  }
  const after = targets.map((id) => currentEnabled(lines[or.models.find((m) => m.id === id).enabledIndex]));
  assert.deepEqual(after, ['true', 'true']);
  // Other provider models must not have been touched.
  assert.equal(lines.length, SAMPLE.split('\n').length);
});
