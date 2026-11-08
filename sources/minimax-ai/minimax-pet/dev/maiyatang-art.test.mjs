import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createPetStore } from '../miniapp/node/pet-store.mjs';

const clientRoot = fileURLToPath(new URL('../miniapp/client/', import.meta.url));
const petJson = fileURLToPath(new URL('../miniapp/client/pets/octopus-girl-v2/pet.json', import.meta.url));

test('Maiyatang is discovered as a bundled v2 pet alongside the default robot', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'maiyatang-catalog-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const diagnostics = [];
  const logger = { debug() {}, info() {}, warn(...args) { diagnostics.push(args); }, error(...args) { diagnostics.push(args); } };
  const pets = await createPetStore({ clientRoot, dataDir, logger }).listPets();
  assert.deepEqual(pets.find((pet) => pet.id === 'octopus-girl-v2'), {
    id: 'octopus-girl-v2',
    displayName: '麦芽糖',
    description: '你好呀，我是麦芽糖！头发卷卷，心情甜甜。喜欢陪你发呆、认真工作，也喜欢为每一个小小的进展开心。累了就歇一会儿吧，我会乖乖等你回来。',
    version: 2,
    source: 'bundled',
    petJsonUrl: '/assets/pets/octopus-girl-v2/pet.json',
  });
  assert.ok(pets.some((pet) => pet.id === 'minimax-original' && pet.source === 'bundled'));
  assert.deepEqual(diagnostics, []);
});

test('the shipped Maiyatang atlas passes full PNG and 73-cell artwork validation', () => {
  const validator = fileURLToPath(new URL('../skills/minimax-pet/scripts/validate-art.mjs', import.meta.url));
  const result = JSON.parse(execFileSync(process.execPath, [validator, petJson], { encoding: 'utf8' }));
  assert.deepEqual(result, { ok: true, version: 2, width: 1536, height: 2288, frames: 73, warnings: [] });
});
