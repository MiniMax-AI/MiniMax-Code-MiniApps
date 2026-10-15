// @ts-check

// Immutable search segments: the text a session can be searched for, stored once per sealed
// generation so that asking the question again does not cost a re-read of 198 MB.
//
// WHY A SEGMENT AND NOT A FIELD ON THE INDEX. The search surface is five fields per record
// (summary, text, result, thinking, toolName) — measured at 36.7 MB for a 44-generation session,
// against 8.6 MB for the index. Folding it in would make every read of the index pay for search, on
// a page that reads the index every eight seconds and searches when someone types. Kept apart, the
// ordinary read never opens the surface and a search never opens the index's own metadata twice.
//
// WHY PER GENERATION AND NOT PER SESSION. A sealed generation's records cannot change, so its
// surface cannot either — that is what makes the segment a thing that is written once. The active
// generation is being appended to right now and is therefore never stored: it is searched from the
// rows the request already read. A session-level file would have to be rewritten on every append,
// which is the exact cost the split exists to avoid.
//
// THE SCAN MAY NOT CROSS A RECORD BOUNDARY. One record's surface is one line, and the scan tests
// each line on its own. Joining the surfaces into one blob first would let a needle that starts at
// the end of one record and finishes at the start of the next report a match that exists in neither.
// That is not a theoretical difference: it is the one thing this file has to get right, so it is an
// invariant with a fixture rather than a comment.
//
// FOUR QUESTIONS.
//
// 归层 — server only. A segment is a derived artifact under the runtime's data dir; the page never
// sees one, it sees the records a scan returned. No client state is written from here.
//
// 关联 — subordinate to the projection that produced the records, and parallel to the index: both
// describe the same records and both are invalidated by the same source identity. A search hit is
// resolved back to the current ledger THROUGH the index, so a hit in a sealed generation and a hit
// in the live one answer in the same shape.
//
// 布局 — no new surface. A new read on the route that already exists; the search box is the same
// control, and this is the only thing that changes about it.
//
// 口径 — the searched text has to be the text the page was searching. `searchSurfaceOf` is the
// page's own `recordSearchText` with the five fields in the page's order, folded once at build time;
// verify-search-segments.mjs holds them equal field for field, because a segment that dropped a
// field would quietly narrow what a reader can find.

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Bumped when the on-disk shape changes in a way an older reader cannot survive. */
export const SEGMENT_SCHEMA_VERSION = 3;

/**
 * The fields a search reads, in the page's order.
 *
 * This is the page's `recordSearchText` field list, and the order is load-bearing for the equality
 * check: two field lists that differ only in order produce different surfaces, so a reader searching
 * for a phrase that spans two of them would hit in one build and miss in another.
 */
export const SEARCH_FIELDS = ['summary', 'text', 'result', 'thinking', 'toolName'];

/** @typedef {{ fileName: string, generation: number | null, size: number, revision: string | null, truncated?: boolean }} SegmentSource */

/** @typedef {{ schemaVersion: number, generation: number | null, view: string, recordCount: number, surfaceBytes: number, surfaceDigest: string, source: SegmentSource[] }} SegmentManifest */

/**
 * One record's searchable text.
 *
 * ONE NORMALISATION, stated once and applied to both sides. The page's own `recordSearchText` reads
 * the same five fields in the same order, joins them with a newline and folds to lower case. Here
 * every run of whitespace becomes a single space and the ends are trimmed — which is what makes a
 * record one line, and what `foldNeedle` does to the needle before the scan.
 *
 * Why one rule and not two. The first draft skipped empty fields AND flattened newlines, which are
 * two separate differences from the page and read as one. Worse, the first draft's separator
 * difference was invisible: with the page's newline between the five fields a record became five
 * lines, so a scan's line number stopped being the record ordinal its locators were numbered by,
 * and a hit resolved to whichever record sat at that line. `verify-search-segments.mjs` holds this
 * function equal to the page's under exactly this normalisation, field for field, plus the ordinal
 * that string equality cannot see.
 *
 * @param {Record<string, any>} record a projected record
 * @returns {string}
 */
export function searchSurfaceOf(record) {
  const parts = [];
  for (const field of SEARCH_FIELDS) {
    const value = record === null || record === undefined ? null : record[field];
    parts.push(typeof value === 'string'
      ? value
      : value !== null && value !== undefined && typeof value === 'object'
        ? (typeof value.text === 'string' ? value.text : '')
        : '');
  }
  return normaliseWhitespace(parts.join('\n')).toLowerCase();
}

/**
 * Every run of whitespace becomes one space, and the ends are trimmed.
 *
 * Applied to a record's surface AND to the needle, so what the reader typed cannot decide whether a
 * record matches on how the page happened to lay the five fields out.
 *
 * @param {string} value
 */
export function normaliseWhitespace(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

/**
 * Where each record sat in the file it came from, in ledger order.
 *
 * This used to be `indexRowsFromPayload` in a module called `trajectory-index`, and it used to
 * return a whole index row per record — every field except five excluded ones — so that the index
 * artifact could be written to disk. Nothing read that artifact back, so the shape was paid for on
 * every publish and consumed by exactly one caller.
 *
 * That caller read **one** of the three fields, and still does: `fileIdx` is the per-generation
 * grouping key, so a record goes into the segment for the source file its locator names, and a
 * record with no locator lands in no segment at all rather than in whichever generation happens to
 * be first.
 *
 * The other two — `byteStart` and `byteEnd`, the byte range the record occupied in that file — are
 * gone as of schema 3. They rode along on the segment line's JSON prefix and **nothing in the
 * shipped search path ever read them back**: `readSegmentHits` picks five fields off that prefix and
 * drops the rest, and `/api/trajectory/record` answers from the in-memory lineage cache rather than
 * from a segment. What they bought was a capability nothing exercised — a hit in a sealed
 * generation mapped back to the line it came from — for 4.36% of a real segment surface, 49 bytes a
 * line (1,177-line, 1.3 MB segment).
 *
 * They came from a design rule that was right and unfinished: a segment line carries *everything a
 * hit has to answer with*, so a hit would be self-sufficient. The route that opens a hit never took
 * that path — it answers from the lineage cache and reports `trajectory_not_cached` when that cache
 * is cold, and it does not re-parse to get out of it. So the promise was never kept and the fields
 * were paid for in full. Completing it would have been the wrong fix anyway: the trajectory route
 * re-parses (`loadParsedRows` keys on size and mtime) and refills that cache, and a record is only
 * ever opened from a ledger the page could already draw — which came from one of those payloads.
 * Nothing on this path needs a position on disk.
 *
 * The function is renamed with the shape. It no longer produces locators, and a name that still
 * claimed to is the kind of debt this file has been paying down since the index was retired.
 *
 * `raws` is the record -> locator map the route already builds for `/raw`. A record with no
 * locator gets `-1`, and that is a real state rather than a gap to be filled: repairing it to `0`
 * would file the record under whichever source file happens to be first, which is a different
 * generation's message.
 *
 * @param {{ turns: Array<{ records: Array<{ index: number }> }> }} payload
 * @param {Map<number, { filePath: string }>} raws
 * @param {Array<{ filePath?: string }>} files
 * @returns {Array<{ fileIdx: number }>} one entry per record,
 *   in the same order the payload's turns and their records are walked
 */
export function fileIdxRowsFromPayload(payload, raws, files) {
  const pathToFileIdx = new Map();
  files.forEach((file, i) => {
    // Matched on the full path, not the file name: two generations can each hold a file the
    // catalog names the same way, and a basename match would file one generation's records
    // under the other. First writer wins, because a path is only in the table once per session.
    if (typeof file.filePath === 'string' && !pathToFileIdx.has(file.filePath)) {
      pathToFileIdx.set(file.filePath, i);
    }
  });
  const out = [];
  for (const turn of payload.turns) {
    for (const record of turn.records) {
      const locator = raws.get(record.index);
      out.push(locator === undefined
        ? { fileIdx: -1 }
        : { fileIdx: pathToFileIdx.get(locator.filePath) ?? -1 });
    }
  }
  return out;
}

/**
 * Builds one generation's searchable lines.
 *
 * Each line is `<compact json>\t<searchable text>`, one line per record in ledger order, and it
 * carries everything a hit has to answer with: the ledger `index`, the `turnIndex`, `kind`,
 * `generation`, the projected `summary`, and the `fileIdx` it was filed under.
 *
 * Why the answer travels with the searchable text: answering used to mean reading the session's
 * whole record index as well — measured at 34.2 MB of JSONL for the largest session on this
 * machine, parsed on every search, which was 1.7 s of the 1.7 s left after the projection stopped
 * being rebuilt. A needle that matches 14 records out of 36,525 does not need the other 36,511,
 * and it does not need them parsed either.
 *
 * `fileIdx` is the one field here that is not part of a hit's answer: nothing reads it back, because
 * the segment a record lands in already *is* the generation it came from. It survives because the
 * grouping is done by comparing against it, and a comparison needs both sides to name the same
 * number. The byte range that used to sit beside it had no such caller and is gone at schema 3 —
 * see `fileIdxRowsFromPayload`.
 *
 * The separator is a TAB and the searchable part comes last, so a needle can never match across the
 * boundary into the JSON prefix — the record it would name is then a match spanning two records,
 * which is the one thing a per-record scan exists to prevent.
 *
 * @param {{ records: Array<Record<string, any>> }} input records of ONE generation, in ledger order
 * @returns {{ surface: string }}
 */
export function buildSegment(input) {
  const lines = [];
  for (let i = 0; i < input.records.length; i += 1) {
    const record = input.records[i];
    lines.push(JSON.stringify({
      ordinal: i,
      index: typeof record.index === 'number' ? record.index : -1,
      turnIndex: typeof record.turnIndex === 'number' ? record.turnIndex : null,
      kind: typeof record.kind === 'string' ? record.kind : '',
      generation: typeof record.generation === 'number' ? record.generation : null,
      summary: typeof record.summary === 'string' ? record.summary : '',
      fileIdx: typeof record.fileIdx === 'number' ? record.fileIdx : -1,
    }) + '\t' + searchSurfaceOf(record));
  }
  return { surface: lines.join('\n') };
}

/**
 * Every record ordinal whose own searchable text contains the needle.
 *
 * Per line, on purpose: this is the boundary. A needle cannot be answered from anything but one
 * record's own five fields, because a match spanning two records describes no record. So only the
 * part after the TAB is tested — the JSON prefix holds the record's kind and summary, and a needle
 * matching there would be matching an answer rather than the text being looked for.
 *
 * @param {string} surface
 * @param {string} needle already folded, by {@link foldNeedle}
 * @returns {number[]}
 */
export function scanSegment(surface, needle) {
  if (needle === '') return [];
  const hits = [];
  let start = 0;
  let ordinal = 0;
  while (start <= surface.length) {
    const nl = surface.indexOf('\n', start);
    const end = nl === -1 ? surface.length : nl;
    const line = surface.slice(start, end);
    const tab = line.indexOf('\t');
    if (tab >= 0 && line.slice(tab + 1).includes(needle)) hits.push(ordinal);
    ordinal += 1;
    if (nl === -1) break;
    start = nl + 1;
  }
  return hits;
}

/**
 * One record's answer, read back out of the line {@link scanSegment} matched.
 *
 * Walks the segment ONCE for the whole batch. The first version took one ordinal and scanned from
 * the beginning to find it, which is fine for a guard checking one record and catastrophic for the
 * route: a needle like "the" matched 14,092 records on the largest session here, and 14,092 scans
 * of a 1.3 MB segment is eighteen gigabytes of walking to answer a search. Measured, and it is the
 * reason this looked like no improvement at all.
 *
 * The ordinals come from the scan, so a caller cannot answer with a record other than the one the
 * scan named, and they are returned in the order asked for rather than the order they sit.
 *
 * @param {string} surface the whole segment text
 * @param {number[]} ordinals as returned by {@link scanSegment}
 * @returns {Array<{ index: number, turnIndex: number | null, kind: string, summary: string, generation: number | null } | null>}
 */
export function readSegmentHits(surface, ordinals) {
  const wanted = new Set(ordinals);
  /** @type {Map<number, { index: number, turnIndex: number | null, kind: string, summary: string, generation: number | null } | null>} */
  const found = new Map();
  if (wanted.size === 0) return [];
  let start = 0;
  let at = 0;
  while (start <= surface.length) {
    const nl = surface.indexOf('\n', start);
    const end = nl === -1 ? surface.length : nl;
    if (wanted.has(at)) {
      const tab = surface.indexOf('\t', start);
      if (tab < 0 || tab > end) {
        found.set(at, null);
      } else {
        /** @type {any} */
        let parsed;
        try {
          parsed = JSON.parse(surface.slice(start, tab));
        } catch {
          parsed = null;
        }
        found.set(at, parsed === null || typeof parsed !== 'object' ? null : {
          index: typeof parsed.index === 'number' ? parsed.index : -1,
          turnIndex: typeof parsed.turnIndex === 'number' ? parsed.turnIndex : null,
          kind: typeof parsed.kind === 'string' ? parsed.kind : '',
          summary: typeof parsed.summary === 'string' ? parsed.summary : '',
          generation: typeof parsed.generation === 'number' ? parsed.generation : null,
        });
      }
    }
    at += 1;
    if (nl === -1) break;
    start = nl + 1;
  }
  return ordinals.map((ordinal) => found.get(ordinal) ?? null);
}

/**
 * The needle in the form the surface was stored in: normalised the same way a surface is, then
 * folded. Folding the needle rather than the surface at query time is what keeps the scan a plain
 * substring test — `String.prototype.includes` is case-sensitive.
 *
 * @param {string} needle
 * @returns {string}
 */
export function foldNeedle(needle) {
  return normaliseWhitespace(typeof needle === 'string' ? needle : '').toLowerCase();
}

/**
 * A needle long enough to be worth scanning for. Measured against the page's own minimum: a shorter
 * one matches almost every record, and a search that returns the whole ledger is not an answer.
 * @param {string} needle
 */
export function needleIsUsable(needle) {
  return foldNeedle(needle).trim().length >= MIN_NEEDLE_CHARS;
}

/** Characters. Two is the floor, not a preference: one character matched most records measured. */
export const MIN_NEEDLE_CHARS = 2;

/**
 * How many hits a single search reports before it stops counting.
 *
 * A bound rather than a page size: the count is real and continues past it, and what the reader sees
 * is the first N. The alternative — returning every hit in a session where a two-character needle
 * matches ten thousand — is a response nobody can use.
 *
 * @param {number[]} hits
 * @param {number} [limit]
 * @returns {{ ordinals: number[], total: number, truncated: boolean }}
 */
export function capHits(hits, limit = MAX_HITS) {
  if (hits.length <= limit) return { ordinals: hits, total: hits.length, truncated: false };
  return { ordinals: hits.slice(0, limit), total: hits.length, truncated: true };
}

/** The most hits one search response carries. */
export const MAX_HITS = 500;

/**
 * @param {string} text
 */
export function digestOf(text) {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * The store. Under the runtime's data dir and nowhere else: the session history is read-only input,
 * and the plugin package installs onto every reader's machine.
 *
 * @param {string} root
 */
export function createSegmentStore(root) {
  const safe = (part) => String(part).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || '_';

  /** @param {string} sessionKey @param {string} view @param {string} generationKey */
  const dirOf = (sessionKey, view, generationKey) =>
    join(root, safe(sessionKey), safe(view), safe(generationKey));

  return {
    dirOf,

    /**
     * Publishes one generation's text. The surface lands first, then the manifest that makes it
     * readable — so a run interrupted anywhere leaves a directory that reads as "no segment"
     * rather than as half of one.
     *
     * There used to be a second file, the locators, holding one small JSON object per record. It
     * was never read on the search path: it names where each record came from, and nothing that
     * answers a search needs that. When the answer itself moved onto each line, the locator fields
     * came with it and the file had nothing left to say.
     *
     * @param {string} sessionKey
     * @param {string} view
     * @param {string} generationKey
     * @param {{ surface: string }} segment
     * @param {{ generation: number | null, source: SegmentManifest['source'] }} meta
     */
    async write(sessionKey, view, generationKey, segment, meta) {
      const dir = dirOf(sessionKey, view, generationKey);
      await mkdir(dir, { recursive: true });
      await writeFile(`${join(dir, 'surface.txt')}.tmp`, segment.surface, 'utf8');
      await rename(`${join(dir, 'surface.txt')}.tmp`, join(dir, 'surface.txt'));
      /** @type {SegmentManifest} */
      const manifest = {
        schemaVersion: SEGMENT_SCHEMA_VERSION,
        generation: meta.generation,
        view,
        recordCount: segment.surface === '' ? 0 : segment.surface.split('\n').length,
        surfaceBytes: Buffer.byteLength(segment.surface),
        surfaceDigest: digestOf(segment.surface),
        source: meta.source,
      };
      await writeFile(`${join(dir, 'manifest.json')}.tmp`, `${JSON.stringify(manifest)}\n`, 'utf8');
      await rename(`${join(dir, 'manifest.json')}.tmp`, join(dir, 'manifest.json'));
      return manifest;
    },

    /**
     * Reads one generation's pair, or answers `null` for every reason it cannot be trusted: no
     * manifest, a manifest from another schema or another view, a source that moved, or bytes that
     * do not match the digests the manifest was written with.
     *
     * @param {string} sessionKey
     * @param {string} view
     * @param {string} generationKey
     * @param {SegmentManifest['source']} source
     */
    async read(sessionKey, view, generationKey, source) {
      const dir = dirOf(sessionKey, view, generationKey);
      /** @type {any} */
      let manifest;
      try {
        manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
      } catch {
        return null;
      }
      if (!manifest || typeof manifest !== 'object') return null;
      if (manifest.schemaVersion !== SEGMENT_SCHEMA_VERSION) return null;
      if (manifest.view !== view) return null;
      if (!sameSource(manifest.source, source)) return null;
      let surface;
      try {
        surface = await readFile(join(dir, 'surface.txt'), 'utf8');
      } catch {
        return null;
      }
      if (digestOf(surface) !== manifest.surfaceDigest) return null;
      const lines = surface === '' ? 0 : surface.split('\n').length;
      if (lines !== manifest.recordCount) return null;
      return { manifest, surface };
    },

    /** @param {string} sessionKey @param {string} view @param {string} generationKey */
    async discard(sessionKey, view, generationKey) {
      await rm(dirOf(sessionKey, view, generationKey), { recursive: true, force: true });
    },
  };
}

/**
 * Whether the generation a segment was built from is still the generation on disk.
 *
 * Identity, not mtime: a sealed file is not written to, and a reader that treated a touch as a
 * change would rebuild correct bytes on every poll.
 *
 * @param {SegmentManifest['source']} stored
 * @param {SegmentManifest['source']} live
 */
export function sameSource(stored, live) {
  if (!Array.isArray(stored) || !Array.isArray(live)) return false;
  if (stored.length === 0 || stored.length !== live.length) return false;
  for (let i = 0; i < stored.length; i += 1) {
    const a = stored[i];
    const b = live[i];
    if (!a || !b) return false;
    if (a.fileName !== b.fileName) return false;
    if (a.generation !== b.generation) return false;
    if (a.size !== b.size) return false;
    // Same reason as in the index: a generation read short by our own cap produces a segment that
    // covers a prefix, while `size` is the whole file. Trusting it would answer with a smaller
    // `total` and say nothing about being wrong.
    if ((a.truncated === true) !== (b.truncated === true)) return false;
    if (typeof a.revision === 'string' && a.revision.length > 0
      && typeof b.revision === 'string' && b.revision.length > 0 && a.revision !== b.revision) {
      return false;
    }
  }
  return true;
}

/**
 * The key a generation's segment is stored under. The generation number, not the file name: two
 * sessions may store the same file name, and a segment that answered for another session's
 * generation would return records that do not exist here.
 *
 * @param {number | null} generation
 */
export function generationKey(generation) {
  return generation === null || generation === undefined ? 'active' : `g${generation}`;
}
