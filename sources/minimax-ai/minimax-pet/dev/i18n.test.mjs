import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import {
  LANGUAGES, MESSAGES, getLanguage, localeFor, onLanguageChange, resolveLanguage, setLanguage, t, translate,
} from '../miniapp/client/i18n.mjs';

const clientUrl = new URL('../miniapp/client/', import.meta.url);

async function usedKeys() {
  const keys = new Set();
  const files = (await readdir(clientUrl)).filter((name) => /\.(?:mjs|js|html)$/u.test(name));
  for (const name of files) {
    const text = await readFile(new URL(name, clientUrl), 'utf8');
    for (const match of text.matchAll(/\bt\('([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+)'/gu)) keys.add(match[1]);
    for (const match of text.matchAll(/data-i18n="([^"]+)"/gu)) keys.add(match[1]);
    for (const match of text.matchAll(/data-i18n-attr="[^"]*?:([^",]+)/gu)) keys.add(match[1].trim());
  }
  // Keys referenced indirectly through a lookup table.
  const petApp = await readFile(new URL('pet-app.js', clientUrl), 'utf8');
  for (const match of petApp.matchAll(/(?:STATUS_KEYS|STATUS_TEXT_KEYS|CONNECTION)[^=]*=\s*\{([^}]+)\}/gu)) {
    for (const value of match[1].matchAll(/'([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+)'/gu)) keys.add(value[1]);
  }
  for (const match of petApp.matchAll(/'(settings\.connected|settings\.disconnected|desk\.statusRunning)'/gu)) keys.add(match[1]);
  return keys;
}

test('every key the client uses exists in every language', async () => {
  const keys = await usedKeys();
  assert.ok(keys.size > 150, `expected the scan to find the copy, found ${keys.size}`);
  for (const language of LANGUAGES) {
    const missing = [...keys].filter((key) => !Object.hasOwn(MESSAGES[language], key));
    assert.deepEqual(missing, [], `missing ${language} copy`);
  }
});

test('both languages carry the same keys and none is empty', () => {
  const [first, second] = LANGUAGES;
  assert.deepEqual(Object.keys(MESSAGES[first]).sort(), Object.keys(MESSAGES[second]).sort());
  for (const language of LANGUAGES) {
    for (const [key, value] of Object.entries(MESSAGES[language])) {
      assert.equal(typeof value, 'string', `${language} ${key}`);
      assert.ok(value.trim().length > 0, `${language} ${key} is empty`);
    }
  }
});

test('keys follow domain.context.name and keep interpolations in both languages', () => {
  for (const [key, value] of Object.entries(MESSAGES['zh-Hans'])) {
    assert.match(key, /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/u, key);
    const placeholders = [...value.matchAll(/\{\{(\w+)\}\}/gu)].map((match) => match[1]).sort();
    const english = [...MESSAGES.en[key].matchAll(/\{\{(\w+)\}\}/gu)].map((match) => match[1]).sort();
    assert.deepEqual(english, placeholders, `${key} placeholders differ between languages`);
  }
});

test('interpolation keeps unknown placeholders visible instead of printing undefined', () => {
  assert.equal(t('tasks.openFailed', { code: 'busy' }, 'zh-Hans'), '没能打开对话（busy）。');
  assert.equal(t('tasks.openFailed', { code: 'busy' }, 'en'), 'Could not open the conversation (busy).');
  assert.equal(t('tasks.openFailed', {}, 'en'), 'Could not open the conversation ({{code}}).');
  assert.equal(t('tasks.openFailed', { code: 'x' }), t('tasks.openFailed', { code: 'x' }, getLanguage()));
});

test('a missing key falls back to the key itself rather than blank text', () => {
  assert.equal(t('no.such.key', undefined, 'en'), 'no.such.key');
});

test('language resolution maps locale tags and honours an explicit preference', () => {
  assert.equal(resolveLanguage('en'), 'en');
  assert.equal(resolveLanguage('en-GB'), 'en');
  assert.equal(resolveLanguage('EN-us'), 'en');
  assert.equal(resolveLanguage('zh-Hans'), 'zh-Hans');
  assert.equal(resolveLanguage('zh-CN'), 'zh-Hans');
  assert.equal(resolveLanguage('ja'), 'zh-Hans');
  assert.equal(resolveLanguage(undefined), 'zh-Hans');
  assert.equal(resolveLanguage('en', 'zh-Hans'), 'zh-Hans');
  assert.equal(resolveLanguage('zh-CN', 'en'), 'en');
  assert.equal(localeFor('en'), 'en-US');
  assert.equal(localeFor('zh-Hans'), 'zh-CN');
});

test('setLanguage notifies once per change and disposes listeners', () => {
  const seen = [];
  const off = onLanguageChange((language) => seen.push(language));
  try {
    setLanguage('zh-Hans');
    setLanguage('zh-CN');
    setLanguage('en');
    setLanguage('en-US');
    setLanguage('zh-Hans');
    assert.deepEqual(seen, ['en', 'zh-Hans']);
    assert.equal(getLanguage(), 'zh-Hans');
  } finally {
    off();
  }
  setLanguage('en');
  assert.deepEqual(seen, ['en', 'zh-Hans'], 'a disposed listener stops receiving changes');
  setLanguage('zh-Hans');
  assert.equal(translate('status.needsAnswer'), MESSAGES['zh-Hans']['status.needsAnswer']);
});
