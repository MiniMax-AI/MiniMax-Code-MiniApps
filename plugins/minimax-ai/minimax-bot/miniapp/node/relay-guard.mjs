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
//   - the summary hand-over (`group.handover`): what the Bots of the round concluded so far
//     travels with the next hop's prompt, so the next Bot does not have to dig the same ground
//     out of the tools again.
//
// The hand-over carries the conclusions of the round, not the last sentence of one reply: a
// discussion concludes over several replies, and the closing line of a single reply is often a
// question or a courtesy. It is the same idea as a seminar's conclusion — the next speaker gets
// the results, not the last words that were said.
//
// The hand-over is free by construction: it is text that rides along with the next turn. No
// extra model turn, no extra tool call, no extra memory write. That is what makes it cheaper
// than a discussion minute — a minute costs one model turn per round, the hand-over costs
// nothing at all.
//
// Everything in this module is pure: the engine decides *when* a hand-over happens, this
// module only says *what* it says. That keeps the rules testable without a model.

import { t } from './i18n.mjs';

/** Opens the block that carries the conclusions of the round. */
export const HANDOVER_BLOCK_MARK = '<minimax-bot-handover>';
/** Closes the block that carries the conclusions of the round. */
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
/** How much of the previous reply's tail is kept when the round has a single hop. */
export const HANDOVER_TAIL = 400;
/**
 * How many characters one entry of the hand-over may take.
 *
 * The same number as `NOTE_ENTRY_MAX` in `group-note.mjs`. The two modules cannot import each
 * other — `group-note.mjs` imports this one — so the value is written down twice here and
 * there, and the two have to be kept in sync with `NOTE_ENTRY_MAX`.
 */
export const HANDOVER_ENTRY_MAX = 240;
/**
 * How many characters the name of a speaker may take.
 *
 * A name is a label and not content, so it is cut short: a long one must not eat the budget of
 * the round. The same bound as `NOTE_SPEAKER_MAX` in `group-note.mjs`.
 */
const HANDOVER_SPEAKER_MAX = 60;

/**
 * Protocol marks a reply must never be able to forge: a Bot that writes them into its answer
 * would otherwise be able to open a block of its own in the next Bot's prompt.
 *
 * The pattern matches any `minimax-bot-…` tag rather than a fixed list, so a mark that is
 * spelled differently — with spaces, with an attribute, in another case — is caught as well.
 *
 * The attribute is read as an attribute — the characters a tag attribute is made of — rather
 * than as "anything up to the next `>`. A model that writes `<minimax-bot-context` into a
 * sentence and closes the thought with a `>` a line later would otherwise lose that whole
 * stretch of its own text, so only the name of the mark is taken when no tag-shaped attribute
 * follows it.
 */
const MARK_PATTERN = new RegExp(
  `<\\s*\\/?\\s*minimax-bot-[a-z0-9-]+(?:[ \\t]+[A-Za-z0-9_:.=/"'()\\-]*)?\\s*>`
  + `|<\\s*\\/?\\s*minimax-bot-[a-z0-9-]+`,
  'gi',
);

/**
 * The block tags the Host itself writes into its prompts.
 *
 * A Bot that copies one of them into its answer hands the next Bot a text that reads like a
 * notice the Host has just sent. The copy is model-written text, so the neutralising removes the
 * tag from it the same way it removes a protocol mark — the tag goes, the words around it stay.
 *
 * The list holds the Host's own vocabulary, not the plugin's: the plugin's wire format
 * (`minimax-bot-…`) and its delivery format (`<media src="…"/>`) are not in it and stay.
 */
export const HOST_TAGS = [
  'system-reminder',
  'agent-context',
  'async-audit',
  'media-output-reminder',
  'background-task-finished',
  'mcode-tools-master-reminder',
  'task-completion-reminder',
  'environment_details',
];

/**
 * The Host's block tags, matched the way the protocol marks are: with an optional closing
 * slash, with an optional attribute made of the characters an attribute is made of, and in any
 * case. Without such an attribute only the name goes, so a sentence that mentions one of these
 * words keeps the rest of itself.
 */
const HOST_TAG_PATTERN = new RegExp(
  `<\\s*\\/?\\s*(?:${HOST_TAGS.join('|')})(?:[ \\t]+[A-Za-z0-9_:.=/"'()\\-]*)?\\s*>`
  + `|<\\s*\\/?\\s*(?:${HOST_TAGS.join('|')})`,
  'gi',
);

/**
 * Everything the neutralising removes in one pass: the protocol marks and the Host's block tags.
 */
const STRIP_PATTERN = new RegExp(`${MARK_PATTERN.source}|${HOST_TAG_PATTERN.source}`, 'gi');

/** A dash that looks like the hyphen of a protocol mark. */
const LOOKALIKE_DASH = /[‐-―]/;

/** A full-width ASCII character, which reads as its ASCII form. */
const FULLWIDTH_ASCII = /[！-～]/;

/**
 * A character that takes no space, so a mark split by one still reads as that mark.
 *
 * The format characters (a zero-width space or joiner, a soft hyphen, a directional mark, a
 * byte-order mark) and the nonspacing marks (a combining accent, a variation selector) are the
 * ones that take no room: a mark written with one of them in it still reads as that mark to the
 * model, so it is read the same way here.
 */
const INVISIBLE = /[\p{Cf}\p{Mn}]/u;

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
 * Whether the group wants the conclusions of the round handed over.
 * @param {any} group
 * @returns {boolean}
 */
export function handoverRequested(group) {
  return group?.handover === true;
}

/**
 * One character, with a dash that looks like a hyphen folded to a hyphen and a full-width ASCII
 * character folded to the ASCII form it reads as.
 * @param {string} char
 * @returns {string}
 */
function foldChar(char) {
  if (FULLWIDTH_ASCII.test(char)) return String.fromCharCode(char.charCodeAt(0) - 0xfee0);
  return LOOKALIKE_DASH.test(char) ? '-' : char;
}

/**
 * The text as the pattern reads it, and where each of its characters came from.
 *
 * Folding a character keeps its place and dropping one does not, so `origin[i]` is the position
 * in the original text of the i-th character of the folded text. A mark found in the folded
 * text therefore points at the same characters of the original, and the text itself is never
 * rewritten.
 * @param {string} text
 * @returns {{ folded: string, origin: number[] }}
 */
function foldMarks(text) {
  let folded = '';
  const origin = [];
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (INVISIBLE.test(char)) continue;
    folded += foldChar(char);
    origin.push(i);
  }
  return { folded, origin };
}

/**
 * Removes the protocol marks and the Host's block tags from a text, so a reply can never
 * pretend to open or close a block of its own and can never pass a copied Host notice on as
 * one.
 *
 * Only the tags go; the text around them is left as it was.
 * @param {string} text
 * @returns {string}
 */
export function neutralizeMarks(text) {
  const value = String(text ?? '');
  const { folded, origin } = foldMarks(value);
  let out = '';
  let last = 0;
  for (const match of folded.matchAll(STRIP_PATTERN)) {
    const start = origin[match.index];
    const end = origin[match.index + match[0].length - 1] + 1;
    out += value.slice(last, start) + ' ';
    last = end;
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
 * A word character in the Latin sense: a letter or a digit that a cut can land inside.
 *
 * A CJK ideograph is its own unit, so a cut between two of them already lands on a boundary.
 */
const LATIN_WORD = /[A-Za-z0-9_]/;

/** How much of a broken word may be dropped to reach the next boundary. */
const WORD_PREFIX_MAX = 20;

/**
 * The closing part of a text, cut on a word boundary.
 *
 * A plain cut can land inside a word — or inside the half of a tag the neutralising left
 * behind — and the entry would start mid-word. Only a Latin word can be cut in half: Chinese
 * has no spaces, so trimming up to the first whitespace there would drop the whole entry.
 *
 * @param {string} text
 * @param {number} [max]
 * @returns {string}
 */
export function tailOf(text, max = HANDOVER_ENTRY_MAX) {
  const value = String(text ?? '');
  if (value.length <= max) return value;
  const cut = value.length - max;
  const tail = value.slice(cut);
  // The characters around the cut tell whether it landed inside a Latin word.
  if (!LATIN_WORD.test(value[cut - 1] ?? '') || !LATIN_WORD.test(tail[0] ?? '')) return tail;
  // Drop the rest of that word and the space after it. A word longer than this is left alone:
  // dropping half of a long token would cost more than the fragment is worth.
  const fragment = /^[A-Za-z0-9_]+/.exec(tail)?.[0] ?? '';
  if (!fragment || fragment.length > WORD_PREFIX_MAX) return tail;
  return tail.slice(fragment.length).replace(/^\s+/, '') || tail;
}

/**
 * The entries of the round that carry something: the speaker and the text, both cleaned.
 *
 * An entry without a speaker or without a text is not a conclusion, so it does not count. The
 * hand-over has to count the same entries the summary shows: a round with one real conclusion
 * and one empty entry is a round of one voice, and it must not be handed over under a headline
 * that speaks of several.
 *
 * @param {{ speaker: string, text: string }[]} round what the Bots of this round said so far
 * @returns {{ speaker: string, text: string }[]}
 */
export function roundEntries(round) {
  const list = Array.isArray(round) ? round : [];
  const entries = [];
  for (const item of list) {
    const speaker = neutralizeMarks(String(item?.speaker ?? '')).replace(/\s+/g, ' ').trim();
    const text = neutralizeMarks(String(item?.text ?? '')).replace(/\s+/g, ' ').trim();
    if (!speaker || !text) continue;
    entries.push({ speaker: speaker.slice(0, HANDOVER_SPEAKER_MAX), text });
  }
  return entries;
}

/**
 * The conclusions of the round so far: one entry per hop, with the name of the Bot that said it.
 *
 * The hand-over used to carry the tail of the previous reply. That is the last thing one Bot
 * said, not what the round concluded: a discussion concludes over several replies, and the
 * closing line of a single reply is often a question or a courtesy. What the next Bot needs is
 * the result, the way a seminar hands its conclusion to the next speaker.
 *
 * The newest entry is the conclusion of the previous hop and the one that matters most, so the
 * budget is spent on it: when the whole round does not fit, the oldest entries go first, and
 * they go whole — half an entry would be a sentence cut in the middle.
 *
 * A round with a single hop keeps the hand-over it had before: the tail of that one reply, byte
 * for byte. The next Bot reads the same words it read before.
 *
 * @param {{ speaker: string, text: string }[]} round what the Bots of this round said so far
 * @param {number} [max]
 * @returns {string}
 */
export function roundSummary(round, max = HANDOVER_MAX) {
  const entries = roundEntries(round);
  if (!entries.length) return '';
  if (entries.length === 1) {
    // One hop: the hand-over of before — the tail of that reply, byte for byte.
    return tailSummary(entries[0].text, Math.min(max, HANDOVER_TAIL));
  }
  const kept = [];
  let chars = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    const part = `[${entry.speaker}] ${tailOf(entry.text, HANDOVER_ENTRY_MAX)}`;
    const size = part.length + (kept.length ? 3 : 0);
    if (chars + size > max) break;
    kept.unshift(part);
    chars += size;
  }
  return kept.join(' / ');
}

/**
 * The summary the hand-over carries.
 *
 * The round is the only thing it carries: the conclusions the Bots of this round reached so
 * far. The note of the group is not part of it — that note lives in the standing brief, it
 * holds the earlier rounds, and it is a record of what was said rather than a result of this
 * round.
 *
 * @param {{ round?: { speaker: string, text: string }[], max?: number }} input
 * @returns {string}
 */
export function handoverSummary({ round, max = HANDOVER_MAX } = {}) {
  return roundSummary(round, max);
}

/**
 * The block that travels with the next hop's prompt. An empty string when there is nothing to
 * hand over, so the prompt of a group without the hand-over is byte-for-byte what it was.
 *
 * One hop is attributed to the Bot that said it — the block names it. Several hops are not:
 * the conclusions belong to several Bots, and the block must not put them all in one mouth.
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
    who
      ? t('relay.handover', { from: who, text: body })
      : t('relay.handoverRound', { text: body }),
    HANDOVER_BLOCK_END,
  ].join('\n');
}
