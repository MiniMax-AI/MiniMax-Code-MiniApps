import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as disk from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createPetStore } from '../miniapp/node/pet-store.mjs';
import { createPetAtlas } from '../scripts/generate-pet-art.mjs';

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../miniapp/client');
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const sprite = createPetAtlas({ version: 1 });
const petId = 'user-pet';
const backupName = `replace-${petId}-1720000000000-abcdef123456`;

function payload(id = petId, displayName = 'Old pet', replace = false) {
  return {
    petJson: { id, displayName, spritesheetPath: 'spritesheet.png' },
    spritesheet: { fileName: 'spritesheet.png', base64: sprite.toString('base64') },
    replace,
  };
}
function store(dataDir) { return createPetStore({ clientRoot, dataDir, logger }); }
async function directory(t) {
  const path = await disk.mkdtemp(join(tmpdir(), 'pet-store-recovery-'));
  t.after(() => disk.rm(path, { recursive: true, force: true }));
  return path;
}
async function seed(t) {
  const dataDir = await directory(t);
  await store(dataDir).importPet(payload());
  return dataDir;
}
async function assertOriginal(dataDir) {
  assert.equal(JSON.parse(await disk.readFile(join(dataDir, 'pets', petId, 'pet.json'), 'utf8')).displayName, 'Old pet');
  assert.deepEqual(await disk.readFile(join(dataDir, 'pets', petId, 'spritesheet.png')), sprite);
}
function child(mode, dataDir, expectedStatus) {
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'fault-child', mode, dataDir], { encoding: 'utf8' });
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
}

if (process.argv[2] === 'fault-child') {
  const mode = process.argv[3];
  const dataDir = process.argv[4];
  const originalRename = fs.promises.rename;
  fs.promises.rename = async (source, destination) => {
    const newFinalMove = source.startsWith(join(dataDir, '.staging', 'import-')) && destination === join(dataDir, 'pets', petId);
    if (['rename-error', 'rollback-error'].includes(mode) && newFinalMove) throw new Error('injected replacement failure');
    if (mode === 'rollback-error' && source.startsWith(join(dataDir, '.staging', 'replace-'))) throw new Error('injected rollback failure');
    await originalRename(source, destination);
    if (mode === 'old-moved' && destination.startsWith(join(dataDir, '.staging', 'replace-'))) process.exit(77);
    if (mode === 'new-committed' && newFinalMove) process.exit(78);
    if (mode === 'delete-moved' && destination.startsWith(join(dataDir, '.staging', 'delete-'))) process.exit(79);
  };
  syncBuiltinESMExports();
  if (mode === 'delete-moved') {
    await store(dataDir).deletePet(petId);
    throw new Error('delete crash point was not reached');
  }
  if (['rename-error', 'rollback-error'].includes(mode)) {
    await assert.rejects(store(dataDir).importPet(payload(petId, 'New pet', true)), /injected .* failure/);
    process.exit(0);
  }
  await store(dataDir).importPet(payload(petId, 'New pet', true));
  throw new Error('replacement crash point was not reached');
} else {
  test('fresh catalog read restores the original pet after process exit between replacement renames', async (t) => {
    const dataDir = await seed(t);
    child('old-moved', dataDir, 77);
    const restarted = store(dataDir);
    assert.equal((await restarted.listPets()).find((pet) => pet.id === petId).displayName, 'Old pet');
    await assertOriginal(dataDir);
    assert.deepEqual(await disk.readdir(join(dataDir, '.staging')), []);
    await restarted.importPet(payload('other-pet'));
    await assertOriginal(dataDir);
  });

  test('direct asset read also recovers before resolving the imported sprite', async (t) => {
    const dataDir = await seed(t);
    child('old-moved', dataDir, 77);
    const result = await store(dataDir).resolveImportedFile(petId, 'spritesheet.png');
    assert.deepEqual(await disk.readFile(result.path), sprite);
    await assertOriginal(dataDir);
  });

  test('first write recovers before checking conflicts, and never sweeps the only original copy', async (t) => {
    const dataDir = await seed(t);
    child('old-moved', dataDir, 77);
    const restarted = store(dataDir);
    await assert.rejects(restarted.importPet(payload()), { code: 'pet_exists' });
    await restarted.importPet(payload('other-pet'));
    await assertOriginal(dataDir);
  });

  test('process exit after new pet commit keeps the new pet and clears only the old replacement backup', async (t) => {
    const dataDir = await seed(t);
    child('new-committed', dataDir, 78);
    assert.equal((await store(dataDir).listPets()).find((pet) => pet.id === petId).displayName, 'New pet');
    assert.deepEqual(await disk.readdir(join(dataDir, '.staging')), []);
  });

  test('an intentional delete is completed after restart and is never resurrected', async (t) => {
    const dataDir = await seed(t);
    child('delete-moved', dataDir, 79);
    assert.equal((await store(dataDir).listPets()).some((pet) => pet.id === petId), false);
    assert.deepEqual(await disk.readdir(join(dataDir, '.staging')), []);
  });

  test('ordinary replacement failure rolls back immediately without discarding the original bytes', async (t) => {
    const dataDir = await seed(t);
    child('rename-error', dataDir, 0);
    await assertOriginal(dataDir);
    assert.deepEqual(await disk.readdir(join(dataDir, '.staging')), []);
  });

  test('failed rollback leaves a named backup for retry rather than swallowing the recovery failure', async (t) => {
    const dataDir = await seed(t);
    child('rollback-error', dataDir, 0);
    assert.equal((await disk.readdir(join(dataDir, '.staging'))).filter((name) => name.startsWith('replace-')).length, 1);
    await store(dataDir).listPets();
    await assertOriginal(dataDir);
  });

  test('invalid committed data blocks recovery and writes while retaining the full replacement backup', async (t) => {
    const dataDir = await seed(t);
    const backup = join(dataDir, '.staging', backupName);
    await disk.rename(join(dataDir, 'pets', petId), backup);
    await disk.mkdir(join(dataDir, 'pets', petId));
    await disk.writeFile(join(dataDir, 'pets', petId, 'pet.json'), '{broken');
    const restarted = store(dataDir);
    await assert.rejects(restarted.listPets());
    await assert.rejects(restarted.importPet(payload('other-pet')));
    await assert.rejects(restarted.deletePet(petId));
    assert.deepEqual(await disk.readFile(join(backup, 'spritesheet.png')), sprite);
    await disk.rm(join(dataDir, 'pets', petId), { recursive: true });
    await restarted.listPets();
    await assertOriginal(dataDir);
  });

  test('replacement recovery rejects a symlink backup without reading or modifying its target', async (t) => {
    const dataDir = await directory(t);
    const outside = await seed(t);
    await disk.mkdir(join(dataDir, '.staging'));
    await disk.symlink(join(outside, 'pets', petId), join(dataDir, '.staging', backupName));
    await assert.rejects(store(dataDir).listPets(), { code: 'pet_recovery_failed' });
    await assertOriginal(outside);
    assert.equal((await disk.lstat(join(dataDir, '.staging', backupName))).isSymbolicLink(), true);
  });

  test('an unreadable replacement backup is retained and blocks cleanup until recovery can succeed', async (t) => {
    const dataDir = await seed(t);
    const backup = join(dataDir, '.staging', backupName);
    await disk.rename(join(dataDir, 'pets', petId), backup);
    const originalJson = await disk.readFile(join(backup, 'pet.json'));
    await disk.writeFile(join(backup, 'pet.json'), '{broken');
    const restarted = store(dataDir);
    await assert.rejects(restarted.listPets());
    await assert.rejects(restarted.importPet(payload('other-pet')));
    assert.deepEqual(await disk.readFile(join(backup, 'spritesheet.png')), sprite);
    await disk.writeFile(join(backup, 'pet.json'), originalJson);
    await restarted.listPets();
    await assertOriginal(dataDir);
  });

  test('a symlinked staging root cannot redirect cleanup into another directory', async (t) => {
    const dataDir = await directory(t);
    const outside = await directory(t);
    await disk.writeFile(join(outside, 'keep.txt'), 'keep');
    await disk.symlink(outside, join(dataDir, '.staging'));
    await assert.rejects(store(dataDir).listPets(), { code: 'pet_storage_unreadable' });
    await assert.rejects(store(dataDir).importPet(payload()), { code: 'pet_storage_unreadable' });
    assert.equal(await disk.readFile(join(outside, 'keep.txt'), 'utf8'), 'keep');
  });

  test('ambiguous legacy trash remains available without reviving an intentional deletion', async (t) => {
    const dataDir = await seed(t);
    const legacy = join(dataDir, '.staging', 'trash-1720000000000-abcdef123456');
    await disk.rename(join(dataDir, 'pets', petId), legacy);
    const restarted = store(dataDir);
    assert.equal((await restarted.listPets()).some((pet) => pet.id === petId), false);
    await restarted.importPet(payload('other-pet'));
    assert.deepEqual(await disk.readFile(join(legacy, 'spritesheet.png')), sprite);
    assert.equal((await restarted.listPets()).some((pet) => pet.id === petId), false);
  });

  test('queued reads cannot recover or clean a replacement that is still in flight', async (t) => {
    const dataDir = await seed(t);
    const current = store(dataDir);
    const [, pets, asset] = await Promise.all([
      current.importPet(payload(petId, 'New pet', true)),
      current.listPets(),
      current.resolveImportedFile(petId, 'pet.json'),
    ]);
    assert.equal(pets.find((pet) => pet.id === petId).displayName, 'New pet');
    assert.equal(JSON.parse(await disk.readFile(asset.path, 'utf8')).displayName, 'New pet');
    assert.deepEqual(await disk.readdir(join(dataDir, '.staging')), []);
  });
}
