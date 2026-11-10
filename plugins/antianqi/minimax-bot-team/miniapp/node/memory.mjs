// @ts-check
import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { appendFile, copyFile, link, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { renameWithRetry } from './fs-retry.mjs';
import { t } from './i18n.mjs';
import { SECRET_PATTERNS, STRICT_PATTERNS } from './redact.mjs';

export const ENTRY_MAX = 1200;
export const STORAGE_MAX = 100000;
export const MAX_ENTRIES = 1000;
export const FILE_MAX = STORAGE_MAX;
export const ENTRY_OVERHEAD = 0;
export const TOPIC_KEY_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Storage counts only UTF-16 body characters; prompt context has its own budget. */
export function storageBudget(entries) {
  const used = entries.reduce((n, entry) => n + entry.text.length, 0);
  return {
    used, limit: STORAGE_MAX, remaining: Math.max(0, STORAGE_MAX - used),
    entryMax: ENTRY_MAX, entryOverhead: 0, entryCount: entries.length,
    entryLimit: MAX_ENTRIES, unit: 'characters',
  };
}
export const memoryBudget = storageBudget;

/** Derived on read as well, so legacy files need no migration to support revisions. */
function entryRevision(entry) {
  return createHash('sha256').update(JSON.stringify([entry.text, entry.key ?? '', Boolean(entry.pinned)])).digest('hex');
}

// The shapes a secret takes live in one place: a memory refuses every one of them, and
// a message masks the high-confidence ones. See redact.mjs.
const MEMORY_SECRET_PATTERNS = [...SECRET_PATTERNS, ...STRICT_PATTERNS];

export class MemoryError extends Error {
  constructor(message, code = 'memory_invalid', details = {}) {
    super(message);
    this.name = 'MemoryError';
    this.code = code;
    this.details = details;
  }
}

function entryId(text) {
  return createHash('sha1').update(text).digest('hex').slice(0, 8);
}

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Single-line metadata value: no control characters, no line breaks, bounded. */
function cleanMeta(value, max = 40) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * One memory per line. The body is kept verbatim and the metadata travels in an encoded
 * trailer, so neither a bracket in the body nor anything in `source` / `by` can change where
 * an entry ends or add another one:
 * `- 用户喜欢简洁的回答 <!-- meta:eyJzb3VyY2UiOiLnp4HogYoifQ -->`
 * Lines written by 0.1.0 (`- text [source: …; added: …; by: …]`) are still read; only a
 * trailer made solely of those keys counts as metadata there.
 */
const META_TRAILER = /^-\s+(.*)\s+<!-- meta:([A-Za-z0-9_-]*) -->\s*$/;
const LEGACY_TRAILER = /^-\s+(.*?)\s+\[((?:source|added|by):[^\]]*)\]\s*$/;

function parseLine(line) {
  /** @type {Record<string, any>} */
  let meta = {};
  let text;
  const encoded = META_TRAILER.exec(line);
  if (encoded) {
    text = encoded[1];
    try {
      const value = JSON.parse(Buffer.from(encoded[2], 'base64url').toString('utf8'));
      if (value && typeof value === 'object') meta = value;
    } catch {
      /* unreadable trailer: keep the text, drop the metadata */
    }
  } else {
    const legacy = LEGACY_TRAILER.exec(line);
    if (legacy && legacy[2].split(';').every((part) => /^\s*(source|added|by)\s*:/.test(part))) {
      text = legacy[1];
      for (const part of legacy[2].split(';')) {
        const [key, ...rest] = part.split(':');
        meta[key.trim()] = rest.join(':').trim();
      }
    } else {
      text = /^-\s+(.*)$/.exec(line)?.[1];
    }
  }
  text = text?.trim();
  if (!text) return undefined;
  const entry = {
    id: /^[a-f0-9]{8}$/.test(meta.id ?? '') ? meta.id : entryId(text),
    ...(TOPIC_KEY_RE.test(meta.key ?? '') ? { key: meta.key } : {}),
    text,
    source: cleanMeta(meta.source),
    added: cleanMeta(meta.added, 10),
    by: cleanMeta(meta.by),
    pinned: meta.pinned === true,
  };
  return { ...entry, revision: entryRevision(entry) };
}

function formatEntry(entry) {
  const meta = { id: entry.id, ...(entry.key ? { key: entry.key } : {}), pinned: Boolean(entry.pinned), source: cleanMeta(entry.source), added: cleanMeta(entry.added, 10) };
  const by = cleanMeta(entry.by);
  if (by) meta.by = by;
  return `- ${entry.text} <!-- meta:${Buffer.from(JSON.stringify(meta), 'utf8').toString('base64url')} -->`;
}

export class MemoryStore {
  /** @param {string} dataDir */
  constructor(dataDir) {
    this.dir = join(dataDir, 'memory');
    this.journal = join(this.dir, 'journal.jsonl');
    this.pendingPath = join(this.dir, '.pending.json');
    /** rev per scope so Bot sessions know when to refresh their context */
    this.revs = new Map();
    this.chain = Promise.resolve();
  }

  async init() {
    await mkdir(join(this.dir, 'bots'), { recursive: true });
    await mkdir(join(this.dir, 'archive'), { recursive: true });
    await this.serialize(() => this.recover());
  }

  /** @param {string} scope `team` or a bot id */
  pathFor(scope) {
    if (scope === 'team') return join(this.dir, 'team.md');
    if (typeof scope !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(scope)) throw new MemoryError(t('memory.err.scope'));
    return join(this.dir, 'bots', `${scope}.md`);
  }

  rev(scope) {
    return this.revs.get(scope) ?? 0;
  }

  list(scope) {
    return this.serialize(async () => {
      await this.recover();
      return this.readEntries(scope);
    });
  }

  async readEntries(scope) {
    let raw = '';
    try {
      raw = await readFile(this.pathFor(scope), 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
    return raw
      .split('\n')
      .map(parseLine)
      .filter((entry) => entry !== undefined);
  }

  contentFor(scope, entries) {
    const header = `${t(scope === 'team' ? 'memory.header.team' : 'memory.header.bot')}\n\n`;
    const body = entries.map(formatEntry).join('\n');
    const content = `${header}${body}${body ? '\n' : ''}`;
    return content;
  }

  /** Preserve the exact pre-upgrade bytes once, before accepting any scope mutation. */
  async backupScope(scope) {
    const source = this.pathFor(scope);
    const backups = join(this.dir, 'backups');
    const staged = join(backups, `.${scope}.${randomBytes(16).toString('hex')}.tmp`);
    try {
      await mkdir(backups, { recursive: true });
      const backup = join(backups, `${scope}.pre-storage-v2.md`);
      // A crash during copying can leave only a temporary file. Publish the complete
      // inode with an exclusive atomic link; a pre-existing backup is never replaced.
      await copyFile(source, staged, constants.COPYFILE_EXCL);
      try {
        await link(staged, backup);
      } catch (error) {
        if (error?.code === 'EEXIST' && (await stat(backup)).isFile()) return;
        throw error;
      }
    } catch (error) {
      // A new scope has no original document to preserve. Other failures reject the write.
      if (error?.code === 'ENOENT') {
        try { await readFile(source); }
        catch (readError) { if (readError?.code === 'ENOENT') return; }
      }
      throw new MemoryError(t('memory.err.backup'), 'memory_backup_failed', {
        scope, retryable: true, ...(typeof error?.code === 'string' ? { causeCode: error.code } : {}),
      });
    } finally {
      await rm(staged, { force: true }).catch(() => {});
    }
  }

  /** The prepared document and journal record form one recoverable operation. */
  async commit(scope, entries, event) {
    await this.backupScope(scope);
    const operationId = randomBytes(16).toString('hex');
    const transaction = {
      version: 1, operationId, scope, content: this.contentFor(scope, entries),
      journal: { ts: Date.now(), ...event, scope, operationId },
    };
    const staged = this.stagedPath(transaction);
    const pendingTemp = `${this.pendingPath}.${operationId}.tmp`;
    // Prepare in the destination directory before accepting the operation. Failures here
    // leave both the current document and its journal unchanged.
    try {
      await writeFile(staged, transaction.content, 'utf8');
      await writeFile(pendingTemp, JSON.stringify(transaction), 'utf8');
      await renameWithRetry(pendingTemp, this.pendingPath);
    } catch (error) {
      await Promise.all([rm(staged, { force: true }), rm(pendingTemp, { force: true })]).catch(() => {});
      throw error;
    }
    // The durable pending record is the acceptance point. Failures afterwards are explicitly
    // pending, not an ordinary rejected write; reads/retries/restart finish the same operation.
    await this.finish(transaction);
  }

  stagedPath(transaction) {
    return `${this.pathFor(transaction.scope)}.${transaction.operationId}.pending`;
  }

  async recover() {
    let transaction;
    try {
      transaction = JSON.parse(await readFile(this.pendingPath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw new MemoryError(t('memory.err.pending'), 'memory_pending', { retryable: true });
    }
    if (transaction?.version !== 1 || !/^[a-f0-9]{32}$/.test(transaction.operationId ?? '') ||
        typeof transaction.scope !== 'string' || typeof transaction.content !== 'string' ||
        transaction.journal?.operationId !== transaction.operationId || transaction.journal?.scope !== transaction.scope) {
      throw new MemoryError(t('memory.err.pending'), 'memory_pending', { retryable: false });
    }
    await this.finish(transaction);
  }

  async finish(transaction) {
    try {
      // Also protects recovery of a transaction prepared by the previous storage version.
      await this.backupScope(transaction.scope);
      // A complete journal record precedes publication of the new document. A torn append
      // is retained and separated from the retried record; operationId makes recovery unique.
      await this.log(transaction.journal);
      const staged = this.stagedPath(transaction);
      // Also handles a crash after the earlier rename but before removing the pending record.
      await writeFile(staged, transaction.content, 'utf8');
      await renameWithRetry(staged, this.pathFor(transaction.scope));
      this.revs.set(transaction.scope, this.rev(transaction.scope) + 1);
      await rm(this.pendingPath);
    } catch (error) {
      throw new MemoryError(t('memory.err.pending'), 'memory_pending', {
        operationId: transaction.operationId, retryable: true,
        ...(typeof error?.code === 'string' ? { causeCode: error.code } : {}),
      });
    }
  }

  async journalText() {
    try { return await readFile(this.journal, 'utf8'); }
    catch (error) {
      if (error?.code === 'ENOENT') return '';
      throw error;
    }
  }

  journalEntries(raw) {
    return raw.split('\n').flatMap((line) => {
      if (!line.trim()) return [];
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  }

  serialize(task) {
    const next = this.chain.then(task, task);
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  /**
   * @param {string} scope
   * @param {{ text: string, source?: string, by?: string, added?: string, replaceId?: string, key?: string, pinned?: boolean, expectedRevision?: string, requireRevision?: boolean }} input
   */
  remember(scope, input) {
    return this.serialize(async () => {
      await this.recover();
      const text = String(input.text ?? '').replace(/\s+/g, ' ').trim();
      if (!text) throw new MemoryError(t('memory.err.empty'));
      if (input.key !== undefined && (typeof input.key !== 'string' || !TOPIC_KEY_RE.test(input.key))) {
        throw new MemoryError(t('memory.err.key'));
      }
      if (input.pinned !== undefined && typeof input.pinned !== 'boolean') {
        throw new MemoryError(t('memory.err.pinned'));
      }
      const entries = await this.readEntries(scope);
      const keyIndex = input.key ? entries.findIndex((item) => item.key === input.key) : -1;
      let index = keyIndex;
      if (input.replaceId) {
        index = entries.findIndex((item) => item.id === input.replaceId);
        if (index < 0) {
          if (input.expectedRevision !== undefined) throw this.conflict(scope, input);
          throw new MemoryError(t('memory.err.replaceMissing', { id: input.replaceId }));
        }
        if (keyIndex >= 0 && keyIndex !== index) throw new MemoryError(t('memory.err.keyConflict'));
      }
      // Adopt a key for an identical legacy entry instead of duplicating it.
      if (index < 0) index = entries.findIndex((item) => item.text === text && (!input.key || !item.key));
      const previous = index >= 0 ? entries[index] : undefined;
      const key = input.key ?? previous?.key;
      const pinned = input.pinned ?? previous?.pinned ?? false;
      // A successful write whose response was lost can be retried with its old revision.
      if (previous?.text === text && previous.key === key && previous.pinned === pinned) {
        return { entry: previous, unchanged: true, budget: storageBudget(entries) };
      }
      if ((!previous && input.expectedRevision !== undefined) || (previous && (
        (input.requireRevision && input.expectedRevision === undefined) ||
        (input.expectedRevision !== undefined && input.expectedRevision !== previous.revision)
      ))) throw this.conflict(scope, input, previous);
      if (text.length > ENTRY_MAX && (!previous || text.length > previous.text.length)) {
        throw new MemoryError(t('memory.err.tooLong', { max: ENTRY_MAX }), 'memory_too_long', { scope, max: ENTRY_MAX, actual: text.length });
      }
      if (MEMORY_SECRET_PATTERNS.some((pattern) => pattern.test(text))) throw new MemoryError(t('memory.err.secret'));
      let id = previous?.id;
      if (!id) {
        do { id = randomBytes(4).toString('hex'); } while (entries.some((item) => item.id === id));
      }
      const entry = {
        id, ...(key ? { key } : {}), text, pinned,
        source: input.source === undefined ? (previous?.source ?? t('memory.defaultSource')) : cleanMeta(input.source),
        added: input.added === undefined ? (previous?.added ?? today()) : cleanMeta(input.added, 10),
        by: input.by === undefined ? (previous?.by ?? '') : cleanMeta(input.by),
      };
      entry.revision = entryRevision(entry);
      const currentBudget = storageBudget(entries);
      if (index >= 0) entries[index] = entry;
      else entries.push(entry);
      const budget = storageBudget(entries);
      const storageExceeded = budget.used > STORAGE_MAX && budget.used > currentBudget.used;
      const entriesExceeded = budget.entryCount > MAX_ENTRIES && budget.entryCount > currentBudget.entryCount;
      if (storageExceeded || entriesExceeded) {
        const details = {
          ...currentBudget, scope, needed: Math.max(0, budget.used - currentBudget.used),
          shortfall: Math.max(0, budget.used - STORAGE_MAX),
          entryNeeded: Math.max(0, budget.entryCount - currentBudget.entryCount),
          entryShortfall: Math.max(0, budget.entryCount - MAX_ENTRIES),
        };
        throw new MemoryError(entriesExceeded
          ? t('memory.err.entryLimit', { max: MAX_ENTRIES, remaining: Math.max(0, MAX_ENTRIES - currentBudget.entryCount), needed: details.entryNeeded })
          : t('memory.err.full', { max: STORAGE_MAX, remaining: details.remaining, needed: details.needed }), 'memory_full', details);
      }
      await this.commit(scope, entries, {
        op: previous ? 'replace' : 'add', entryId: entry.id, before: previous?.text, after: text,
        ...(previous ? { beforeEntry: previous } : {}), afterEntry: entry, by: cleanMeta(input.by),
      });
      return { entry, unchanged: false, budget };
    });
  }

  conflict(scope, input, previous) {
    return new MemoryError(t('memory.err.conflict'), 'memory_conflict', {
      scope, ...(previous ? { entryId: previous.id, currentRevision: previous.revision } : {}),
      ...(input.expectedRevision !== undefined ? { expectedRevision: input.expectedRevision } : {}),
      ...(input.requireRevision ? { requireRevision: true } : {}),
    });
  }

  forget(scope, id, by) {
    return this.serialize(async () => {
      await this.recover();
      const entries = await this.readEntries(scope);
      const index = entries.findIndex((item) => item.id === id);
      if (index < 0) {
        // A removal may have committed before the caller received its result. Its receipt
        // makes a retry after recovery/restart idempotent without accepting an unknown ID.
        const receipt = this.journalEntries(await this.journalText()).findLast((entry) =>
          entry?.scope === scope && entry?.op === 'remove' && entry?.removed?.id === id);
        if (receipt) return receipt.removed;
        throw new MemoryError(t('memory.err.missing', { id }));
      }
      const [removed] = entries.splice(index, 1);
      await this.commit(scope, entries, { op: 'remove', entryId: removed.id, removed, before: removed.text, by: cleanMeta(by) });
      return removed;
    });
  }

  async search(scopes, query) {
    const needle = String(query ?? '')
      .toLowerCase()
      .trim();
    const terms = needle.split(/\s+/).filter(Boolean);
    const results = [];
    for (const scope of scopes) {
      for (const entry of await this.list(scope)) {
        const hay = entry.text.toLowerCase();
        if (terms.length === 0 || terms.some((term) => hay.includes(term))) {
          results.push({ scope, ...entry });
        }
      }
    }
    return results;
  }

  async archive(scope) {
    return this.serialize(async () => {
      await this.recover();
      await this.backupScope(scope);
      try {
        await renameWithRetry(this.pathFor(scope), join(this.dir, 'archive', `${scope}-${Date.now()}.md`));
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      this.revs.set(scope, this.rev(scope) + 1);
    });
  }

  async log(entry) {
    const raw = await this.journalText();
    if (entry.operationId && this.journalEntries(raw).some((row) => row?.operationId === entry.operationId)) return;
    const separator = raw && !raw.endsWith('\n') ? '\n' : '';
    await appendFile(this.journal, `${separator}${JSON.stringify(entry)}\n`, 'utf8');
  }
}
