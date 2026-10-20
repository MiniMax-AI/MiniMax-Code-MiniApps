/**
 * The session list re-walked the store on every poll, and nothing was holding it to that.
 *
 * `LIST_CACHE_TTL_MS` was 1000 while the page polls every 2500 ms, so the cache could not
 * survive a single tick: every poll expired it, and the list walked the session tree again,
 * reopened the runtime database, and rebuilt the visible slice from scratch. Measured on the
 * machine that reported it, that was most of the 16 GB the miniapp process read in 68 minutes,
 * and the allocation behind it held the process at a 1.2-2.5 GB high-water mark for as long as
 * the page stayed open. No existing guard asserted the number, which is why a config value that
 * defeats the cache it belongs to survived every run of a suite that reports 52 green guards.
 *
 * The invariants, and what each one is for:
 *
 *   1. LIST_CACHE_TTL_MS >= POLL_INTERVAL. This is the fix. It is asserted as a relationship
 *      between two files rather than as a literal, because the number itself is not the
 *      invariant — a cache shorter than the interval that invalidates it is. Asserting
 *      `=== 3000` would let the same defect back the moment anybody tuned the poll interval,
 *      and would fail for a change that is actually an improvement.
 *   2. the titles read is cached under that same budget. `readSessionTitles` opens the runtime
 *      database on every call and the list route calls it once per poll, so fixing (1) alone
 *      leaves a 700 MB store reopened every 2.5 s forever. The two caches answer one poll
 *      together or neither does.
 *   3. the route reaches titles through that cache. Asserted as the identity of the callee
 *      rather than as the absence of a call, because the failure mode here is a second caller
 *      quietly reintroducing the per-poll open, and an absence-check passes the moment somebody
 *      renames the function.
 *   4. dispose releases the title cache. The parsed-row cache once leaked here — a disposed
 *      runtime held ~43 MB for a 39 MB session — and the line that fixed it is in server.mjs
 *      precisely so the next cache cannot repeat the omission silently.
 *   5. the list peek stays within a small multiple of the generation probe. A generation marker
 *      lives on the first row, so a prefix that cannot hold one is a prefix that wants the whole
 *      session. This bounds the read without pinning a byte count the list does not depend on:
 *      the counters it produces are approximate by design.
 *
 * `mutate-list-cache-ttl.py` breaks each of these in the shipped source and requires this guard to
 * catch it by name, so nothing here can be an assertion nothing could fail.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SERVER = fileURLToPath(new URL('../miniapp/node/server.mjs', import.meta.url));
const HTML = fileURLToPath(new URL('../miniapp/client/index.html', import.meta.url));
const server = readFileSync(SERVER, 'utf8');
const html = readFileSync(HTML, 'utf8');

let pass = 0;
const failures = [];
function assert(name, cond) {
  if (cond) pass += 1;
  else failures.push(name);
}

/* ---------- 1: the TTL outlives the poll that expires it ---------- */

// The governing cadence is the LIST's, not the page's. One `POLL_INTERVAL` drove both fetches when
// this was written, so the two were the same number by coincidence; the page now has a tick per
// fetch, and asserting against the trajectory's would let the list be polled twice as often as
// its cache can answer.
const ttl = /const LIST_CACHE_TTL_MS\s*=\s*(\d+)/.exec(server);
const sessionPoll = /var SESSION_POLL_INTERVAL\s*=\s*(\d+)/.exec(html);

assert('the list TTL is still declared in the server', ttl !== null);
assert('the list\'s poll interval is still declared in the client', sessionPoll !== null);

if (ttl && sessionPoll) {
  assert('LIST_CACHE_TTL_MS (' + ttl[1] + ') is at or above the list poll interval (' + sessionPoll[1] + ') — a cache below the poll interval can never be hit',
    Number(ttl[1]) >= Number(sessionPoll[1]));
}

// The other direction, and it is what makes a 304 on this route honest. A revalidated list means
// "the payload I would send you now is the one you have", so its staleness bound cannot be looser
// than the descriptor cache whose entries it is derived from. The tag is computed from the walk's
// output, so it is as old as LIST_CACHE_TTL_MS; the descriptors behind it are as old as
// SESSION_CACHE_TTL_MS. If that ever inverts, the validator is the freshest input in the route
// and a stale descriptor can be pinned in place by a tag that says nothing changed.
const descriptorTtl = /const SESSION_CACHE_TTL_MS\s*=\s*(\d+)/.exec(server);
assert('the descriptor cache budget is still declared', descriptorTtl !== null);
if (ttl && descriptorTtl) {
  assert('LIST_CACHE_TTL_MS (' + ttl[1] + ') is at or below SESSION_CACHE_TTL_MS (' + descriptorTtl[1]
    + ') — the walk must not be able to feed a validator built on fresher facts than the descriptors it stands for',
    Number(ttl[1]) <= Number(descriptorTtl[1]));
}

/* ---------- 2 & 3: one poll, one walk, one database open ---------- */

assert('the titles read is cached rather than taken from the database on every poll',
  /let titleCache\s*=/.test(server) && /const sessionTitles\s*=\s*async/.test(server));

assert('the title cache shares the walk\'s budget, so both expire on the same poll',
  /now - titleCache\.at < LIST_CACHE_TTL_MS/.test(server));

const routeTitles = /const titles = await (\w+)\(/.exec(server);
assert('the list route reaches titles through the cache',
  routeTitles !== null && routeTitles[1] === 'sessionTitles');

/* ---------- 4: dispose releases what the poll built ---------- */

assert('dispose releases the title cache',
  /titleCache = \{ at: 0, key: '', map: new Map\(\) \};[\s\S]{0,240}?descriptorCache\.clear\(\)/.test(server));

// The list body cache is a third thing the poll built, and it holds serialized bytes this time.
// It is small next to the two above, which is exactly why it is the one that gets forgotten.
assert('dispose releases the list body cache',
  /sessionsBody = \{ material: '', body: null \};[\s\S]{0,240}?descriptorCache\.clear\(\)/.test(server));

/* ---------- 5: the peek that backs the list is bounded ---------- */

const probe = /const GENERATION_PROBE_BYTES\s*=\s*(\d+)\s*\*\s*1024/.exec(server);
const peek = /const LIST_PEEK_BYTES\s*=\s*(\d+)\s*\*\s*1024/.exec(server);

assert('the generation probe budget is still declared', probe !== null);
assert('the list peek budget is still declared', peek !== null);

if (probe && peek) {
  assert('LIST_PEEK_BYTES (' + peek[1] + ' KB-blocks) stays within 4x GENERATION_PROBE_BYTES (' + probe[1] + ') — the marker is on the first row',
    Number(peek[1]) <= Number(probe[1]) * 4);
}

/* ---------- 6: what the bounded prefix is allowed to be reported as ---------- */

// The rule above is the one that rules out counting exactly: the list must not read the whole
// active file, so a count it can afford is a count of a PREFIX. That used to be fine because the
// constant's own comment said the counters were for 「counts nobody treats as exact」 — and the page
// treated them as exact, printing 「（3 分钟前 · 10 条）」 for a session with 23,642 messages. The
// prefix stays; what changed is that its numbers are only sent when the prefix was the whole file.
//
// So the invariant is two halves and both are load-bearing. Bounded-but-reported is the defect, and
// absent is the only other answer available at this budget: an exact count would need the whole
// active file, and would still miss the rest of the lineage besides.
const gatedOnWholeFile = /messageCount:\s*peekIsWhole\s*\?\s*peek\.messages\s*:\s*null/;
const turnsGatedTheSame = /turnCount:\s*peekIsWhole\s*\?\s*peek\.turns\s*:\s*null/;

assert('the list asks whether its prefix was the whole file',
  /const\s+head\s*=\s*await readHead\([\s\S]{0,120}?LIST_PEEK_BYTES\)/.test(server)
  && /peekIsWhole\s*=\s*!truncatedByCap\(head\.size,\s*LIST_PEEK_BYTES\)/.test(server));

assert('a prefix message count is not sent as the session message count', gatedOnWholeFile.test(server));
// Same rule, same reason: turnCount comes out of the same prefix. Fixing one and leaving the other
// is the same lie under a second name, and a mutation below does exactly that.
assert('a prefix turn count is not sent either', turnsGatedTheSame.test(server));

// A failed read has counted nothing at all. Reporting its zeros would be the same untrue number
// with a smaller magnitude, so the flag must default to "not the whole file" rather than to true.
assert('a read that failed is not reported as a count of zero',
  /let peekIsWhole = false;/.test(server)
  && !/let peekIsWhole = true;/.test(server));

// The reader-facing half. When there is no count the page omits the whole segment rather than
// printing a dash, because 「— 条」 renders the absence of a number in the shape of a number.
//
// Read off the client with its comments stripped. The comment above `sessionOptionLabel` quotes the
// old string `（3 分钟前 · 10 条）`, so an assertion made against the raw file would be satisfied by
// prose describing the very defect it exists to catch — which is what D27 was.
const clientJs = html
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');
assert('the session picker omits the count segment instead of printing a placeholder',
  /var tail = isCount\(count\) \?/.test(clientJs)
  && /'（' \+ when \+ '）'/.test(clientJs));

/* ---------- 7: the branch a session was spawned from is carried, not dropped ---------- */
// The store has always had a `parent_session_id`, and the list route has always read the titles
// beside it without reading it — so every sub-agent run the runtime spawned was listed exactly
// like a top-level conversation. Nothing caught that, because nothing was pinned about WHICH
// fields the list is allowed to drop: `stripInternalFields` had no reader anywhere in this
// directory, so a field could be added, or lost, and the suite stayed green either way.
//
// Four links, and dropping any one of them produces the same silent list: the column is not
// selected, or it is selected and not mapped, or it is mapped and not put on the descriptor, or
// it reaches the descriptor and is stripped before it is sent. Each gets its own assertion
// because each is a place the value can be lost without a type error or a crash.
//
// The read is a LADDER rather than one statement, because the columns it wants are not all the
// same age: a runtime database written before child sessions existed has no `parent_session_id`,
// and one written before the kind of a session was recorded has neither `purpose` nor
// `workspace_dir`. Each rung has to be there, in this order — a rung that asks for more than the
// one above it can never be reached, and a rung that is missing sends an old database down to the
// empty catch, which is a list with no titles at all rather than a list with fewer titles.
const LADDER = [
  'select session_id, title, session_kind, parent_session_id, purpose, workspace_dir from local_runtime_sessions where session_id = ?',
  'select session_id, title, session_kind, parent_session_id, purpose from local_runtime_sessions where session_id = ?',
  'select session_id, title, session_kind, parent_session_id from local_runtime_sessions where session_id = ?',
  'select session_id, title, session_kind from local_runtime_sessions where session_id = ?',
];
const ladderLabels = [
  'the widest rung reads the purpose and the workspace as well',
  'the next rung drops the workspace column',
  'the next rung drops the purpose column',
  'the last rung is the one every runtime database has',
];
let ladderAt = -1;
let ladderOrdered = true;
for (let i = 0; i < LADDER.length; i += 1) {
  const found = server.indexOf(LADDER[i], ladderAt + 1);
  if (found < 0) ladderOrdered = false;
  else ladderAt = found;
  assert(ladderLabels[i], server.includes(LADDER[i]));
}
assert('the rungs are walked widest first — a rung that asks for more than the one above it can never be reached',
  ladderOrdered);

assert('the titles query reads the parent column',
  /select session_id, title, session_kind, parent_session_id from local_runtime_sessions where session_id = \?/.test(server));

assert('the parent row is mapped, and an empty id is no parent rather than a parent named ""',
  /parent:\s*typeof row\.parent_session_id === 'string' && row\.parent_session_id !== ''\s*\n\s*\?\s*row\.parent_session_id\s*\n\s*:\s*null,/.test(server));

// The same two links for the two newer columns. The purpose is what says a session is a cron
// run, a background task or a lightweight exchange, and the workspace is what orders the list —
// neither of them can be dropped without the page going back to presenting every session as the
// reader's own conversation.
assert('the purpose row is mapped, and an empty value is no purpose',
  /purpose: typeof row\.purpose === 'string' && row\.purpose\.trim\(\) \? row\.purpose\.trim\(\) : null,/.test(server));
assert('the workspace row is mapped, and an empty value is no workspace',
  /workspace: typeof row\.workspace_dir === 'string' && row\.workspace_dir\.trim\(\) \? row\.workspace_dir\.trim\(\) : null,/.test(server));

assert('the descriptor carries the parent onto the row the page receives',
  /descriptor\.sessionParentId = meta\.parent;/.test(server));

assert('the descriptor carries the kind badge onto the row the page receives',
  /descriptor\.sessionTag = sessionTagFor\(meta\.kind, meta\.purpose\);/.test(server));

// `?? null` rather than a bare copy: the page decides by whether this field is SET, so a missing
// key and a present-but-undefined one have to land in the same place as a row that has no parent.
assert('the field survives the strip, with null as the floor',
  /sessionParentId:\s*value\.sessionParentId \?\? null,/.test(server));

assert('the kind badge survives the strip, with null as the floor',
  /sessionTag:\s*value\.sessionTag \?\? null,/.test(server));

// The reader-facing half, off the comment-stripped client for the reason given in section 6: the
// comment above `sessionOptionLabel` names the marker, so an assertion made against the raw file
// would be satisfied by prose describing the very thing it exists to require.
assert('the page decides the marker by the field and not unconditionally',
  /var branch = session && session\.sessionParentId \? BRANCH_MARK : '';/.test(clientJs));

assert('the page decides the kind badge by the field and not unconditionally',
  /var tag = session \? sessionTagBadge\(session\.sessionTag\) : '';/.test(clientJs));

/* ---------- 8. a database without the columns, which the regexes above cannot see ----------
 *
 * Everything above reads `server.mjs` as text, and every one of those regexes is satisfied by a
 * query that works. None of them is satisfied by a query that FAILS, which is the whole case here:
 * `db.prepare` throws on a column the database does not have, and the throw landed in the empty
 * catch that exists for a different reason ("a title is a nicety"). So on a runtime database
 * written before child sessions existed, the page showed no titles and no kinds at all — every
 * session fell back to the first sentence of its transcript — and nothing in the suite could see
 * it, because the shape of a correct query is the shape of a query nobody ran.
 *
 * So this runs the function against real databases built here, one per rung of the ladder: with
 * every column, without the workspace column, without the purpose column, and with neither. The
 * without-cases are the ones that carry the rule — the titles and the kind are the page's whole
 * reason for opening the database, and a missing optional column is not a reason to lose them. */
const { mkdtempSync, mkdirSync, rmSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
// `node:sqlite` is still flagged experimental, and the flag goes to stderr the moment the module
// is first loaded. The runner reads `stdout + stderr` and prints the LAST non-empty line, so the
// warning lands where this guard's own result line should be and `verify-list-cache.mjs` gets
// reported with the text of an unrelated warning instead of its verdict. Narrowly filtered, and
// installed BEFORE the import that provokes it: anything else still prints.
const emitWarning = process.emitWarning;
process.emitWarning = (warning, ...rest) => (
  String(warning).startsWith('SQLite is an experimental feature')
    ? undefined
    : emitWarning.call(process, warning, ...rest));

const { DatabaseSync } = await import('node:sqlite');
// `SERVER` is a plain filesystem path, and a dynamic import of one on Windows is read as a URL
// with an unsupported scheme. The module has to be asked for by its file: URL.
const { readSessionTitles, sessionTagFor } = await import(pathToFileURL(SERVER).href);

/**
 * One runtime database, with the optional columns the caller asks for.
 * @param {readonly string[]} extraColumns
 */
const runtimeDb = (extraColumns) => {
  const home = mkdtempSync(join(tmpdir(), 'mmc-trajectory-runtimedb-'));
  mkdirSync(join(home, 'v2', 'sqlite'), { recursive: true });
  const db = new DatabaseSync(join(home, 'v2', 'sqlite', 'runtime-state.sqlite'));
  const extra = extraColumns.length ? ', ' + extraColumns.join(', ') : '';
  const placeholders = extraColumns.length ? ', ' + extraColumns.map(() => '?').join(', ') : '';
  db.exec('create table local_runtime_sessions (session_id text primary key, title text,'
    + ' session_kind text' + extra + ')');
  const values = ['mvs_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '一条真实的标题', 'conversation'];
  for (const column of extraColumns) {
    if (column === 'parent_session_id') values.push('mvs_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    else if (column === 'purpose') values.push('context-mode:lightweight');
    else if (column === 'workspace_dir') values.push('workspace-of-the-session');
    else throw new Error('unknown column ' + column);
  }
  db.prepare('insert into local_runtime_sessions (session_id, title, session_kind'
    + extra + ') values (?, ?, ?' + placeholders + ')').run(...values);
  db.close();
  return home;
};

const ids = ['mvs_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'];
const homes = [];
let parentOnly = null;
let baseOnly = null;
let noWorkspace = null;
let everything = null;
try {
  homes.push(
    runtimeDb(['parent_session_id']),
    runtimeDb([]),
    runtimeDb(['parent_session_id', 'purpose']),
    runtimeDb(['parent_session_id', 'purpose', 'workspace_dir'])
  );
  parentOnly = await readSessionTitles(homes[0], ids);
  baseOnly = await readSessionTitles(homes[1], ids);
  noWorkspace = await readSessionTitles(homes[2], ids);
  everything = await readSessionTitles(homes[3], ids);
} finally {
  // The homes are `mkdtemp` directories this call created, so they are cleaned up in the same
  // breath rather than left behind for the OS to find.
  for (const h of homes) rmSync(h, { recursive: true, force: true });
}
assert('a database with the parent column still reports the title, the kind and the parent',
  parentOnly.get(ids[0])?.title === '一条真实的标题'
  && parentOnly.get(ids[0])?.kind === 'conversation'
  && parentOnly.get(ids[0])?.parent === 'mvs_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
assert('a database WITHOUT the column keeps the title and the kind, and only loses the parent',
  baseOnly.get(ids[0])?.title === '一条真实的标题'
  && baseOnly.get(ids[0])?.kind === 'conversation'
  && baseOnly.get(ids[0])?.parent === null);
// The same rung, one column further on: a database that knows the parent but not the purpose
// still answers with the parent, because the rung above it asks for columns it does not have.
assert('a database WITHOUT the purpose column still reports the title, the kind and the parent',
  parentOnly.get(ids[0])?.title === '一条真实的标题'
  && parentOnly.get(ids[0])?.kind === 'conversation'
  && parentOnly.get(ids[0])?.parent === 'mvs_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  && parentOnly.get(ids[0])?.purpose === null
  && parentOnly.get(ids[0])?.workspace === null);
// And the rung below it: no workspace column, everything else still readable.
assert('a database WITHOUT the workspace column still reports the title, the kind, the parent and the purpose',
  noWorkspace.get(ids[0])?.title === '一条真实的标题'
  && noWorkspace.get(ids[0])?.kind === 'conversation'
  && noWorkspace.get(ids[0])?.parent === 'mvs_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  && noWorkspace.get(ids[0])?.purpose === 'context-mode:lightweight'
  && noWorkspace.get(ids[0])?.workspace === null);
// The widest rung, which is what a current runtime database answers with.
assert('a database with every column reports the workspace as well',
  everything.get(ids[0])?.title === '一条真实的标题'
  && everything.get(ids[0])?.kind === 'conversation'
  && everything.get(ids[0])?.parent === 'mvs_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  && everything.get(ids[0])?.purpose === 'context-mode:lightweight'
  && everything.get(ids[0])?.workspace === 'workspace-of-the-session');

/* ---------- 9. what a purpose means, in one place and nowhere else ---------- */
//
// The raw purpose is free text — it carries whatever a person typed into it — so it never
// travels to the page. What travels is a token derived from it, and this is the only place that
// knows the derivation. A row whose kind is a conversation and whose purpose says nothing gets no
// token at all, which is what keeps an ordinary conversation from being badged.
assert('a lightweight purpose is a lightweight session',
  sessionTagFor('conversation', 'context-mode:lightweight') === 'lightweight');
assert('a cron purpose is a scheduled session',
  sessionTagFor('conversation', 'cron:mavis:something') === 'scheduled');
assert('a cron kind is a scheduled session even with no purpose at all',
  sessionTagFor('cron', null) === 'scheduled');
assert('a background task purpose is a task',
  sessionTagFor('conversation', 'local-background-task:bg_1') === 'task');
assert('a local task purpose is a task',
  sessionTagFor('conversation', 'local-task:1') === 'task');
assert('a task kind is a task even with no purpose at all',
  sessionTagFor('task', null) === 'task');
assert('a plain conversation is not tagged at all',
  sessionTagFor('conversation', null) === null);
assert('a row with neither a kind nor a purpose is not tagged at all',
  sessionTagFor(null, null) === null);

console.log('[list-cache] ' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('[list-cache] OK');
