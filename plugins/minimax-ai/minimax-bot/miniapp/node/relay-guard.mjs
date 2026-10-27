// @ts-check
// Relay guardrails for group chats (F7).
//
// Two capabilities, both per group and both off by default:
//
//   - the hop limit (`group.maxHops`): how many Bots may speak in one relay chain.
//     0 means "no limit", which is exactly the baseline behaviour — the chain runs as long as
//     the Bots keep handing over to each other. When the limit is reached the chain converges:
//     the Bot that was about to be called is not called, and the Bot that just spoke is asked
//     to wrap up instead.
//
//   - the summary hand-over (`group.handover`): the conclusion of the previous hop travels with
//     the next hop's prompt ("the previous one said: …"), so the next Bot does not have to dig
//     the same ground out of the tools again.
//
// The hand-over is free by construction: it is text that rides along with the next turn. No
// extra model turn, no extra tool call, no extra memory write. That is what makes it cheaper
// than a discussion minute — a minute costs one model turn per round, the hand-over costs
// nothing at all.
//
// Everything in this module is pure: the engine decides *when* a hand-over happens, this
// module only says *what* it says. That keeps the rules testable without a model.

import { t } from './i18n.mjs';

/** Opens the block that carries the previous hop's conclusion. */
export const HANDOVER_BLOCK_MARK = '<minimax-bot-handover>';
/** Closes the block that carries the previous hop's conclusion. */
export const HANDOVER_BLOCK_END = '</minimax-bot-handover>';
/** Marks the prompt that asks the current speaker to wrap up. */
export const CONVERGE_MARK = '<minimax-bot-relay-converge>';
/**
 * Opens the block that carries the Bot's standing context.
 *
 * The context block wraps the whole brief, so a reply that ends with its closing tag would
 * close the block early and make the rest of the text look like it sits outside the context.
 */
export const CONTEXT_BLOCK_MARK = '<minimax-bot-context>';
/** Closes the block that carries the Bot's standing context. */
export const CONTEXT_BLOCK_END = '</minimax-bot-context>';
/** Longest summary handed over to the next hop. */
export const HANDOVER_MAX = 600;
/** How much of the previous reply's tail is kept when the group keeps no note. */
export const HANDOVER_TAIL = 400;

/**
 * Protocol marks a reply must never be able to forge: a Bot that writes them into its answer
 * would otherwise be able to open a block of its own in the next Bot's prompt.
 *
 * The pattern matches any `minimax-bot-…` tag rather than a fixed list, so a mark that is
 * spelled differently — with spaces, with an attribute, in another case — is caught as well.
 * The attribute part is bounded, so a stray `<` cannot swallow the text behind it.
 */
const MARK_PATTERN = /<\s*\/?\s*minimax-bot-[a-z0-9-]+(?:\s[^>]{0,40})?>/gi;

/** A dash that looks like the hyphen of a protocol mark. */
const LOOKALIKE_DASH = /[‐-―]/g;

/** A full-width ASCII character, which a Host that folds them would read as ASCII. */
const FULLWIDTH_ASCII = /[！-～]/g;

/** The largest hop limit a group can hold. The panel offers the same range. */
export const HOP_LIMIT_MAX = 20;

/**
 * The hop limit of a group: how many Bots may speak in one relay chain. 0 = no limit.
 *
 * A broken value reads as "no limit", so a hand-edited state file can never silence a group.
 * Only a number (or a string of digits) is a limit: `true`, `null` and `'abc'` are not.
 * A limit above {@link HOP_LIMIT_MAX} is clamped, so the same bound holds whether the value
 * came from the panel or from a direct call to the group API.
 * @param {any} group
 * @returns {number}
 */
export function hopLimit(group) {
  const value = group?.maxHops;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.min(Math.floor(value), HOP_LIMIT_MAX);
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const raw = Number(value.trim());
    return raw > 0 ? Math.min(raw, HOP_LIMIT_MAX) : 0;
  }
  return 0;
}

/**
 * Whether the group wants the conclusion of the previous hop handed over.
 * @param {any} group
 * @returns {boolean}
 */
export function handoverRequested(group) {
  return group?.handover === true;
}

/**
 * A copy of the text with the characters that can stand in for a hyphen or an ASCII letter
 * folded to their ASCII form.
 *
 * Every fold replaces one character with one character, so a mark found in the folded text
 * points at the same characters in the original and the text itself stays untouched.
 * @param {string} text
 * @returns {string}
 */
function foldMarks(text) {
  return text
    .replace(LOOKALIKE_DASH, '-')
    .replace(FULLWIDTH_ASCII, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

/**
 * Removes the protocol marks from a text, so a reply can never pretend to open or close a
 * block of its own.
 * @param {string} text
 * @returns {string}
 */
export function neutralizeMarks(text) {
  const value = String(text ?? '');
  const folded = foldMarks(value);
  let out = '';
  let last = 0;
  for (const match of folded.matchAll(MARK_PATTERN)) {
    out += value.slice(last, match.index) + ' ';
    last = match.index + match[0].length;
  }
  return out + value.slice(last);
}

/**
 * The tail of a reply: a conclusion sits at the end of an answer, not at its beginning.
 *
 * @param {string} text
 * @param {number} [max]
 * @returns {string}
 */
export function tailSummary(text, max = HANDOVER_TAIL) {
  const clean = neutralizeMarks(String(text ?? '')).replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (clean.length <= max) return clean;
  return clean.slice(-max);
}

/**
 * The summary of the previous hop.
 *
 * The note the group already produced wins: it is the structured conclusion of the round and it
 * cost nothing extra to reuse. Without a note the tail of the previous reply is used, which
 * costs nothing either.
 *
 * @param {{ note?: string, reply?: string, max?: number }} input
 * @returns {string}
 */
export function handoverSummary({ note, reply, max = HANDOVER_MAX } = {}) {
  const fromNote = neutralizeMarks(String(note ?? '')).replace(/\s+/g, ' ').trim();
  if (fromNote) return fromNote.length <= max ? fromNote : fromNote.slice(0, max);
  const tail = tailSummary(reply, Math.min(max, HANDOVER_TAIL));
  return tail;
}

/**
 * The block that travels with the next hop's prompt. An empty string when there is nothing to
 * hand over, so the prompt of a group without the hand-over is byte-for-byte what it was.
 *
 * @param {{ from?: string, text?: string }} input
 * @returns {string}
 */
export function renderHandover({ from, text } = {}) {
  const body = String(text ?? '').trim();
  if (!body) return '';
  const who = String(from ?? '').trim();
  return [
    HANDOVER_BLOCK_MARK,
    t('relay.handover', { from: who, text: body }),
    HANDOVER_BLOCK_END,
  ].join('\n');
}
