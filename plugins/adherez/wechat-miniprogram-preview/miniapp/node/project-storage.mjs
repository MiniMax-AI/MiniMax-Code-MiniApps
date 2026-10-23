import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const MAX_STORAGE_BYTES = 1024 * 1024;
const MAX_DEPTH = 64;
const MAX_NODES = 100000;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export class ProjectStorageError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ProjectStorageError';
    this.code = code;
    if (details) this.details = details;
    if (details?.currentRevision !== undefined) this.currentRevision = details.currentRevision;
  }
}

function encodeSnapshot(snapshot) {
  let nodes = 0;
  const ancestors = new Set();
  const invalid = () => { throw new ProjectStorageError('STORAGE_INVALID_VALUE', 'Storage must contain only JSON data without unsafe keys, cycles, or excessive nesting.'); };
  const visit = (value, depth) => {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) invalid();
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number') { if (!Number.isFinite(value)) invalid(); return; }
    if (typeof value !== 'object' || ancestors.has(value)) invalid();
    const isArray = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) invalid();
    if (Object.getOwnPropertySymbols(value).length || (isArray && value.length > MAX_NODES)) invalid();
    ancestors.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors);
    if (isArray && keys.length !== value.length + 1) invalid();
    for (const key of keys) {
      if (isArray && key === 'length') continue;
      const descriptor = descriptors[key];
      if (FORBIDDEN_KEYS.has(key) || !descriptor.enumerable || !('value' in descriptor)) invalid();
      if (isArray && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) invalid();
      visit(descriptor.value, depth + 1);
    }
    ancestors.delete(value);
  };
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) invalid();
  visit(snapshot, 0);
  const encoded = JSON.stringify(snapshot);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_STORAGE_BYTES) {
    throw new ProjectStorageError('STORAGE_QUOTA_EXCEEDED', 'Preview storage is limited to 1 MiB per project.');
  }
  return encoded;
}

async function projectKey(candidate) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate) || candidate.includes('\0')) {
    throw new ProjectStorageError('STORAGE_INVALID_PROJECT', 'Storage requires an authorized absolute project directory.');
  }
  try {
    const resolved = await realpath(candidate);
    if (!(await stat(resolved)).isDirectory()) throw new Error('not a directory');
    return createHash('sha256').update(resolved).digest('hex');
  } catch {
    throw new ProjectStorageError('STORAGE_INVALID_PROJECT', 'The storage project directory is unavailable.');
  }
}

async function inspectFile(file) {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new ProjectStorageError('STORAGE_STATE_INVALID', 'The saved preview storage is not a regular file.');
    }
    return info;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function createProjectStorage(dataDir) {
  if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir) || dataDir.includes('\0')) {
    throw new ProjectStorageError('STORAGE_INVALID_DIRECTORY', 'Storage requires a persistent data directory.');
  }
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const root = path.join(await realpath(dataDir), 'project-storage');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const rootIdentity = await lstat(root);
  if (!rootIdentity.isDirectory() || rootIdentity.isSymbolicLink() || await realpath(root) !== root) {
    throw new ProjectStorageError('STORAGE_STATE_INVALID', 'The preview storage directory must not be a symbolic link.');
  }
  // Reads share the queue so a reload cannot race an already accepted snapshot write.
  let pending = Promise.resolve();
  const serialize = (operation) => {
    const result = pending.then(async () => {
      try {
        const current = await lstat(root);
        if (!current.isDirectory() || current.isSymbolicLink() || await realpath(root) !== root
          || current.dev !== rootIdentity.dev || current.ino !== rootIdentity.ino) {
          throw new ProjectStorageError('STORAGE_STATE_INVALID', 'The preview storage directory changed.');
        }
        return await operation();
      } catch (error) {
        if (error instanceof ProjectStorageError) throw error;
        throw new ProjectStorageError('STORAGE_IO_FAILED', 'Preview storage could not be read or saved.');
      }
    });
    pending = result.catch(() => undefined);
    return result;
  };
  const filename = async (projectPath) => path.join(root, `${await projectKey(projectPath)}.json`);

  const read = (projectPath) => serialize(async () => {
    const file = await filename(projectPath);
    const info = await inspectFile(file);
    if (!info) return {};
    if (info.size > MAX_STORAGE_BYTES) throw new ProjectStorageError('STORAGE_STATE_INVALID', 'Saved preview storage exceeds its quota.');
    let handle;
    try {
      handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const openedInfo = await handle.stat();
      if (!openedInfo.isFile() || openedInfo.dev !== info.dev || openedInfo.ino !== info.ino) throw new Error('changed');
      const buffer = Buffer.alloc(MAX_STORAGE_BYTES + 1);
      let total = 0;
      while (total < buffer.length) {
        const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
        if (!bytesRead) break;
        total += bytesRead;
      }
      if (total > MAX_STORAGE_BYTES) throw new Error('oversized');
      const decoded = JSON.parse(buffer.subarray(0, total).toString('utf8'));
      return JSON.parse(encodeSnapshot(decoded));
    } catch {
      throw new ProjectStorageError('STORAGE_STATE_INVALID', 'Saved preview storage is invalid. Clear it explicitly to start again.');
    } finally {
      await handle?.close();
    }
  });

  const write = (projectPath, snapshot) => {
    let encoded;
    try { encoded = encodeSnapshot(snapshot); } catch (error) { return Promise.reject(error); }
    return serialize(async () => {
      const file = await filename(projectPath);
      await inspectFile(file);
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, encoded, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        await rename(temporary, file);
        return JSON.parse(encoded);
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
    });
  };

  const clear = (projectPath) => serialize(async () => {
    const file = await filename(projectPath);
    if (await inspectFile(file)) await unlink(file);
    return {};
  });
  return { read, write, clear };
}

export const MAX_STORAGE_OPERATIONS = 128;
export const MAX_STORAGE_METADATA_BYTES = 128 * 1024;
export const MAX_STORAGE_OPERATION_VALUE_BYTES = 8 * 1024;
const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const clone = (value) => JSON.parse(JSON.stringify(value));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const revisionValid = (value) => Number.isSafeInteger(value) && value >= 0;

class TransactionCallbackError extends Error {
  constructor(cause) { super('Storage transaction callback failed.', { cause }); }
}

function canonicalJSON(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(',')}}`;
}

function operationValue(value) {
  const encoded = encodeSnapshot(value);
  if (Buffer.byteLength(encoded) > MAX_STORAGE_OPERATION_VALUE_BYTES) {
    throw new ProjectStorageError('STORAGE_INVALID_OPERATION', 'Storage operation metadata and results are limited to 8 KiB each.');
  }
  return JSON.parse(encoded);
}

function prepareCommit(request) {
  if (!request || !revisionValid(request.baseRevision) || typeof request.operationId !== 'string' || !OPERATION_ID.test(request.operationId)) {
    throw new ProjectStorageError('STORAGE_INVALID_OPERATION', 'Storage writes require a nonnegative safe revision and a bounded operation ID.');
  }
  const data = JSON.parse(encodeSnapshot(request.data));
  const metadata = request.metadata === undefined ? undefined : operationValue(request.metadata);
  const result = request.result === undefined ? undefined : operationValue(request.result);
  const fingerprint = hash(canonicalJSON({ baseRevision: request.baseRevision, data, ...(metadata === undefined ? {} : { metadata }) }));
  return { baseRevision: request.baseRevision, operationId: request.operationId, data, metadata, result, fingerprint };
}

function stateInvalid(message = 'Saved versioned storage is invalid. Recover it explicitly instead of overwriting it.') {
  return new ProjectStorageError('STORAGE_STATE_INVALID', message);
}

function encodeEnvelope(envelope) {
  encodeSnapshot(envelope.data);
  if (envelopeMetadataBytes(envelope) > MAX_STORAGE_METADATA_BYTES) {
    throw stateInvalid('Saved storage operation metadata exceeds its quota.');
  }
  return JSON.stringify(envelope);
}

const envelopeMetadataBytes = (envelope) => Buffer.byteLength(JSON.stringify({ ...envelope, data: null })) - 4;

function validateMigration(migration) {
  if (!migration || typeof migration !== 'object' || Array.isArray(migration)
    || !['v1', 'empty'].includes(migration.source) || !Number.isSafeInteger(migration.importedAt) || migration.importedAt < 0
    || Object.keys(migration).some((key) => !['source', 'importedAt', 'sourceDigest'].includes(key))
    || (migration.source === 'v1' ? typeof migration.sourceDigest !== 'string' || !DIGEST.test(migration.sourceDigest) : migration.sourceDigest !== undefined)) throw stateInvalid();
}

function validateEnvelope(envelope) {
  try {
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || envelope.schemaVersion !== 2
      || !revisionValid(envelope.revision) || !Array.isArray(envelope.operations) || envelope.operations.length > MAX_STORAGE_OPERATIONS
      || Object.keys(envelope).some((key) => !['schemaVersion', 'revision', 'data', 'operations', 'migration'].includes(key))) throw stateInvalid();
    validateMigration(envelope.migration);
    const ids = new Set();
    let previousRevision;
    for (const op of envelope.operations) {
      if (!op || typeof op !== 'object' || Array.isArray(op) || typeof op.operationId !== 'string' || !OPERATION_ID.test(op.operationId) || ids.has(op.operationId)
        || typeof op.fingerprint !== 'string' || !DIGEST.test(op.fingerprint) || !revisionValid(op.baseRevision) || !revisionValid(op.committedRevision)
        || typeof op.changed !== 'boolean' || op.committedRevision !== op.baseRevision + (op.changed ? 1 : 0)
        || op.committedRevision > envelope.revision || (previousRevision !== undefined && op.baseRevision !== previousRevision)
        || Object.keys(op).some((key) => !['operationId', 'baseRevision', 'fingerprint', 'committedRevision', 'changed', 'metadata', 'result'].includes(key))) throw stateInvalid();
      if (op.metadata !== undefined) operationValue(op.metadata);
      if (op.result !== undefined) operationValue(op.result);
      ids.add(op.operationId);
      previousRevision = op.committedRevision;
    }
    if ((previousRevision ?? 0) !== envelope.revision) throw stateInvalid();
    encodeEnvelope(envelope);
    return envelope;
  } catch { throw stateInvalid(); }
}

async function readJSONFile(file, maxBytes) {
  const info = await inspectFile(file);
  if (!info) return null;
  if (info.size > maxBytes) throw stateInvalid();
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino) throw stateInvalid();
    const bytes = Buffer.alloc(maxBytes + 1);
    let total = 0;
    while (total < bytes.length) {
      const { bytesRead } = await handle.read(bytes, total, bytes.length - total, total);
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total > maxBytes) throw stateInvalid();
    return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, total))), info };
  } catch { throw stateInvalid(); }
  finally { await handle?.close(); }
}

async function directoryIdentity(directory) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) {
    throw stateInvalid('The storage directory must be a stable real directory.');
  }
  return info;
}

async function assertIdentity(directory, expected) {
  const current = await directoryIdentity(directory);
  if (current.dev !== expected.dev || current.ino !== expected.ino) throw stateInvalid('The storage directory was replaced.');
}

// One service owns this store. The queue linearizes data commits and synchronous
// in-memory lease handoffs; it is not a cross-process lock or a disk-backed lease.
export async function createVersionedProjectStorage(dataDir) {
  if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir) || dataDir.includes('\0')) {
    throw new ProjectStorageError('STORAGE_INVALID_DIRECTORY', 'Storage requires a persistent data directory.');
  }
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const dataRoot = await realpath(dataDir);
  const dataIdentity = await directoryIdentity(dataRoot);
  const root = path.join(dataRoot, 'project-storage-v2');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const rootIdentity = await directoryIdentity(root);
  const legacyRoot = path.join(dataRoot, 'project-storage');
  let legacyIdentity;
  try { legacyIdentity = await directoryIdentity(legacyRoot); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const queues = new Map();
  let admissions = Promise.resolve();
  let inCallback = false;

  const assertRoots = async () => {
    if (await realpath(dataDir) !== dataRoot) throw stateInvalid('The persistent data directory changed.');
    await assertIdentity(dataRoot, dataIdentity);
    await assertIdentity(root, rootIdentity);
  };

  const atomicWrite = async (file, encoded, expectedInfo) => {
    await assertRoots();
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, encoded, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      const temporaryInfo = await inspectFile(temporary);
      if (!temporaryInfo) throw stateInvalid('The pending storage file disappeared.');
      await assertRoots();
      const actual = await inspectFile(file);
      if (expectedInfo ? !actual || actual.dev !== expectedInfo.dev || actual.ino !== expectedInfo.ino
        || actual.size !== expectedInfo.size || actual.mtimeMs !== expectedInfo.mtimeMs : actual) throw stateInvalid('Saved storage changed outside its commit queue.');
      await rename(temporary, file);
      return temporaryInfo;
    } finally { await unlink(temporary).catch(() => undefined); }
  };

  const ensureMigrationMarker = async (key, envelope) => {
    const file = path.join(root, `${key}.migration.json`);
    const expected = { schemaVersion: 2, initialRevision: 0, ...envelope.migration };
    const marker = await readJSONFile(file, 1024);
    if (marker) {
      if (canonicalJSON(marker.value) !== canonicalJSON(expected)) throw stateInvalid('The storage migration marker is invalid.');
    } else await atomicWrite(file, JSON.stringify(expected), null);
  };

  const load = async (key) => {
    const file = path.join(root, `${key}.json`);
    let saved = await readJSONFile(file, MAX_STORAGE_BYTES + MAX_STORAGE_METADATA_BYTES);
    if (saved) {
      validateEnvelope(saved.value);
    } else {
      if (await inspectFile(path.join(root, `${key}.migration.json`))) {
        throw stateInvalid('Migrated storage is missing. Restore v2 data instead of re-importing an outdated v1 snapshot.');
      }
      let legacy = null;
      try {
        if (legacyIdentity) await assertIdentity(legacyRoot, legacyIdentity);
        else legacyIdentity = await directoryIdentity(legacyRoot);
        legacy = await readJSONFile(path.join(legacyRoot, `${key}.json`), MAX_STORAGE_BYTES);
      } catch (error) {
        if (error.code !== 'ENOENT' || legacyIdentity) throw error;
      }
      let encoded;
      try { encoded = encodeSnapshot(legacy ? legacy.value : {}); } catch { throw stateInvalid('Legacy storage is invalid and was not migrated.'); }
      const migration = { source: legacy ? 'v1' : 'empty', importedAt: Date.now(), ...(legacy ? { sourceDigest: hash(encoded) } : {}) };
      const value = { schemaVersion: 2, revision: 0, data: JSON.parse(encoded), operations: [], migration };
      saved = { value, info: await atomicWrite(file, encodeEnvelope(value), null) };
    }
    // If a prior process stopped after the data rename, repair only the marker;
    // an existing v2 file is always authoritative and never re-imports v1.
    await ensureMigrationMarker(key, saved.value);
    return { file, ...saved };
  };

  const enqueue = (projectPath, operation) => {
    if (inCallback) throw new ProjectStorageError('STORAGE_TRANSACTION_REENTRY', 'Use the transaction methods inside a storage transaction.');
    const admitted = admissions.then(async () => {
      const key = await projectKey(projectPath);
      const previous = queues.get(key) ?? Promise.resolve();
      const result = previous.then(async () => {
        try { await assertRoots(); return await operation(key); }
        catch (error) {
          if (error instanceof TransactionCallbackError) throw error.cause;
          if (error instanceof ProjectStorageError) throw error;
          throw new ProjectStorageError('STORAGE_IO_FAILED', 'Versioned storage could not be read or saved.');
        }
      });
      const tail = result.catch(() => undefined);
      queues.set(key, tail);
      void tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
      return { result };
    });
    // Admission is ordered but never waits for disk writes on another project.
    admissions = admitted.then(() => undefined, () => undefined);
    return admitted.then(({ result }) => result);
  };

  const withProjectTransaction = (projectPath, callback, { validate } = {}) => {
    if (typeof callback !== 'function' || callback.constructor?.name === 'AsyncFunction') {
      return Promise.reject(new ProjectStorageError('STORAGE_ASYNC_TRANSACTION', 'Storage transaction callbacks must be synchronous.'));
    }
    return enqueue(projectPath, async (key) => {
      try { if (validate) await validate(); } catch (error) { throw new TransactionCallbackError(error); }
      const saved = await load(key);
      const staged = clone(saved.value);
      const afterCommit = [];
      let active = true;
      let changed = false;
      const requireActive = () => {
        if (!active) throw new ProjectStorageError('STORAGE_TRANSACTION_CLOSED', 'The storage transaction has ended.');
      };
      const tx = {
        read() { requireActive(); return { revision: staged.revision, data: clone(staged.data) }; },
        getOperation(operationId) { requireActive(); const value = staged.operations.find((op) => op.operationId === operationId); return value ? clone(value) : null; },
        commit(request) {
          requireActive();
          const prepared = prepareCommit(request);
          const prior = staged.operations.find((op) => op.operationId === prepared.operationId);
          if (prior) {
            if (prior.fingerprint !== prepared.fingerprint) throw new ProjectStorageError('STORAGE_OPERATION_CONFLICT', 'This operation ID was already used for a different storage write.');
            return { committedRevision: prior.committedRevision, changed: prior.changed, replayed: true, ...(prior.result === undefined ? {} : { result: clone(prior.result) }) };
          }
          if (prepared.baseRevision !== staged.revision) {
            throw new ProjectStorageError('STORAGE_CONFLICT', 'Storage changed in another preview. Keep or export local data before loading the latest snapshot.', { currentRevision: staged.revision });
          }
          const dataChanged = canonicalJSON(prepared.data) !== canonicalJSON(staged.data);
          if (dataChanged && staged.revision === Number.MAX_SAFE_INTEGER) throw new ProjectStorageError('STORAGE_REVISION_EXHAUSTED', 'Storage revision cannot be incremented safely.');
          if (dataChanged) { staged.revision += 1; staged.data = prepared.data; }
          const op = {
            operationId: prepared.operationId, baseRevision: prepared.baseRevision, fingerprint: prepared.fingerprint,
            committedRevision: staged.revision, changed: dataChanged,
            ...(prepared.metadata === undefined ? {} : { metadata: prepared.metadata }),
            ...(prepared.result === undefined ? {} : { result: prepared.result }),
          };
          staged.operations.push(op);
          while (staged.operations.length > MAX_STORAGE_OPERATIONS) staged.operations.shift();
          while (envelopeMetadataBytes(staged) > MAX_STORAGE_METADATA_BYTES) staged.operations.shift();
          changed = true;
          return { committedRevision: op.committedRevision, changed: op.changed, replayed: false, ...(op.result === undefined ? {} : { result: clone(op.result) }) };
        },
        afterCommit(effect) {
          requireActive();
          if (typeof effect !== 'function' || effect.constructor?.name === 'AsyncFunction') throw new ProjectStorageError('STORAGE_ASYNC_TRANSACTION', 'After-commit effects must be synchronous.');
          afterCommit.push(effect);
        },
      };
      let result;
      try {
        inCallback = true;
        result = callback(tx);
        if (result && typeof result.then === 'function') {
          void Promise.resolve(result).catch(() => undefined);
          throw new ProjectStorageError('STORAGE_ASYNC_TRANSACTION', 'Storage transaction callbacks must not return a promise.');
        }
      } catch (error) {
        throw new TransactionCallbackError(error);
      } finally { inCallback = false; active = false; }
      if (changed) await atomicWrite(saved.file, encodeEnvelope(staged), saved.info);
      for (const effect of afterCommit) {
        try {
          inCallback = true;
          const returned = effect();
          if (returned && typeof returned.then === 'function') {
            void Promise.resolve(returned).catch(() => undefined);
            throw new Error('asynchronous after-commit effect');
          }
        } catch {
          throw new ProjectStorageError('STORAGE_AFTER_COMMIT_FAILED', 'Storage is committed, but its in-memory handoff failed. Do not retry as an uncommitted write.', { committed: true, currentRevision: staged.revision });
        } finally { inCallback = false; }
      }
      return result;
    });
  };

  const read = (projectPath) => withProjectTransaction(projectPath, (tx) => tx.read());
  const commit = (projectPath, request) => {
    let prepared;
    try { prepared = prepareCommit(request); } catch (error) { return Promise.reject(error); }
    return withProjectTransaction(projectPath, (tx) => tx.commit(prepared));
  };
  const getOperation = (projectPath, operationId) => withProjectTransaction(projectPath, (tx) => tx.getOperation(operationId));
  const migration = (projectPath) => enqueue(projectPath, async (key) => {
    const saved = await load(key);
    const info = clone(saved.value.migration);
    let legacyStatus = 'none';
    try {
      if (legacyIdentity) await assertIdentity(legacyRoot, legacyIdentity);
      else legacyIdentity = await directoryIdentity(legacyRoot);
      const legacy = await readJSONFile(path.join(legacyRoot, `${key}.json`), MAX_STORAGE_BYTES);
      if (legacy) legacyStatus = info.source === 'v1' && hash(encodeSnapshot(legacy.value)) === info.sourceDigest ? 'unchanged' : 'changed';
    } catch (error) { if (error.code !== 'ENOENT') legacyStatus = 'unavailable'; }
    return { ...info, legacyStatus };
  });
  return { read, commit, getOperation, withProjectTransaction, migration };
}
