import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rename, rm, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_BYTES = 64 * 1024 * 1024;
const DEFAULT_ENTRIES = 16;
const MAX_SCAN_ENTRIES = 4096;
const HASH = /^[a-f0-9]{64}$/;
const digest = (value) => createHash('sha256').update(value).digest('hex');
const invalid = () => Object.assign(new Error('Invalid build cache state.'), { code: 'BUILD_CACHE_INVALID' });

async function directoryIdentity(directory) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) throw invalid();
  return info;
}

async function assertIdentity(directory, expected) {
  const info = await directoryIdentity(directory);
  if (info.dev !== expected.dev || info.ino !== expected.ino) throw invalid();
}

function validArtifact(value) {
  return value && typeof value === 'object' && typeof value.buildId === 'string' && /^[\w-]{1,100}$/.test(value.buildId)
    && typeof value.css === 'string' && value.payload && typeof value.payload === 'object'
    && Array.isArray(value.errors) && value.errors.length === 0 && Array.isArray(value.warnings)
    && Array.isArray(value.assets) && !Object.hasOwn(value, 'project');
}

/** Disposable compiled-output cache. Neither permissions nor runtime state live here. */
export async function createBuildCache(dataDir, { maxBytes = DEFAULT_BYTES, maxEntries = DEFAULT_ENTRIES } = {}) {
  if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir) || dataDir.includes('\0')
    || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(maxEntries) || maxEntries < 1) throw invalid();
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const dataRoot = await realpath(dataDir);
  const dataIdentity = await directoryIdentity(dataRoot);
  const root = path.join(dataRoot, 'build-cache');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const rootIdentity = await directoryIdentity(root);
  const entries = new Map();
  const owners = new Map();
  const directoryIdentities = new Map();
  const temporaryDirectories = [];
  const stats = { hits: 0, misses: 0, invalidated: 0, corrupt: 0, unavailable: 0, stores: 0, capacity: 0 };
  let pending = Promise.resolve();
  let disposed = false;

  const assertRoot = async () => {
    if (disposed) throw invalid();
    if (await realpath(dataDir) !== dataRoot) throw invalid();
    await assertIdentity(dataRoot, dataIdentity);
    await assertIdentity(root, rootIdentity);
  };

  const assertParents = async (key, create = false) => {
    await assertRoot();
    const parts = key.split('/');
    if (parts.length !== 3 || parts.some((part) => !HASH.test(part))) throw invalid();
    let current = root;
    for (const part of parts.slice(0, 2)) {
      current = path.join(current, part);
      if (create) await mkdir(current, { mode: 0o700 }).catch((error) => { if (error.code !== 'EEXIST') throw error; });
      const identity = await directoryIdentity(current);
      const previous = directoryIdentities.get(current);
      if (previous && (previous.dev !== identity.dev || previous.ino !== identity.ino)) throw invalid();
      directoryIdentities.set(current, identity);
    }
    return path.join(root, ...parts);
  };

  const describe = async ({ projectPath, compilerFingerprint, sourceHash }) => {
    if (typeof projectPath !== 'string' || !path.isAbsolute(projectPath) || projectPath.includes('\0')
      || typeof compilerFingerprint !== 'string' || !compilerFingerprint || compilerFingerprint.length > 512
      || typeof sourceHash !== 'string' || !HASH.test(sourceHash)) throw invalid();
    const projectRoot = await realpath(projectPath);
    const projectHash = digest(projectRoot);
    const compilerHash = digest(compilerFingerprint);
    return { key: `${projectHash}/${compilerHash}/${sourceHash}`, projectHash, compilerHash, compilerFingerprint, sourceHash };
  };

  const serial = (operation) => {
    const result = pending.then(operation);
    pending = result.catch(() => undefined);
    return result;
  };

  let scanned = 0;
  const scan = async (directory, parts = []) => {
    await directoryIdentity(directory);
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (++scanned > MAX_SCAN_ENTRIES) throw invalid();
      if (parts.length === 2 && /^\.tmp-[a-f0-9-]{36}$/.test(item.name) && item.isDirectory() && !item.isSymbolicLink()) {
        temporaryDirectories.push(path.join(directory, item.name));
        continue;
      }
      if (!HASH.test(item.name) || !item.isDirectory() || item.isSymbolicLink()) continue;
      const child = path.join(directory, item.name);
      const next = [...parts, item.name];
      if (next.length < 3) { await scan(child, next); continue; }
      const identity = await directoryIdentity(child);
      try {
        const file = await lstat(path.join(child, 'artifact.json'));
        if (!file.isFile() || file.isSymbolicLink()) {
          entries.set(next.join('/'), { bytes: 0, lastUsed: identity.mtimeMs, owners: new Set() });
          continue;
        }
        entries.set(next.join('/'), { bytes: file.size, lastUsed: identity.mtimeMs, owners: new Set() });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        entries.set(next.join('/'), { bytes: 0, lastUsed: identity.mtimeMs, owners: new Set() });
      }
    }
  };
  await scan(root);
  for (const directory of temporaryDirectories) {
    await assertRoot();
    await directoryIdentity(path.dirname(directory));
    await directoryIdentity(directory);
    await rm(directory, { recursive: true, force: true });
  }

  const removeEntry = async (key) => {
    if (entries.get(key)?.owners.size) return false;
    const directory = await assertParents(key);
    // Never recursively traverse a link substituted for an entry directory.
    await directoryIdentity(directory);
    const entry = entries.get(key);
    if (!entry || entry.owners.size) return false;
    entry.evicting = true;
    try {
      await rm(directory, { recursive: true, force: true });
      entries.delete(key);
    } catch (error) { entry.evicting = false; throw error; }
    return true;
  };

  const prune = async (incomingKey, bytes) => {
    const incomingCount = incomingKey ? 1 : 0;
    let total = [...entries.values()].reduce((sum, item) => sum + item.bytes, 0);
    let count = entries.size;
    const candidates = [...entries.entries()].filter(([key, item]) => key !== incomingKey && !item.owners.size).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    const deletions = [];
    for (const [key, item] of candidates) {
      if (total + bytes <= maxBytes && count + incomingCount <= maxEntries) break;
      deletions.push(key); total -= item.bytes; count--;
    }
    if (total + bytes > maxBytes || count + incomingCount > maxEntries) return false;
    for (const key of deletions) {
      // Pins may be acquired while disk IO is pending; recheck before each removal.
      if (!await removeEntry(key)) return false;
    }
    return true;
  };
  await prune(null, 0);

  const readFile = async (directory) => {
    await directoryIdentity(directory);
    const file = path.join(directory, 'artifact.json');
    const before = await lstat(file);
    if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes) throw invalid();
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) throw invalid();
      const bytes = Buffer.alloc(before.size + 1);
      let total = 0;
      while (total < bytes.length) {
        const { bytesRead } = await handle.read(bytes, total, bytes.length - total, total);
        if (!bytesRead) break;
        total += bytesRead;
      }
      const after = await handle.stat();
      if (total !== before.size || after.mtimeMs !== before.mtimeMs || after.size !== before.size) throw invalid();
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, total)));
    } finally { await handle.close(); }
  };

  return {
    key: describe,
    has(key) { return entries.has(key) && !entries.get(key).evicting; },
    lookup(request) {
      return serial(async () => {
        let descriptor;
        try {
          await assertRoot();
          descriptor = await describe(request);
          const directory = path.join(root, ...descriptor.key.split('/'));
          if (!entries.has(descriptor.key)) {
            const invalidated = [...entries.keys()].some((key) => key.startsWith(descriptor.projectHash + '/') && !key.startsWith(`${descriptor.projectHash}/${descriptor.compilerHash}/`));
            stats[invalidated ? 'invalidated' : 'misses']++;
            return { status: invalidated ? 'invalidated' : 'miss', key: descriptor.key };
          }
          await assertParents(descriptor.key);
          const saved = await readFile(directory);
          if (saved?.schemaVersion !== 1 || saved.sourceHash !== descriptor.sourceHash || saved.compilerFingerprint !== descriptor.compilerFingerprint
            || !validArtifact(saved.artifact) || digest(JSON.stringify(saved.artifact)) !== saved.contentHash) throw invalid();
          const entry = entries.get(descriptor.key);
          entry.lastUsed = Date.now();
          await utimes(directory, new Date(), new Date(entry.lastUsed));
          stats.hits++;
          return { status: 'hit', key: descriptor.key, artifact: saved.artifact };
        } catch (error) {
          const exists = descriptor && entries.has(descriptor.key);
          if (exists) {
            stats.corrupt++;
            try { await removeEntry(descriptor.key); } catch { /* A substituted path is left untouched. */ }
            return { status: 'corrupt', key: descriptor.key, cause: error.code ?? 'BUILD_CACHE_INVALID' };
          }
          stats.unavailable++;
          return { status: 'unavailable', cause: error.code ?? 'BUILD_CACHE_INVALID' };
        }
      });
    },
    store(request, artifact) {
      let encoded;
      try {
        if (!validArtifact(artifact)) throw invalid();
        encoded = JSON.stringify({ schemaVersion: 1, sourceHash: request.sourceHash, compilerFingerprint: request.compilerFingerprint, contentHash: digest(JSON.stringify(artifact)), artifact });
      } catch (error) { return Promise.resolve({ status: 'unavailable', cause: error.code ?? 'BUILD_CACHE_INVALID' }); }
      return serial(async () => {
        let temporary;
        try {
          await assertRoot();
          const descriptor = await describe(request);
          const bytes = Buffer.byteLength(encoded);
          if (entries.has(descriptor.key)) return { status: 'exists', key: descriptor.key };
          if (bytes > maxBytes || !await prune(descriptor.key, bytes)) {
            stats.capacity++;
            return { status: 'capacity', key: descriptor.key };
          }
          const directory = await assertParents(descriptor.key, true);
          temporary = path.join(path.dirname(directory), `.tmp-${randomUUID()}`);
          await mkdir(temporary, { mode: 0o700 });
          await writeFile(path.join(temporary, 'artifact.json'), encoded, { flag: 'wx', mode: 0o600 });
          await assertParents(descriptor.key);
          await rename(temporary, directory);
          temporary = null;
          entries.set(descriptor.key, { bytes, lastUsed: Date.now(), owners: new Set() });
          stats.stores++;
          return { status: 'stored', key: descriptor.key };
        } catch (error) {
          stats.unavailable++;
          return { status: 'unavailable', cause: error.code ?? 'BUILD_CACHE_INVALID' };
        } finally {
          if (temporary) await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
        }
      });
    },
    pin(key, owner) {
      const previous = owners.get(owner);
      if (previous) entries.get(previous)?.owners.delete(owner);
      if (!entries.has(key) || entries.get(key).evicting) { owners.delete(owner); return; }
      entries.get(key).owners.add(owner);
      owners.set(owner, key);
    },
    unpin(owner) {
      const key = owners.get(owner);
      if (key) entries.get(key)?.owners.delete(owner);
      owners.delete(owner);
    },
    inspect() {
      return { ...stats, entries: [...entries].map(([key, value]) => ({ key, bytes: value.bytes, pins: value.owners.size, lastUsed: value.lastUsed })) };
    },
    async dispose() { await pending; disposed = true; entries.clear(); owners.clear(); },
  };
}
