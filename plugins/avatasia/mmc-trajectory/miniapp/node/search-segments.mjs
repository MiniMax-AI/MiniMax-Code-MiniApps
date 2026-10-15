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
export const SEGMENT_SCHEMA_VERSION = 1;

/**
 * The fields a search reads, in the page's order.
 *
 * This is the page's `recordSearchText` field list, and the order is load-bearing for the equality
 * check: two field lists that differ only in order produce different surfaces, so a reader searching
 * for a phrase that spans two of them would hit in one build and miss in another.
 */
export const SEARCH_FIELDS = ['summary', 'text', 'result', 'thinking', 'toolName'];

/** @typedef {{ ordinal: number, fileIdx: number, byteStart: number, byteEnd: number }} SegmentLocator */

/** @typedef {{ fileName: string, generation: number | null, size: number, revision: string | null, truncated?: boolean }} SegmentSource */

/** @typedef {{ schemaVersion: number, generation: number | null, view: string, recordCount: number, surfaceBytes: number, locatorBytes: number, surfaceDigest: string, locatorDigest: string, source: SegmentSource[] }} SegmentManifest */

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
 * Builds one generation's pair: the surface and the locators that name where each of its records
 * came from.
 *
 * @param {{ records: Array<Record<string, any>> }} input records of ONE generation, in ledger order
 * @returns {{ surface: string, locators: string }}
 */
export function buildSegment(input) {
  const surfaceLines = [];
  const locatorLines = [];
  for (let i = 0; i < input.records.length; i += 1) {
    const record = input.records[i];
    surfaceLines.push(searchSurfaceOf(record));
    /** @type {SegmentLocator} */
    const locator = {
      ordinal: i,
      fileIdx: typeof record.fileIdx === 'number' ? record.fileIdx : -1,
      byteStart: typeof record.byteStart === 'number' ? record.byteStart : -1,
      byteEnd: typeof record.byteEnd === 'number' ? record.byteEnd : -1,
    };
    locatorLines.push(JSON.stringify(locator));
  }
  return { surface: surfaceLines.join('\n'), locators: locatorLines.join('\n') };
}

/**
 * Every record ordinal whose own surface contains the needle.
 *
 * Per line, on purpose: this is the boundary. A needle cannot be answered from anything but one
 * record's own five fields, because a match spanning two records describes no record.
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
    if (line.includes(needle)) hits.push(ordinal);
    ordinal += 1;
    if (nl === -1) break;
    start = nl + 1;
  }
  return hits;
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
     * Publishes one generation's pair. The surface lands, then the locators, then the manifest that
     * makes the pair readable — so a run interrupted anywhere leaves a directory that reads as "no
     * segment" rather than as half of one.
     *
     * @param {string} sessionKey
     * @param {string} view
     * @param {string} generationKey
     * @param {{ surface: string, locators: string }} segment
     * @param {{ generation: number | null, source: SegmentManifest['source'] }} meta
     */
    async write(sessionKey, view, generationKey, segment, meta) {
      const dir = dirOf(sessionKey, view, generationKey);
      await mkdir(dir, { recursive: true });
      await writeFile(`${join(dir, 'surface.txt')}.tmp`, segment.surface, 'utf8');
      await rename(`${join(dir, 'surface.txt')}.tmp`, join(dir, 'surface.txt'));
      await writeFile(`${join(dir, 'locators.jsonl')}.tmp`, segment.locators, 'utf8');
      await rename(`${join(dir, 'locators.jsonl')}.tmp`, join(dir, 'locators.jsonl'));
      /** @type {SegmentManifest} */
      const manifest = {
        schemaVersion: SEGMENT_SCHEMA_VERSION,
        generation: meta.generation,
        view,
        recordCount: segment.locators === '' ? 0 : segment.locators.split('\n').length,
        surfaceBytes: Buffer.byteLength(segment.surface),
        locatorBytes: Buffer.byteLength(segment.locators),
        surfaceDigest: digestOf(segment.surface),
        locatorDigest: digestOf(segment.locators),
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
      let locators;
      try {
        surface = await readFile(join(dir, 'surface.txt'), 'utf8');
        locators = await readFile(join(dir, 'locators.jsonl'), 'utf8');
      } catch {
        return null;
      }
      if (digestOf(surface) !== manifest.surfaceDigest) return null;
      if (digestOf(locators) !== manifest.locatorDigest) return null;
      const lines = locators === '' ? [] : locators.split('\n');
      if (lines.length !== manifest.recordCount) return null;
      return { manifest, surface, locators: lines };
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
