// @ts-check
// The words a failed turn shows the user, and the keys behind them.
//
// A turn that died for a reason the plugin cannot read used to say "try again shortly": no
// cause, no next step, nothing the user could act on. The copy here replaces that with three
// different sentences for three different situations — a code the plugin knows, an error the
// plugin raised itself, and a failure whose cause only the Host knows — so the user can tell a
// busy model from a session that never started.
//
// The page localises the codes it knows from its own dictionary, so a code the server and the
// page spell differently is a sentence the user reads twice, in two languages, with two
// meanings. The dictionaries are checked against each other here rather than by eye.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import SERVER from '../miniapp/node/strings.mjs';
import CLIENT from '../miniapp/client/strings-app.js';
import { t, setLocale } from '../miniapp/node/i18n.mjs';
import { describeAgentError, Engine, EngineError } from '../miniapp/node/engine.mjs';
import { MemoryError, MemoryStore } from '../miniapp/node/memory.mjs';
import { Store } from '../miniapp/node/store.mjs';

/** The sentence for a turn whose Agent never started. */
const UNAVAILABLE = 'agentError.AGENT_UNAVAILABLE';
/** The sentence for a failure whose cause the plugin cannot read. */
const HOST_ERROR = 'agentError.hostError';
/** The sentence for a model that cannot be used; it names a setting, so it is not a fallback. */
const MODEL_UNAVAILABLE = 'agentError.MODEL_UNAVAILABLE';

/** The model sentence, written out: it may not drift while the other copy is being changed. */
const MODEL_TEXT = {
  zh: '这个 Bot 设置的模型现在用不了（可能已停用或下线），请在 Bot 设置里换一个模型或改回默认',
  en: "This Bot's model can't be used right now (it may have been disabled or removed). Pick another model, or go back to the default, in the Bot's settings",
};

/** Words that belong to the model sentence and would mislead a reader of the other one. */
const MODEL_WORDS = ['模型', 'model', 'settings', 'default', 'disabled', '停用', '下线'];

/** The codes the plugin knows by name, in the order the page shows them. */
const KNOWN_CODES = [
  'BUSY',
  'NOT_PERMITTED',
  'SESSION_NOT_FOUND',
  'INVALID_ARGUMENTS',
  'AGENT_OUTCOME_UNKNOWN',
  'REQUEST_CANCELLED',
];

/**
 * A turn that fails once, with the Agent replaced by one that throws.
 * @param {import('node:test').TestContext} ctx
 * @param {unknown} thrown
 */
async function failedTurn(ctx, thrown) {
  const dir = await mkdtemp(join(tmpdir(), 'bot-agent-error-'));
  const store = new Store(dir);
  const memory = new MemoryStore(dir);
  await store.init();
  await memory.init();
  const engine = new Engine({
    store,
    memory,
    logger: { warn() {} },
    broadcast() {},
    retryDelaysMs: [],
  });
  engine.agent = {
    async run() {
      throw thrown;
    },
  };
  ctx.after(async () => {
    engine.dispose();
    await store.writeChain;
    await rm(dir, { recursive: true, force: true });
  });
  const bot = store.state.bots[0];
  const chatId = `bot:${bot.id}`;
  await engine.runBotTurn({ bot, chatId, text: 'Hello', kind: 'private' });
  const messages = await store.getMessages(chatId);
  return messages.at(-1);
}
test('the page and the server spell the unavailable sentence the same way', () => {
  assert.equal(SERVER.zh[UNAVAILABLE], CLIENT.zh[UNAVAILABLE]);
  assert.equal(SERVER.en[UNAVAILABLE], CLIENT.en[UNAVAILABLE]);
});

test('every dictionary carries the same keys in both languages', () => {
  assert.deepEqual(Object.keys(SERVER.zh).sort(), Object.keys(SERVER.en).sort());
  assert.deepEqual(Object.keys(CLIENT.zh).sort(), Object.keys(CLIENT.en).sort());
});

test('the page reads no error key the server does not have', () => {
  const server = new Set(Object.keys(SERVER.zh).filter((key) => key.startsWith('agentError.')));
  const page = Object.keys(CLIENT.zh).filter((key) => key.startsWith('agentError.'));
  assert.ok(page.length > 0);
  for (const key of page) assert.ok(server.has(key), `the page has ${key} and the server does not`);
});

test('the server has a sentence for a cause it cannot read, in both languages', () => {
  for (const lang of ['zh', 'en']) {
    const text = SERVER[lang][HOST_ERROR];
    assert.ok(typeof text === 'string' && text.length > 0, `${lang} has no ${HOST_ERROR}`);
    assert.notEqual(text, HOST_ERROR);
  }
});

test('the two new sentences differ between the two languages', () => {
  assert.notEqual(SERVER.zh[UNAVAILABLE], SERVER.en[UNAVAILABLE]);
  assert.notEqual(SERVER.zh[HOST_ERROR], SERVER.en[HOST_ERROR]);
});

test('the unavailable sentence does not borrow the model sentence', () => {
  for (const lang of ['zh', 'en']) {
    assert.notEqual(SERVER[lang][UNAVAILABLE], SERVER[lang][MODEL_UNAVAILABLE]);
    const lower = SERVER[lang][UNAVAILABLE].toLowerCase();
    for (const word of MODEL_WORDS) {
      assert.ok(!lower.includes(word.toLowerCase()), `the ${lang} unavailable sentence mentions ${word}`);
    }
  }
});

test('every new sentence stays short, alone and behind the failure prefix', () => {
  for (const lang of ['zh', 'en']) {
    for (const key of [UNAVAILABLE, HOST_ERROR]) {
      const text = SERVER[lang][key];
      assert.ok(text.length <= 120, `${lang} ${key} is ${text.length} characters`);
      const shown = t('notice.failed', { error: text }, lang);
      assert.ok(shown.length <= 120, `${lang} ${key} under notice.failed is ${shown.length} characters`);
    }
  }
});

test('the model sentence is the one that was there before', () => {
  assert.equal(SERVER.zh[MODEL_UNAVAILABLE], MODEL_TEXT.zh);
  assert.equal(SERVER.en[MODEL_UNAVAILABLE], MODEL_TEXT.en);
});

test('a Host error with a cause the plugin cannot read is described without its text', () => {
  for (const lang of ['zh', 'en']) {
    setLocale(lang);
    const text = describeAgentError({ code: 'SessionServiceError', message: 'SessionServiceError: svc-abc123 bind failed' });
    assert.equal(text, t(HOST_ERROR));
    for (const leak of ['svc-abc123', 'SessionServiceError', 'bind']) {
      assert.ok(!text.includes(leak), `the sentence leaks ${leak}`);
    }
  }
});

test('a failure that is not an error at all is described without its text', () => {
  for (const lang of ['zh', 'en']) {
    setLocale(lang);
    for (const thrown of [null, undefined, 'boom', {}]) {
      const text = describeAgentError(thrown);
      assert.equal(text, t(HOST_ERROR));
      for (const leak of ['null', 'undefined', 'boom']) {
        assert.ok(!text.includes(leak), `the sentence leaks ${leak}`);
      }
    }
  }
});

test("the plugin's own errors keep the message they were built with", () => {
  for (const lang of ['zh', 'en']) {
    setLocale(lang);
    const expected = t('err.noAgentSupport', undefined, lang);
    assert.equal(describeAgentError(new EngineError('agent_unavailable', expected)), expected);
    assert.equal(describeAgentError(new MemoryError(expected)), expected);
  }
});

test('a known code keeps its own sentence in both languages', () => {
  for (const lang of ['zh', 'en']) {
    setLocale(lang);
    for (const code of KNOWN_CODES) {
      const key = `agentError.${code}`;
      assert.equal(describeAgentError({ code }), t(key));
    }
  }
});

test('a turn whose Agent never started shows the unavailable sentence and hides the cause', async (ctx) => {
  setLocale('en');
  const message = await failedTurn(ctx, { code: 'AGENT_UNAVAILABLE', message: 'SessionServiceError: svc-abc123 bind failed' });
  assert.equal(message.errorCode, 'AGENT_UNAVAILABLE');
  assert.equal(message.error, t('agentError.AGENT_UNAVAILABLE'));
  assert.ok(!message.error.includes('svc-abc123'), 'the error keeps the cause');
  assert.ok(!String(message.text ?? '').includes('svc-abc123'), 'the text keeps the cause');
});

test('a turn that failed for a reason the plugin cannot name shows the host sentence', async (ctx) => {
  setLocale('en');
  const message = await failedTurn(ctx, { code: 'SessionServiceError' });
  assert.equal(message.errorCode, 'SessionServiceError');
  assert.equal(message.error, t(HOST_ERROR));
  assert.ok(!message.error.includes('SessionServiceError'), 'the error keeps the code');
});
