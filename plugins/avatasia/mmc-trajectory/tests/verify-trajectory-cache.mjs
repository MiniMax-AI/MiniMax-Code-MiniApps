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
import { mkdir, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createTrajectoryCache,
  start,
  trajectoryCacheFamily,
  trajectoryCacheKey,
} from '../miniapp/node/server.mjs';

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
cache.set(keyFresh, familyAll, { body: 'v1' });
check('one store makes one entry', cache.size, 1);
for (let size = 2000; size <= 9000; size += 1000) {
  cache.set(trajectoryCacheKey(entry(size, size), identity, null, null), familyAll, { body: `v${size}` });
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
mixed.set(keyA1, familyAll, { body: 'a1' });
mixed.set(keyA2, familyAll, { body: 'a2' });
check('growth in one family did not disturb the other family', mixed.size, 1);
mixed.set(keySlice, familySlice, { body: 's3' });
mixed.set(keyOther, trajectoryCacheFamily('/store/session-b', null), { body: 'b1' });
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
  bounded.set(trajectoryCacheKey({ dir, sizeBytes: 100, lastActiveAt: 1 }, identity, null, null), fam, { body: `b${i}` });
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
hot.set(keyOf('wanted'), trajectoryCacheFamily('/store/wanted', null), { body: 'wanted' });
hot.set(keyOf('other'), trajectoryCacheFamily('/store/other', null), { body: 'other' });
// Touched, so recency order becomes [other, wanted] rather than [wanted, other].
hot.get(keyOf('wanted'));
hot.set(keyOf('newcomer'), trajectoryCacheFamily('/store/newcomer', null), { body: 'newcomer' });
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
hotFamily.set(familyKeyOf('wanted'), trajectoryCacheFamily('/store/wanted', null), { body: 'wanted' });
hotFamily.set(familyKeyOf('other'), trajectoryCacheFamily('/store/other', null), { body: 'other' });
// Touched by family, not by key: the reader asked the family and never computed this key.
hotFamily.getByFamily(trajectoryCacheFamily('/store/wanted', null));
hotFamily.set(familyKeyOf('newcomer'), trajectoryCacheFamily('/store/newcomer', null), { body: 'newcomer' });
assert('a family that was read by family survives the next eviction',
  hotFamily.getByFamily(trajectoryCacheFamily('/store/wanted', null))?.body === 'wanted');
assert('and the family that was not read is the one evicted',
  hotFamily.getByFamily(trajectoryCacheFamily('/store/other', null)) === null);

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
  (startBody.match(/trajectoryCache\.get\(ctx\.cacheKey\) \?\? trajectoryCache\.getByFamily\(ctx\.family\)/g) || []).length === 2);

// The family is what the two keys share, so it has to be looked up by the family and not by
// the key: an entry stored under one key is found under another whose family is the same.
const shared = createTrajectoryCache(LIMIT);
const boundKey = trajectoryCacheKey(entry(1000, 5000), identity, { sessionId: 'sess-a', title: 'A' }, null);
const unboundKey = trajectoryCacheKey(entry(1000, 5000), identity, null, null);
assert('the same body under two bindings is two keys',
  boundKey !== unboundKey);
shared.set(boundKey, familyAll, { body: 'shared' });
assert('and the exact key still finds it', shared.get(boundKey)?.body === 'shared');
assert('the other key does not',
  shared.get(unboundKey) === null);
assert('but the family finds it, which is what the readers do',
  shared.getByFamily(familyAll)?.body === 'shared');
assert('and a different family does not',
  shared.getByFamily(familySlice) === null);

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
  for (let attempt = 0; attempt < 12 && !base; attempt += 1) {
    const port = 19900 + Math.floor(Math.random() * 300) + attempt;
    try {
      instance = await start({
        pluginId: 'mmc-trajectory',
        pluginRoot: PLUGIN_ROOT,
        dataDir: PLUGIN_ROOT,
        generationId: 'guard',
        listen: { host: '127.0.0.1', port },
        signal: controller.signal,
        logger: { debug: noop, info: noop, warn: noop, error: noop },
      });
      base = 'http://127.0.0.1:' + port;
    } catch (error) {
      // The port was taken. Another one is tried; a guard that gave up here would be a
      // guard that sometimes checks nothing.
    }
  }
  if (!base) throw new Error('could not bind a port for the reachability route');

  const get = async (path) => {
    const response = await fetch(base + path);
    let body = null;
    try { body = await response.json(); } catch { body = null; }
    return { status: response.status, body };
  };
  const why = (answer) => 'status ' + answer.status + ' ' + JSON.stringify(answer.body);

  try {
    // 1 — the poll the page makes, and the read it makes right after it.
    const poll = await get('/api/trajectory?session=latest');
    assert('the poll answers with the conversation the runtime says is live',
      Boolean(poll.body && poll.body.session) && poll.body.session.id === REACH_ALPHA,
      why(poll));

    const rawById = await get('/api/trajectory/raw?index=1&session=' + REACH_ALPHA);
    assert('a record of the conversation on screen is readable by that conversation\'s id',
      rawById.status === 200, why(rawById));
    assert('and it is that conversation\'s own message',
      JSON.stringify(rawById.body && rawById.body.raw ? rawById.body.raw : '').includes('ALPHA BODY'),
      why(rawById));

    const detailById = await get('/api/trajectory/record?index=1&session=' + REACH_ALPHA);
    assert('the four fields of a record are readable by that conversation\'s id',
      detailById.status === 200, why(detailById));

    // 2 — the runtime moves on while the page is still showing the first conversation.
    const moved = new DatabaseSync(dbPath);
    moved.exec('update local_runtime_sessions set updated_at_ms = 300 where session_id = '
      + '\'' + REACH_BRAVO + '\'');
    moved.close();
    const poll2 = await get('/api/trajectory?session=latest');
    assert('the next poll follows the runtime to the conversation that is live now',
      Boolean(poll2.body && poll2.body.session) && poll2.body.session.id === REACH_BRAVO,
      why(poll2));

    const rawAfter = await get('/api/trajectory/raw?index=1&session=' + REACH_ALPHA);
    assert('the conversation still on screen is still readable by its id',
      rawAfter.status === 200, why(rawAfter));
    assert('and it is still its own message, not the other conversation\'s',
      JSON.stringify(rawAfter.body && rawAfter.body.raw ? rawAfter.body.raw : '').includes('ALPHA BODY'),
      why(rawAfter));

    const detailAfter = await get('/api/trajectory/record?index=1&session=' + REACH_ALPHA);
    assert('and its records\' fields are still readable by its id',
      detailAfter.status === 200, why(detailAfter));

    // 3 — the retry. The client's answer to a 503 is to reload the trajectory and ask again,
    // so the read after a reload is the read a reader would make.
    const reload = await get('/api/trajectory?session=latest');
    assert('the reload answers', reload.status === 200, why(reload));
    const rawRetry = await get('/api/trajectory/raw?index=1&session=' + REACH_ALPHA);
    assert('the read after a reload still finds the conversation on screen',
      rawRetry.status === 200, why(rawRetry));
    const detailRetry = await get('/api/trajectory/record?index=1&session=' + REACH_ALPHA);
    assert('and so does the record read',
      detailRetry.status === 200, why(detailRetry));
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
