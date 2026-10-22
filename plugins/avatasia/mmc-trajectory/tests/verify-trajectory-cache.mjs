/**
 * The rendered-body cache may not keep four versions of one question alive.
 *
 * `trajectoryCacheKey()` carries the active file's size and mtime, so a session that is still
 * being written to mints a new key every time it grows. Every miss then stores another complete
 * body — `?since=` included, because the cache entry and /raw both need the whole thing. With a
 * plain FIFO over keys, four versions of the SAME (session, slice) sit there at once, and three of
 * them can no longer be reached: /raw resolves the current key, and the page's next poll produces
 * a newer one. Measured on a 9.1 MB session polled every 8s: four bodies, 49.6 MB, after four polls.
 *
 * So an entry carries the family it answers for — the session directory plus the requested slice —
 * and storing a new one drops its predecessor. Everything that decides whether the answer changed
 * stays in the key; everything that decides what the answer IS stays in the family.
 *
 * Read-only: imports the pure helpers, and the last section starts the route against a store
 * and a runtime database built here.
 * mutate-trajectory-cache.py breaks each of these in the shipped file.
 */
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createTrajectoryCache,
  recordSetFingerprint,
  start,
  trajectoryCacheFamily,
  trajectoryCacheKey,
} from '../miniapp/node/server.mjs';
import { digestOf } from '../miniapp/node/search-segments.mjs';

const SERVER = readFileSync(new URL('../miniapp/node/server.mjs', import.meta.url), 'utf8');
/** The package root, so the route serves the same page the reader gets. */
const PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url));

// `node:sqlite` is still flagged experimental, and the flag goes to stderr the moment the module
// is first loaded. The runner reads `stdout + stderr` and prints the LAST non-empty line, so the
// warning would land where this guard's own result line should be.
const emitWarning = process.emitWarning;
process.emitWarning = (warning, ...rest) => (
  String(warning).startsWith('SQLite is an experimental feature')
    ? undefined
    : emitWarning.call(process, warning, ...rest));

let pass = 0;
const failures = [];
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass += 1;
  else failures.push(`${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function assert(name, cond) {
  if (cond) pass += 1;
  else failures.push(name);
}

const LIMIT = 4;
const DIR = '/store/session-a';
/** The session the entries in the unit section below are about. */
const SID = 'sess-unit';
const entry = (size, mtime) => ({ dir: DIR, sizeBytes: size, lastActiveAt: mtime });
const identity = { catalogBytes: 1234, generations: [{ generation: 0, fileName: 'g0', byteLength: 10 }] };

/* =====================================================================
 * 1 — the family is a prefix of the key, and the key still says what changed
 * ===================================================================== */

const familyAll = trajectoryCacheFamily(DIR, null);
const familySlice = trajectoryCacheFamily(DIR, 3);
assert('the family names the session directory', familyAll.startsWith(DIR));
assert('an unfiltered request is the "all" slice', familyAll === `${DIR}|gen=all|`);
assert('a filtered request names its own generation', familySlice === `${DIR}|gen=3|`);
assert('two slices are two families', familyAll !== familySlice);
assert('two sessions are two families',
  trajectoryCacheFamily('/store/session-b', null) !== familyAll);

const keyFresh = trajectoryCacheKey(entry(1000, 5000), identity, null, null);
const keyGrown = trajectoryCacheKey(entry(2000, 6000), identity, null, null);
assert('the key starts with its family', keyFresh.startsWith(familyAll));
assert('growth still produces a different key', keyFresh !== keyGrown);
assert('the key still carries the size, so a stale entry is never served',
  keyGrown.includes('|2000|6000|'));
assert('the key still carries the catalog bytes',
  keyGrown.includes('|1234|'));

// The catalog rotating a generation must also change the key, or a compaction that only rotated
// snapshots would serve the pre-rotation body.
const rotatedIdentity = {
  catalogBytes: 1234,
  generations: [{ generation: 0, fileName: 'g1', byteLength: 10 }],
};
assert('rotating the lineage changes the key',
  trajectoryCacheKey(entry(1000, 5000), rotatedIdentity, null, null) !== keyFresh);

// The identity the directory holds is part of the key, because the body says which session it is
// about. A manifest that changes from one id to another leaves the directory, the transcript and
// the mtime exactly as they were, so a key made of those would still match — and the cached body
// of the OLD id would be served for the NEW one.
const keyIdentityA = trajectoryCacheKey(entry(1000, 5000), { ...identity, id: 'sess-a' }, null, null);
const keyIdentityB = trajectoryCacheKey(entry(1000, 5000), { ...identity, id: 'sess-b' }, null, null);
assert('two identities are two keys, so one identity cannot reuse the other body',
  keyIdentityA !== keyIdentityB);
assert('an identity is not the same key as no identity at all', keyIdentityA !== keyFresh);

/* =====================================================================
 * 2 — growth replaces its predecessor instead of stacking beside it
 * ===================================================================== */

const cache = createTrajectoryCache(LIMIT);
cache.set(keyFresh, familyAll, SID, { body: 'v1' });
check('one store makes one entry', cache.size, 1);
for (let size = 2000; size <= 9000; size += 1000) {
  cache.set(trajectoryCacheKey(entry(size, size), identity, null, null), familyAll, SID, { body: `v${size}` });
}
assert('nine versions of one question leave one entry', cache.size === 1);
assert('the survivor is the newest, not the oldest',
  cache.get(trajectoryCacheKey(entry(9000, 9000), identity, null, null))?.body === 'v9000');
assert('a superseded key is gone, so /raw cannot reach it',
  cache.get(keyFresh) === null);

/* =====================================================================
 * 3 — different questions keep their own entries
 * ===================================================================== */

const mixed = createTrajectoryCache(LIMIT);
const keyA1 = trajectoryCacheKey(entry(1000, 5000), identity, null, null);
const keyA2 = trajectoryCacheKey(entry(2000, 6000), identity, null, null);
const keySlice = trajectoryCacheKey(entry(1000, 5000), identity, null, 3);
const keyOther = trajectoryCacheKey({ ...entry(1000, 5000), dir: '/store/session-b' }, identity, null, null);
mixed.set(keyA1, familyAll, SID, { body: 'a1' });
mixed.set(keyA2, familyAll, SID, { body: 'a2' });
check('growth in one family did not disturb the other family', mixed.size, 1);
mixed.set(keySlice, familySlice, SID, { body: 's3' });
mixed.set(keyOther, trajectoryCacheFamily('/store/session-b', null), SID, { body: 'b1' });
check('two sessions and two slices coexist', mixed.size, 3);
assert('the unfiltered session kept its newest body', mixed.get(keyA2)?.body === 'a2');
assert('the slice kept its own body', mixed.get(keySlice)?.body === 's3');
assert('the other session kept its own body', mixed.get(keyOther)?.body === 'b1');

/* =====================================================================
 * 4 — the entry bound still applies across families
 * ===================================================================== */

const bounded = createTrajectoryCache(LIMIT);
const families = [];
for (let i = 0; i < LIMIT + 3; i += 1) {
  const dir = `/store/session-${i}`;
  const fam = trajectoryCacheFamily(dir, null);
  families.push(fam);
  bounded.set(trajectoryCacheKey({ dir, sizeBytes: 100, lastActiveAt: 1 }, identity, null, null), fam, SID, { body: `b${i}` });
}
assert('more sessions than the bound still respect it', bounded.size === LIMIT);
assert('the oldest session was the one evicted', bounded.get(trajectoryCacheKey(
  { dir: '/store/session-0', sizeBytes: 100, lastActiveAt: 1 }, identity, null, null,
)) === null);

// Reading has to refresh recency, or a family the reader keeps asking for is evicted by
// insertion order while a colder one survives.
//
// Three families are needed, not two: storing a fourth member of an existing family frees its own
// slot first, so with two families the bound never has to evict anything and the assertion passes
// whether or not recency is refreshed. That is the shape of a tautological test.
const hot = createTrajectoryCache(2);
const keyOf = (name) => trajectoryCacheKey(
  { dir: `/store/${name}`, sizeBytes: 1, lastActiveAt: 1 }, identity, null, null,
);
hot.set(keyOf('wanted'), trajectoryCacheFamily('/store/wanted', null), SID, { body: 'wanted' });
hot.set(keyOf('other'), trajectoryCacheFamily('/store/other', null), SID, { body: 'other' });
// Touched, so recency order becomes [other, wanted] rather than [wanted, other].
hot.get(keyOf('wanted'));
hot.set(keyOf('newcomer'), trajectoryCacheFamily('/store/newcomer', null), SID, { body: 'newcomer' });
assert('a family that was read again survives the next eviction', hot.get(keyOf('wanted'))?.body === 'wanted');
assert('the family that was NOT touched is the one evicted', hot.get(keyOf('other')) === null);

// Reading by family refreshes recency too, and for the same reason: an entry that was just
// read is hot, and a family the reader keeps asking for must not be the one evicted. A lookup
// that found the entry but left it where it was would make the family that is being read the
// first to go.
const hotFamily = createTrajectoryCache(2);
const familyKeyOf = (name) => trajectoryCacheKey(
  { dir: `/store/${name}`, sizeBytes: 1, lastActiveAt: 1 }, identity, null, null,
);
hotFamily.set(familyKeyOf('wanted'), trajectoryCacheFamily('/store/wanted', null), SID, { body: 'wanted' });
hotFamily.set(familyKeyOf('other'), trajectoryCacheFamily('/store/other', null), SID, { body: 'other' });
// Touched by family, not by key: the reader asked the family and never computed this key.
hotFamily.getByFamily(trajectoryCacheFamily('/store/wanted', null), SID);
hotFamily.set(familyKeyOf('newcomer'), trajectoryCacheFamily('/store/newcomer', null), SID, { body: 'newcomer' });
assert('a family that was read by family survives the next eviction',
  hotFamily.getByFamily(trajectoryCacheFamily('/store/wanted', null), SID)?.body === 'wanted');
assert('and the family that was not read is the one evicted',
  hotFamily.getByFamily(trajectoryCacheFamily('/store/other', null), SID) === null);

/* =====================================================================
 * 5 — structure: the cache is per-runtime, and the route names the family
 * ===================================================================== */

const startAt = SERVER.indexOf('export async function start(');
const startBody = SERVER.slice(startAt);
assert('start() exists', startAt > 0);
assert('the cache is created inside start(), not at module level',
  startBody.includes('const trajectoryCache = createTrajectoryCache(TRAJECTORY_CACHE_ENTRIES);')
  && !/\nconst trajectoryCache = createTrajectoryCache\(/.test(SERVER.slice(0, startAt)));
assert('the route names the family from the entry and the requested slice',
  startBody.includes('trajectoryCache.set(cacheKey, trajectoryCacheFamily(entry.dir, filter)'));
assert('the route no longer evicts by insertion order itself',
  !/while \(trajectoryCache\.size > TRAJECTORY_CACHE_ENTRIES\)/.test(startBody));
assert('the family helper is exported so the key and the cache cannot drift apart',
  SERVER.includes('export function trajectoryCacheFamily(dir, filter)'));
// The key is read as the set of components it is made of, not as one frozen line of source. A key
// that grew a field is still the same key, and an assertion that pinned two neighbouring fields
// together would have called that growth a regression — the shape is an accident of how the
// template was written, the components are the contract.
const keyFnAt = SERVER.indexOf('export function trajectoryCacheKey(');
const keyFnEnd = keyFnAt >= 0 ? SERVER.indexOf('\n}', keyFnAt) : -1;
const keyFnBody = keyFnAt >= 0 && keyFnEnd > keyFnAt ? SERVER.slice(keyFnAt, keyFnEnd) : '';
assert('the key is built from the same helper, so the prefix cannot drift from the cache',
  keyFnBody.includes('${trajectoryCacheFamily(entry.dir, filter)}'));
assert('the key names the identity the body carries, so one identity cannot reuse another body',
  keyFnBody.includes("${identity.id ?? ''}"));
assert('the key names the lineage it stitches, so a rotated snapshot cannot reuse an old body',
  keyFnBody.includes('${lineage}'));
assert('the route still releases both caches on dispose',
  /trajectoryCache\.clear\(\);/.test(startBody) && /parsedRows\.clear\(\);/.test(startBody));

// The key names the version; the family names the question. A poll that asked for `latest`
// and a read that asked for that session by its id are the same reader of the same body,
// but they computed different keys: the poll's key carries the binding it resolved and the
// read's does not, and that has nothing to do with the body. So the read has to be able to
// ask for the family when the exact key misses.
//
// The two shapes are asserted separately on purpose. A guard that only checked the family
// would pass with a route that never stored one; a guard that only checked the store would
// pass with a route that never looked one up.
assert('the cache can be asked for the family it answers for',
  typeof createTrajectoryCache(LIMIT).getByFamily === 'function');
assert('the request resolves the family it will look up',
  startBody.includes('family: trajectoryCacheFamily(entry.dir, filter)'));
assert('both readers fall back to the family when the exact key misses',
  (startBody.match(/trajectoryCache\.get\(ctx\.cacheKey\) \?\? trajectoryCache\.getByFamily\(ctx\.family, ctx\.identityId\)/g) || []).length === 2);

// The family is what the two keys share, so it has to be looked up by the family and not by
// the key: an entry stored under one key is found under another whose family is the same.
const shared = createTrajectoryCache(LIMIT);
const boundKey = trajectoryCacheKey(entry(1000, 5000), identity, { sessionId: 'sess-a', title: 'A' }, null);
const unboundKey = trajectoryCacheKey(entry(1000, 5000), identity, null, null);
assert('the same body under two bindings is two keys',
  boundKey !== unboundKey);
shared.set(boundKey, familyAll, SID, { body: 'shared' });
assert('and the exact key still finds it', shared.get(boundKey)?.body === 'shared');
assert('the other key does not',
  shared.get(unboundKey) === null);
assert('but the family finds it, which is what the readers do',
  shared.getByFamily(familyAll, SID)?.body === 'shared');
assert('and a different family does not',
  shared.getByFamily(familySlice, SID) === null);

/* =====================================================================
 * 5b — the family names the QUESTION; the session names the ANSWER
 * ===================================================================== */

// A family holds exactly one entry, and that entry is about one session. A directory can stop
// holding one session and start holding another: the manifest beside the transcript is the
// authority on that, and it can change under a cached walk. An entry built for the old session
// is therefore not an answer about the new one, however well the directory and the slice match
// — and its decoded messages are the OLD session's messages.
//
// The family cannot carry the session, because one family is one question and the question is
// asked by many readers of many sessions: the poll that asks for `latest` and the read that
// asks for one session by its id are the same reader of the same body. So the entry remembers
// which session it is about, and the lookup names the session it wants.

const identityAware = createTrajectoryCache(LIMIT);
identityAware.set('key-for-a', familyAll, 'sess-a', { body: 'a' });
assert('an entry is found for the session it is about',
  identityAware.getByFamily(familyAll, 'sess-a')?.body === 'a');
assert('and it is NOT found for another session',
  identityAware.getByFamily(familyAll, 'sess-b') === null);
assert('the exact key still finds it, because the key names the session too',
  identityAware.get('key-for-a')?.body === 'a');
assert('and a family that was never asked for is still empty',
  identityAware.getByFamily(familySlice, 'sess-a') === null);

// The other direction, because a check that rejects everything is not a check: the SAME session
// has to be reachable by the family, which is what the readers rely on.
const sameSession = createTrajectoryCache(LIMIT);
sameSession.set('key-one', familyAll, 'sess-a', { body: 'one' });
sameSession.set('key-two', familyAll, 'sess-a', { body: 'two' });
assert('a newer version of the same family replaces its predecessor',
  sameSession.size === 1);
assert('and the survivor is the newer one',
  sameSession.getByFamily(familyAll, 'sess-a')?.body === 'two');

/* =====================================================================
 * 6 — over HTTP: the body of the session on screen is reachable by its id
 * ===================================================================== */

// The cache is where the body is held and the readers are where it is handed out, so the
// promise checked here is the one a reader sees: the conversation on screen can be opened,
// record by record.
//
// It used to answer 「会话数据已释放，请重新加载」 for a conversation the service was holding.
// The page polls `/api/trajectory?session=latest` and the body is stored under a key that
// carries the binding `latest` resolved; the page then reads one record through
// `/api/trajectory/raw?session=<the id on screen>`, and that request carries no binding at
// all — so it computed a different key, missed, and reported that the session was gone.
//
// The client's own retry does not rescue it, and that is the part worth checking: the retry
// reloads the CURRENT conversation, which is not the one on screen, and asks again with the
// same key that missed. So the read after a reload is the same failure.
//
// The fixture carries a runtime database, and that is not decoration. The binding only
// exists when the runtime database answered; without it `latest` falls back to the newest
// file, the poll carries no binding either, and the two requests compute the SAME key — so
// the defect is invisible on a store with no runtime database, and a fixture without one
// would pass for the wrong reason.

const REACH_ALPHA = 'mvs_reach_alpha';
const REACH_BRAVO = 'mvs_reach_bravo';

try {
  const home = mkdtempSync(join(tmpdir(), 'mmc-trajectory-reach-'));
  const sessionsRoot = join(home, 'v2', 'sessions');

  /** One conversation on disk: a transcript, the manifest that names it, and an mtime. */
  const makeConversation = async (id, body, mtimeMs) => {
    const name = '00-00-00-session_' + Buffer.from(id, 'utf8').toString('base64url');
    const dir = join(sessionsRoot, '2026', '10', '22', name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'messages.jsonl'), JSON.stringify({
      message_id: 'm1',
      turn_id: 't1',
      message: { role: 'user', content: body, timestamp: 1791600000000 },
    }) + '\n', 'utf8');
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ sessionId: id }), 'utf8');
    const stamp = new Date(mtimeMs);
    await utimes(join(dir, 'messages.jsonl'), stamp, stamp);
    return { id, dir, relative: '2026/10/22/' + name };
  };

  const alpha = await makeConversation(REACH_ALPHA, 'ALPHA BODY', 1791600000000);
  const bravo = await makeConversation(REACH_BRAVO, 'BRAVO BODY', 1791500000000);

  // A directory whose name does not decode names no session, so the manifest beside it is the
  // only identity it has — and that identity can change under a cached walk. This is the shape
  // the family fallback has to be careful about: the directory and the slice still match, and
  // the session underneath is a different one.
  const LEGACY_A = 'mvs_legacy_alpha';
  const LEGACY_B = 'mvs_legacy_bravo';
  const legacyDir = join(sessionsRoot, '2026', '10', '22', '00-00-00-session_legacy');
  const writeLegacy = async (id, body, mtimeMs) => {
    await mkdir(legacyDir, { recursive: true });
    await writeFile(join(legacyDir, 'messages.jsonl'), JSON.stringify({
      message_id: 'm1',
      turn_id: 't1',
      message: { role: 'user', content: body, timestamp: 1791600000000 },
    }) + '\n', 'utf8');
    await writeFile(join(legacyDir, 'manifest.json'), JSON.stringify({ sessionId: id }), 'utf8');
    const stamp = new Date(mtimeMs);
    await utimes(join(legacyDir, 'messages.jsonl'), stamp, stamp);
  };
  await writeLegacy(LEGACY_A, 'ALPHA LEGACY', 1791600000000);

  // A conversation whose transcript is rewritten under a page that is still showing the old one.
  // The session identity does not move: the same directory, the same manifest, the same id — only
  // the line behind record 1 is a different line. That is what makes this the hard case: the
  // index still says 1, and the position is still a position, but it names a different record.
  //
  // TWO records in TWO turns, because the rule has two cases and one record can only ever be
  // one of them: a record rewritten AT the cursor, and a record rewritten in a turn BEFORE it.
  // The writer takes the lines one at a time, so a case can rewrite one of them and leave the
  // other exactly as it was.
  const VERSIONED = 'mvs_versioned';
  const versionedDir = join(sessionsRoot, '2026', '10', '22', '00-00-00-session_'
    + Buffer.from(VERSIONED, 'utf8').toString('base64url'));
  const writeVersioned = async (lines, mtimeMs) => {
    await mkdir(versionedDir, { recursive: true });
    const text = lines.map((one) => JSON.stringify({
      message_id: one.id,
      turn_id: one.turn,
      message: { role: 'user', content: one.body, timestamp: 1791600000000 },
    }) + '\n').join('');
    await writeFile(join(versionedDir, 'messages.jsonl'), text, 'utf8');
    await writeFile(join(versionedDir, 'manifest.json'), JSON.stringify({ sessionId: VERSIONED }), 'utf8');
    const stamp = new Date(mtimeMs);
    await utimes(join(versionedDir, 'messages.jsonl'), stamp, stamp);
  };
  const ALPHA_LINES = [
    { id: 'm1', turn: 't1', body: 'ALPHA BODY' },
    { id: 'm2', turn: 't2', body: 'ALPHA SECOND' },
  ];
  await writeVersioned(ALPHA_LINES, 1791600000000);

  // A conversation whose turn grouping is not its file order.
  //
  // The ledger draws turn by turn, and inside a turn the records in the order they were
  // emitted — so the body of this one is [m1, m3, m2]: the first turn's two records together,
  // then the second turn's one. The generation files hold [m1, m2] and then [m3], because the
  // record that belongs to the FIRST turn arrived after the rotation.
  //
  // The two orders read one fact two ways, and they are not the same order: the first N records
  // of the body and the first N records of the files are two different sets. A search that
  // folds the files answers about the wrong one, and refuses a body that did not change.
  const LEDGER = 'mvs_ledger_order';
  const ledgerDir = join(sessionsRoot, '2026', '10', '22', '00-00-00-session_'
    + Buffer.from(LEDGER, 'utf8').toString('base64url'));
  const ledgerRow = (one) => JSON.stringify({
    message_id: one.id,
    turn_id: one.turn,
    message: { role: 'user', content: one.body, timestamp: 1791600000000 },
  }) + '\n';
  await mkdir(join(ledgerDir, 'snapshots'), { recursive: true });
  await writeFile(join(ledgerDir, 'snapshots', 'gen0.jsonl'), [
    { id: 'm1', turn: 't1', body: 'LEDGER ORDER FIRST QUESTION' },
    { id: 'm2', turn: 't2', body: 'LEDGER ORDER SECOND QUESTION' },
  ].map(ledgerRow).join(''), 'utf8');
  await writeFile(join(ledgerDir, 'messages.jsonl'), [
    { id: 'm3', turn: 't1', body: 'LEDGER ORDER LATE ANSWER' },
  ].map(ledgerRow).join(''), 'utf8');
  await writeFile(join(ledgerDir, 'manifest.json'), JSON.stringify({ sessionId: LEDGER }), 'utf8');
  // The catalog is what names the sealed generation. Without it the lineage is the active file
  // alone, and there is no second generation for the turn grouping to disagree with.
  await writeFile(join(ledgerDir, 'history-catalog.json'), JSON.stringify({
    artifacts: [
      { generation: 0, kind: 'snapshot', fileName: 'gen0.jsonl' },
      { generation: 1, kind: 'active', fileName: 'messages.jsonl' },
    ],
  }), 'utf8');
  const ledgerStamp = new Date(1791600000000);
  await utimes(join(ledgerDir, 'messages.jsonl'), ledgerStamp, ledgerStamp);
  await utimes(join(ledgerDir, 'snapshots', 'gen0.jsonl'), ledgerStamp, ledgerStamp);

  // A conversation whose segment will not cover the whole body.
  //
  // A record with no locator names no file, so it belongs to no generation's segment — and the
  // segments then cover fewer records than the body, which is a DIFFERENT set of records. The
  // fold over that set is a fold over the wrong one, its fingerprint is not the one the page is
  // holding, and the service refuses a body that did not change at all.
  //
  // Three records, so that a segment which covers two of them is visibly short.
  const UNCOVERED = 'mvs_uncovered';
  const uncoveredDir = join(sessionsRoot, '2026', '10', '22', '00-00-00-session_'
    + Buffer.from(UNCOVERED, 'utf8').toString('base64url'));
  await mkdir(uncoveredDir, { recursive: true });
  await writeFile(join(uncoveredDir, 'messages.jsonl'), [
    { id: 'm1', turn: 't1', body: 'UNCOVERED SET FIRST' },
    { id: 'm2', turn: 't2', body: 'UNCOVERED SET SECOND' },
    { id: 'm3', turn: 't3', body: 'UNCOVERED SET THIRD' },
  ].map((one) => JSON.stringify({
    message_id: one.id,
    turn_id: one.turn,
    message: { role: 'user', content: one.body, timestamp: 1791600000000 },
  }) + '\n').join(''), 'utf8');
  await writeFile(join(uncoveredDir, 'manifest.json'), JSON.stringify({ sessionId: UNCOVERED }), 'utf8');
  const uncoveredStamp = new Date(1791600000000);
  await utimes(join(uncoveredDir, 'messages.jsonl'), uncoveredStamp, uncoveredStamp);

  // The runtime database, which is the only place on this machine that knows which
  // conversation is live. ALPHA is live first; BRAVO becomes live later in this section.
  mkdirSync(join(home, 'v2', 'sqlite'), { recursive: true });
  const { DatabaseSync } = await import('node:sqlite');
  const dbPath = join(home, 'v2', 'sqlite', 'runtime-state.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec('create table local_runtime_sessions (session_id text, title text, status text, '
    + 'history_relative_dir text, session_kind text, archived integer, updated_at_ms integer, '
    + 'parent_session_id text, purpose text, workspace_dir text)');
  db.exec('create table local_runtime_session_locks (session_id text, expires_at_ms integer)');
  const insert = db.prepare('insert into local_runtime_sessions values (?,?,?,?,?,0,?,null,null,null)');
  insert.run(REACH_ALPHA, 'Alpha', 'idle', alpha.relative, 'conversation', 200);
  insert.run(REACH_BRAVO, 'Bravo', 'idle', bravo.relative, 'conversation', 100);
  db.close();

  const previousRoot = process.env.MMC_TRAJECTORY_ROOT;
  process.env.MMC_TRAJECTORY_ROOT = home;
  const controller = new AbortController();
  const noop = () => {};
  let instance = null;
  let base = null;
  // Starting the service is one thing that happens twice in this section, so it is one function.
  // The second start is not a repeat of the first: it is how the service stops believing the walk
  // it cached (the walk holds the session list for three seconds, so a rewritten transcript is
  // invisible to it until that expires). Restarting drops that cache in one step instead of
  // waiting it out.
  const startService = async () => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const port = 19900 + Math.floor(Math.random() * 300) + attempt;
      try {
        const started = await start({
          pluginId: 'mmc-trajectory',
          pluginRoot: PLUGIN_ROOT,
          // The temporary store, not the plugin directory. A search writes its segment cache
          // under the data dir, and the plugin directory installs onto every reader's machine —
          // a guard that leaves a cache in there is a guard that ships a cache.
          dataDir: home,
          generationId: 'guard',
          listen: { host: '127.0.0.1', port },
          signal: controller.signal,
          logger: { debug: noop, info: noop, warn: noop, error: noop },
        });
        return { instance: started, base: 'http://127.0.0.1:' + port };
      } catch (error) {
        // The port was taken. Another one is tried; a guard that gave up here would be a
        // guard that sometimes checks nothing.
      }
    }
    throw new Error('could not bind a port for the reachability route');
  };
  {
    const started = await startService();
    instance = started.instance;
    base = started.base;
  }

  const get = async (path) => {
    const response = await fetch(base + path);
    let body = null;
    try { body = await response.json(); } catch { body = null; }
    return { status: response.status, body };
  };
  const why = (answer) => 'status ' + answer.status + ' ' + JSON.stringify(answer.body);

  // The version of one record of a body. A position read names an INDEX, and an index is a
  // position inside ONE body — so a read has to say which record of that body it means, and this
  // is what it says. The page takes it from the RECORD the reader opened, which came from the body
  // it is showing: the record is the one that survives a reload, so a read that is retried after
  // one still asks about the same record.
  const versionOf = (body, index) => {
    const turns = body && Array.isArray(body.turns) ? body.turns : [];
    for (const turn of turns) {
      const records = Array.isArray(turn && turn.records) ? turn.records : [];
      for (const record of records) {
        if (record && record.index === index) return typeof record.v === 'string' ? record.v : '';
      }
    }
    return '';
  };

  // The SET of records a body is, as the page names it: the records' own versions, in the order
  // the ledger shows them. The service folds its own records the same way, and an answer it
  // cannot tie to this set is refused — an answer about another body says nothing about this
  // body's omissions, and the rows it does not name are the ones the reader cannot see dimmed.
  const versionsOf = (body) => {
    const out = [];
    const turns = body && Array.isArray(body.turns) ? body.turns : [];
    for (const turn of turns) {
      const records = Array.isArray(turn && turn.records) ? turn.records : [];
      for (const record of records) {
        out.push(record && typeof record.v === 'string' ? record.v : '');
      }
    }
    return out;
  };
  // The cursor a page would ask a tail from: the last record it holds. The same word the server
  // uses for it, and the same number — a tail cut at the wrong one is a tail about the wrong
  // records, and the point of this section is that the wrong one is refused rather than served.
  const lastIndexOf = (body) => {
    const turns = body && Array.isArray(body.turns) ? body.turns : [];
    let last = 0;
    for (const turn of turns) {
      const records = Array.isArray(turn && turn.records) ? turn.records : [];
      for (const record of records) {
        if (record && typeof record.index === 'number' && record.index > last) last = record.index;
      }
    }
    return last;
  };

  // The segments a search published, found by walking the data dir. Publishing them is a side
  // effect that nobody awaits, so the test waits for the file rather than for a promise.
  const surfacePaths = async (dir) => {
    const found = [];
    const walk = async (current) => {
      let entries = [];
      try {
        entries = await readdir(current, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = join(current, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.name === 'surface.txt') found.push(full);
      }
    };
    await walk(dir);
    return found;
  };
  const waitForSegments = async (dir) => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const found = await surfacePaths(dir);
      if (found.length > 0) return found;
      await new Promise((done) => setTimeout(done, 50));
    }
    return [];
  };

  // The surfaces that hold a given text. Every session's segments live under the same root, so
  // they are told apart by what is IN them: the searchable text of the records they cover.
  const waitForSegmentsWith = async (dir, marker, wanted) => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const found = [];
      for (const path of await surfacePaths(dir)) {
        const text = await readFile(path, 'utf8');
        if (text.includes(marker)) found.push(path);
      }
      if (found.length >= wanted) return found;
      await new Promise((done) => setTimeout(done, 50));
    }
    return [];
  };

  // The manifest lands after the surface, so a segment that has just been published can be found
  // before it can be read. Wait for the pair, not for the surface.
  const waitForManifest = async (surfacePath) => {
    const manifestPath = join(dirname(surfacePath), 'manifest.json');
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        return { manifestPath, manifest: JSON.parse(await readFile(manifestPath, 'utf8')) };
      } catch {
        await new Promise((done) => setTimeout(done, 50));
      }
    }
    return null;
  };

  try {
    // 1 — the poll the page makes, and the read it makes right after it.
    const poll = await get('/api/trajectory?session=latest');
    assert('the poll answers with the conversation the runtime says is live',
      Boolean(poll.body && poll.body.session) && poll.body.session.id === REACH_ALPHA,
      why(poll));

    // The slice the body IS. The service publishes it, and the page compares every answer it
    // gets against it, so it has to be the slice the body was BUILT FOR — the one that was asked
    // for, and the whole lineage when none was. The old wording answered a different question
    // (「how many generations does this body happen to show」) and gave a single-generation
    // session's default view the number 0 — so the same body published two different slices
    // depending on which of its generations happened to be in it, and an answer about the whole
    // lineage could not be compared with the body it was supposed to filter.
    assert('the body names the slice it is for: the whole lineage when no slice was asked for',
      Boolean(poll.body && poll.body.session) && poll.body.session.generation === null, why(poll));

    // Every record of the body carries its version, and the search answer's hits carry the SAME
    // one for the same record. Two answers to 「which record is at this index」 that disagree are
    // what let a newer body's hits filter an older body's rows.
    const alphaVersion = versionOf(poll.body, 1);
    assert('every record of the body carries a version',
      alphaVersion !== '', 'version of record 1: ' + JSON.stringify(alphaVersion));
    const alphaVersions = versionsOf(poll.body);
    const alphaSearch = await get('/api/trajectory/search?session=' + REACH_ALPHA + '&q=ALPHA'
      + '&n=' + alphaVersions.length + '&fp=' + recordSetFingerprint(alphaVersions));
    assert('the search answers with hits',
      alphaSearch.status === 200 && Array.isArray(alphaSearch.body && alphaSearch.body.hits)
      && alphaSearch.body.hits.length > 0, why(alphaSearch));
    const alphaHit = alphaSearch.body.hits.find((hit) => hit.index === 1);
    assert('and a hit names the same version of the record it points at',
      Boolean(alphaHit) && alphaHit.v === alphaVersion,
      'hit: ' + JSON.stringify(alphaHit) + ' body: ' + alphaVersion);
    assert('and the search answer names the same slice as the body it is about',
      Boolean(alphaSearch.body && alphaSearch.body.session)
      && alphaSearch.body.session.generation === poll.body.session.generation,
      'search: ' + JSON.stringify(alphaSearch.body && alphaSearch.body.session)
      + ' body: ' + JSON.stringify(poll.body && poll.body.session));

    // WHICH SET the answer is about. An answer says 「these match and the rest do not」, and the
    // part that matters to the reader is the part it does NOT name: a record this body has and
    // that body does not match would be dimmed as if it did not contain the needle, with nothing
    // anywhere saying so. So the request names the set, and a set that is not this one is refused.
    const otherSet = await get('/api/trajectory/search?session=' + REACH_ALPHA + '&q=ALPHA'
      + '&n=' + alphaVersions.length + '&fp=' + recordSetFingerprint(['a-different-record']));
    assert('a search about a set the body on screen is not is refused',
      otherSet.status === 409 && Boolean(otherSet.body)
      && otherSet.body.error === 'search_version_mismatch', why(otherSet));
    const unnamedSet = await get('/api/trajectory/search?session=' + REACH_ALPHA + '&q=ALPHA');
    assert('and a search that does not say which set it is about is refused rather than guessed at',
      unnamedSet.status === 400 && Boolean(unnamedSet.body)
      && unnamedSet.body.error === 'search_fingerprint_required', why(unnamedSet));
    // The fold is over the FIRST N records, so a page that is behind — the session grew since its
    // last poll — is still answered: its first N records are the same N, and the answer applies
    // to them. A body-level identity would have refused this, and the refusal would have been the
    // common case rather than the rare one.
    const behind = await get('/api/trajectory/search?session=' + REACH_ALPHA + '&q=ALPHA'
      + '&n=1&fp=' + recordSetFingerprint(alphaVersions.slice(0, 1)));
    assert('a page that is behind is still answered, because its first records are the same ones',
      behind.status === 200, why(behind));

    // The same refusal, on the path that answers from the stored segments — and the PROOF that
    // this path was the one taken.
    //
    // The segments are the cache the next search is answered from, and the answer is about the set
    // THEY stand for. So the test edits the version on one of their lines and fixes the digest:
    // the segment still matches its manifest, so it is still usable, and now the set it stands for
    // is not the set the page is showing. A rebuild would have answered 200 — the records on disk
    // are the ones the page has — so a 409 can only have come from the segments. And the other way
    // round: naming the EDITED set is accepted, which a rebuild would have refused. Between the
    // two, the path is not a guess.
    const segments = await waitForSegments(home);
    assert('the first search published its segments, so the next one is answered from them',
      segments.length > 0, 'segments under ' + home);
    if (segments.length > 0) {
      const surfacePath = segments[0];
      const manifestPath = join(dirname(surfacePath), 'manifest.json');
      const surface = await readFile(surfacePath, 'utf8');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      const edited = surface.replace(/"v":"[0-9a-f]{16}"/, '"v":"ffffffffffffffff"');
      await writeFile(surfacePath, edited);
      manifest.surfaceDigest = digestOf(edited);
      await writeFile(manifestPath, JSON.stringify(manifest));
      const editedVersions = alphaVersions.slice();
      editedVersions[0] = 'ffffffffffffffff';
      const viaSegments = await get('/api/trajectory/search?session=' + REACH_ALPHA + '&q=ALPHA'
        + '&n=' + editedVersions.length + '&fp=' + recordSetFingerprint(editedVersions));
      assert('a search answered from the segments is accepted when the page names the set they stand for',
        viaSegments.status === 200, why(viaSegments));
      const aboutTheOtherSet = await get('/api/trajectory/search?session=' + REACH_ALPHA + '&q=ALPHA'
        + '&n=' + alphaVersions.length + '&fp=' + recordSetFingerprint(alphaVersions));
      assert('and refused when the page names a set they do not stand for',
        aboutTheOtherSet.status === 409 && Boolean(aboutTheOtherSet.body)
        && aboutTheOtherSet.body.error === 'search_version_mismatch', why(aboutTheOtherSet));
    }

    const rawById = await get('/api/trajectory/raw?index=1&session=' + REACH_ALPHA + '&v=' + alphaVersion);
    assert('a record of the conversation on screen is readable by that conversation\'s id',
      rawById.status === 200, why(rawById));
    assert('and it is that conversation\'s own message',
      JSON.stringify(rawById.body && rawById.body.raw ? rawById.body.raw : '').includes('ALPHA BODY'),
      why(rawById));

    const detailById = await get('/api/trajectory/record?index=1&session=' + REACH_ALPHA + '&v=' + alphaVersion);
    assert('the four fields of a record are readable by that conversation\'s id',
      detailById.status === 200, why(detailById));

    // A read that does not say which record it means is not answered: the service cannot tell
    // 「the record you meant」 from 「whatever is at that index now」, and guessing is the defect.
    // (These two sit after the version scenario on purpose: the two refusals are two rules, and a
    // control that takes the whole check away breaks both of them — so the one that is about the
    // VERSION has to be asked first, or the control would be attributed to the wrong rule.)

    // 2 — the runtime moves on while the page is still showing the first conversation.
    const moved = new DatabaseSync(dbPath);
    moved.exec('update local_runtime_sessions set updated_at_ms = 300 where session_id = '
      + '\'' + REACH_BRAVO + '\'');
    moved.close();
    const poll2 = await get('/api/trajectory?session=latest');
    assert('the next poll follows the runtime to the conversation that is live now',
      Boolean(poll2.body && poll2.body.session) && poll2.body.session.id === REACH_BRAVO,
      why(poll2));

    const rawAfter = await get('/api/trajectory/raw?index=1&session=' + REACH_ALPHA + '&v=' + alphaVersion);
    assert('the conversation still on screen is still readable by its id',
      rawAfter.status === 200, why(rawAfter));
    assert('and it is still its own message, not the other conversation\'s',
      JSON.stringify(rawAfter.body && rawAfter.body.raw ? rawAfter.body.raw : '').includes('ALPHA BODY'),
      why(rawAfter));

    const detailAfter = await get('/api/trajectory/record?index=1&session=' + REACH_ALPHA + '&v=' + alphaVersion);
    assert('and its records\' fields are still readable by its id',
      detailAfter.status === 200, why(detailAfter));

    // 3 — the retry. The client's answer to a 503 is to reload the trajectory and ask again,
    // so the read after a reload is the read a reader would make.
    const reload = await get('/api/trajectory?session=latest');
    assert('the reload answers', reload.status === 200, why(reload));
    const rawRetry = await get('/api/trajectory/raw?index=1&session=' + REACH_ALPHA + '&v=' + alphaVersion);
    assert('the read after a reload still finds the conversation on screen',
      rawRetry.status === 200, why(rawRetry));
    const detailRetry = await get('/api/trajectory/record?index=1&session=' + REACH_ALPHA + '&v=' + alphaVersion);
    assert('and so does the record read',
      detailRetry.status === 200, why(detailRetry));

    // 4 — the session under a directory can change, and the fallback has to notice.
    //
    // The family names the directory and the slice. The session is a different thing: a
    // directory can stop holding one session and start holding another, and the manifest
    // beside the transcript is the authority on that. The family lookup then finds the OLD
    // session's entry, and that entry's decoded messages are the old session's messages — so
    // a read for the new session answers with the old one's words.
    const legacyLoad = await get('/api/trajectory?session=' + LEGACY_A);
    assert('the conversation whose name does not decode loads by the id its manifest gives',
      legacyLoad.status === 200 && Boolean(legacyLoad.body && legacyLoad.body.session)
      && legacyLoad.body.session.id === LEGACY_A, why(legacyLoad));

    const legacyVersion = versionOf(legacyLoad.body, 1);
    const legacyRaw = await get('/api/trajectory/raw?index=1&session=' + LEGACY_A + '&v=' + legacyVersion);
    assert('and its record reads back',
      legacyRaw.status === 200, why(legacyRaw));
    assert('with its own message',
      JSON.stringify(legacyRaw.body && legacyRaw.body.raw ? legacyRaw.body.raw : '')
        .includes('ALPHA LEGACY'), why(legacyRaw));

    // The directory keeps its name and its place; the manifest and the transcript change.
    await writeLegacy(LEGACY_B, 'BRAVO LEGACY', 1791700000000);

    const staleRaw = await get('/api/trajectory/raw?index=1&session=' + LEGACY_B);
    assert('the read for the new session does not answer with the old session\'s message',
      !(staleRaw.status === 200
        && JSON.stringify(staleRaw.body && staleRaw.body.raw ? staleRaw.body.raw : '')
          .includes('ALPHA LEGACY')), why(staleRaw));
    assert('and it says the body is not held, rather than serving another session\'s',
      staleRaw.status === 503, why(staleRaw));

    const legacyDetail = await get('/api/trajectory/record?index=1&session=' + LEGACY_B);
    assert('and the record read refuses it the same way',
      legacyDetail.status === 503, why(legacyDetail));

    // After a reload the new session is held, and then it reads back.
    const legacyReload = await get('/api/trajectory?session=' + LEGACY_B);
    assert('the new session loads after the swap',
      legacyReload.status === 200 && Boolean(legacyReload.body && legacyReload.body.session)
      && legacyReload.body.session.id === LEGACY_B, why(legacyReload));
    const legacyRawAfter = await get('/api/trajectory/raw?index=1&session=' + LEGACY_B + '&v=' + versionOf(legacyReload.body, 1));
    assert('and then its own record reads back',
      legacyRawAfter.status === 200, why(legacyRawAfter));
    assert('with the new message, not the old one',
      JSON.stringify(legacyRawAfter.body && legacyRawAfter.body.raw ? legacyRawAfter.body.raw : '')
        .includes('BRAVO LEGACY'), why(legacyRawAfter));

    // 5 — the transcript is rewritten under a page that is still showing the old one.
    //
    // The session does not change: the same directory, the same manifest, the same id. Only the
    // line behind record 1 is a different line now. The index still says 1 and the position is
    // still a position — but it names a DIFFERENT record, and the old one is what the reader is
    // looking at.
    //
    // The service is holding the newer body by the time the read arrives (the page's next poll
    // loaded it), so the line it would read is the new one and its own digest check passes. What
    // stops it from answering is the version the request carries: the reader says which record it
    // meant, and the service compares that with the record it would serve.
    const versionLoad = await get('/api/trajectory?session=' + VERSIONED);
    assert('the conversation whose transcript will be rewritten loads',
      versionLoad.status === 200 && Boolean(versionLoad.body && versionLoad.body.session)
      && versionLoad.body.session.id === VERSIONED, why(versionLoad));
    const oldVersion = versionOf(versionLoad.body, 1);
    assert('and its record carries a version',
      oldVersion !== '', 'version: ' + JSON.stringify(oldVersion));
    // The set the page holds, and the cursor it would ask a tail from: the records it has, in
    // order, and the last of them.
    const oldVersions = versionsOf(versionLoad.body);
    const oldCursor = lastIndexOf(versionLoad.body);
    assert('the conversation has the two records the two cases need',
      oldVersions.length === 2 && oldCursor === 2,
      'versions: ' + oldVersions.length + ' cursor: ' + oldCursor);

    await writeVersioned([
      { id: 'm1', turn: 't1', body: 'BRAVO BODY' },
      { id: 'm2', turn: 't2', body: 'ALPHA SECOND' },
    ], 1791800000000);
    // The service now has to be holding the NEWER body, or the read below is not the read the
    // reader would make. A fresh service instance is how it stops believing the walk it cached:
    // the walk holds the session list for three seconds, so a rewritten transcript is invisible
    // to it until that expires, and restarting drops that cache in one step.
    await instance.dispose();
    {
      const restarted = await startService();
      instance = restarted.instance;
      base = restarted.base;
    }

    // THE TAIL A PAGE ASKS FOR WHEN THE RECORD UNDER IT HAS CHANGED.
    //
    // The tail carries the records AFTER the page's cursor; the ones before it stay as the page
    // has them. So the tail is only about the page's copy if that copy is still the service's —
    // and a record rewritten in place keeps its index and its id, so the cursor still points at
    // the same record and the tail looks empty. The page would merge nothing, keep the old text,
    // and install the new body's validator, and nothing else in the protocol could see it.
    //
    // So the request says which set the page holds, and the service refuses a tail it cannot tie
    // to that set. THIS IS THE FIRST REQUEST AFTER THE RESTART ON PURPOSE: the refusal belongs
    // to the path that REBUILDS the body, and the path that finds the body already held answers
    // with the whole body — which is safe, because a whole body replaces everything.
    //
    // The set the page holds is the one it had before the rewrite: record 1 was rewritten in
    // place, in the turn BEFORE the cursor's turn.
    const staleTail = await get('/api/trajectory?session=' + VERSIONED + '&since=' + oldCursor
      + '&n=' + oldVersions.length + '&fp=' + recordSetFingerprint(oldVersions));
    assert('a tail asked for by a page whose record was rewritten in place is refused',
      staleTail.status === 409 && Boolean(staleTail.body)
      && staleTail.body.error === 'trajectory_version_mismatch', why(staleTail));
    // And the tail it is NOT given: the next request finds the body the service already holds,
    // and is answered with the whole body. That is safe — a whole body replaces everything — and
    // it is why the refusal belongs to the path that rebuilds: the cached path answers with a
    // whole body, not with a tail, so there is no set for it to check.
    const wholeBody = await get('/api/trajectory?session=' + VERSIONED + '&since=' + oldCursor);
    assert('a tail asked for against a body the service already holds is answered with the whole body',
      wholeBody.status === 200 && Boolean(wholeBody.body) && !wholeBody.body.delta, why(wholeBody));

    const versionReload = await get('/api/trajectory?session=' + VERSIONED);
    assert('the rewritten conversation loads again',
      versionReload.status === 200, why(versionReload));
    assert('and the body it serves is the rewritten one',
      JSON.stringify(versionReload.body).includes('BRAVO BODY'), why(versionReload));
    const newVersion = versionOf(versionReload.body, 1);
    assert('and the record behind the same index is a different version of itself',
      newVersion !== '' && newVersion !== oldVersion,
      'old: ' + oldVersion + ' new: ' + newVersion);

    const staleVersionRaw = await get('/api/trajectory/raw?index=1&session=' + VERSIONED + '&v=' + oldVersion);
    assert('a secondary read from an older body never serves a newer body\'s record',
      !(staleVersionRaw.status === 200
        && JSON.stringify(staleVersionRaw.body && staleVersionRaw.body.raw ? staleVersionRaw.body.raw : '')
          .includes('BRAVO BODY')), why(staleVersionRaw));
    assert('and it says the version moved, rather than answering with the other record',
      staleVersionRaw.status === 409 && staleVersionRaw.body
      && staleVersionRaw.body.error === 'record_version_mismatch', why(staleVersionRaw));

    const staleVersionDetail = await get('/api/trajectory/record?index=1&session=' + VERSIONED + '&v=' + oldVersion);
    assert('and the record read refuses it the same way',
      staleVersionDetail.status === 409 && staleVersionDetail.body
      && staleVersionDetail.body.error === 'record_version_mismatch', why(staleVersionDetail));

    const currentVersionRaw = await get('/api/trajectory/raw?index=1&session=' + VERSIONED + '&v=' + newVersion);
    assert('while the read that names the current version still answers',
      currentVersionRaw.status === 200
      && JSON.stringify(currentVersionRaw.body && currentVersionRaw.body.raw ? currentVersionRaw.body.raw : '')
        .includes('BRAVO BODY'), why(currentVersionRaw));

    // And the other refusal: a read that does not say which record it means is not answered
    // either. The service cannot tell 「the record you meant」 from 「whatever is at that index
    // now」, and guessing is the defect.
    //
    // The body is loaded again first: a restarted service holds no body until one is asked for,
    // and a read against an empty cache is refused for that reason rather than this one.
    const alphaReload = await get('/api/trajectory?session=' + REACH_ALPHA);
    assert('and the service still answers for the conversation on screen',
      alphaReload.status === 200, why(alphaReload));
    const rawNoVersion = await get('/api/trajectory/raw?index=1&session=' + REACH_ALPHA);
    assert('a read that does not name the record it means is refused',
      rawNoVersion.status === 400 && rawNoVersion.body && rawNoVersion.body.error === 'record_version_required',
      why(rawNoVersion));
    const detailNoVersion = await get('/api/trajectory/record?index=1&session=' + REACH_ALPHA);
    assert('and the record read refuses it the same way',
      detailNoVersion.status === 400 && detailNoVersion.body && detailNoVersion.body.error === 'record_version_required',
      why(detailNoVersion));

    // The other case of the same rule: the record AT THE CURSOR, rewritten in place.
    //
    // The page's set is the one it would hold now — the body after the first rewrite, whose
    // record 2 is still the old one — and the record that changed under it is the one the cursor
    // points at. The tail would be empty here too, and the id it names would still agree.
    await writeVersioned([
      { id: 'm1', turn: 't1', body: 'BRAVO BODY' },
      { id: 'm2', turn: 't2', body: 'BRAVO SECOND' },
    ], 1791900000000);
    await instance.dispose();
    {
      const restarted = await startService();
      instance = restarted.instance;
      base = restarted.base;
    }
    const cursorSet = versionsOf(versionReload.body);
    const staleCursorTail = await get('/api/trajectory?session=' + VERSIONED + '&since=' + oldCursor
      + '&n=' + cursorSet.length + '&fp=' + recordSetFingerprint(cursorSet));
    assert('a tail asked for by a page whose record AT THE CURSOR was rewritten in place is refused',
      staleCursorTail.status === 409 && Boolean(staleCursorTail.body)
      && staleCursorTail.body.error === 'trajectory_version_mismatch', why(staleCursorTail));

    // And the request that names no set at all. The service cannot tell which records the page
    // has, so it cannot answer with a tail: the records before the cursor are not in the tail,
    // and the page would keep the copies it has without knowing whether they are still the
    // service's. A whole body would be safe, but the body has to be rebuilt for it — and the
    // rule is that a tail is only ever answered to a page that says which set it holds.
    await writeVersioned([
      { id: 'm1', turn: 't1', body: 'CHARLIE BODY' },
      { id: 'm2', turn: 't2', body: 'BRAVO SECOND' },
    ], 1792000000000);
    await instance.dispose();
    {
      const restarted = await startService();
      instance = restarted.instance;
      base = restarted.base;
    }
    const unnamedTail = await get('/api/trajectory?session=' + VERSIONED + '&since=' + oldCursor);
    assert('a tail asked for without saying which set the page holds is refused rather than guessed at',
      unnamedTail.status === 400 && Boolean(unnamedTail.body)
      && unnamedTail.body.error === 'trajectory_fingerprint_required', why(unnamedTail));

    // 6b — the set the segments stand for, when the ledger's order is not the files' order.
    //
    // The search answers about a SET of records, and the set is the first N of the body — the
    // body in LEDGER order, which is turn by turn. The segments are one file per generation,
    // read oldest first, and those are two different orders whenever a record that belongs to an
    // EARLIER turn lives in a LATER file. That is what a turn that spans a rotation looks like,
    // and it is the conversation the fixture above holds.
    //
    // So the fold has to be over the body's order, reconstructed from the segments. A fold over
    // the files answers about a different set, the fingerprint of the first N does not match the
    // one the page asked for, and the service refuses a body that did not change at all.
    const ledgerBody = await get('/api/trajectory?session=' + LEDGER);
    assert('the conversation whose turn grouping differs from its file order loads',
      ledgerBody.status === 200 && Boolean(ledgerBody.body && ledgerBody.body.turns), why(ledgerBody));
    // The order, written out by hand: the first turn holds the records 1 and 3, the second holds
    // the record 2. The generation files hold 1 and 2, then 3.
    const LEDGER_ORDER = [1, 3, 2];
    const FILE_ORDER = [1, 2, 3];
    check('the ledger draws the first turn with the record that arrived after the rotation',
      (ledgerBody.body.turns || []).map((turn) => (turn.records || []).map((record) => record.index)),
      [[1, 3], [2]]);
    const ledgerVersionByIndex = new Map(
      (ledgerBody.body.turns || []).flatMap((turn) => (turn.records || []))
        .map((record) => [record.index, record.v]));
    // The set the page holds: the versions of its records, in the order the ledger draws them.
    // The ORDER is the one written out above and the versions are the page's own, so the
    // expectation cannot move together with the answer it is checking — a fold computed with the
    // function under test would.
    const ledgerVersions = LEDGER_ORDER.map((index) => ledgerVersionByIndex.get(index) ?? '');
    const fileVersions = FILE_ORDER.map((index) => ledgerVersionByIndex.get(index) ?? '');
    const ledgerFingerprint = recordSetFingerprint(ledgerVersions);
    assert('and the two orders really are two different sets, so this case can tell them apart',
      ledgerFingerprint !== recordSetFingerprint(fileVersions));

    // The first search finds no segment to answer from, so the rebuild answers it — and
    // publishes the segments the next search is answered from.
    const rebuilt = await get('/api/trajectory/search?session=' + LEDGER
      + '&q=LEDGER ORDER&n=' + ledgerVersions.length + '&fp=' + ledgerFingerprint);
    assert('the search answers the set the page holds',
      rebuilt.status === 200, why(rebuilt));
    check('and it reports the records that match',
      (rebuilt.body && rebuilt.body.hits ? rebuilt.body.hits : []).map((hit) => hit.index), [1, 3, 2]);
    const ledgerSurfaces = await waitForSegmentsWith(home, 'ledger order', 2);
    assert('and the search published a segment for each of the two generations',
      ledgerSurfaces.length === 2, 'surfaces holding the marker: ' + ledgerSurfaces.length);

    // THE REBUILD IS TAKEN OUT OF THE PICTURE, so that the answers below can only be the
    // segments'. The active file's line stops parsing while the file keeps its length and its
    // timestamp, so the segments still match their source — and a rebuild would see a body
    // without the record that arrived late. The service is restarted because the rendered body
    // is cached under the file's size and timestamp, and both of those are unchanged.
    const ledgerActive = join(ledgerDir, 'messages.jsonl');
    const ledgerStat = await stat(ledgerActive);
    const ledgerText = await readFile(ledgerActive, 'utf8');
    // The colon after the message id becomes a letter: the line stops being JSON, and the file
    // keeps every byte it had — a segment is reusable while its source is the same file, and a
    // file's identity here is its size and its timestamp.
    await writeFile(ledgerActive, ledgerText.replace('"message_id":', '"message_id"X'), 'utf8');
    await utimes(ledgerActive, ledgerStat.mtimeMs / 1000, ledgerStat.mtimeMs / 1000);
    await instance.dispose();
    {
      const restarted = await startService();
      instance = restarted.instance;
      base = restarted.base;
    }
    const onDisk = await get('/api/trajectory?session=' + LEDGER);
    check('so the body on disk now holds only the records of the sealed generation',
      (onDisk.body && onDisk.body.turns ? onDisk.body.turns : [])
        .flatMap((turn) => (turn.records || [])).length, 2);

    const cached = await get('/api/trajectory/search?session=' + LEDGER
      + '&q=LEDGER ORDER&n=' + ledgerVersions.length + '&fp=' + ledgerFingerprint);
    assert('a cached search accepts the unchanged displayed set when an earlier turn gains a record in a later generation',
      cached.status === 200, why(cached));
    // The hits come back in the ledger's order, which is the order the rebuild returns them in.
    // The record's own number is NOT that order: the record that arrived for the first turn after
    // the rotation is emitted last and drawn first, so the two orders really do differ here — the
    // rebuild answers [1, 3, 2] and the segments hold [1, 2, 3].
    assert('a cached search returns its hits in the same order the rebuild returns them',
      JSON.stringify(cached.body && cached.body.hits) === JSON.stringify(rebuilt.body && rebuilt.body.hits),
      'cached: ' + JSON.stringify(cached.body && cached.body.hits)
      + ' rebuilt: ' + JSON.stringify(rebuilt.body && rebuilt.body.hits));
    check('and the answer is the one the rebuild gave',
      cached.body && cached.body.hits, rebuilt.body && rebuilt.body.hits);
    check('and the count is the count',
      cached.body && cached.body.total, rebuilt.body && rebuilt.body.total);

    // A page that is behind is still answered, because its first records are the same ones. The
    // body on disk holds two records, so a rebuild could not have answered this at all — which is
    // what says the answer above came from the segments.
    const ledgerBehind = await get('/api/trajectory/search?session=' + LEDGER
      + '&q=LEDGER ORDER&n=2&fp=' + recordSetFingerprint(ledgerVersions.slice(0, 2)));
    assert('and a page that is behind is still answered, because its first records are the same ones',
      ledgerBehind.status === 200, why(ledgerBehind));

    // And the refusal is still a refusal. The set the body on disk holds is the first two
    // records in FILE order, which is not the first two in ledger order — so the segments do not
    // stand for it, and a search that names it is refused rather than answered about the wrong
    // set. A rebuild would have answered it, so the refusal says the segments answered.
    const ledgerOtherSet = await get('/api/trajectory/search?session=' + LEDGER
      + '&q=LEDGER ORDER&n=2&fp=' + recordSetFingerprint(fileVersions.slice(0, 2)));
    assert('and a search that names a set the segments do not stand for is refused',
      ledgerOtherSet.status === 409 && Boolean(ledgerOtherSet.body)
      && ledgerOtherSet.body.error === 'search_version_mismatch', why(ledgerOtherSet));

    // 6c — a set of segments that does not cover the whole body.
    //
    // The set a search is answered about is the first N records of the body, and the segments have
    // to stand for THAT set. A record with no locator names no file, so it belongs to no
    // generation's segment: the segments cover fewer records than the body, and the fold over them
    // is a fold over a different set of records. The fingerprint of that set is not the one the
    // page is holding, so the service refuses a body that did not change at all — and the reader is
    // told the session moved when nothing moved.
    //
    // The route cannot produce that state today: every parsed row gets a locator, and a locator
    // names a file that is in the lineage. So the state is put together by hand here — the state
    // the segments would be in — and what is checked is the ANSWER: the search has to come from
    // the rebuild, and it has to report every record that matches rather than the ones the
    // segments happen to cover.
    const uncoveredBody = await get('/api/trajectory?session=' + UNCOVERED);
    const uncoveredVersions = versionsOf(uncoveredBody.body);
    const uncoveredFingerprint = recordSetFingerprint(uncoveredVersions);
    assert('the conversation whose segments will not cover the body holds three records',
      uncoveredVersions.length === 3, 'records: ' + uncoveredVersions.length);
    // The first search finds no segment to answer from, so the rebuild answers it — and publishes
    // the segments the next search would be answered from.
    const uncoveredRebuilt = await get('/api/trajectory/search?session=' + UNCOVERED
      + '&q=UNCOVERED SET&n=' + uncoveredVersions.length + '&fp=' + uncoveredFingerprint);
    assert('and it answers its search', uncoveredRebuilt.status === 200, why(uncoveredRebuilt));
    const uncoveredSurfaces = await waitForSegmentsWith(home, 'uncovered set', 1);
    assert('the search published a segment for it',
      uncoveredSurfaces.length === 1, 'surfaces holding the marker: ' + uncoveredSurfaces.length);
    if (uncoveredSurfaces.length === 1) {
      const pair = await waitForManifest(uncoveredSurfaces[0]);
      assert('the manifest beside it says how much of the body it does not cover', pair !== null);
      if (pair !== null) {
        check('which is nothing, because the segment covers the whole body',
          pair.manifest.uncovered, 0);
        // The segment is made to cover LESS than the body: the last record is taken out of the
        // surface, the manifest is told about the shorter surface, and the manifest is told that it
        // does not cover the whole body. The digest is fixed, so the pair still matches itself —
        // the only thing wrong with it is that it does not stand for the body the page is holding.
        const surface = await readFile(uncoveredSurfaces[0], 'utf8');
        const shorter = surface.split('\n').slice(0, 2).join('\n');
        await writeFile(uncoveredSurfaces[0], shorter);
        pair.manifest.surfaceDigest = digestOf(shorter);
        pair.manifest.surfaceBytes = Buffer.byteLength(shorter);
        pair.manifest.recordCount = 2;
        pair.manifest.uncovered = 1;
        await writeFile(pair.manifestPath, JSON.stringify(pair.manifest));
        const uncoveredAnswer = await get('/api/trajectory/search?session=' + UNCOVERED
          + '&q=UNCOVERED SET&n=' + uncoveredVersions.length + '&fp=' + uncoveredFingerprint);
        assert('a search whose segments do not cover the whole body is answered by the rebuild',
          uncoveredAnswer.status === 200, why(uncoveredAnswer));
        check('and the rebuild reports every record that matches, not the ones the segments cover',
          (uncoveredAnswer.body && uncoveredAnswer.body.hits ? uncoveredAnswer.body.hits : [])
            .map((hit) => hit.index), [1, 2, 3]);
      }
    }
  } finally {
    // The server is released here and not at the end of the happy path: an assertion that
    // throws would otherwise leave it listening, and the guard would hang instead of
    // reporting.
    if (instance) await instance.dispose();
    controller.abort();
    if (previousRoot === undefined) delete process.env.MMC_TRAJECTORY_ROOT;
    else process.env.MMC_TRAJECTORY_ROOT = previousRoot;
  }
} catch (error) {
  failures.push('the body of the session on screen is reachable by its id -- '
    + (error && error.message));
}

/* =====================================================================
 * 7 — shape: the route records and resolves the session, too
 * ===================================================================== */

// These two are read out of the source rather than run, and they are HERE rather than in
// section 5 on purpose: the behavioural section above is the owner of the promise they check,
// so a mutation that breaks the route must be caught by the reader's observable behaviour and
// only then by the shape. A shape check that fires first would report a mutation as caught
// while the behaviour it is about was never asked.

assert('the request resolves the session the family lookup is about, because a family is not a session',
  startBody.includes("identityId: identity.id ?? ''"));
assert('and the route records that session on the entry it stores',
  (startBody.match(/trajectoryCache\.set\(cacheKey, trajectoryCacheFamily\(entry\.dir, filter\), identity\.id \?\? ''/g) || []).length === 1);

/* =====================================================================
 * 8 — shape: the publish says how much of the body it does not cover
 * ===================================================================== */

// The reader's half of the rule is behavioural and lives in section 6c: a set of segments that does
// not cover the whole body is refused, and the rebuild answers. The publisher's half is read out of
// the source instead, and the reason is the same one that put the state together by hand in 6c —
// the route cannot produce a record with no locator, so nothing that runs the route can observe what
// the publish computes.
//
// So this is the claim that the count the publish writes into the manifest IS the count of the
// records no segment covers: a publish that counted nothing would write 「the set covers the whole
// body」 for a set that does not, and the reader would answer from it.
assert('the publish counts the records no segment covers, and hands the count to the manifest',
  startBody.includes('const uncovered = uncoveredRecordCount(fileIdxRows);')
  && startBody.includes('        uncovered,\n'));

if (failures.length) {
  console.error(`\n[trajectory-cache] ${failures.length} FAILED, ${pass} passed`);
  for (const f of failures) console.error('  - ' + f);
  // `process.exitCode` rather than `process.exit(1)`: the route was just asked for, and an
  // abrupt exit tears down the socket the answer arrived on, which on this platform ends in a
  // libuv assertion and a crash instead of an exit code. A guard that CRASHES has not caught
  // anything -- it has stopped -- and a mutation control that only saw a crash would not know
  // which rule it broke.
  process.exitCode = 1;
} else {
  console.log(`\n[trajectory-cache] ${pass} assertions passed`);
}
