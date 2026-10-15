// @ts-check

// The record-level index: what a session's ledger looks like, laid out so that reading a window,
// counting a kind, or brushing a time range costs a lookup instead of a re-parse of every
// generation the session has ever stored.
//
// WHY IT EXISTS. Reading a session today has exactly two shapes — all of it, or all of it with the
// tail cut off — and both have to build every row of every generation first. That is why the
// server keeps parsed rows resident (measured 231 MB for a 44-generation session) and keeps the
// serialized response (135 MB for the same session). This file is the third shape: a durable,
// cheap-to-load description of the ledger, so "give me records 3,100 through 3,300" and "how many
// tool calls are there" stop being a reason to read 198 MB.
//
// FOUR QUESTIONS, because a change like this is not allowed to skip them.
//
// 归层 — server only. Everything here is derived from the projection the identity layer already
// produced, and none of it is shipped to the page as a second answer: the window endpoint answers
// out of this, and the full payload keeps its existing shape. The index never writes client state.
//
// 关联 — subordinate to the projection, parallel to the two caches it exists to replace. It is
// built FROM the corrected records, so it inherits the identity merge rather than re-deciding it;
// a view it does not cover (a single generation) falls back to the full build rather than being
// answered from a stale approximation.
//
// 布局 — no new surface. Two files under the runtime's data dir, and query parameters on the route
// that already exists. Nothing here is a panel, a section, or a page.
//
// 口径 — the answer must be the same answer. `verify-trajectory-index.mjs` holds every window, KPI
// and brush it serves against the full payload field by field, so switching a read onto this file
// cannot move a number the page already shows.
//
// STORAGE. Two files per (session, view): records.jsonl, then manifest.json. The manifest is
// written LAST and only after the records are in place under their final name, so a run that dies
// half way leaves a manifest that does not describe the bytes next to it — and a missing or
// mismatched manifest means "no index", never "half an index". Absolute paths are deliberately
// absent: a record names a file by its index into the manifest's own file table, so the artifact
// carries no machine path and is meaningless outside the session it was built for.
//
// The records are JSONL rather than a b-tree because the primary key is already dense and sorted
// (measured gapless 1..36527 on a 44-generation session), which makes the file on disk the sorted
// array a binary search wants. The one thing that must not be searched that way is the timestamp —
// see `buildSecondary`.

import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Bumped when the on-disk shape changes in a way an older reader cannot survive. A file written
 * under a different version is rebuilt, never migrated: the source it describes is still there.
 */
export const INDEX_SCHEMA_VERSION = 1;

/**
 * Bumped when `buildTrajectoryPayload` changes what a record CONTAINS, independently of the file
 * layout above. A projection that starts emitting a new field, or stops clipping at a different
 * length, makes every stored index describe a ledger that no longer exists — and the check that
 * catches it has to be about the projection, not about the bytes.
 */
export const PROJECTION_VERSION = 1;

/**
 * The record fields the index does NOT carry.
 *
 * A denylist, not an allowlist, and the reason is that a field this file forgot would be a field
 * the page renders as blank with nothing to say why. The projected text fields are the whole of
 * what is left out: they are the bulk of the payload, and the ledger draws them from one record at
 * a time, so they are read back from the source line the locator names — the same move `/raw`
 * already makes. Everything else, however small, is carried verbatim.
 *
 * `rawRow` is dropped for a different reason: it is an index into an array that is gone by the time
 * anything reads this file, and the locator beside it is the durable form of the same fact.
 */
export const EXCLUDED_RECORD_FIELDS = new Set([
  'text',
  'thinking',
  'arguments',
  'result',
  'error',
  'rawRow',
]);

/**
 * Turn-level fields, kept apart because a window has to reproduce a turn header without the rows
 * that header was summed from. Sums, not derivations: `toolCalls` / `errors` / `tokens` are read
 * off the built turn rather than recomputed, so a window's header matches the full build's header.
 */
export const INDEX_TURN_FIELDS = [
  'id',
  'index',
  'startedAt',
  'endedAt',
  'durationMs',
  'toolCalls',
  'errors',
  'tokens',
  'turnClass',
  'askedReader',
  'closed',
  'openerInView',
  'openerOutOfView',
];

/**
 * One source file, as the index knows it.
 *
 * `filePath` is here because a locator names a file by its path and the record has to be matched
 * to a file exactly, not by basename — but it is stripped before the manifest is written, so no
 * machine path reaches the artifact. That is also why it is not compared by `sameSources`: it is
 * not identity, it is where the identity happens to live this time.
 *
 * @typedef {{ fileName: string, generation: number | null, size: number, mtimeMs: number, revision: string | null, filePath?: string }} IndexFile
 */

/** @typedef {{ schemaVersion: number, projectionVersion: number, view: string, files: IndexFile[], recordCount: number, turnCount: number, recordsBytes: number, recordsDigest: string, projectionDigest: string }} IndexManifest */

/**
 * One ledger record as the index stores it.
 * @typedef {Record<string, any>} IndexRecord
 */

/**
 * Turns a built payload's turns into the two line-per-item shapes the file is made of.
 *
 * `raws` is the record -> locator map the route already builds for `/raw`; it is read here and
 * then forgotten, because a locator's `filePath` is a machine path and the file must not carry one.
 * A record with no locator becomes `fileIdx: -1`, which is a real state (a projection built by a
 * caller that had no locators) and is not silently repaired to 0 — that would point the record at
 * whichever file happens to be first.
 *
 * There is deliberately no `ordinalInLine`. One source line expands into several records, but they
 * all answer with the same message, so `/raw` locates per line and not per segment — a segment
 * number here would be a field nothing could act on.
 *
 * @param {{ turns: Array<any>, stats: Record<string, any>, session: Record<string, any> }} payload
 * @param {Map<number, { filePath: string, start: number, end: number, digest: string }>} raws
 * @param {IndexFile[]} files
 * @returns {{ turns: Array<Record<string, any>>, records: IndexRecord[] }}
 */
export function indexRowsFromPayload(payload, raws, files) {
  const pathToFileIdx = new Map();
  files.forEach((file, i) => {
    // Matched on the full path, not the file name: two generations can each hold a file the catalog
    // names the same way, and a basename match would file one generation's records under the other.
    // First writer wins, because a path can only be in the table once for one session.
    if (typeof file.filePath === 'string' && !pathToFileIdx.has(file.filePath)) {
      pathToFileIdx.set(file.filePath, i);
    }
  });
  /** @type {IndexRecord[]} */
  const records = [];
  /** @type {Array<Record<string, any>>} */
  const turns = [];
  for (const turn of payload.turns) {
    /** @type {Record<string, any>} */
    const header = {};
    for (const field of INDEX_TURN_FIELDS) header[field] = turn[field] ?? null;
    header.firstRecord = 0;
    header.lastRecord = -1;
    for (const record of turn.records) {
      const locator = raws.get(record.index);
      const fileIdx = locator === undefined ? -1 : (pathToFileIdx.get(locator.filePath) ?? -1);
      /** @type {IndexRecord} */
      const line = {};
      for (const [key, value] of Object.entries(record)) {
        if (EXCLUDED_RECORD_FIELDS.has(key)) continue;
        if (value === undefined) continue;
        line[key] = value;
      }
      line.fileIdx = fileIdx;
      // Where the line that produced this record sat in its file. `ordinalInLine` — which segment of
      // a line this record is — is deliberately absent: every record out of one line answers with the
      // same message, so /raw locates per line. These two are different: they name the LINE, and they
      // are what a search hit in a sealed generation is mapped back through, because a sealed
      // generation's records are searched long after the row objects that gave them their ordinals
      // have stopped existing. `-1` is "no location", and stays distinguishable from a byte 0.
      line.byteStart = locator === undefined ? -1 : locator.start;
      line.byteEnd = locator === undefined ? -1 : locator.end;
      // Whether `error` had text, not the text: the flag is what a row is styled by, and carrying
      // the string would put the bulk back into the file this exists to keep small.
      line.hasErrorText = typeof record.error === 'string' && record.error.length > 0;
      if (header.lastRecord < 0) header.firstRecord = records.length;
      header.lastRecord = records.length;
      records.push(line);
    }
    turns.push(header);
  }
  return { turns, records };
}

/**
 * Serializes turns and records into the two byte ranges of one file, in that order.
 *
 * Turns first so that a reader can learn the turn table without touching a record line, and so a
 * file whose record half is truncated still has a describable header.
 *
 * @param {{ turns: Array<Record<string, any>>, records: IndexRecord[] }} rows
 * @returns {string}
 */
export function serializeIndex(rows) {
  const parts = [];
  // No separator between the two blocks: the manifest's `turnCount` is the boundary, and a blank
  // line would be a second thing that has to agree with it.
  for (const turn of rows.turns) parts.push(JSON.stringify(turn));
  for (const record of rows.records) parts.push(JSON.stringify(record));
  return parts.join('\n');
}

/**
 * @param {string} text
 * @param {IndexManifest} manifest
 * @returns {{ turns: Array<Record<string, any>>, records: IndexRecord[] } | null}
 */
export function parseIndex(text, manifest) {
  if (manifest.recordsDigest !== digestOf(text)) return null;
  const lines = text.split('\n');
  if (lines.length < 1) return null;
  const turns = [];
  for (let i = 0; i < manifest.turnCount; i += 1) {
    const line = lines[i];
    if (line === undefined || line === '') return null;
    let parsed;
    try { parsed = JSON.parse(line); } catch { return null; }
    if (!parsed || typeof parsed !== 'object') return null;
    turns.push(parsed);
  }
  // Exactly as many lines as the manifest claims, and no more: a file with an extra line is one
  // whose writer was interrupted, and reading the prefix of it would answer with half an index.
  if (lines.length !== manifest.turnCount + manifest.recordCount) return null;
  const records = [];
  for (let i = manifest.turnCount; i < manifest.turnCount + manifest.recordCount; i += 1) {
    const line = lines[i];
    if (line === undefined || line === '') return null;
    let parsed;
    try { parsed = JSON.parse(line); } catch { return null; }
    if (!parsed || typeof parsed !== 'object') return null;
    records.push(parsed);
  }
  return { turns, records };
}

/**
 * The identity half of a source file, with the path taken off.
 *
 * This is what the manifest stores and what `sameSources` compares, so it is also what decides
 * whether a stored index may be reused: a machine path is not part of that question.
 *
 * @param {IndexFile} file
 */
export function stripPath(file) {
  return {
    fileName: file.fileName,
    generation: file.generation,
    size: file.size,
    mtimeMs: file.mtimeMs,
    revision: file.revision,
    // Whether this generation's rows were cut short by our own read cap. `size` is the whole file
    // whether or not the read covered it, so on its own a truncated generation's artifact looks
    // exactly like a complete one. Carried because an answer assembled from artifacts would then
    // report a smaller `total` than the rebuild would, and report nothing about being wrong.
    truncated: file.truncated === true,
  };
}

/** @param {string} text */
export function digestOf(text) {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * The five secondary structures, built once per load.
 *
 * `index` is the primary key and needs no structure: the array is already in index order, and the
 * file is written that way. `timestamp` is the one that costs a sort, and it is the one that may
 * NOT be searched in index order — a session's timestamps are nearly but not quite monotonic
 * (measured 32 adjacent inversions in 25,428 rows, the largest a 141.8 s step backwards, against a
 * 98.9 h span), so bisecting the primary order would silently drop whatever fell in a gap. The
 * ordering is therefore a side array, and nothing is allowed to reach for `records[]` order when
 * answering a time range.
 *
 * @param {IndexRecord[]} records
 */
export function buildSecondary(records) {
  /** @type {Map<string, number[]>} */
  const byMessageId = new Map();
  /** @type {Map<number, number[]>} */
  const byGeneration = new Map();
  /** @type {Map<string, number>} */
  const kindCounts = new Map();
  /** @type {number[]} */
  const timedPositions = [];
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    // `id` IS the logical message id: it is the field the page groups by and the field the
    // identity layer keys on. A record without one is unkeyed and joins no group — it is not
    // filed under a shared empty key, which would merge every unkeyed record into one message.
    if (typeof record.id === 'string' && record.id.length > 0) {
      const existing = byMessageId.get(record.id);
      if (existing === undefined) byMessageId.set(record.id, [i]);
      else existing.push(i);
    }
    if (typeof record.generation === 'number') {
      const existing = byGeneration.get(record.generation);
      if (existing === undefined) byGeneration.set(record.generation, [i]);
      else existing.push(i);
    }
    if (typeof record.kind === 'string') {
      kindCounts.set(record.kind, (kindCounts.get(record.kind) ?? 0) + 1);
    }
    if (typeof record.timestamp === 'number') timedPositions.push(i);
  }
  // Stable so that two records sharing a timestamp keep index order among themselves: a time
  // brush that lists them back in ledger order is the order the reader is looking at.
  timedPositions.sort((a, b) => {
    const delta = records[a].timestamp - records[b].timestamp;
    return delta === 0 ? a - b : delta;
  });
  const timeValues = new Float64Array(timedPositions.length);
  for (let i = 0; i < timedPositions.length; i += 1) timeValues[i] = records[timedPositions[i]].timestamp;
  return {
    recordCount: records.length,
    /** @type {Map<string, number[]>} */
    byMessageId,
    /** @type {Map<number, number[]>} */
    byGeneration,
    /** @type {Map<string, number>} */
    kindCounts,
    /** @type {Float64Array} */
    timeValues,
    /** @type {Int32Array} */
    timeRows: Int32Array.from(timedPositions),
    untimedCount: records.length - timedPositions.length,
  };
}

/**
 * The half-open record range a window request names, clamped to what exists.
 *
 * `limit` is bounded here rather than at the route so that every caller gets the same ceiling and
 * the guard can pin one number.
 *
 * @param {{ recordCount: number }} secondary
 * @param {{ from?: number | null, limit?: number | null, tail?: number | null }} request
 */
export function resolveWindow(secondary, request) {
  const total = secondary.recordCount;
  if (total === 0) return { from: 1, to: 0, limit: 0, total: 0 };
  const tail = typeof request.tail === 'number' && request.tail > 0 ? Math.min(request.tail, MAX_WINDOW_RECORDS) : null;
  const from = typeof request.from === 'number' && request.from > 0 ? request.from : 1;
  if (tail !== null) {
    const start = Math.max(1, total - tail + 1);
    return { from: start, to: total, limit: tail, total };
  }
  const limit = Math.min(
    typeof request.limit === 'number' && request.limit > 0 ? request.limit : MAX_WINDOW_RECORDS,
    MAX_WINDOW_RECORDS,
  );
  const start = Math.min(from, total);
  const end = Math.min(start + limit - 1, total);
  return { from: start, to: end, limit: end - start + 1, total };
}

/**
 * One window's worth of records: the range plus every turn that touches it.
 *
 * The extra turns are not padding. A group header carries the turn's token and error totals, so a
 * window that cut a turn in half would print a header describing rows the reader cannot see. The
 * turn table knows each turn's record span, which is why it is indexed separately.
 *
 * @param {{ turns: Array<Record<string, any>> }} index
 * @param {{ from: number, to: number, total: number }} range
 */
export function windowTurns(index, range) {
  const out = [];
  for (let i = 0; i < index.turns.length; i += 1) {
    const turn = index.turns[i];
    const first = typeof turn.firstRecord === 'number' ? turn.firstRecord : null;
    const last = typeof turn.lastRecord === 'number' ? turn.lastRecord : null;
    // A turn with no records still has a header the full payload emitted, so it is kept.
    if (first === null || last === null || last < first) {
      out.push({ turn, records: [] });
      continue;
    }
    const start = first + 1;
    const end = last + 1;
    if (end < range.from || start > range.to) continue;
    out.push({ turn, records: [Math.max(start, range.from), Math.min(end, range.to)] });
  }
  return out;
}

/**
 * Every record whose timestamp falls in a range, in ledger order.
 *
 * Bisected on the sorted side array and then sorted back into index order, because the answer a
 * brush highlights is a set of ledger rows and the page addresses them by record.
 *
 * @param {ReturnType<typeof buildSecondary>} secondary
 * @param {number} from inclusive
 * @param {number} to inclusive
 * @returns {number[]} record indexes
 */
export function recordsInTimeRange(secondary, from, to) {
  if (to < from || secondary.timeValues.length === 0) return [];
  const values = secondary.timeValues;
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] < from) lo = mid + 1;
    else hi = mid;
  }
  const hits = [];
  for (let i = lo; i < values.length && values[i] <= to; i += 1) hits.push(secondary.timeRows[i]);
  hits.sort((a, b) => a - b);
  return hits;
}

/** The most records one window response may carry, whatever the request asked for. */
export const MAX_WINDOW_RECORDS = 2000;

/**
 * A derived-artifact store under the runtime's data dir. Never beside the session history and never
 * inside the plugin package: the session store is read-only input, and the package installs onto
 * every reader's machine.
 *
 * @param {string} root
 */
export function createIndexStore(root) {
  const safe = (part) => String(part).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || '_';

  /**
   * @param {string} sessionKey
   * @param {string} view
   */
  const dirOf = (sessionKey, view) => join(root, safe(sessionKey), safe(view));

  return {
    /**
     * Publishes one view. The records land under their final name first; the manifest, which is
     * what makes the pair readable, lands last.
     *
     * @param {string} sessionKey
     * @param {string} view
     * @param {{ turns: Array<Record<string, any>>, records: IndexRecord[] }} rows
     * @param {{ files: IndexFile[], projectionDigest: string }} meta
     */
    async write(sessionKey, view, rows, meta) {
      const dir = dirOf(sessionKey, view);
      await mkdir(dir, { recursive: true });
      const text = serializeIndex(rows);
      const recordPath = join(dir, 'records.jsonl');
      const manifestPath = join(dir, 'manifest.json');
      await writeFile(`${recordPath}.tmp`, text, 'utf8');
      await rename(`${recordPath}.tmp`, recordPath);
      /** @type {IndexManifest} */
      const manifest = {
        schemaVersion: INDEX_SCHEMA_VERSION,
        projectionVersion: PROJECTION_VERSION,
        view,
        files: meta.files.map(stripPath),
        recordCount: rows.records.length,
        turnCount: rows.turns.length,
        turnsStart: 0,
        recordsBytes: Buffer.byteLength(text),
        recordsDigest: digestOf(text),
        projectionDigest: meta.projectionDigest,
      };
      await writeFile(`${manifestPath}.tmp`, `${JSON.stringify(manifest)}\n`, 'utf8');
      await rename(`${manifestPath}.tmp`, manifestPath);
      return manifest;
    },

    /**
     * Reads one view, or answers `null` for every reason it cannot be trusted: no manifest, a
     * manifest from another schema or another projection, a source file that moved, or records
     * whose bytes do not match the digest the manifest was written with.
     *
     * @param {string} sessionKey
     * @param {string} view
     * @param {IndexFile[]} sourceFiles the files the caller just stat()ed
     */
    async read(sessionKey, view, sourceFiles) {
      const dir = dirOf(sessionKey, view);
      let manifest;
      try {
        manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
      } catch {
        return null;
      }
      if (!manifest || typeof manifest !== 'object') return null;
      if (manifest.schemaVersion !== INDEX_SCHEMA_VERSION) return null;
      if (manifest.projectionVersion !== PROJECTION_VERSION) return null;
      if (manifest.view !== view) return null;
      if (!sameSources(manifest.files, sourceFiles)) return null;
      let text;
      try {
        text = await readFile(join(dir, 'records.jsonl'), 'utf8');
      } catch {
        return null;
      }
      const rows = parseIndex(text, manifest);
      if (rows === null) return null;
      return { manifest, ...rows };
    },

    /**
     * @param {string} sessionKey
     * @param {string} view
     */
    async discard(sessionKey, view) {
      await rm(dirOf(sessionKey, view), { recursive: true, force: true });
    },

    dirOf,
  };
}

/**
 * Whether the source a stored index was built from is still the source on disk.
 *
 * Identity is per file: the same names, in the same order, each with the same generation and the
 * same byte length. `revision` is the runtime's own sha256 when the catalog carries one, and it is
 * compared when both sides have it — that catches a rewrite which happened to preserve the length,
 * which a length check alone cannot. Mtime is deliberately NOT compared: it moves when the file is
 * touched without being written, and a reader that treated that as a change would rebuild a
 * correct index for nothing on every poll.
 *
 * @param {IndexFile[]} stored
 * @param {IndexFile[]} live
 */
export function sameSources(stored, live) {
  if (!Array.isArray(stored) || !Array.isArray(live)) return false;
  if (stored.length !== live.length) return false;
  for (let i = 0; i < stored.length; i += 1) {
    const a = stored[i];
    const b = live[i];
    if (!a || !b) return false;
    if (a.fileName !== b.fileName) return false;
    if (a.generation !== b.generation) return false;
    if (a.size !== b.size) return false;
    // A generation that was read short is not the same answer as one that was read whole, even
    // though both report the same `size`. Compared as booleans so an artifact written before this
    // field existed is rejected once and rebuilt, rather than trusted.
    if ((a.truncated === true) !== (b.truncated === true)) return false;
    if (typeof a.revision === 'string' && a.revision.length > 0
      && typeof b.revision === 'string' && b.revision.length > 0 && a.revision !== b.revision) {
      return false;
    }
  }
  return true;
}

/**
 * What every served answer has to reproduce, reduced to one comparable value.
 *
 * The index is allowed to be a different shape from the payload — that is the point of it. It is
 * not allowed to be a different ANSWER, and this is how that is checked rather than asserted.
 *
 * @param {{ stats: Record<string, any>, session: Record<string, any> }} payload
 * @returns {string}
 */
export function projectionDigestOf(payload) {
  return digestOf(JSON.stringify({
    stats: payload.stats,
    session: {
      messageCount: payload.session.messageCount,
      turnCount: payload.session.turnCount,
      startedAt: payload.session.startedAt,
      generation: payload.session.generation,
    },
  }));
}
