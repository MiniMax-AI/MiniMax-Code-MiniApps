// @ts-check
// The terms a query is matched against, and how a record is scored by them.
//
// This module has no imports on purpose: the Host memory search runs both inside the plugin
// and inside a helper script a Bot runs, and the helper carries a copy of it. A dependency
// would drag the whole string table along with it.

/**
 * The terms of a query: latin words, whole Han runs and the bigrams of a Han run.
 * @param {string} query
 */
export function queryTerms(query) {
  const words = String(query).normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  const terms = new Set(words);
  for (const word of words) {
    for (const run of word.match(/\p{Script=Han}+/gu) ?? []) {
      const chars = [...run];
      if (chars.length === 1) terms.add(run);
      for (let index = 0; index + 1 < chars.length; index += 1) terms.add(chars[index] + chars[index + 1]);
    }
  }
  return [...terms];
}

/**
 * The terms a record has to contain to be a hit: a whole Han run or a latin word.
 *
 * The bigrams of a query only add score. On their own they match nearly everything - "一定"
 * is in half the corpus - so a query of common words would answer with noise instead of with
 * nothing. A one-character query has no such term, and falls back to the bigrams.
 * @param {string} query
 */
export function strongTerms(query) {
  const words = String(query).normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  const strong = new Set();
  for (const word of words) {
    for (const run of word.match(/\p{Script=Han}+/gu) ?? []) {
      if (run.length >= 2) strong.add(run);
    }
    if (/^[\p{Script=Latin}\p{N}_]+$/u.test(word) && word.length >= 3) strong.add(word);
  }
  return [...strong];
}

/**
 * How well a record answers a query: a term in the text counts once, a term in its key
 * counts three times.
 * @param {{ text?: string, key?: string }} entry
 * @param {string[]} terms
 */
export function relevance(entry, terms) {
  const text = String(entry.text).normalize('NFKC').toLowerCase();
  const key = String(entry.key ?? '').normalize('NFKC').toLowerCase();
  return terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0) + (key.includes(term) ? 3 : 0), 0);
}