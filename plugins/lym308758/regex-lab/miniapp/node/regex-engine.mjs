// @ts-check

/**
 * @typedef {Object} MatchInfo
 * @property {number} index  Index of the match in the source text.
 * @property {number} end    Index just after the match.
 * @property {string} value  The matched substring.
 * @property {Array<{ value: string | null }>} groups  Capture groups, 1-based.
 * @property {Record<string, string> | null} namedGroups  Named capture groups.
 */

const MAX_MATCHES = 100000;

/**
 * Compile a pattern + flags, returning either a RegExp or the error message.
 * @param {string} pattern
 * @param {string} flags
 * @returns {{ regex: RegExp | null, error: string | null }}
 */
export function compile(pattern, flags) {
  try {
    return { regex: new RegExp(pattern, flags), error: null };
  } catch (error) {
    return { regex: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Run a regular expression against text and return every match.
 * @param {string} text
 * @param {string} pattern
 * @param {string} [flags]
 * @returns {{ ok: boolean, error?: string, global?: boolean, count?: number, matches?: MatchInfo[] }}
 */
export function runMatch(text, pattern, flags = '') {
  const { regex, error } = compile(pattern, flags);
  if (error) return { ok: false, error };
  const matches = [];
  if (regex.global) {
    let execResult;
    let guard = 0;
    while ((execResult = regex.exec(text)) !== null) {
      matches.push(describeMatch(execResult));
      // A zero-width match leaves lastIndex unchanged and would loop forever;
      // nudge it forward so the next search starts after the current position.
      if (execResult.index === regex.lastIndex) regex.lastIndex += 1;
      if (++guard > MAX_MATCHES) break;
    }
  } else {
    const execResult = regex.exec(text);
    if (execResult) matches.push(describeMatch(execResult));
  }
  return { ok: true, global: regex.global, count: matches.length, matches };
}

/**
 * Replace matches in text using a replacement string ($1, $<name>, $$ …).
 * @param {string} text
 * @param {string} pattern
 * @param {string} flags
 * @param {string} replacement
 * @returns {{ ok: boolean, error?: string, result?: string }}
 */
export function runReplace(text, pattern, flags, replacement) {
  const { regex, error } = compile(pattern, flags);
  if (error) return { ok: false, error };
  try {
    return { ok: true, result: text.replace(regex, replacement) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * @param {RegExpExecArray} m
 * @returns {MatchInfo}
 */
function describeMatch(m) {
  const groups = [];
  for (let i = 1; i < m.length; i += 1) {
    groups.push({ value: m[i] === undefined ? null : m[i] });
  }
  const namedGroups =
    m.groups != null
      ? Object.fromEntries(Object.entries(m.groups).map(([key, value]) => [key, value ?? '']))
      : null;
  return {
    index: m.index,
    end: m.index + m[0].length,
    value: m[0],
    groups,
    namedGroups,
  };
}
