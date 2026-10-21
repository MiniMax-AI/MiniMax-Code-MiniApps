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
 * Read-only: imports the pure helpers, never starts the runtime.
 * mutate-trajectory-cache.py breaks each of these in the shipped file.
 */
import { readFileSync } from 'node:fs';
import {
  createTrajectoryCache,
  trajectoryCacheFamily,
  trajectoryCacheKey,
} from '../miniapp/node/server.mjs';

const SERVER = readFileSync(new URL('../miniapp/node/server.mjs', import.meta.url), 'utf8');

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

if (failures.length) {
  console.error(`\n[trajectory-cache] ${failures.length} FAILED, ${pass} passed`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(`\n[trajectory-cache] ${pass} assertions passed`);
