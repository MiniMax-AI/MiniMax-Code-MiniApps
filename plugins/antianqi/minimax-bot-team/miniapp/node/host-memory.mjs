// @ts-check
// A read-only view of the Host's own memory.
//
// The Host keeps its memory in files under ~/.minimax/memories/scopes/global. A Mini App Bot
// cannot call the Host's memory tools - they are not in a Mini App session's tool surface - so
// this module is the one door: it reads what the Host wrote and answers a query with excerpts
// that name their source. It never writes there.
//
// It is a second, narrower view of the same files, not the Host's memory: the Host decides
// what its own search finds, and nothing written here changes what the Host captures.

import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { queryTerms, relevance, strongTerms } from './memory-query.mjs';

/** Where the Host keeps the memory of the global scope. */
export const HOST_MEMORY_DIR = join(homedir(), '.minimax', 'memories', 'scopes', 'global');

/** How many excerpts one answer carries. */
export const HOST_MEMORY_MAX_HITS = 8;
/** How long one excerpt may be. */
export const HOST_MEMORY_MAX_EXCERPT = 500;
/** How long all excerpts together may be. */
export const HOST_MEMORY_MAX_TOTAL = 4000;
/** A file bigger than this is not read; the memory files are far smaller. */
const MAX_FILE_BYTES = 4 * 1024 * 1024;
/** How many files of one kind are read. */
const MAX_FILES = 400;

/** Two matches of the same weight: the summary is newer than the index it summarizes. */
const SOURCE_WEIGHT = { 'memory_summary.md': 1.3, 'MEMORY.md': 1.15, sessions: 1, notes: 1 };

async function readIfFile(path) {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_FILE_BYTES) return '';
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

async function listFiles(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name)
      .sort()
      .slice(0, MAX_FILES);
  } catch {
    return [];
  }
}

/** The keywords a record carries; they are what a query is matched against first. */
function keywordsOf(text) {
  const found = [];
  for (const match of String(text).matchAll(/keywords:\s*([^\n]+)/g)) {
    for (const part of match[1].split(',')) {
      const word = part.trim();
      if (word) found.push(word);
    }
  }
  for (const match of String(text).matchAll(/\[搜:\s*([^\]]+)\]/g)) {
    for (const part of match[1].split(',')) {
      const word = part.trim();
      if (word) found.push(word);
    }
  }
  return found.join(' ');
}

/** A short label for a record: the first line, cut to what a reader can scan. */
function titleOf(text) {
  const line = String(text).split('\n').map((part) => part.trim()).find(Boolean) ?? '';
  return line.replace(/^#+\s*/, '').replace(/^[-*]\s*/, '').slice(0, 60);
}

/** Blocks separated by a blank line: one entry each in the memory index. */
function blocksOf(text) {
  return String(text)
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
}

/** The `## ` sections of a file: a session is a set of them, a note mostly one. */
function sectionsOf(text) {
  const out = [];
  let title = '';
  let lines = [];
  for (const line of String(text).split('\n')) {
    const heading = /^#{1,3}\s+(.*)$/.exec(line);
    if (heading) {
      if (title || lines.length) out.push({ title, text: lines.join('\n').trim() });
      title = heading[1].trim();
      lines = [];
      continue;
    }
    lines.push(line);
  }
  if (title || lines.length) out.push({ title, text: lines.join('\n').trim() });
  return out.filter((section) => section.text || section.title);
}

/** @typedef {{ source: string, title: string, text: string, key: string }} HostMemoryRecord */

async function readRecords(dir) {
  /** @type {HostMemoryRecord[]} */
  const records = [];
  const push = (source, title, text) => {
    const body = String(text ?? '').trim();
    if (!body) return;
    records.push({ source, title: title || titleOf(body), text: body, key: keywordsOf(body) });
  };

  const summary = await readIfFile(join(dir, 'memory_summary.md'));
  if (summary) {
    for (const section of sectionsOf(summary)) {
      for (const line of section.text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('- ')) continue;
        push('memory_summary.md', titleOf(trimmed), trimmed);
      }
    }
  }

  const index = await readIfFile(join(dir, 'MEMORY.md'));
  if (index) {
    for (const block of blocksOf(index)) {
      if (block.startsWith('#')) continue;
      push('MEMORY.md', titleOf(block), block);
    }
  }

  const sessionsDir = join(dir, 'sessions');
  for (const name of await listFiles(sessionsDir)) {
    const text = await readIfFile(join(sessionsDir, name));
    if (!text) continue;
    for (const section of sectionsOf(text)) {
      push('sessions/' + name, section.title || titleOf(section.text), section.text);
    }
  }

  const notesDir = join(dir, 'extensions', 'ad_hoc', 'notes');
  for (const name of await listFiles(notesDir)) {
    const text = await readIfFile(join(notesDir, name));
    if (!text) continue;
    for (const section of sectionsOf(text)) {
      push('notes/' + name, section.title || titleOf(section.text), section.text);
    }
  }

  return records;
}

/** The part of a record around the first term that matched. */
function excerptOf(text, terms, max) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  const lower = flat.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const found = lower.indexOf(term.toLowerCase());
    if (found >= 0 && (at < 0 || found < at)) at = found;
  }
  if (at < 0) at = 0;
  const start = Math.max(0, at - 60);
  const slice = flat.slice(start, start + max);
  return (start > 0 ? '…' : '') + slice + (start + max < flat.length ? '…' : '');
}

/**
 * Search the Host's memory files.
 * @param {string} query what to look for
 * @param {{ dir?: string, limit?: number, maxExcerpt?: number, maxTotal?: number }} [options]
 */
export async function searchHostMemory(query, options = {}) {
  const dir = options.dir ?? HOST_MEMORY_DIR;
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : HOST_MEMORY_MAX_HITS;
  const maxExcerpt = Number.isInteger(options.maxExcerpt) && options.maxExcerpt > 0 ? options.maxExcerpt : HOST_MEMORY_MAX_EXCERPT;
  const maxTotal = Number.isInteger(options.maxTotal) && options.maxTotal > 0 ? options.maxTotal : HOST_MEMORY_MAX_TOTAL;
  const text = String(query ?? '').trim();
  const records = await readRecords(dir);
  const available = records.length > 0;
  if (!text) return { query: '', available, hits: [], terms: [], scanned: records.length, total: 0 };
  if (!available) return { query: text, available: false, hits: [], terms: [], scanned: 0, total: 0 };

  const terms = queryTerms(text);
  // A record has to carry one of the strong terms; the bigrams only make the score higher.
  const strong = strongTerms(text);
  const required = (strong.length ? strong : terms).map((term) => term.toLowerCase());
  const scored = records
    .map((record, index) => ({
      record,
      index,
      score: relevance(record, terms) * (SOURCE_WEIGHT[record.source.split('/')[0]] ?? 1),
    }))
    .filter((item) => {
      if (item.score <= 0) return false;
      const haystack = (item.record.text + ' ' + item.record.key).toLowerCase();
      return required.some((term) => haystack.includes(term));
    })
    .sort((a, b) => b.score - a.score || b.index - a.index);

  const hits = [];
  let used = 0;
  for (const item of scored) {
    if (hits.length >= limit) break;
    const excerpt = excerptOf(item.record.text, terms, maxExcerpt);
    if (used + excerpt.length > maxTotal && hits.length) break;
    used += excerpt.length;
    hits.push({
      source: item.record.source,
      title: item.record.title,
      excerpt,
      score: Math.round(item.score * 100) / 100,
    });
  }

  return {
    query: text,
    available: true,
    hits,
    terms: terms.slice(0, 12),
    scanned: records.length,
    total: scored.length,
  };
}

/** Whether the Host's memory files are there at all. */
export async function hostMemoryAvailable(dir = HOST_MEMORY_DIR) {
  const records = await readRecords(dir);
  return records.length > 0;
}