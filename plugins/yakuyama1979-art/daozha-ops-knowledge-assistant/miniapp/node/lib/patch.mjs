// SEARCH/REPLACE patch parsing, unique-match verification and unified diff generation.

const SEARCH_MARKER = /^<{3,}\s*SEARCH\b/;
const SEPARATOR_MARKER = /^={3,}\s*$/;
const REPLACE_MARKER = /^>{3,}\s*REPLACE\b/;

/**
 * Parses SEARCH/REPLACE blocks out of a model reply.
 * @param {string} modelText
 * @returns {Array<{ search:string, replace:string }>}
 */
export function parsePatchBlocks(modelText) {
  const lines = String(modelText || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let state = null;
  let searchLines = [];
  let replaceLines = [];

  const flush = () => {
    if (state === null) return;
    const search = trimBlankEdges(searchLines);
    const replace = trimBlankEdges(replaceLines);
    if (search) blocks.push({ search, replace });
    state = null;
    searchLines = [];
    replaceLines = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (SEARCH_MARKER.test(trimmed)) {
      flush();
      state = 'search';
      continue;
    }
    if (SEPARATOR_MARKER.test(trimmed) && state === 'search') {
      state = 'replace';
      continue;
    }
    if (REPLACE_MARKER.test(trimmed)) {
      flush();
      continue;
    }
    if (state === 'search') searchLines.push(line);
    else if (state === 'replace') replaceLines.push(line);
  }
  flush();
  return blocks;
}

function trimBlankEdges(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === '') start += 1;
  while (end > start && lines[end - 1].trim() === '') end -= 1;
  return lines.slice(start, end).join('\n');
}

export function countOccurrences(content, needle) {
  if (!needle) return 0;
  let count = 0;
  let index = content.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = content.indexOf(needle, index + Math.max(1, needle.length));
  }
  return count;
}

/**
 * Applies patch blocks. Every block must match the current text exactly once.
 * @param {string} content
 * @param {Array<{ search:string, replace:string }>} blocks
 */
export function applyBlocks(content, blocks) {
  if (!blocks.length) throw new Error('patch_no_blocks_parsed');
  let current = String(content);
  const applied = [];
  for (const block of blocks) {
    const search = block.search;
    if (!search.trim()) throw new Error('patch_search_block_empty');
    let occurrences = countOccurrences(current, search);
    let usedSearch = search;
    let normalized = false;
    if (occurrences === 0) {
      const relaxed = search
        .split('\n')
        .map((line) => line.replace(/[ \t]+$/, ''))
        .join('\n');
      if (relaxed !== search) {
        occurrences = countOccurrences(current, relaxed);
        if (occurrences === 1) {
          usedSearch = relaxed;
          normalized = true;
        }
      }
    }
    if (occurrences === 0) {
      throw new Error(`patch_search_not_found: 第 ${applied.length + 1} 个补丁块在文件中找不到原文`);
    }
    if (occurrences > 1) {
      throw new Error(
        `patch_search_not_unique: 第 ${applied.length + 1} 个补丁块在文件中出现 ${occurrences} 次，需要补充上下文`,
      );
    }
    current = current.replace(usedSearch, () => block.replace);
    applied.push({
      index: applied.length,
      occurrences,
      normalized,
      matchedCharacters: usedSearch.length,
    });
  }
  return { content: current, applied };
}

/* --------------------------------------------------------------- unified diff */

export function unifiedDiff(oldText, newText, oldLabel = 'a/file', newLabel = 'b/file', context = 3) {
  const before = String(oldText).split('\n');
  const after = String(newText).split('\n');

  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (
    endBefore > start &&
    endAfter > start &&
    before[endBefore - 1] === after[endAfter - 1]
  ) {
    endBefore -= 1;
    endAfter -= 1;
  }

  const middleBefore = before.slice(start, endBefore);
  const middleAfter = after.slice(start, endAfter);
  const operations = diffOperations(middleBefore, middleAfter);
  if (!operations.some((operation) => operation.type !== 'eq')) return '';

  const items = [];
  // Leading context: the common prefix, trimmed to `context` lines.
  const leadStart = Math.max(0, start - context);
  for (let index = leadStart; index < start; index += 1) {
    items.push({ type: 'eq', value: before[index], oldIndex: index, newIndex: index });
  }
  // Changed region.
  let oldIndex = start;
  let newIndex = start;
  for (const operation of operations) {
    if (operation.type === 'eq') {
      items.push({ type: 'eq', value: operation.value, oldIndex, newIndex });
      oldIndex += 1;
      newIndex += 1;
    } else if (operation.type === 'del') {
      items.push({ type: 'del', value: operation.value, oldIndex, newIndex });
      oldIndex += 1;
    } else {
      items.push({ type: 'ins', value: operation.value, oldIndex, newIndex });
      newIndex += 1;
    }
  }
  // Trailing context: the common suffix, trimmed to `context` lines.
  const tailCount = Math.min(context, after.length - endAfter);
  for (let offset = 0; offset < tailCount; offset += 1) {
    items.push({
      type: 'eq',
      value: after[endAfter + offset],
      oldIndex: endBefore + offset,
      newIndex: endAfter + offset,
    });
  }

  const changedPositions = [];
  items.forEach((item, index) => {
    if (item.type !== 'eq') changedPositions.push(index);
  });
  if (!changedPositions.length) return '';

  const groups = [];
  let groupStart = changedPositions[0];
  let groupEnd = changedPositions[0];
  for (const position of changedPositions.slice(1)) {
    if (position - groupEnd > context * 2) {
      groups.push([groupStart, groupEnd]);
      groupStart = position;
    }
    groupEnd = position;
  }
  groups.push([groupStart, groupEnd]);

  const lines = [`--- ${oldLabel}`, `+++ ${newLabel}`];
  for (const [from, to] of groups) {
    const sliceStart = Math.max(0, from - context);
    const sliceEnd = Math.min(items.length - 1, to + context);
    const slice = items.slice(sliceStart, sliceEnd + 1);
    const oldCount = slice.filter((item) => item.type !== 'ins').length;
    const newCount = slice.filter((item) => item.type !== 'del').length;
    const oldStart = slice.find((item) => item.type !== 'ins');
    const newStart = slice.find((item) => item.type !== 'del');
    lines.push(
      `@@ -${(oldStart ? oldStart.oldIndex : 0) + 1},${oldCount} +${(newStart ? newStart.newIndex : 0) + 1},${newCount} @@`,
    );
    for (const item of slice) {
      const marker = item.type === 'eq' ? ' ' : item.type === 'del' ? '-' : '+';
      lines.push(`${marker}${item.value}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function diffOperations(before, after) {
  const n = before.length;
  const m = after.length;
  if (n * m > 4_000_000) {
    return [
      ...before.map((value) => ({ type: 'del', value })),
      ...after.map((value) => ({ type: 'ins', value })),
    ];
  }
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        before[i] === after[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const operations = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      operations.push({ type: 'eq', value: before[i] });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      operations.push({ type: 'del', value: before[i] });
      i += 1;
    } else {
      operations.push({ type: 'ins', value: after[j] });
      j += 1;
    }
  }
  while (i < n) {
    operations.push({ type: 'del', value: before[i] });
    i += 1;
  }
  while (j < m) {
    operations.push({ type: 'ins', value: after[j] });
    j += 1;
  }
  return operations;
}

/* ------------------------------------------------------------------- outlines */

const ANCHOR_PATTERNS = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+[\w$]/,
  /^\s*(?:def|class)\s+\w/,
  /^\s*#\s*\S/,
  /^\s*\/\/\s*\S/,
  /^\s*\/\*\s*\S/,
  /^\s*@media\b/,
  /^\s*[.#][\w-][^{]*\{/,
  /^\s*<\/?[a-zA-Z][^>]*>/,
  /^\s*(?:if|for|while|switch|case)\b/,
];

/**
 * Builds a compact outline of a file so a model can locate the right region
 * even when the file does not fit into the context window.
 * @param {string} content
 */
export function buildOutline(content, options = {}) {
  const limit = options.limit || 160;
  const lines = String(content).split('\n');
  const anchors = [];
  lines.forEach((line, index) => {
    if (anchors.length >= limit) return;
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 160) return;
    if (!ANCHOR_PATTERNS.some((pattern) => pattern.test(line))) return;
    anchors.push(`${index + 1}: ${trimmed}`);
  });
  return {
    totalLines: lines.length,
    totalCharacters: content.length,
    anchors,
    header: lines.slice(0, 12).join('\n'),
  };
}

/**
 * Extracts a window of lines around a located region.
 * @param {string} content
 * @param {number} startLine 1-based
 * @param {number} endLine 1-based
 */
export function extractWindow(content, startLine, endLine, padding = 6) {
  const lines = String(content).split('\n');
  const from = Math.max(1, startLine - padding);
  const to = Math.min(lines.length, endLine + padding);
  return {
    from,
    to,
    text: lines.slice(from - 1, to).join('\n'),
  };
}

/** Finds the densest region of a file for keywords found in a requirement. */
export function locateByKeywords(content, requirement) {
  const lines = String(content).split('\n');
  const terms = String(requirement || '')
    .toLowerCase()
    .split(/[^a-z0-9一-龥]+/)
    .filter((term) => term.length >= 2);
  if (!terms.length) return null;
  const hits = lines.map((line) => {
    const lower = line.toLowerCase();
    let score = 0;
    for (const term of terms) if (lower.includes(term)) score += 1;
    return score;
  });
  let best = null;
  let window = 0;
  lines.forEach((_, index) => {
    window += hits[index].score;
    if (index >= 40) window -= hits[index - 40].score;
    if (!best || window > best.score) best = { score: window, index };
  });
  if (!best || best.score <= 0) return null;
  const start = Math.max(1, best.index - 20);
  const end = Math.min(lines.length, best.index + 40);
  return { startLine: start, endLine: end, method: 'keyword' };
}
