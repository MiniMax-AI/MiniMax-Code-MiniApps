// @ts-check
// Selection affects one prompt only. Storage and the caller's entries remain untouched.
import { neutralizeMarks } from './relay-guard.mjs';
import { queryTerms, relevance } from './memory-query.mjs';

/** The whole memory area of one turn: the private one and the shared one together. */
export const MEMORY_CONTEXT_MAX = 6000;
/** The private area of one Bot gets the larger share; the shared one keeps the rest. */
export const MEMORY_SELF_MAX = 3600;
export const MEMORY_TEAM_MAX = 2400;

export 

function serializeEntry(entry) {
  return JSON.stringify({
    scope: entry.scope, id: entry.id, key: entry.key ?? '', revision: entry.revision ?? '',
    pinned: Boolean(entry.pinned),
    // A memory entry is written by a Bot (or by the user) and travels into the memory block of
    // every Bot that reads it. A protocol mark in it would close that block early, so the marks
    // go the way they go in a reply: out of the text, the words around them untouched.
    text: neutralizeMarks(String(entry.text ?? '')),
  });
}

/**
 * A shared self/team budget, including every marker, encoded value and separator.
 * Whole records that do not fit are skipped so smaller useful records can still fit.
 */
export function selectMemoryContext(scopedEntries, { query = '', limit = MEMORY_CONTEXT_MAX } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError('Memory context limit must be a non-negative integer');
  const terms = queryTerms(query);
  const candidates = scopedEntries.map((entry, index) => ({
    entry, index, score: relevance(entry, terms), added: Date.parse(entry.added ?? '') || 0,
  })).sort((a, b) => Number(Boolean(b.entry.pinned)) - Number(Boolean(a.entry.pinned)) ||
    b.score - a.score || b.added - a.added || b.index - a.index);
  const entries = [];
  const lines = [];
  let used = 0;
  for (const { entry } of candidates) {
    const line = serializeEntry(entry);
    const size = line.length + (lines.length ? 1 : 0);
    if (used + size > limit) continue;
    entries.push(entry);
    lines.push(line);
    used += size;
  }
  return { entries, text: lines.join('\n'), used, limit, total: scopedEntries.length, omitted: scopedEntries.length - entries.length };
}
