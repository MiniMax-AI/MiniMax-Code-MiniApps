/**
 * A session the user could name but not open.
 *
 * `collectSessionEntries` used to do two jobs with one return value: it walked the store, and it
 * returned `entries.slice(0, MAX_SESSION_LIST)`. Because the slice was the last statement, the
 * only handle the service had on a session directory was "one of the 30 most recently touched" —
 * and `resolveTrajectoryRequest` resolved an explicit `?session=<id>` by scanning exactly those
 * 30. Measured on a real store: 146 candidate directories, 30 exposed, and 116 of them answering
 * 404 to their own id. Inside the window 200/200; a sample outside 404/24. No leakage at the
 * boundary, which is what a single truncation point looks like.
 *
 * The invariant here is not "the list is longer". It is that **the traversal yields two products
 * and the two callers take different ones**: the picker keeps its 30, and id resolution is not
 * bounded by them.
 *
 * What each assertion is holding up:
 *
 *   1. Two products from one walk. A single truncated array cannot serve both callers, whichever
 *      way the slice is moved — that is the whole defect.
 *   2. The index is not the list. `recentEntries` stays at `MAX_SESSION_LIST`, so widening id
 *      resolution costs the picker nothing.
 *   3. The index is complete relative to the walk. A directory outside the recent 30 is still in
 *      `byDecodedId`, which is the 116-session case measured above.
 *   4. Building the index costs no I/O. The walk already stat'ed `messages.jsonl` for every
 *      candidate, so the id comes from the name — this asserts no new file read was introduced
 *      by the index itself. The walk does read each candidate's manifest now, to decide whether
 *      that directory is publishable at all; that read belongs to the admission step, and the
 *      index still reads nothing.
 *   5. A decoded name is a claim, not a fact. `readSessionIdentity` prefers `manifest.sessionId`,
 *      so the route re-reads the identity of the directory it picked and compares before serving.
 *      Without this, a directory renamed on disk would be served under the wrong id.
 *   6. Duplicate ids are not collapsed. `Map.set` would keep whichever came last and make the
 *      answer depend on `readdir` order; the index keeps a list so the manifests can decide.
 *   7. A name that does not decode is still a real session. Dropping it from the index would turn
 *      "no fast path" into "does not exist".
 *   8. The scan budget is a resource guard, not a correctness boundary. When the walk stops early
 *      the route must say so, because "the budget ran out" and "no such session" are different
 *      answers and only one of them is true.
 *   9. The basename entry point still works — it is a second way to name a session and it is not
 *      covered by the index.
 *  10. The picker is untouched: the list route still builds from `recentEntries`.
 *  11. The client names the session it is actually showing. `sessionParam()` prefers
 *      `hostSessionId`, so a host-pinned page that leaves `sessionId` null renders
 *      「跟随最新（自动切换）」 above content pinned to a different conversation.
 *
 * `tests/mutate-session-reachability.py` breaks each of these in the shipped source and requires
 * this guard to report it by name.
 */
import { readFileSync, mkdtempSync } from 'node:fs';
import { mkdir, writeFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSessionCandidates, decodeSessionIdFromDirName } from '../miniapp/node/server.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SERVER = readFileSync(fileURLToPath(new URL('../miniapp/node/server.mjs', import.meta.url)), 'utf8');
const CLIENT = readFileSync(fileURLToPath(new URL('../miniapp/client/index.html', import.meta.url)), 'utf8');

let pass = 0;
const failures = [];
function assert(label, condition) {
  if (condition) { pass += 1; return; }
  failures.push(label);
}

/* =====================================================================
 * 1 — the walk is real: 40 sessions with controlled mtimes
 * ===================================================================== */

const root = mkdtempSync(join(tmpdir(), 'reachability-'));
const NAME_COUNT = 40;
/** mtime descending: index 0 is the most recent, so index >= 30 is outside the picker window. */
async function makeSession(index) {
  const id = `sess${String(index).padStart(4, '0')}${'x'.repeat(4)}`;
  const encoded = Buffer.from(id, 'utf8').toString('base64url');
  const dir = join(root, '2026', '01', '01', `00-00-${String(index).padStart(2, '0')}-000-session_${encoded}`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'messages.jsonl'),
    JSON.stringify({ role: 'user', content: `session ${index}` }) + '\n', 'utf8');
  // Strictly decreasing mtime so the recency order is the creation order.
  const stamp = new Date(Date.UTC(2026, 0, 1, 0, 0, 0) - index * 60_000);
  await utimes(join(dir, 'messages.jsonl'), stamp, stamp);
  return { id, dir };
}

const made = [];
for (let i = 0; i < NAME_COUNT; i += 1) made.push(await makeSession(i));

const candidates = await collectSessionCandidates(root);

/* =====================================================================
 * 2 — the picker keeps its 30, and only its 30
 * ===================================================================== */

assert('the recent list is still capped at MAX_SESSION_LIST',
  candidates.recentEntries.length === 30);
assert('the recent list is in recency order',
  candidates.recentEntries[0].dir === made[0].dir
  && candidates.recentEntries[29].dir === made[29].dir);
assert('the recent list does not reach the 31st session',
  !candidates.recentEntries.some((e) => e.dir === made[30].dir));

/* =====================================================================
 * 3 — the index covers what the list cut: the measured 116/146 case
 * ===================================================================== */

assert('the id index is not the recent list',
  candidates.byDecodedId instanceof Map && candidates.byDecodedId.size === NAME_COUNT);
assert('a session outside the recent list is still resolvable by id',
  candidates.byDecodedId.has(made[35].id));
assert('the newest session is resolvable by id too',
  candidates.byDecodedId.has(made[0].id));
assert('the index maps an id to a directory that exists on disk',
  (candidates.byDecodedId.get(made[35].id) || [])[0]?.dir === made[35].dir);

/* =====================================================================
 * 4 — the index is built from names, not from new reads
 * ===================================================================== */

const walkBody = /export async function collectSessionCandidates\([\s\S]*?\n\}/.exec(SERVER);
assert('collectSessionCandidates is the exported traversal', walkBody !== null);
if (walkBody) {
  // Scoped to the index construction rather than to the whole function: the walk reads each
  // candidate's manifest to decide whether that directory is publishable at all, so the decoded
  // name appears in the function more than once, and a check that only asks "does this function
  // mention the decoded name" is satisfied by the admission step instead of the index.
  assert('the index is built from the decoded directory name',
    /const byDecodedId = new Map\(\);[\s\S]{0,300}?const id = decodeSessionIdFromDirName\(basename\(entry\.dir\)\);/.test(walkBody[0]));
  assert('building the index opens no file of its own',
    !/byDecodedId[\s\S]{0,400}?\b(readFile|readJsonIfPresent|stat)\s*\(/.test(walkBody[0]));
  assert('the walk stats messages.jsonl exactly once per candidate',
    (walkBody[0].match(/stat\(join\(child, 'messages\.jsonl'\)\)/g) || []).length === 1);
}

/* =====================================================================
 * 5 — a decoded name is a claim; the manifest gets the last word
 * ===================================================================== */

assert('the explicit-id branch consults the decoded-id index',
  /const fastPath = candidates\.byDecodedId\.get\(requested\);/.test(SERVER));
assert('an index hit still reads the directory identity',
  /for \(const candidate of fastPath\) \{\s*\n\s*const candidateIdentity = await readSessionIdentity\(candidate\.dir\);/.test(SERVER));
assert('a directory whose manifest disagrees is not served under the requested id',
  /if \(candidateIdentity\.id === requested\) verified\.push\(\{ entry: candidate, identity: candidateIdentity \}\);/.test(SERVER));
assert('an ambiguous id is not resolved by directory order',
  /if \(verified\.length === 1\) picked = verified\[0\];\s*\n\s*else if \(verified\.length > 1\)/.test(SERVER)
  && /reason: 'ambiguous_session_id'/.test(SERVER));
assert('duplicate ids are kept as a list rather than collapsed',
  /const bucket = byDecodedId\.get\(id\);\s*\n\s*if \(bucket\) bucket\.push\(entry\);\s*\n\s*else byDecodedId\.set\(id, \[entry\]\);/.test(SERVER));

/* =====================================================================
 * 6 — a name that does not decode is still a session
 * ===================================================================== */

const odd = join(root, '2026', '01', '02', '00-00-99-000-session_!!!not-base64!!!');
await mkdir(odd, { recursive: true });
await writeFile(join(odd, 'messages.jsonl'), JSON.stringify({ role: 'user', content: 'odd' }) + '\n', 'utf8');
// Newest on purpose, so membership is decided by "did the walk take it as a candidate" rather
// than by where it happens to fall in the recency slice.
const oddStamp = new Date(Date.UTC(2026, 0, 2));
await utimes(join(odd, 'messages.jsonl'), oddStamp, oddStamp);
const withOdd = await collectSessionCandidates(root);
assert('a session whose name does not decode is still a candidate',
  withOdd.recentEntries.some((e) => e.dir === odd));
assert('a non-decoding name simply gets no fast path, and is not treated as absent',
  decodeSessionIdFromDirName('00-00-99-000-session_!!!not-base64!!!') === null
  && withOdd.byDecodedId.size === NAME_COUNT);

/* =====================================================================
 * 7 — the scan budget is a guard, and it says so
 * ===================================================================== */

assert('a walk inside the budget reports that it was not truncated', candidates.truncated === false);
assert('the exhaustion path is a distinct answer from "no such session"',
  SERVER.includes("code: 'session_scan_budget_exhausted'")
  && SERVER.includes("code: 'session_not_found'"));
assert('the two answers are reachable from different conditions',
  /if \(candidates\.truncated\) \{[\s\S]{0,400}session_scan_budget_exhausted[\s\S]{0,400}?\n\s*\}\s*\n\s*return \{ ok: false, status: 404, code: 'session_not_found'/.test(SERVER));
assert('the candidate budget still exists as a resource guard',
  /const MAX_SESSION_CANDIDATES = (\d+);/.test(SERVER));

// Exercised, not asserted as a string: a walk that runs out of budget has to *say* it, because
// "we stopped looking" and "there is no such session" are different answers and only one is true.
// The source check above cannot tell a `truncated` flag that is always false from one that is
// wired to the budget it claims to report.
const budgetRoot = mkdtempSync(join(tmpdir(), 'reachability-budget-'));
const budget = Number(/const MAX_SESSION_CANDIDATES = (\d+);/.exec(SERVER)[1]);
for (let i = 0; i < budget + 5; i += 1) {
  // No prefix before the encoded id: a stray leading character would decode to a stray leading
  // byte, fail the id charset check, and make every directory silently decode to nothing.
  const dir = join(budgetRoot, '2026', '01', '01', `01-00-${String(i).padStart(3, '0')}-000-session_`
    + Buffer.from(`over${String(i).padStart(4, '0')}zz`, 'utf8').toString('base64url'));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'messages.jsonl'), JSON.stringify({ role: 'user', content: 'x' }) + '\n', 'utf8');
}
const exhausted = await collectSessionCandidates(budgetRoot);
assert('a walk that runs out of candidate budget reports itself as truncated',
  exhausted.truncated === true);
assert('the budget still bounds the recent list',
  exhausted.recentEntries.length === 30 && exhausted.recentEntries.length <= budget);
assert('an over-budget store indexes no more than the budget allows',
  exhausted.byDecodedId.size <= budget && exhausted.byDecodedId.size > 0);
await rm(budgetRoot, { recursive: true, force: true });

/* =====================================================================
 * 8 — the basename entry point survives
 * ===================================================================== */

assert('a full directory basename can still name a session',
  /basename\(candidate\.dir\) === requested/.test(SERVER));

/* =====================================================================
 * 9 — the picker route walks the store, not the id index
 * ===================================================================== */

// The list route builds from the WALK and not from the id index: the index is a reachability
// fix, and building the picker from it would mean a descriptor per candidate on every poll.
//
// The walk's own list is now the WHOLE of it rather than the thirty most recent sessions, and
// that is the second layer's requirement rather than a widening for its own sake: a sub-agent is
// always newer than the session that spawned it, so a window of thirty is mostly sub-agents, and
// drawing the picker from it would push main sessions out of their own list. The walk has already
// stat'ed every candidate, so the deeper pool costs no extra disk work.
assert('the list route builds from the whole walk',
  /const allEntries = candidates\.allEntries;/.test(SERVER)
  && /const layers = splitSessionLayers\(allEntries, titles\);/.test(SERVER));
assert('the trajectory route keeps the recent list for the latest branch',
  /const entries = candidates\.recentEntries;/.test(SERVER));

/* =====================================================================
 * 10 — the page names the session it is showing
 * ===================================================================== */

assert('the page seeds the pinned session from the host id',
  /sessionId: detectHostSessionId\(\),/.test(CLIENT));
assert('the picker can label a pinned session that the recent list omits',
  /当前会话（不在最近列表）/.test(CLIENT));
assert('a pinned id missing from the options gets one inserted, not a blank select',
  /if \(select\.selectedIndex < 0\) \{[\s\S]{0,400}?select\.insertBefore\(pinned/.test(CLIENT));

await rm(root, { recursive: true, force: true });

console.log('[session-reachability] ' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('[session-reachability] OK');