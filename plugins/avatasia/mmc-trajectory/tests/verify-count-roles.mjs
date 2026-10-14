/**
 * `countRolesInPrefix` counts the session list's eight counters out of a bounded prefix of the
 * active `messages.jsonl`. It used to do that with five `matchAll` passes over the prefix, which
 * allocates a match object per hit: on a 64 KB prefix holding a few thousand messages that is a
 * few thousand short-lived objects per session, per rebuild, on a poll.
 *
 * A rewrite that stops allocating is only worth having if it is still the same function. So this
 * guard holds the implementation it replaced as `reference` and requires the two to agree — over
 * hand-written edges, and over the prefix of every session in the store it is pointed at. The
 * fixture is the default so the corpus is reproducible on a clean runner; `--real` uses this
 * machine's transcripts instead.
 *
 * The corpus is the evidence, so it is deliberately wider than the shapes that occur: roles
 * outside the four the counters recognize, values with no closing quote, a `message_id` used as a
 * *value* rather than a key, duplicate and empty turn ids, and whitespace the patterns have to
 * skip. Each of those is a case where a position-based rewrite and a capturing one can disagree,
 * and a prefix counter that quietly changes its answer is worse than a slow one — the list sends
 * these numbers to the reader.
 *
 * `tests/mutate-count-roles.py` breaks the shipped implementation in the ways this guard exists to
 * catch, and requires it to report each by name.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  countRolesInPrefix,
  collectSessionEntries,
  readHead,
  resolveSessionsRoot,
} from '../miniapp/node/server.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SERVER = fileURLToPath(new URL('../miniapp/node/server.mjs', import.meta.url));
const FIXTURE_HOME = join(HERE, 'fixtures', 'minimax-home');
const USE_REAL = process.argv.includes('--real');
// Not exported from the server; the same 64 KB the list route reads. If the constant moves, this
// guard is still a valid comparison — it compares two implementations over whatever they are
// given — but the corpus stops matching production. LIST_PEEK_BYTES is pinned by verify-list-cache.
const LIST_PEEK_BYTES = 64 * 1024;

let pass = 0;
const failures = [];
function assert(name, cond) {
  if (cond) pass += 1;
  else failures.push(name);
}

/* ---------- the implementation this replaced ---------- */

/**
 * @param {string} text
 */
function reference(text) {
  const turnIds = new Set();
  const counts = { messages: 0, userMessages: 0, assistantMessages: 0, toolResults: 0, systemMessages: 0, toolCalls: 0, thinkingBlocks: 0, turns: 0 };
  for (const match of text.matchAll(/"message_id"\s*:/g)) counts.messages += 1;
  for (const match of text.matchAll(/"role"\s*:\s*"(user|assistant|toolResult|custom)"/g)) {
    if (match[1] === 'user') counts.userMessages += 1;
    else if (match[1] === 'assistant') counts.assistantMessages += 1;
    else if (match[1] === 'toolResult') counts.toolResults += 1;
    else counts.systemMessages += 1;
  }
  for (const match of text.matchAll(/"turn_id"\s*:\s*"([^"]*)"/g)) turnIds.add(match[1]);
  for (const match of text.matchAll(/"type"\s*:\s*"(toolCall|thinking|text)"/g)) {
    if (match[1] === 'toolCall') counts.toolCalls += 1;
    else if (match[1] === 'thinking') counts.thinkingBlocks += 1;
  }
  counts.turns = turnIds.size;
  return counts;
}

/**
 * @param {string} label
 * @param {string} text
 */
function sameAsReference(label, text) {
  const got = countRolesInPrefix(text);
  const want = reference(text);
  const equal = Object.keys(want).every((key) => want[key] === got[key]);
  assert(label + (equal ? '' : ` — got ${JSON.stringify(got)}, reference says ${JSON.stringify(want)}`), equal);
}

/* ---------- 1: the edges a position-based rewrite can get wrong ---------- */

sameAsReference('empty prefix', '');
sameAsReference('no counters at all', 'not json, just bytes');
sameAsReference('one user turn', '{"message_id":"m1","turn_id":"t1","message":{"role":"user","content":"a"}}');
sameAsReference('a custom role counts as system', '{"message_id":"m2","turn_id":"t2","message":{"role":"custom","content":"raw"}}');
sameAsReference('all four recognized roles', '{"role":"user"}{"role":"assistant"}{"role":"toolResult"}{"role":"custom"}');

// Values outside the four must stay uncounted. The capturing version's alternation simply failed
// to match them; a rewrite that counts "anything with a role" reports a number the old one denied.
sameAsReference('roles outside the four are not counted',
  '{"role":"system"}{"role":"tool"}{"role":"user2"}{"role":"users"}{"role":"assistants"}');

// `text` is in the block alternation and counts as nothing. So does anything else in it, and the
// two are indistinguishable by outcome — but only because both branches fall through, so a
// rewrite that drops the guard could start counting them.
sameAsReference('block values outside the two counted ones', '{"type":"text"}{"type":"toolCall"}{"type":"thinking"}{"type":"unknownType"}');

// Whitespace the patterns have to skip. `text` is the JS in the client, not this file.
sameAsReference('whitespace around the separators', '{"role" : "user","turn_id"\n:\n"t9","type"\t:\t"toolCall"}');

// `message_id` as a value, not a key. The pattern needs the colon, so `{"note":"message_id"}`
// counts nothing and `{"note":"message_id":1}` counts one — and a rewrite that just looks for the
// word would get the first one wrong.
sameAsReference('message_id as a value without a colon', '{"note":"message_id"}');
sameAsReference('message_id as a value followed by a colon', '{"note":"message_id":1}');

// Truncated tails. The prefix is a prefix: the last line is routinely cut mid-field, so an
// unterminated value is the normal case, not an edge. A capturing regex needs its closing quote
// and finds nothing; a position-based scan that assumed one would count a value it never read.
sameAsReference('truncated inside a role value', '{"message_id":"m1","message":{"role":"user');
sameAsReference('truncated inside a turn id', '{"message_id":"m1","turn_id":"t');
sameAsReference('truncated with nothing after a complete field', '{"message_id":"m1","role":"user"');

// The scans `break` out when a value has no closing quote, which leaves their `lastIndex` pointing
// into the middle of the string — the one thing `test` on a shared `/g` regex carries between
// calls. A complete scan runs to exhaustion and resets itself on the way out; a broken one does
// not. So the case that matters is a full scan *after* a truncated one, in that order: drop any
// reset and the second call starts counting from wherever the first stopped.
sameAsReference('a complete scan after a truncated role', '{"message_id":"m2","turn_id":"t7","message":{"role":"user","content":"a"}}{"type":"toolCall"}');
sameAsReference('a complete scan after a truncated turn id', '{"message_id":"m3","turn_id":"t8","message":{"role":"assistant","content":"b"}}');
sameAsReference('a complete scan after a truncated block type', '{"message_id":"m4","turn_id":"t9","type":"thinking"}');

// Turn ids are counted distinctly, so duplicates and the empty id are the interesting cases.
sameAsReference('duplicate turn ids count once', '{"turn_id":"t1"}{"turn_id":"t1"}{"turn_id":"t2"}');
sameAsReference('an empty turn id is still a turn', '{"turn_id":""}{"turn_id":""}{"turn_id":"t1"}');

// Scans are module-level `/g` regexes, and `test` moves `lastIndex` while `matchAll` did not.
// Calling the function twice on different text is the cheapest way to catch a missing reset, so
// it is a case here rather than an implementation detail.
sameAsReference('a second call is unaffected by the first', '{"message_id":"m1","role":"user","turn_id":"t1","type":"toolCall"}');
sameAsReference('a third call returns to zero', '');

/* ---------- 2: the same comparison over real session prefixes ---------- */

const location = USE_REAL ? resolveSessionsRoot() : resolveSessionsRoot({ MAVIS_HOME: FIXTURE_HOME });
const entries = await collectSessionEntries(location.sessionsRoot);

assert('the store under test has sessions to compare over', entries.length > 0);

let compared = 0;
let mismatches = 0;
for (const entry of entries) {
  let head;
  try {
    head = await readHead(join(entry.dir, 'messages.jsonl'), LIST_PEEK_BYTES);
  } catch {
    continue;
  }
  compared += 1;
  const got = countRolesInPrefix(head.text);
  const want = reference(head.text);
  if (!Object.keys(want).every((key) => want[key] === got[key])) {
    mismatches += 1;
    failures.push(`${entry.dir} — got ${JSON.stringify(got)}, reference says ${JSON.stringify(want)}`);
  }
}

assert('every session prefix counted identically (' + compared + ' compared)'
  + (USE_REAL ? ' [real store]' : ' [fixture]'), mismatches === 0 && compared > 0);

// The corpus only proves equivalence if it would have caught a divergence, so it has to contain
// something to disagree about. A prefix with real messages in it exercises every branch; without
// one, an implementation that counted only `user` would pass this whole file.
let firstCounts = null;
if (entries.length) {
  try {
    firstCounts = reference((await readHead(join(entries[0].dir, 'messages.jsonl'), LIST_PEEK_BYTES)).text);
  } catch {
    firstCounts = null;
  }
}
assert('the corpus has messages in it, not just structure'
  + (firstCounts ? ' (' + firstCounts.messages + ' on the first entry)' : ''),
  firstCounts !== null && firstCounts.messages > 0);

/* ---------- 3: the allocation claim, read off the shipped source ---------- */

const server = readFileSync(SERVER, 'utf8');
const body = /export function countRolesInPrefix\(text\) \{[\s\S]*?\n\}/.exec(server);

assert('countRolesInPrefix is still in the shipped source', body !== null);

if (body) {
  const code = body[0];
  // `matchAll` and `exec` are the two shapes that hand back a match object per hit. `test` is
  // the one that does not, which is why the scans use it.
  assert('the counting loops do not build a match object per hit',
    !/matchAll\(/.test(code) && !/\.exec\(/.test(code));
  // The scans are module-level so the allocation is not just moved into a per-call `new RegExp`.
  assert('the scans are module-level constants, not built per call',
    !/new RegExp/.test(code));
  assert('the counting loops share one pass over the prefix rather than five',
    (code.match(/\.test\(text\)/g) || []).length === 4
    && !/for \(const .* of /.test(code));

  // `/g` plus `test` mutates `lastIndex`, and these are shared module state. Missing one reset is
  // a counter that silently starts from wherever the previous call stopped.
  for (const scan of ['MESSAGE_ID_SCAN', 'ROLE_SCAN', 'TURN_SCAN', 'BLOCK_SCAN']) {
    assert(scan + ' is reset before it is scanned',
      new RegExp(scan + '\\.lastIndex = 0').test(code));
  }
}

console.log('[count-roles] ' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('[count-roles] OK');