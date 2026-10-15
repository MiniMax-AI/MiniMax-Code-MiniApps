/**
 * `/api/sessions` is polled on a timer and rebuilt from scratch on every tick that moves, while
 * `/api/trajectory` — the route that got a validator first — answers the same question with one.
 * That asymmetry is not principled: the list is exactly as revalidatable as the payload, and it is
 * the one a reader watches when nothing is happening.
 *
 * What makes a 304 sound here is narrower than "the tag covers every input that could change the
 * payload". It is that the tag is computed from the same values the payload is built from, in the
 * same request — so a matching tag means the bytes this request would produce are the bytes the
 * caller already holds. The guard checks that property directly, on the function, rather than
 * reading the route's regexes and hoping.
 *
 * The cases that are not obvious:
 *
 *   1. `?limit=10` and `?limit=20` are different payloads and must not satisfy one another. A
 *      tag over the visible slice alone would let a page that asked for 20 keep its copy while
 *      asking for 10, and get told nothing changed.
 *   2. A rename. No file stat on the session directory moves when somebody renames the
 *      conversation in the app, so the titles have to be in the material or a rename is invisible
 *      until the descriptor cache happens to expire.
 *   3. Field boundaries. With a plain separator, a title of `ab` beside an empty kind and a title
 *      of `a` beside a kind of `b` concatenate to the same string, so two different payloads
 *      share a tag. This is the one that a separator character fixes and nothing else catches.
 *   4. The 304 has to be decided before any descriptor is built, or the route still pays for the
 *      work it is avoiding and the validator buys only the transfer.
 *   5. `no-store` suppresses the 304 path at the browser's end, so a revalidated route has to
 *      advertise `no-cache` instead — which is what `revalidate: true` selects.
 *
 * `tests/mutate-sessions-etag.py` breaks each of these in the shipped source and requires this
 * guard to report it by name.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sessionsValidator } from '../miniapp/node/server.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SERVER = fileURLToPath(new URL('../miniapp/node/server.mjs', import.meta.url));
const CLIENT = fileURLToPath(new URL('../miniapp/client/index.html', import.meta.url));
const server = readFileSync(SERVER, 'utf8');
const html = readFileSync(CLIENT, 'utf8');

let pass = 0;
const failures = [];
function assert(name, cond) {
  if (cond) pass += 1;
  else failures.push(name);
}

/* ---------- fixtures: directories shaped like the ones the walk returns ---------- */

/** The session id is base64url-encoded after a `-session_` marker, so the dir name round-trips. */
function dirFor(id) {
  return '/store/2026/10/10/03-45-31-084-session_' + Buffer.from(id, 'utf8').toString('base64url');
}

const A = 'mvs_0000000000000000000000000000aaaa';
const B = 'mvs_0000000000000000000000000000bbbb';
const visible = [
  { dir: dirFor(A), sizeBytes: 1024, lastActiveAt: 1700000000 },
  { dir: dirFor(B), sizeBytes: 2048, lastActiveAt: 1700000001 },
];
const noTitles = new Map();
const titled = new Map([
  [A, { title: '第一段会话', kind: 'conversation' }],
  [B, { title: '第二段会话', kind: null }],
]);

/* ---------- 1: the material moves exactly when the payload does ---------- */

// Nothing changed. Same entries, same titles, same limit.
assert('an unchanged list produces an unchanged tag',
  sessionsValidator(visible, noTitles, 20) === sessionsValidator(visible, noTitles, 20));

// The three things the payload is built from, one at a time.
assert('a grown active file moves the tag',
  sessionsValidator([{ ...visible[0], sizeBytes: 1025 }, visible[1]], noTitles, 20)
  !== sessionsValidator(visible, noTitles, 20));

assert('a newer mtime moves the tag',
  sessionsValidator([{ ...visible[0], lastActiveAt: 1700000002 }, visible[1]], noTitles, 20)
  !== sessionsValidator(visible, noTitles, 20));

// The rename. Both halves of a row's metadata, because the picker renders both — and each has to
// be isolated, or the assertion passes on the other field and the one it names is untested. These
// two maps differ in the title and in nothing else.
const beforeRename = new Map([[A, { title: '旧名字', kind: 'conversation' }], [B, { title: '第二段会话', kind: null }]]);
const afterRename = new Map([[A, { title: '新名字', kind: 'conversation' }], [B, { title: '第二段会话', kind: null }]]);
assert('a renamed session moves the tag',
  sessionsValidator(visible, beforeRename, 20) !== sessionsValidator(visible, afterRename, 20));

// `kind` is what puts the sub-agent badge on the row, so it is reader-visible on its own. Same
// discipline: the title is held constant here.
const kindBefore = new Map([[A, { title: '第一段会话', kind: null }]]);
const kindAfter = new Map([[A, { title: '第一段会话', kind: 'conversation' }]]);
assert('a changed session kind moves the tag, even with no title',
  sessionsValidator(visible, kindBefore, 20) !== sessionsValidator(visible, kindAfter, 20));

// The parent is what puts 「子会话」 on the row, so it is reader-visible on its own and belongs in
// the material for the same reason `kind` does. The title AND the kind are held constant here, so
// this cannot pass on either of them: the two maps differ in the parent and in nothing else.
const parentBefore = new Map([[A, { title: '第一段会话', kind: 'conversation', parent: null }]]);
const parentAfter = new Map([[A, { title: '第一段会话', kind: 'conversation', parent: 'mvs_0000000000000000000000000000bbbb' }]]);
assert('a changed parent moves the tag, even with the title and kind held constant',
  sessionsValidator(visible, parentBefore, 20) !== sessionsValidator(visible, parentAfter, 20));

// And the null case, which is the other half: a row with no parent and a row whose parent is the
// empty string render identically on the page, so they must not read as a change.
const parentEmpty = new Map([[A, { title: '第一段会话', kind: 'conversation', parent: '' }]]);
assert('an empty parent and a null one agree — they render the same row',
  sessionsValidator(visible, parentBefore, 20) === sessionsValidator(visible, parentEmpty, 20));

// A null title and an absent one are the same payload — the picker falls back to 「会话 <id>」 — so
// they have to be the same tag, or every poll would look like a change.
const nullTitle = new Map([[A, { title: null, kind: 'conversation' }]]);
const nullTitleBoth = new Map([[A, { title: null, kind: 'conversation' }], [B, { title: null, kind: null }]]);
assert('a null title and an absent one agree — they render the same row',
  sessionsValidator(visible, nullTitle, 20) === sessionsValidator(visible, nullTitleBoth, 20));

// A session entering or leaving the visible slice.
assert('one more session in view moves the tag',
  sessionsValidator([...visible, { dir: dirFor('mvs_0000000000000000000000000000cccc'), sizeBytes: 1, lastActiveAt: 1 }], noTitles, 20)
  !== sessionsValidator(visible, noTitles, 20));

/* ---------- 2: the request itself is part of the identity ---------- */

assert('a different limit moves the tag',
  sessionsValidator(visible, noTitles, 10) !== sessionsValidator(visible, noTitles, 20));

/* ---------- 3: the separator, which is the case nothing else catches ---------- */

// Same characters, different boundaries. Without a separator that cannot appear in a value, both
// of these hash to the same string and a 304 is served for a payload the caller never held.
const splitOne = new Map([[A, { title: 'ab', kind: '' }]]);
const splitTwo = new Map([[A, { title: 'a', kind: 'b' }]]);
assert('a title/kind split cannot be hidden inside the separator',
  sessionsValidator(visible, splitOne, 20) !== sessionsValidator(visible, splitTwo, 20));

// The other half, and the one this file got wrong for a while. Above used to be followed by
// `the separator is a character a title cannot contain`, whose check was a regex for a NUL in the
// function body: it tested the IDENTITY of the separator and called the result a property. The
// property is false -- a SQLite TEXT column can hold any character, the NUL included -- so a title of
// `a<NUL>b` beside a kind of `c` and a title of `a` beside a kind of `b<NUL>c` produced byte-identical
// material. That assertion passed for a reason, not because the thing it names was true.
//
// So the rule is now stated as the property it always was, and checked as one: two metadata tuples a
// reader can tell apart must not share a material, with the ambiguous character placed INSIDE a value
// rather than at a boundary. No choice of separator character can satisfy this, which is the point --
// it has to be satisfied by the representation, not by the delimiter.
const NUL = String.fromCharCode(0);
const insideSeparator = new Map([[A, { title: 'a' + NUL + 'b', kind: 'c', parent: 'p' }]]);
const insideSeparatorShifted = new Map([[A, { title: 'a', kind: 'b' + NUL + 'c', parent: 'p' }]]);
assert('a separator-like character inside a value cannot merge two readable rows into one tag',
  sessionsValidator(visible, insideSeparator, 20)
  !== sessionsValidator(visible, insideSeparatorShifted, 20));

// The same character in the parent -- the third field, and the one nobody had looked at.
const parentInside = new Map([[A, { title: 't', kind: 'k', parent: 'a' + NUL + 'b' }]]);
const parentInsideShifted = new Map([[A, { title: 't', kind: 'k' + NUL + 'a', parent: 'b' }]]);
assert('the same collision in the parent cannot merge two readable rows either',
  sessionsValidator(visible, parentInside, 20)
  !== sessionsValidator(visible, parentInsideShifted, 20));

// The material is still built in server.mjs, which is what the three assertions above are testing
// rather than a copy of it.
const material = /export function sessionsValidator\(visible, titles, limit\) \{[\s\S]*?\n\}/.exec(server);
assert('the material is still built in server.mjs', material !== null);

// Empty input, because the route calls this before it knows the walk found anything.
assert('an empty list still produces a material', typeof sessionsValidator([], noTitles, 20) === 'string'
  && sessionsValidator([], noTitles, 20).length > 0);

/* ---------- 4: the route uses it, and decides the 304 before it builds anything ---------- */

const route = /const handleSessions = async \(response, url\) => \{[\s\S]*?\n  \};/.exec(server);
assert('the list route is still in the shipped source', route !== null);

if (route) {
  const code = route[0];
  assert('the route derives its tag from sessionsValidator',
    /weakETag\(sessionsValidator\(visible, titles, limit\)\)/.test(code));

  // The same three values on both sides. A validator computed from anything the payload does not
  // use is a validator about a different payload. The pairing itself is settled by the call above
  // passing `titles` and `visible` by name; this asserts the body loop reads the same binding.
  assert('the payload is built from the same visible slice the tag was', /for \(const entry of visible\)/.test(code));
  assert('the payload consults the titles the tag was built from',
    /const meta = titles\.get\(/.test(code));

  // The whole point: no descriptor work before the 304 is decided.
  const tagAt = code.indexOf('etagMatches(requestEtag, etag)');
  const describeAt = code.indexOf('describeSession(entry)');
  assert('the 304 is decided before any descriptor is built',
    tagAt !== -1 && describeAt !== -1 && tagAt < describeAt);

  // ...and the reused body answers the request that arrives with no validator at all.
  assert('an unchanged list reuses the bytes it already built',
    /sessionsBody\.material === etag \? sessionsBody\.body : null/.test(code));

  // A 304 carries no body and must not advertise one; a revalidated response must not say
  // `no-store`, because that suppresses the 304 path in the browser as well.
  assert('the 304 is sent through the revalidating sender',
    /sendJsonBody\(response, 304, '', \{ etag, revalidate: true \}\)/.test(code));
  assert('the 200 carries the tag and the revalidating cache-control',
    /sendJsonBody\(response, 200, body, \{ etag, revalidate: true \}\)/.test(code));
  // sendJson hardcodes no-store, so reaching for it here would silently drop the validator.
  assert('the list no longer answers through the non-revalidating sender',
    !/sendJson\(response, 200/.test(code));

  assert('the validator is cleared on dispose',
    /sessionsBody = \{ material: '', body: null \};[\s\S]{0,240}?descriptorCache\.clear\(\)/.test(server));
}

/* ---------- 5: the page has to actually use it ---------- */

const clientJs = html
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');

assert('the page sends the list validator back',
  /headers\['If-None-Match'\] = state\.sessionsEtag;/.test(clientJs));

assert('the page keeps every piece of state on a 304',
  /if \(response\.status === 304\) \{[\s\S]{0,200}?return \{ changed: false/.test(clientJs));

// A 304 that still re-rendered would be correct and pointless; the point is not touching state.
assert('a 304 does not re-render the picker',
  /if \(response\.status === 304\) \{[\s\S]{0,300}?renderSessionSelect/.test(clientJs) === false);

// One writer per field, and a validator bound to the request it was taken against. A list
// validator carried across a different limit would ask a question about a payload it is not for.
assert('the list validator is bound to the request key',
  /state\.sessionsEtagFor === key/.test(clientJs) && /var key = 'limit=20';/.test(clientJs));

// A refresh button that revalidated the list would be a refresh of half the page.
assert('a manual refresh drops the list validator',
  /if \(manual\) \{\s*state\.sessionsEtag = '';\s*state\.sessionsEtagFor = '';/.test(clientJs));

assert('the refresh button is the only caller that asks for a manual list',
  /fetchSessions\(true\)/.test(clientJs)
  && (clientJs.match(/fetchSessions\(true\)/g) || []).length === 1);

// The two validators are separate fields, not one shared pair. Sharing would let a list tag
// satisfy a trajectory request or the other way round.
assert('the list and trajectory validators are separate fields',
  /state\.sessionsEtag\b/.test(clientJs) && !/state\.etag = state\.sessionsEtag/.test(clientJs));

console.log('[sessions-etag] ' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('[sessions-etag] OK');