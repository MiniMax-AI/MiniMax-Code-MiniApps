// @ts-check
// Group notes for group chats.
//
// A group chat can be reset — "Start new chat" in the panel. The reset drops the whole message
// archive of the group, and with it everything the Bots said and concluded. The group's own
// record survives, because it lives in the group record and not in the messages: the name, the
// notice, the members, the relay settings.
//
// A group note closes that gap. The group keeps a short, bounded record of what its Bots said at
// the end of the earlier rounds, and every Bot of the group gets that record in its standing
// brief. So a group that was reset does not start from nothing, a Bot that joins the group later
// knows what the group was working on, and the Bots share one account of the group instead of
// each of them having its own slice of the last thirty messages.
//
// The note is free by construction. It is written from text the group already produced — the
// closing part of each Bot's reply — so it costs no extra Agent turn, no extra tool call and no
// extra memory write. It is off unless the operator switches it on, and a group without notes
// keeps its prompt byte for byte.
//
// Everything in this module is pure: the engine decides *when* the note is written and where it
// goes, this module only says *what* it says. That keeps the rules testable without a model.

import { neutralizeMarks } from './relay-guard.mjs';
import { t } from './i18n.mjs';

/**
 * Opens the block that carries the group's note.
 *
 * Both marks are listed in the forged-marks list of `relay-guard.mjs`, so a reply that writes
 * them into its own text cannot open a block of its own in another Bot's prompt.
 */
export const GROUP_NOTE_MARK = '<minimax-bot-group-summary>';
/** Closes the block that carries the group's note. */
export const GROUP_NOTE_END = '</minimax-bot-group-summary>';
/** How many entries the note keeps. The newest ones win. */
export const NOTE_MAX_ENTRIES = 6;
/** How many characters the whole note may take. */
export const NOTE_MAX_CHARS = 1200;
/** How many characters one entry may take. */
export const NOTE_ENTRY_MAX = 240;
/** How many characters the name of a speaker may take. */
export const NOTE_SPEAKER_MAX = 60;

/**
 * Whether the group keeps a note.
 *
 * The switch belongs to the group and only the operator sets it (the panel writes
 * `group.notes`); the model cannot change it, so a Bot cannot switch the note on for itself.
 *
 * @param {any} group
 * @returns {boolean}
 */
export function notesEnabled(group) {
  return group?.notes === true;
}

/**
 * One entry, cleaned: the protocol marks are removed and the text is a single line.
 *
 * The text keeps the *closing* part of a reply, because that is where the conclusion sits. It
 * is the same rule the hand-over uses for the reply it carries along.
 *
 * @param {any} entry
 * @returns {{ speaker: string, text: string } | undefined}
 */
function cleanEntry(entry) {
  if (!entry || typeof entry !== 'object') return undefined;
  const speaker = neutralizeMarks(String(entry.speaker ?? '')).replace(/\s+/g, ' ').trim();
  const text = neutralizeMarks(String(entry.text ?? '')).replace(/\s+/g, ' ').trim();
  if (!speaker || !text) return undefined;
  return { speaker: speaker.slice(0, NOTE_SPEAKER_MAX), text: tailOf(text, NOTE_ENTRY_MAX) };
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
export function tailOf(text, max = NOTE_ENTRY_MAX) {
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
 * The cleaned entries of a list, without the empty ones.
 *
 * @param {any} list
 * @returns {{ speaker: string, text: string }[]}
 */
function cleanList(list) {
  if (!Array.isArray(list)) return [];
  const cleaned = [];
  for (const item of list) {
    const entry = cleanEntry(item);
    if (entry) cleaned.push(entry);
  }
  return cleaned;
}

/**
 * Keep the newest entries that still fit in the budget.
 *
 * The newest entries win, and the budget is spent in order: once an entry does not fit, the
 * older ones are dropped too. A note therefore always reads as "the last rounds", never as a
 * mix of old and new.
 *
 * @param {{ speaker: string, text: string }[]} entries
 * @returns {{ speaker: string, text: string }[]}
 */
function bound(entries) {
  const kept = [];
  let chars = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (kept.length >= NOTE_MAX_ENTRIES) break;
    const size = entry.text.length + entry.speaker.length + 3;
    if (chars + size > NOTE_MAX_CHARS) break;
    kept.unshift(entry);
    chars += size;
  }
  return kept;
}

/**
 * The note of a group: only well-formed entries, and only as many as fit.
 *
 * The list is read from the group record, so a note that was written by an earlier round is
 * still there after the chat was reset.
 *
 * @param {any} group
 * @returns {{ speaker: string, text: string }[]}
 */
export function noteEntries(group) {
  return bound(cleanList(group?.noteEntries));
}

/**
 * Add what the Bots said this round to the note and return the new note.
 *
 * Pure: the caller keeps the result. Nothing here is written to disk and no turn is spent.
 *
 * @param {any} entries the note so far
 * @param {any} round what the Bots said this round
 * @returns {{ speaker: string, text: string }[]}
 */
export function appendNote(entries, round) {
  return bound([...cleanList(entries), ...cleanList(round)]);
}

/**
 * The block that goes into the standing brief of every Bot of the group.
 *
 * Empty when the group keeps no note, so the brief of such a group is byte for byte what it
 * was. The block says plainly that it is a record of what the Bots said and not an agreement,
 * so a Bot does not read an old remark as a decision the group took.
 *
 * @param {any} group
 * @returns {string}
 */
export function renderNote(group) {
  if (!notesEnabled(group)) return '';
  const entries = noteEntries(group);
  if (!entries.length) return '';
  const lines = entries.map((entry) => `[${entry.speaker}] ${entry.text}`);
  return [
    GROUP_NOTE_MARK,
    t('brief.groupNoteHead'),
    ...lines,
    GROUP_NOTE_END,
  ].join('\n');
}
