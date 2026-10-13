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
import { fileURLToPath } from 'node:url';

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

const ttl = /const LIST_CACHE_TTL_MS\s*=\s*(\d+)/.exec(server);
const poll = /var POLL_INTERVAL\s*=\s*(\d+)/.exec(html);

assert('the list TTL is still declared in the server', ttl !== null);
assert('the poll interval is still declared in the client', poll !== null);

if (ttl && poll) {
  assert('LIST_CACHE_TTL_MS (' + ttl[1] + ') is at or above POLL_INTERVAL (' + poll[1] + ') — a cache below the poll interval can never be hit',
    Number(ttl[1]) >= Number(poll[1]));
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

console.log('[list-cache] ' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('[list-cache] OK');
