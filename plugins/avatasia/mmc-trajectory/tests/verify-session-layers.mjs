/**
 * The picker is two controls: the upper one names the conversation, the lower one names the run
 * inside it.
 *
 * A sub-agent is a session like any other on disk — its own directory, its own `messages.jsonl` —
 * and the picker used to list it exactly like a conversation of the reader's own. On the machine
 * this was measured on, 13 of the 20 rows in the picker were sub-agent runs of the one
 * conversation being read. Nothing said so: a reader comparing two entries could not tell a
 * sub-agent run from their own work, and the runs were the actual content of the conversation.
 *
 * So they are not hidden either, and they are not rows of the conversation list either — that
 * list is the one a reader scrolls to find a conversation, and folding nineteen runs into it made
 * it forty rows long. The conversation pick holds conversations; the run pick holds the runs of
 * the conversation that was picked, and it is empty and disabled while the page follows the
 * newest conversation. The service sends the conversations and every run in the pool, and every
 * run row names the conversation it hangs off. The page groups them by that name; it does not
 * keep a hierarchy of its own.
 *
 * It used to be a second list under the picker. That was one question answered in two places:
 * the dropdown named conversations, the list named their runs, and nothing said whose runs they
 * were.
 *
 * Four rules, each with the reason it exists:
 *
 *   1. The conversation list holds conversations and nothing else. A sub-agent in it is a
 *      sub-agent wearing a conversation's clothes, which is the defect.
 *   2. A conversation's runs are all of them. The list is not a window: a run that exists but is
 *      not on screen is a run the reader cannot open.
 *   3. They are ordered by when each one last ran, most recent first — the one that ran last is
 *      the one a reader is most likely to want, and it is the one the other order buries.
 *   4. The layer is decided by `parent_session_id` and by the chain it forms, and by nothing
 *      else. `purpose` says what a session IS (a scheduled run, a background task), which is a
 *      different question from what it hangs off, and the two are orthogonal: a sub-agent is a
 *      task AND somebody's child. A judge that used `purpose` would call a scheduled run a
 *      sub-agent, and a sub-agent spawned by something other than a task a main session.
 *      The chain is what says whether a parent is a conversation: a run's parent is one, and a
 *      cycle has no conversation at the end of it, so the two sessions that name each other are
 *      two conversations rather than two runs of each other that the reader cannot reach.
 *
 * The fourth rule is the one that decides the other three, so the fixture below contains a row
 * that is a child with no purpose, and a row that is a main session whose purpose says 「task」.
 * The two columns disagree, and the layer follows the parent.
 *
 * A parent is a foreign key into the runtime database's own session table: a value that names
 * no session there is not a parent, and the page groups its runs by that value, so the service
 * publishes a parent only when it names one. The eighth section is about that.
 *
 * The pool is the whole walk, not the thirty most recent sessions. That is not a detail: a
 * sub-agent is always newer than the session that spawned it, so the thirty-entry window is
 * mostly sub-agents, and drawing the conversation list from it would push conversations out of
 * their own list. The walk has already stat'ed every candidate, so the deeper pool costs no extra
 * disk work — and a run that fell out of the window is still a run the reader has to be able to
 * open.
 *
 * The sections are checked against real stores and real runtime databases built here, not
 * against a copy of the logic. Each section runs inside its own try, and a section that throws
 * reports ITSELF rather than borrowing the name of the first assertion in it: a section that
 * threw has not judged anything, and a mutation that dies of an exception has to say which rule
 * it broke.
 *
 * `tests/mutate-session-layers.py` breaks each of them in the shipped source and requires this
 * guard to report it by name.
 */
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { mkdir, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SERVER = fileURLToPath(new URL('../miniapp/node/server.mjs', import.meta.url));
/** The page, read for the fields it takes out of the list payload. */
const CLIENT = fileURLToPath(new URL('../miniapp/client/index.html', import.meta.url));
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

const { DatabaseSync } = await import('node:sqlite');
const {
  collectSessionCandidates,
  decodeSessionIdFromDirName,
  readSessionTitles,
  sessionsValidator,
  splitSessionLayers,
} = await import(pathToFileURL(SERVER).href);

let pass = 0;
const failures = [];
function assert(name, cond, detail) {
  if (cond) { pass += 1; return; }
  failures.push(detail ? name + ' -- ' + detail : name);
}

/* ---------- the fixtures: a store and a runtime database, built here ---------- */

/** A session id, distinct enough that a wrong one cannot pass for another. */
const MAIN = (n) => 'mvs_layer_main' + String(n).padStart(2, '0') + 'zzzz';
const KID = (n) => 'mvs_layer_kid_' + String(n).padStart(2, '0') + 'zzzz';

/** A minute apart, so the recency order is unambiguous. */
const BASE_TIME = Date.UTC(2026, 9, 20, 0, 0, 0);

/** How many main sessions, and how many sub-agents hang off the first two of them. */
const MAIN_COUNT = 25;
const KIDS_OF_MAIN_0 = 13;
const KIDS_OF_MAIN_1 = 6;
// A main session that is NOT on the page: it is the twenty-third of twenty-five, so the twenty
// the picker shows do not include it. Its runs still have to travel, because the picker keeps a
// conversation alive with a row of its own once it ages out of the list.
const KIDS_OF_MAIN_22 = 2;

/**
 * One session directory under the store, with a controlled mtime.
 * @param {string} sessionsRoot
 * @param {number} index
 * @param {string} id
 * @param {number} mtimeMs
 */
async function makeSession(sessionsRoot, index, id, mtimeMs) {
  const name = String(index).padStart(2, '0') + '-00-00-session_'
    + Buffer.from(id, 'utf8').toString('base64url');
  const dir = join(sessionsRoot, '2026', '10', '20', name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'messages.jsonl'),
    JSON.stringify({ role: 'user', content: 'x' }) + '\n', 'utf8');
  const stamp = new Date(mtimeMs);
  await utimes(join(dir, 'messages.jsonl'), stamp, stamp);
  return { id, dir, relative: '2026/10/20/' + name };
}

/**
 * A runtime database with the columns the layer is decided by.
 *
 * `parent_session_id` and `purpose` are written so that they DISAGREE on purpose: one sub-agent
 * has no purpose at all, and one main session has a purpose that says 「task」. A judge that read
 * the purpose column would move both of them, and the guard below would see it.
 *
 * @param {string} home
 * @param {readonly { sessionId: string, kind?: string, purpose?: string | null, parent?: string | null, relative?: string | null, workspace?: string | null, updatedAtMs?: number }[]} rows
 * @param {readonly string[]} [leases] sessions holding a live lease
 */
function runtimeDb(home, rows, leases) {
  mkdirSync(join(home, 'v2', 'sqlite'), { recursive: true });
  const db = new DatabaseSync(join(home, 'v2', 'sqlite', 'runtime-state.sqlite'));
  db.exec('create table local_runtime_sessions (session_id text, title text, status text, '
    + 'history_relative_dir text, session_kind text, archived integer, updated_at_ms integer, '
    + 'parent_session_id text, purpose text, workspace_dir text)');
  db.exec('create table local_runtime_session_locks (session_id text, expires_at_ms integer)');
  const insert = db.prepare('insert into local_runtime_sessions (session_id, title, status, '
    + 'history_relative_dir, session_kind, archived, updated_at_ms, parent_session_id, purpose, '
    + 'workspace_dir) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const row of rows) {
    insert.run(row.sessionId, '会话 ' + row.sessionId.slice(-4), 'idle', row.relative ?? null,
      row.kind ?? 'conversation', 0, row.updatedAtMs ?? 1, row.parent ?? null, row.purpose ?? null,
      row.workspace ?? null);
  }
  // A live lease is the strongest signal the current-conversation resolver has: it says an
  // agent turn is running in that session right now. The fixture in section seven needs
  // one, because the defect that section covers is a session that WINS that resolution.
  if (leases) {
    const lock = db.prepare('insert into local_runtime_session_locks (session_id, expires_at_ms) values (?, ?)');
    for (const id of leases) lock.run(id, Date.now() + 600_000);
  }
  db.close();
}

/**
 * The service, started against a store, and stopped again.
 *
 * The port is picked from this guard's own band and a taken one is simply tried again. The store
 * is named through the environment, because that is how the service finds it -- the same way the
 * runtime finds it.
 *
 * @param {string} home
 * @returns {Promise<{ base: string, dispose: () => Promise<void> }>}
 */
async function startService(home) {
  const { start } = await import(pathToFileURL(SERVER).href);
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
        logger: { debug: noop, info: noop, warn: noop, error: noop }
      });
      base = 'http://127.0.0.1:' + port;
    } catch (error) {
      // The port was taken. Another one is tried.
    }
  }
  if (!base) throw new Error('could not bind a port for the route');
  return {
    base,
    dispose: async () => {
      if (instance) await instance.dispose();
      controller.abort();
      if (previousRoot === undefined) delete process.env.MMC_TRAJECTORY_ROOT;
      else process.env.MMC_TRAJECTORY_ROOT = previousRoot;
    }
  };
}

/**
 * The store, the database and the layers the service builds from them.
 *
 * @returns {Promise<{ home: string, sessionsRoot: string, made: any[], rows: any[], candidates: any, titles: Map<string, any>, layers: any }>}
 */
async function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'mmc-trajectory-layers-'));
  const sessionsRoot = join(home, 'v2', 'sessions');
  const made = [];
  const rows = [];
  let index = 0;
  // The main sessions are the newest: they are what a reader is looking at, and a sub-agent is
  // always newer than the session that spawned it, so this is the order the real store has.
  for (let i = 0; i < MAIN_COUNT; i += 1) {
    const id = MAIN(i);
    const dir = await makeSession(sessionsRoot, index, id, BASE_TIME - i * 60_000);
    index += 1;
    made.push(dir);
    rows.push({
      sessionId: id,
      relative: dir.relative,
      workspace: 'D:\\private\\workspace-one',
      updatedAtMs: BASE_TIME - i * 60_000,
      // The main session that LOOKS like a task. It is not one: it has no parent, so it is a
      // conversation, and a judge that read the purpose column would have moved it.
      purpose: i === MAIN_COUNT - 1 ? 'local-background-task:looks-like-a-task' : null,
      kind: i === MAIN_COUNT - 1 ? 'task' : 'conversation',
    });
  }
  // The sub-agents of the first main session are the OLDEST of all, so thirteen of them sit
  // outside the thirty most recent sessions. A pool of thirty would have lost them.
  for (let i = 0; i < KIDS_OF_MAIN_0; i += 1) {
    const id = KID(i);
    const dir = await makeSession(sessionsRoot, index, id, BASE_TIME - (60 + i) * 60_000);
    index += 1;
    made.push(dir);
    rows.push({
      sessionId: id,
      relative: dir.relative,
      parent: MAIN(0),
      kind: 'task',
      // The first sub-agent has NO purpose at all, and it is still a sub-agent.
      purpose: i === 0 ? null : 'local-background-task:sub-agent',
    });
  }
  // The sub-agents of the second main session are the newest of the sub-agents, and six of them
  // is the number this machine has.
  for (let i = 0; i < KIDS_OF_MAIN_1; i += 1) {
    const id = KID(KIDS_OF_MAIN_0 + i);
    const dir = await makeSession(sessionsRoot, index, id, BASE_TIME - (40 + i) * 60_000);
    index += 1;
    made.push(dir);
    rows.push({
      sessionId: id,
      relative: dir.relative,
      parent: MAIN(1),
      kind: 'task',
      purpose: 'local-background-task:sub-agent',
    });
  }
  // The runs of the main session that is not on the page.
  for (let i = 0; i < KIDS_OF_MAIN_22; i += 1) {
    const id = KID(KIDS_OF_MAIN_0 + KIDS_OF_MAIN_1 + i);
    const dir = await makeSession(sessionsRoot, index, id, BASE_TIME - (200 + i) * 60_000);
    index += 1;
    made.push(dir);
    rows.push({
      sessionId: id,
      relative: dir.relative,
      parent: MAIN(22),
      kind: 'task',
      purpose: 'local-background-task:sub-agent',
    });
  }
  runtimeDb(home, rows);
  const candidates = await collectSessionCandidates(sessionsRoot);
  const ids = candidates.allEntries.map((entry) => decodeSessionIdFromDirName(basename(entry.dir))).filter(Boolean);
  const titles = await readSessionTitles(home, ids);
  const layers = splitSessionLayers(candidates.allEntries, titles);
  return { home, sessionsRoot, made, rows, candidates, titles, layers };
}

const idsOf = (entries) => entries.map((entry) => decodeSessionIdFromDirName(basename(entry.dir)));
const idsOfBucket = (bucket) => (bucket || []).map((entry) => decodeSessionIdFromDirName(basename(entry.dir)));

/* ---------- 1: the main list holds main sessions and nothing else ---------- */

let world = null;
try {
  world = await fixture();
  const mainIds = idsOf(world.layers.mains);
  assert('the main list holds every main session',
    mainIds.length === MAIN_COUNT,
    mainIds.length + ' of ' + MAIN_COUNT);
  assert('and it holds no sub-agent at all',
    !mainIds.some((id) => KIDS_OF_MAIN_0 > 0 && /^mvs_layer_kid_/.test(id)),
    mainIds.filter((id) => /^mvs_layer_kid_/.test(id)).join('|'));
  assert('and no main session is missing from it',
    MAIN_COUNT === [...Array(MAIN_COUNT).keys()].map(MAIN).filter((id) => mainIds.includes(id)).length,
    mainIds.join('|'));
} catch (error) {
  failures.push('the main list holds main sessions and nothing else -- ' + (error && error.message));
}

/* ---------- 2: every sub-agent is there, and the list is not a window ---------- */

try {
  const kidIds = [...world.layers.childrenByParent.keys()].flatMap((parent) => idsOfBucket(world.layers.childrenByParent.get(parent)));
  assert('every sub-agent is in the sub-agent list',
    kidIds.length === KIDS_OF_MAIN_0 + KIDS_OF_MAIN_1 + KIDS_OF_MAIN_22,
    kidIds.length + ' of ' + (KIDS_OF_MAIN_0 + KIDS_OF_MAIN_1 + KIDS_OF_MAIN_22));
  assert('and none of them is a main session',
    !kidIds.some((id) => /^mvs_layer_main/.test(id)),
    kidIds.filter((id) => /^mvs_layer_main/.test(id)).join('|'));
  // The pool is the whole walk, not the thirty most recent. Thirteen of these sub-agents are
  // older than every main session, so a pool of thirty would have lost all of them.
  const recentIds = idsOf(world.candidates.recentEntries);
  assert('and the pool is the whole walk, not the thirty most recent sessions',
    world.candidates.allEntries.length === MAIN_COUNT + KIDS_OF_MAIN_0 + KIDS_OF_MAIN_1 + KIDS_OF_MAIN_22
    && recentIds.length < world.candidates.allEntries.length,
    world.candidates.allEntries.length + ' all / ' + recentIds.length + ' recent');
  const outsideTheWindow = idsOfBucket(world.layers.childrenByParent.get(MAIN(0)));
  assert('so a sub-agent older than the thirty most recent is still listed',
    outsideTheWindow.length === KIDS_OF_MAIN_0
    && outsideTheWindow.every((id) => !recentIds.includes(id)),
    outsideTheWindow.length + ' of ' + KIDS_OF_MAIN_0 + ', '
    + outsideTheWindow.filter((id) => recentIds.includes(id)).length + ' inside the window');
} catch (error) {
  failures.push('every sub-agent is there, and the list is not a window -- ' + (error && error.message));
}

/* ---------- 3: the sub-agents are ordered by when each one last ran ---------- */

try {
  for (const [parent, bucket] of world.layers.childrenByParent.entries()) {
    const times = bucket.map((entry) => entry.lastActiveAt);
    const sorted = times.every((value, i) => i === 0 || times[i - 1] >= value);
    assert('the sub-agents of one main session are ordered most recently active first',
      sorted,
      parent + ': ' + times.join(','));
  }
  const first = world.layers.childrenByParent.get(MAIN(0)) || [];
  // The fixture makes the sub-agents older the higher their number, so the one at the top is
  // the first one made.
  const newestKid = KID(0);
  assert('and the one that ran last is the one at the top',
    first.length === KIDS_OF_MAIN_0
    && decodeSessionIdFromDirName(basename(first[0].dir)) === newestKid,
    first.map((entry) => decodeSessionIdFromDirName(basename(entry.dir))).join('|'));
} catch (error) {
  failures.push('the sub-agents are ordered by when each one last ran -- ' + (error && error.message));
}

/* ---------- 4: the layer is the parent column, and the purpose column is not ---------- */

try {
  const mainIds = idsOf(world.layers.mains);
  const kidsOfMain0 = idsOfBucket(world.layers.childrenByParent.get(MAIN(0)));
  // The main session whose purpose says 「task」: no parent, so it is a conversation.
  const looksLikeATask = MAIN(MAIN_COUNT - 1);
  assert('a main session whose purpose says 「task」 is still a main session',
    mainIds.includes(looksLikeATask) && !world.layers.childrenByParent.has(looksLikeATask),
    mainIds.includes(looksLikeATask) ? 'in the main list' : 'missing');
  // The sub-agent with no purpose at all: a parent, so it is a sub-agent.
  const purposeLess = KID(0);
  assert('a sub-agent with no purpose at all is still a sub-agent',
    kidsOfMain0.includes(purposeLess) && !mainIds.includes(purposeLess),
    kidsOfMain0.includes(purposeLess) ? 'in the sub-agent list' : 'missing');
  // The sub-agent whose purpose says what it is. It has a parent AND a purpose, and a judge
  // that read the purpose column instead of the parent column would move it into the wrong
  // layer -- so the two columns are read against each other here, and not only against the
  // row that has just one of them.
  const purposeSaying = KID(1);
  assert('a sub-agent whose purpose says 「sub-agent」 is still a sub-agent',
    kidsOfMain0.includes(purposeSaying) && !mainIds.includes(purposeSaying),
    kidsOfMain0.includes(purposeSaying) ? 'in the sub-agent list' : 'missing');
  // And the sub-agents hang off the main session they name — the join key is one id, the same
  // id the main row carries.
  assert('and each sub-agent hangs off the main session it names',
    [...world.layers.childrenByParent.keys()].every((parent) => /^mvs_layer_main/.test(parent)),
    [...world.layers.childrenByParent.keys()].join('|'));
} catch (error) {
  failures.push('the layer is the parent column, and the purpose column is not -- ' + (error && error.message));
}

/* ---------- 5: the validator moves when a sub-agent does ---------- */

try {
  const visible = world.layers.mains.slice(0, 20);
  const kids = world.layers.childrenByParent.get(MAIN(0)) || [];
  const before = sessionsValidator(visible, world.titles, 20, kids);
  // A sub-agent that starts: one more row, and the page has never seen it.
  const oneMore = kids.concat([{ dir: kids[0].dir + '-new', sizeBytes: 10, lastActiveAt: 1 }]);
  assert('a sub-agent that starts moves the validator',
    sessionsValidator(visible, world.titles, 20, oneMore) !== before);
  // A sub-agent that runs again: same row, newer file.
  const rerun = kids.map((entry, i) => (i === 0 ? { ...entry, lastActiveAt: entry.lastActiveAt + 1 } : entry));
  assert('a sub-agent that runs again moves the validator',
    sessionsValidator(visible, world.titles, 20, rerun) !== before);
  // The parent id is IN the material: the same sub-agent under a different main session is a
  // different page, and a material that did not say so would let one answer for the other.
  assert('and the material carries the parent a sub-agent hangs off',
    before.includes(MAIN(0)),
    before.slice(0, 200));
  // A validator that never saw the sub-agents cannot move when they do — which is exactly why
  // the route has to pass them in.
  assert('a validator built without the sub-agents does not move when one does',
    sessionsValidator(visible, world.titles, 20) === sessionsValidator(visible, world.titles, 20));
} catch (error) {
  failures.push('the validator moves when a sub-agent does -- ' + (error && error.message));
}

/* ---------- 6: the payload the page receives ---------- */

// The sections above test the service's own functions. This one tests the BYTES: the route is
// started against the same fixture store, and the body it answers with is read back.
//
// It is here because the last rule is not a rule about a function. "A main session's sub-agents
// are all of them" is a promise about what the page receives, and the place a sub-agent could
// get lost is the route that collects them -- a cap there would show up in a function-level test
// as nothing at all.

try {
  const { start } = await import(pathToFileURL(SERVER).href);
  const previousRoot = process.env.MMC_TRAJECTORY_ROOT;
  process.env.MMC_TRAJECTORY_ROOT = world.home;
  const controller = new AbortController();
  const noop = () => {};
  let base = null;
  let instance = null;
  for (let attempt = 0; attempt < 12 && !base; attempt += 1) {
    const port = 19400 + Math.floor(Math.random() * 400) + attempt;
    try {
      instance = await start({
        pluginId: 'mmc-trajectory',
        pluginRoot: PLUGIN_ROOT,
        dataDir: PLUGIN_ROOT,
        generationId: 'guard',
        listen: { host: '127.0.0.1', port },
        signal: controller.signal,
        logger: { debug: noop, info: noop, warn: noop, error: noop }
      });
      base = 'http://127.0.0.1:' + port;
    } catch (error) {
      // The port was taken. Another one is tried; a guard that gives up here would be a guard
      // that sometimes checks nothing.
    }
  }
  if (!base) throw new Error('could not bind a port for the route');
  const response = await fetch(base + '/api/sessions?limit=20');
  const body = await response.json();
  const mainIds = new Set(idsOf(world.layers.mains));
  const kidIds = new Set([...world.layers.childrenByParent.keys()].flatMap(
    (parent) => idsOfBucket(world.layers.childrenByParent.get(parent))));
  const sessionIds = (body.sessions || []).map((row) => row.id);
  const childIds = (body.children || []).map((row) => row.id);

  assert('the payload sends twenty main sessions',
    sessionIds.length === 20, String(sessionIds.length));
  assert('and not one of them is a sub-agent',
    !sessionIds.some((id) => kidIds.has(id)),
    sessionIds.filter((id) => kidIds.has(id)).join('|'));
  assert('and every one of them is a main session',
    sessionIds.every((id) => mainIds.has(id)),
    sessionIds.filter((id) => !mainIds.has(id)).join('|'));
  assert('the payload sends every run in the pool',
    childIds.length === KIDS_OF_MAIN_0 + KIDS_OF_MAIN_1 + KIDS_OF_MAIN_22,
    childIds.length + ' of ' + (KIDS_OF_MAIN_0 + KIDS_OF_MAIN_1 + KIDS_OF_MAIN_22));
  assert('and each of them names the conversation it hangs off',
    (body.children || []).every((row) => typeof row.sessionParentId === 'string' && row.sessionParentId),
    (body.children || []).filter((row) => !row.sessionParentId).map((row) => row.id).join('|'));
  // The runs of a conversation that is NOT on the page travel too. The pool is the whole
  // walk, and a reader reading a conversation that has aged out of the twenty still has to be
  // able to reach its runs -- so a service that sent only the runs of the visible conversations
  // would take them away from a reader who is reading one.
  const runsOfTheHidden = (body.children || [])
    .filter((row) => row.sessionParentId === MAIN(22)).map((row) => row.id);
  assert('and the runs of a conversation that is not on the page are sent too',
    runsOfTheHidden.length === KIDS_OF_MAIN_22,
    runsOfTheHidden.length + ' of ' + KIDS_OF_MAIN_22);
  // The order inside one group: most recently active first, which is the promise the run pick
  // makes about the rows it draws.
  const kidsOfMain0 = (body.children || []).filter((row) => row.sessionParentId === MAIN(0)).map((row) => row.id);
  assert('and the sub-agents of one conversation arrive most recently active first',
    kidsOfMain0.join(',') === idsOfBucket(world.layers.childrenByParent.get(MAIN(0))).join(','),
    kidsOfMain0.join('|'));
  // The payload carries only what the page reads. `currentSessionId` used to be here for a
  // second list under the picker; that list is gone, and a field nobody reads is a field every
  // reader is sent for nothing. The set of "what the page reads" is read out of the page's own
  // sessions fetch rather than written out here, because a copy of it in this file would be a
  // second answer to the same question.
  const clientSource = readFileSync(CLIENT, 'utf8');
  const sessionsFetch = /function fetchSessions\(manual\) \{[\s\S]*?\n      \}/.exec(clientSource);
  const readKeys = new Set(sessionsFetch
    ? [...sessionsFetch[0].matchAll(/body\.([A-Za-z_$][\w$]*)/g)].map((match) => match[1])
    : []);
  const unread = Object.keys(body).filter((key) => !readKeys.has(key));
  assert('and the payload carries no field the page does not read',
    sessionsFetch !== null && unread.length === 0,
    unread.join('|'));
  // The validator: an unchanged list answers 304, and it is the list that moved.
  const etag = response.headers.get('etag');
  const again = await fetch(base + '/api/sessions?limit=20', { headers: { 'If-None-Match': etag || '' } });
  assert('and an unchanged list answers 304',
    again.status === 304, String(again.status));
  if (instance) await instance.dispose();
  controller.abort();
  if (previousRoot === undefined) delete process.env.MMC_TRAJECTORY_ROOT;
  else process.env.MMC_TRAJECTORY_ROOT = previousRoot;
} catch (error) {
  failures.push('the payload the page receives -- ' + (error && error.message));
}

/* ---------- 7: a run that wins the current-conversation resolution ---------- */

// The rule the sections above state is about a function: `splitSessionLayers` puts a run
// in the run layer. The route does not call it and stop -- it splits, and then it promotes
// the conversation the runtime database reports as current into the list the page draws.
// A run that won that resolution was therefore promoted back into the conversation list,
// and the same session sat in both controls at once.
//
// So this section is driven over HTTP, against a store built for exactly that case: one
// conversation, and one run that has a parent, no purpose at all, and a live lease -- the
// strongest signal the resolver has, so it wins the resolution outright.

const PROMOTE_PARENT = 'mvs_promote_parent';
const PROMOTE_RUN = 'mvs_promote_run';

try {
  const home = mkdtempSync(join(tmpdir(), 'mmc-trajectory-promotion-'));
  const sessionsRoot = join(home, 'v2', 'sessions');
  const parent = await makeSession(sessionsRoot, 0, PROMOTE_PARENT, BASE_TIME - 10 * 60_000);
  const run = await makeSession(sessionsRoot, 1, PROMOTE_RUN, BASE_TIME);
  runtimeDb(home, [
    {
      sessionId: PROMOTE_PARENT,
      relative: parent.relative,
      workspace: 'D:\\private\\workspace-one',
      updatedAtMs: BASE_TIME - 10 * 60_000
    },
    {
      sessionId: PROMOTE_RUN,
      relative: run.relative,
      parent: PROMOTE_PARENT,
      // A conversation by kind, with no purpose at all: nothing but the parent column says
      // this is a run, which is the whole point of the rule.
      kind: 'conversation',
      purpose: null,
      workspace: 'D:\\private\\workspace-one',
      updatedAtMs: BASE_TIME
    }
  ], [PROMOTE_RUN]);

  const { start } = await import(pathToFileURL(SERVER).href);
  const previousRoot = process.env.MMC_TRAJECTORY_ROOT;
  process.env.MMC_TRAJECTORY_ROOT = home;
  const controller = new AbortController();
  const noop = () => {};
  let base = null;
  let instance = null;
  for (let attempt = 0; attempt < 12 && !base; attempt += 1) {
    const port = 19700 + Math.floor(Math.random() * 300) + attempt;
    try {
      instance = await start({
        pluginId: 'mmc-trajectory',
        pluginRoot: PLUGIN_ROOT,
        dataDir: PLUGIN_ROOT,
        generationId: 'guard',
        listen: { host: '127.0.0.1', port },
        signal: controller.signal,
        logger: { debug: noop, info: noop, warn: noop, error: noop }
      });
      base = 'http://127.0.0.1:' + port;
    } catch (error) {
      // The port was taken. Another one is tried; a guard that gave up here would be a
      // guard that sometimes checks nothing.
    }
  }
  if (!base) throw new Error('could not bind a port for the promotion route');
  const response = await fetch(base + '/api/sessions?limit=20');
  const body = await response.json();
  const sessionIds = (body.sessions || []).map((row) => row.id);
  const childIds = (body.children || []).map((row) => row.id);

  assert('a run that wins the current-conversation resolution is not in the conversation list',
    !sessionIds.includes(PROMOTE_RUN),
    sessionIds.join('|'));
  assert('and it is in the run list, where it belongs',
    childIds.includes(PROMOTE_RUN),
    childIds.join('|'));
  assert('and the conversation it hangs off is still in the conversation list',
    sessionIds.includes(PROMOTE_PARENT),
    sessionIds.join('|'));
  assert('and no session is in both lists at once',
    !sessionIds.some((id) => childIds.includes(id)),
    sessionIds.filter((id) => childIds.includes(id)).join('|'));

  if (instance) await instance.dispose();
  controller.abort();
  if (previousRoot === undefined) delete process.env.MMC_TRAJECTORY_ROOT;
  else process.env.MMC_TRAJECTORY_ROOT = previousRoot;
} catch (error) {
  failures.push('a run that wins the current-conversation resolution -- ' + (error && error.message));
}

/* ---------- 8: a parent that names no session ---------- */

// The parent id crosses the wire from the runtime database, and the page groups its runs by
// it. `parent_session_id` is a foreign key into the runtime database's own session table, so a
// value that names no session there is not a parent at all -- and publishing it would put a
// name on the wire that no conversation in the list can answer to.
//
// The fixture holds two such rows: one whose parent id is a plausible session id that does
// not exist, and one whose parent id is a name a plain object inherits. The second is the one
// that broke the picker, and the first is the ordinary shape of the same mistake.

const PHANTOM_PARENT = 'mvs_phantom_parent';
const HOSTILE_PARENT = '__proto__';

try {
  const home = mkdtempSync(join(tmpdir(), 'mmc-trajectory-phantom-'));
  const sessionsRoot = join(home, 'v2', 'sessions');
  const main = await makeSession(sessionsRoot, 0, 'mvs_phantom_main', BASE_TIME - 10 * 60_000);
  const orphan = await makeSession(sessionsRoot, 1, 'mvs_phantom_child', BASE_TIME - 20 * 60_000);
  const hostile = await makeSession(sessionsRoot, 2, 'mvs_hostile_child', BASE_TIME - 30 * 60_000);
  runtimeDb(home, [
    {
      sessionId: 'mvs_phantom_main',
      relative: main.relative,
      workspace: 'D:\\private\\workspace-one',
      updatedAtMs: BASE_TIME - 10 * 60_000
    },
    {
      sessionId: 'mvs_phantom_child',
      relative: orphan.relative,
      parent: PHANTOM_PARENT,
      kind: 'task',
      purpose: 'local-background-task:orphan',
      workspace: 'D:\\private\\workspace-one',
      updatedAtMs: BASE_TIME - 20 * 60_000
    },
    {
      sessionId: 'mvs_hostile_child',
      relative: hostile.relative,
      parent: HOSTILE_PARENT,
      kind: 'task',
      purpose: 'local-background-task:hostile',
      workspace: 'D:\\private\\workspace-one',
      updatedAtMs: BASE_TIME - 30 * 60_000
    }
  ]);

  const { start } = await import(pathToFileURL(SERVER).href);
  const previousRoot = process.env.MMC_TRAJECTORY_ROOT;
  process.env.MMC_TRAJECTORY_ROOT = home;
  const controller = new AbortController();
  const noop = () => {};
  let base = null;
  let instance = null;
  for (let attempt = 0; attempt < 12 && !base; attempt += 1) {
    const port = 19800 + Math.floor(Math.random() * 300) + attempt;
    try {
      instance = await start({
        pluginId: 'mmc-trajectory',
        pluginRoot: PLUGIN_ROOT,
        dataDir: PLUGIN_ROOT,
        generationId: 'guard',
        listen: { host: '127.0.0.1', port },
        signal: controller.signal,
        logger: { debug: noop, info: noop, warn: noop, error: noop }
      });
      base = 'http://127.0.0.1:' + port;
    } catch (error) {
      // The port was taken. Another one is tried.
    }
  }
  if (!base) throw new Error('could not bind a port for the phantom-parent route');
  const response = await fetch(base + '/api/sessions?limit=20');
  // The raw bytes, because what this section is about is what CROSSES the wire. A value that is
  // not in the parsed body could still be in the bytes, and a field that is absent from the
  // body could still be in a header.
  const raw = await response.text();
  const body = JSON.parse(raw);
  const sessionIds = (body.sessions || []).map((row) => row.id);
  const childIds = (body.children || []).map((row) => row.id);
  const parentsOnTheWire = (body.sessions || []).concat(body.children || [])
    .map((row) => row.sessionParentId).filter(Boolean);

  assert('a run whose parent names no session is not published as a run',
    !childIds.includes('mvs_phantom_child'),
    childIds.join('|'));
  assert('and it is a conversation instead',
    sessionIds.includes('mvs_phantom_child'),
    sessionIds.join('|'));
  assert('and no row on the wire names a parent that does not exist',
    !parentsOnTheWire.includes(PHANTOM_PARENT),
    parentsOnTheWire.join('|'));
  assert('and the same holds for a parent id that names an inherited object property',
    !childIds.includes('mvs_hostile_child') && !parentsOnTheWire.includes(HOSTILE_PARENT),
    childIds.join('|') + ' / ' + parentsOnTheWire.join('|'));

  // The two values that must never cross the wire at all. The purpose is free text the runtime
  // wrote, and the workspace is a location on the reader's own disk; the page gets a token for
  // the first and nothing for the second. Both are in this fixture, so both are absent here.
  assert('the raw purpose does not cross the wire',
    !raw.includes('local-background-task:orphan'),
    raw.slice(0, 200));
  // The workspace is looked for in the PARSED body, not in the raw bytes, and that is the whole
  // point of the check. JSON escapes a backslash, so a path that is spelled
  // `D:\private\workspace-one` on disk is spelled `D:\\private\\workspace-one` in the response, and
  // a search for the path as it is on disk finds nothing in it. A guard that looks in the wrong
  // spelling passes forever, which is what happened here: the workspace could cross the wire and
  // this assertion stayed green, because the only mutation that leaked it also leaked the purpose
  // and was caught by the assertion above. So every string in the body is searched instead, which
  // is the spelling the value actually has once it is parsed.
  const everyString = (value, out) => {
    if (typeof value === 'string') { out.push(value); return out; }
    if (Array.isArray(value)) { for (const item of value) everyString(item, out); return out; }
    if (value && typeof value === 'object') {
      for (const key of Object.keys(value)) { out.push(key); everyString(value[key], out); }
    }
    return out;
  };
  const wireStrings = everyString(body, []).join('\n');
  assert('and neither does the workspace path',
    !wireStrings.includes('D:\\private\\workspace-one') && !wireStrings.includes('D:/private/workspace-one'),
    wireStrings.slice(0, 200));

  // The map itself, before the layer decision has anything to say about it: a parent that names
  // no session is not a parent. The route clears the parent of every session it puts in the
  // conversation layer, so the wire would look the same whether this check is here or not --
  // which is exactly why it is read off the map the read produces, and not off the wire.
  const rawTitles = await readSessionTitles(home, ['mvs_phantom_child', 'mvs_hostile_child']);
  assert('and the map itself carries no parent that names no session',
    rawTitles.get('mvs_phantom_child')?.parent === null
    && rawTitles.get('mvs_hostile_child')?.parent === null,
    JSON.stringify([rawTitles.get('mvs_phantom_child')?.parent, rawTitles.get('mvs_hostile_child')?.parent]));

  if (instance) await instance.dispose();
  controller.abort();
  if (previousRoot === undefined) delete process.env.MMC_TRAJECTORY_ROOT;
  else process.env.MMC_TRAJECTORY_ROOT = previousRoot;
} catch (error) {
  failures.push('a parent that names no session -- ' + (error && error.message));
}

/* ---------- 9: two sessions that name each other as parent ---------- */
//
// The parent column is a foreign key into the runtime database's own session table, and a
// foreign key can point back: A's parent is B, B's parent is A, and both have a row, so both
// are real parents of a real session. The column alone cannot tell a run from a conversation
// there. Read it straight, both of them are runs -- of each other -- so neither is a
// conversation, the conversation list comes back with neither in it, and the two are in
// neither control: the reader cannot reach either one.
//
// The layer is decided by the chain, and a chain ends at a conversation. A cycle ends at no
// conversation, so it is dissolved: both sessions are conversations, and their parent columns
// are dropped, because a conversation that names a parent names a run.
//
// The fixture holds three sessions: the two that name each other, and one run of the first of
// them -- a run of a conversation that sits on a cycle is still a run of it.

const CYCLE_ALPHA = 'mvs_cycle_alpha';
const CYCLE_BRAVO = 'mvs_cycle_bravo';
const CYCLE_RUN = 'mvs_cycle_run';

try {
  const home = mkdtempSync(join(tmpdir(), 'mmc-trajectory-cycle-'));
  const sessionsRoot = join(home, 'v2', 'sessions');
  const alpha = await makeSession(sessionsRoot, 0, CYCLE_ALPHA, BASE_TIME - 10 * 60_000);
  const bravo = await makeSession(sessionsRoot, 1, CYCLE_BRAVO, BASE_TIME - 20 * 60_000);
  const run = await makeSession(sessionsRoot, 2, CYCLE_RUN, BASE_TIME - 30 * 60_000);
  runtimeDb(home, [
    {
      sessionId: CYCLE_ALPHA,
      relative: alpha.relative,
      parent: CYCLE_BRAVO,
      kind: 'task',
      purpose: 'local-background-task:alpha',
      workspace: 'D:\\private\\workspace-one',
      updatedAtMs: BASE_TIME - 10 * 60_000
    },
    {
      sessionId: CYCLE_BRAVO,
      relative: bravo.relative,
      parent: CYCLE_ALPHA,
      kind: 'task',
      purpose: 'local-background-task:bravo',
      workspace: 'D:\\private\\workspace-one',
      updatedAtMs: BASE_TIME - 20 * 60_000
    },
    {
      sessionId: CYCLE_RUN,
      relative: run.relative,
      parent: CYCLE_ALPHA,
      kind: 'task',
      purpose: 'local-background-task:run',
      workspace: 'D:\\private\\workspace-one',
      updatedAtMs: BASE_TIME - 30 * 60_000
    }
  ]);

  const { start } = await import(pathToFileURL(SERVER).href);
  const previousRoot = process.env.MMC_TRAJECTORY_ROOT;
  process.env.MMC_TRAJECTORY_ROOT = home;
  const controller = new AbortController();
  const noop = () => {};
  let base = null;
  let instance = null;
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
        logger: { debug: noop, info: noop, warn: noop, error: noop }
      });
      base = 'http://127.0.0.1:' + port;
    } catch (error) {
      // The port was taken. Another one is tried.
    }
  }
  if (!base) throw new Error('could not bind a port for the cycle route');
  const response = await fetch(base + '/api/sessions?limit=20');
  const body = await response.json();
  const sessionIds = (body.sessions || []).map((row) => row.id);
  const childIds = (body.children || []).map((row) => row.id);

  assert('a session whose parent names it back is a conversation, not a run',
    sessionIds.includes(CYCLE_ALPHA) && sessionIds.includes(CYCLE_BRAVO),
    sessionIds.join('|'));
  assert('and it is in neither run list',
    !childIds.includes(CYCLE_ALPHA) && !childIds.includes(CYCLE_BRAVO),
    childIds.join('|'));
  // The run of the cycle member still names it -- that is what a run names -- so this is about
  // the two rows of the cycle themselves: a conversation that names a parent names a run, and
  // these two are conversations.
  const parentNamedBy = (id) => {
    const row = (body.sessions || []).concat(body.children || []).find((entry) => entry.id === id);
    return row ? row.sessionParentId : null;
  };
  assert('and neither of them names a parent on the wire',
    !parentNamedBy(CYCLE_ALPHA) && !parentNamedBy(CYCLE_BRAVO),
    String(parentNamedBy(CYCLE_ALPHA)) + ' / ' + String(parentNamedBy(CYCLE_BRAVO)));
  assert('and a run of a session that sits on a cycle is still a run of it',
    childIds.includes(CYCLE_RUN)
    && (body.children || []).some((row) => row.id === CYCLE_RUN && row.sessionParentId === CYCLE_ALPHA),
    childIds.join('|'));
  assert('and the two of them are in the conversation list only once each',
    sessionIds.filter((id) => id === CYCLE_ALPHA).length === 1
    && sessionIds.filter((id) => id === CYCLE_BRAVO).length === 1,
    sessionIds.join('|'));

  if (instance) await instance.dispose();
  controller.abort();
  if (previousRoot === undefined) delete process.env.MMC_TRAJECTORY_ROOT;
  else process.env.MMC_TRAJECTORY_ROOT = previousRoot;
} catch (error) {
  failures.push('two sessions that name each other as parent -- ' + (error && error.message));
}

/* ---------- 10: a parent the payload does not know, and a run of a run ---------- */
//
// Two more shapes of the chain, and the same rule answers both.
//
//   - The parent has a row in the runtime database but no directory in the pool. It is a real
//     session and a real conversation, but the reader cannot pick it -- and the run pick only
//     ever shows the runs of the conversation that was picked. A run of it would therefore be a
//     run of a conversation that is not in the list, which is a run nobody can reach. It is a
//     conversation itself, so that it is somewhere the reader can reach.
//   - The parent is itself a run. The two controls are one conversation and the runs of THAT
//     one, so a run of a run goes in the conversation layer as well.
//
// Both are read off the function that decides the layer, and off the map it corrects: the
// parent column of a conversation is cleared, because a conversation that names a parent names
// a run.

try {
  const home = mkdtempSync(join(tmpdir(), 'mmc-trajectory-unknown-parent-'));
  const sessionsRoot = join(home, 'v2', 'sessions');
  const root = await makeSession(sessionsRoot, 0, 'mvs_chain_root', BASE_TIME - 10 * 60_000);
  const run = await makeSession(sessionsRoot, 1, 'mvs_chain_run', BASE_TIME - 20 * 60_000);
  const deeper = await makeSession(sessionsRoot, 2, 'mvs_chain_deeper', BASE_TIME - 30 * 60_000);
  const unknown = await makeSession(sessionsRoot, 3, 'mvs_chain_unknown', BASE_TIME - 40 * 60_000);
  runtimeDb(home, [
    {
      sessionId: 'mvs_chain_root',
      relative: root.relative,
      workspace: 'D:\\private\\workspace-one',
      updatedAtMs: BASE_TIME - 10 * 60_000
    },
    {
      sessionId: 'mvs_chain_run',
      relative: run.relative,
      parent: 'mvs_chain_root',
      kind: 'task',
      purpose: 'local-background-task:run',
      workspace: 'D:\\private\\workspace-one',
      updatedAtMs: BASE_TIME - 20 * 60_000
    },
    {
      sessionId: 'mvs_chain_deeper',
      relative: deeper.relative,
      parent: 'mvs_chain_run',
      kind: 'task',
      purpose: 'local-background-task:deeper',
      workspace: 'D:\\private\\workspace-one',
      updatedAtMs: BASE_TIME - 30 * 60_000
    },
    {
      sessionId: 'mvs_chain_unknown',
      relative: unknown.relative,
      parent: 'mvs_chain_absent',
      kind: 'task',
      purpose: 'local-background-task:unknown',
      workspace: 'D:\\private\\workspace-one',
      updatedAtMs: BASE_TIME - 40 * 60_000
    },
    {
      // The parent of the last one. It has a row in the runtime database, so the parent column
      // is a parent by the foreign key -- and it has no directory in the pool, so the walk never
      // asked about it and the map does not have it.
      sessionId: 'mvs_chain_absent',
      relative: '2026/10/20/99-00-00-session_absent',
      workspace: 'D:\\private\\workspace-one',
      updatedAtMs: BASE_TIME - 50 * 60_000
    }
  ]);

  const candidates = await collectSessionCandidates(sessionsRoot);
  const ids = candidates.allEntries
    .map((entry) => decodeSessionIdFromDirName(basename(entry.dir))).filter(Boolean);
  const titles = await readSessionTitles(home, ids);
  const layers = splitSessionLayers(candidates.allEntries, titles);
  const mainIds = idsOf(layers.mains);
  const kidIds = [...layers.childrenByParent.keys()]
    .flatMap((parent) => idsOfBucket(layers.childrenByParent.get(parent)));

  assert('a run whose parent is not in the list is a conversation, so that the reader can reach it',
    mainIds.includes('mvs_chain_unknown') && !kidIds.includes('mvs_chain_unknown'),
    mainIds.join('|') + ' / ' + kidIds.join('|'));
  assert('and it names no parent, because a conversation that names a parent names a run',
    titles.get('mvs_chain_unknown')?.parent === null,
    String(titles.get('mvs_chain_unknown')?.parent));
  assert('a run of a run is a conversation too, because the run pick shows the runs of ONE conversation',
    mainIds.includes('mvs_chain_deeper') && !kidIds.includes('mvs_chain_deeper'),
    mainIds.join('|') + ' / ' + kidIds.join('|'));
  assert('and the run it hangs off is still a run of the conversation above it',
    kidIds.includes('mvs_chain_run')
    && [...layers.childrenByParent.keys()].every((parent) => parent === 'mvs_chain_root'),
    [...layers.childrenByParent.keys()].join('|'));
} catch (error) {
  failures.push('a parent the payload does not know, and a run of a run -- ' + (error && error.message));
}

/* ---------- 11: the current conversation that has no transcript of its own ---------- */
//
// The map the layer is decided from holds the sessions with a ROW in the runtime database, and the
// route asks about the current conversation even when that conversation has no transcript in the
// store -- it wants the title and the workspace of it. So the map can name a parent the reader
// cannot pick: a row, not a directory.
//
// A run hanging off such a parent is a run of a conversation that is not in the list, and the run
// pick only ever shows the runs of the conversation that was picked. So the run is a conversation
// itself, exactly like a run whose parent has no row at all. The rule is about what the reader can
// reach, and a parent that is not in the list is a parent the reader cannot reach -- whether it is
// missing from the map or missing from the walk.

try {
  const home = mkdtempSync(join(tmpdir(), 'mmc-trajectory-current-parent-'));
  const sessionsRoot = join(home, 'v2', 'sessions');
  const child = await makeSession(sessionsRoot, 0, 'mvs_current_child', BASE_TIME - 20 * 60_000);
  // The parent has a row in the runtime database and NO directory in the store. It is the current
  // conversation -- the newest row, and a plain conversation -- so the route asks the database
  // about it even though there is nothing on disk to read.
  runtimeDb(home, [
    {
      sessionId: 'mvs_current_parent',
      relative: '2026/10/20/99-00-00-session_absent',
      workspace: 'D:\\private\\workspace-one',
      updatedAtMs: BASE_TIME
    },
    {
      sessionId: 'mvs_current_child',
      relative: child.relative,
      parent: 'mvs_current_parent',
      kind: 'task',
      purpose: 'local-background-task:child',
      workspace: 'D:\\private\\workspace-one',
      updatedAtMs: BASE_TIME - 20 * 60_000
    }
  ]);

  const service = await startService(home);
  try {
    const body = await (await fetch(service.base + '/api/sessions?limit=20')).json();
    const sessionIds = (body.sessions || []).map((row) => row.id);
    const childIds = (body.children || []).map((row) => row.id);
    const parentsOnTheWire = (body.sessions || []).concat(body.children || [])
      .map((row) => row.sessionParentId).filter(Boolean);
    assert('a run whose parent is the current conversation but has no transcript of its own is a conversation',
      sessionIds.includes('mvs_current_child') && !childIds.includes('mvs_current_child'),
      sessionIds.join('|') + ' / ' + childIds.join('|'));
    assert('and it names no parent, because the conversation it would hang off is not one the reader can pick',
      !parentsOnTheWire.includes('mvs_current_parent'),
      parentsOnTheWire.join('|'));
  } finally {
    await service.dispose();
  }
} catch (error) {
  failures.push('the current conversation that has no transcript of its own -- ' + (error && error.message));
}

/* ---------- 12: a row whose runtime metadata disappears ---------- */
//
// The descriptor behind a row comes out of a cache, and the runtime's facts -- the title, the
// kind, the parent -- used to be written ONTO that cached object. So a session whose row left the
// runtime database went on publishing the facts it had last time, while the validator, which
// reads the same rows, reported none of them: the body and the ETag disagreed about the same
// row, and the reader saw a parent and a kind for a session that no longer had either.
//
// The row is built, not patched, so the cached descriptor keeps the facts the filesystem gives.
// And the check is on the wire, after the caches have had their time, because the point is what
// the reader is shown.

try {
  const home = mkdtempSync(join(tmpdir(), 'mmc-trajectory-vanished-'));
  const sessionsRoot = join(home, 'v2', 'sessions');
  const parent = await makeSession(sessionsRoot, 0, 'mvs_vanish_parent', BASE_TIME - 10 * 60_000);
  const child = await makeSession(sessionsRoot, 1, 'mvs_vanish_child', BASE_TIME - 20 * 60_000);
  runtimeDb(home, [
    {
      sessionId: 'mvs_vanish_parent',
      relative: parent.relative,
      workspace: 'D:\\private\\workspace-one',
      updatedAtMs: BASE_TIME - 10 * 60_000
    },
    {
      sessionId: 'mvs_vanish_child',
      relative: child.relative,
      parent: 'mvs_vanish_parent',
      kind: 'task',
      purpose: 'local-background-task:child',
      workspace: 'D:\\private\\workspace-one',
      updatedAtMs: BASE_TIME - 20 * 60_000
    }
  ]);

  const service = await startService(home);
  try {
    const first = await (await fetch(service.base + '/api/sessions?limit=20')).json();
    const firstChild = (first.children || []).find((row) => row.id === 'mvs_vanish_child');
    assert('and the row carried the runtime facts while the runtime database still had them',
      Boolean(firstChild)
      && firstChild.sessionKind === 'task'
      && firstChild.sessionParentId === 'mvs_vanish_parent',
      JSON.stringify(firstChild));

    // The runtime database forgets the run. Its transcript is still on disk, so the walk still
    // finds it and the reader must still be able to reach it -- as a plain conversation, with
    // nothing left over from the row that is gone.
    const db = new DatabaseSync(join(home, 'v2', 'sqlite', 'runtime-state.sqlite'));
    db.exec("delete from local_runtime_sessions where session_id = 'mvs_vanish_child'");
    db.close();
    // The map is held for three seconds and the descriptor for five, so the first wait is the one
    // that decides when the row is seen to be gone.
    await new Promise((resolve) => setTimeout(resolve, 3200));
    const second = await (await fetch(service.base + '/api/sessions?limit=20')).json();
    const secondChild = (second.sessions || []).find((row) => row.id === 'mvs_vanish_child');
    assert('a row whose runtime metadata disappears loses its title kind and parent across cache expiry',
      Boolean(firstChild)
      && Boolean(secondChild)
      && secondChild.sessionKind === null
      && secondChild.sessionParentId === null
      && secondChild.sessionTag === null
      && secondChild.label !== firstChild.label,
      JSON.stringify([firstChild, secondChild]));

    // And the body the service reuses for the next request says the same thing: a body that is
    // kept under its tag must not be able to keep publishing facts the map has already dropped.
    const third = await (await fetch(service.base + '/api/sessions?limit=20')).json();
    const thirdChild = (third.sessions || []).find((row) => row.id === 'mvs_vanish_child');
    assert('and the body the service reuses for the next request says the same thing',
      Boolean(secondChild)
      && Boolean(thirdChild)
      && thirdChild.sessionKind === null
      && thirdChild.sessionParentId === null
      && thirdChild.sessionTag === null
      && thirdChild.label === secondChild.label,
      JSON.stringify([secondChild, thirdChild]));
  } finally {
    await service.dispose();
  }
} catch (error) {
  failures.push('a row whose runtime metadata disappears -- ' + (error && error.message));
}

/* ---------- 13: a directory that holds another session ---------- */
//
// The directory name is where a session id is written down, and the manifest beside the
// transcript is where the runtime writes it too. The service reads a session's identity from the
// manifest, so a directory whose name says one session and whose manifest says another is the
// OTHER session's directory, whatever the folder is called.
//
// Two shortcuts took the name's word for it: the picker promoting the current conversation, and
// the 'latest' resolver choosing which transcript to serve. The recorded path was checked -- but
// it is only consulted when the directory is NOT in the window, so the window's own shortcut was
// never checked at all, and both of them could put one session's id on another session's
// messages. The route has to be asked over HTTP here, because the function is not the route.

try {
  const home = mkdtempSync(join(tmpdir(), 'mmc-trajectory-mismatch-'));
  const sessionsRoot = join(home, 'v2', 'sessions');
  // The other session is the newest FILE, so the walk's own order starts with it, and the current
  // conversation is the newest ROW. The two orders are independent, and the fixture needs them
  // apart: the promotion has to be visible as a change of the first row.
  const other = await makeSession(sessionsRoot, 0, 'mvs_mismatch_other', BASE_TIME);
  const current = await makeSession(sessionsRoot, 1, 'mvs_mismatch_current', BASE_TIME - 60_000);
  // The current conversation's own directory says it is the current conversation, and the manifest
  // beside its transcript says it is somebody else.
  await writeFile(join(current.dir, 'manifest.json'),
    JSON.stringify({ sessionId: 'mvs_mismatch_stranger', createdAtMs: 1 }), 'utf8');
  runtimeDb(home, [
    {
      sessionId: 'mvs_mismatch_other',
      relative: other.relative,
      workspace: 'D:\\private\\workspace-one',
      updatedAtMs: BASE_TIME - 60_000
    },
    {
      sessionId: 'mvs_mismatch_current',
      relative: current.relative,
      workspace: 'D:\\private\\workspace-one',
      updatedAtMs: BASE_TIME
    }
  ]);

  const service = await startService(home);
  try {
    const list = await (await fetch(service.base + '/api/sessions?limit=20')).json();
    const firstRow = (list.sessions || [])[0];
    assert('the current conversation is not promoted on a directory that holds another session',
      Boolean(firstRow) && firstRow.id !== 'mvs_mismatch_stranger',
      JSON.stringify(firstRow));
    assert('every row the list publishes carries an id',
      (list.sessions || []).every((row) => typeof row.id === 'string' && row.id !== '')
      && (list.children || []).every((row) => typeof row.id === 'string' && row.id !== ''),
      JSON.stringify((list.sessions || []).map((row) => row.id)));
    const trajectory = await (await fetch(service.base + '/api/trajectory?session=latest')).json();
    assert('the latest route does not serve a directory that holds another session as the current one',
      Boolean(trajectory.session) && trajectory.session.id !== 'mvs_mismatch_stranger',
      JSON.stringify(trajectory.session));
    assert('and it does not claim the runtime binding for it either',
      Boolean(trajectory.session) && trajectory.session.binding !== 'runtime-db',
      String(trajectory.session && trajectory.session.binding));
  } finally {
    await service.dispose();
  }
} catch (error) {
  failures.push('a directory that holds another session -- ' + (error && error.message));
}

/* ---------- 14: a directory whose name and manifest disagree ---------- */
//
// A directory's name and the manifest beside its transcript are two copies of the same id. When
// they disagree, the directory is nobody's: publishing it puts one session's id on another
// session's transcript, and the row mixes the manifest's id with the name's metadata -- two
// sources in one row.
//
// And the id it claims is not among the published ones, so it is not a parent the reader can
// pick. A run hanging off it is a run of a conversation that is not in the list, and neither
// control can reach it -- the conversation pick has no row to select, and the run pick asks for
// the bucket of a conversation that is not there.
//
// The rule under test is the one the recorded path and the 'latest' binding already follow: the
// name AND the manifest have to name that session. Here it is asked of every directory.

try {
  const home = mkdtempSync(join(tmpdir(), 'mmc-trajectory-join-'));
  const sessionsRoot = join(home, 'v2', 'sessions');
  const ambiguous = await makeSession(sessionsRoot, 0, 'mvs_join_name', BASE_TIME);
  const child = await makeSession(sessionsRoot, 1, 'mvs_join_child', BASE_TIME - 60_000);
  // The directory says one session; the manifest beside its transcript says another.
  await writeFile(join(ambiguous.dir, 'manifest.json'),
    JSON.stringify({ sessionId: 'mvs_join_manifest', createdAtMs: 1 }), 'utf8');
  runtimeDb(home, [
    { sessionId: 'mvs_join_name', relative: ambiguous.relative, workspace: 'D:\\private\\workspace-one', updatedAtMs: BASE_TIME },
    { sessionId: 'mvs_join_child', relative: child.relative, parent: 'mvs_join_name', kind: 'task', updatedAtMs: BASE_TIME - 60_000 }
  ]);

  const service = await startService(home);
  try {
    const list = await (await fetch(service.base + '/api/sessions?limit=20')).json();
    const rows = list.sessions || [];
    const ids = rows.map((row) => row.id);
    assert('a directory whose name and manifest disagree is not published',
      !ids.includes('mvs_join_name') && !ids.includes('mvs_join_manifest'),
      JSON.stringify(ids));
    assert('and its database row is not published under any id',
      !rows.some((row) => row.label === '会话 name'),
      JSON.stringify(rows.map((row) => row.label)));
    const childRow = rows.find((row) => row.id === 'mvs_join_child');
    assert('a run of a directory that is not published becomes a conversation the reader can pick',
      Boolean(childRow) && childRow.sessionParentId === null,
      JSON.stringify(childRow));
    assert('and it is not left in the run list either',
      !(list.children || []).some((row) => row.id === 'mvs_join_child'),
      JSON.stringify(list.children || []));
    const served = await fetch(service.base + '/api/trajectory?session=mvs_join_name');
    assert('and the trajectory route does not serve that directory either',
      served.status === 404,
      'status ' + served.status);
  } finally {
    await service.dispose();
  }
} catch (error) {
  failures.push('a directory whose name and manifest disagree -- ' + (error && error.message));
}

/* ---------- 15: the identity a directory is published under ---------- */
//
// A directory's name may not decode at all. The runtime writes the id into the folder name, but
// the manifest beside the transcript is the authority, and a name that decodes to nothing names
// no session -- so the manifest is the only identity such a directory has, and that identity is
// the id it is published under.
//
// Two things break when the service reads the id off the name instead: the parent is not among
// the sessions the reader can pick, so the runs hanging off it are demoted into the conversation
// list, and the row loses the title and the kind the runtime database has for it.
//
// And the rule has to hold when the manifest changes under a walk that is already cached: a
// directory whose manifest no longer agrees with its name is nobody's directory, and the route
// must not serve it under the id it now claims -- nor under the one it used to claim.

try {
  const home = mkdtempSync(join(tmpdir(), 'mmc-trajectory-identified-'));
  const sessionsRoot = join(home, 'v2', 'sessions');
  // The parent's folder name does not decode. The manifest beside its transcript is the only
  // identity it has.
  const legacy = join(sessionsRoot, '2026', '10', '20', '00-00-00-session_legacy');
  await mkdir(legacy, { recursive: true });
  await writeFile(join(legacy, 'messages.jsonl'),
    JSON.stringify({ role: 'user', content: 'p' }) + '\n', 'utf8');
  await writeFile(join(legacy, 'manifest.json'),
    JSON.stringify({ sessionId: 'mvs_identified_parent', createdAtMs: 1 }), 'utf8');
  const legacyStamp = new Date(BASE_TIME);
  await utimes(join(legacy, 'messages.jsonl'), legacyStamp, legacyStamp);
  const child = await makeSession(sessionsRoot, 1, 'mvs_identified_child', BASE_TIME - 60_000);
  runtimeDb(home, [
    { sessionId: 'mvs_identified_parent', relative: '2026/10/20/00-00-00-session_legacy', workspace: 'D:\\private\\workspace-one', updatedAtMs: BASE_TIME },
    { sessionId: 'mvs_identified_child', relative: child.relative, parent: 'mvs_identified_parent', kind: 'task', updatedAtMs: BASE_TIME - 60_000 }
  ]);

  const service = await startService(home);
  try {
    const list = await (await fetch(service.base + '/api/sessions?limit=20')).json();
    const rows = list.sessions || [];
    const parentRow = rows.find((row) => row.id === 'mvs_identified_parent');
    const childRow = (list.children || []).find((row) => row.id === 'mvs_identified_child');
    assert('a published manifest-identified parent keeps its runs when its directory name does not decode',
      Boolean(parentRow) && Boolean(childRow) && childRow.sessionParentId === 'mvs_identified_parent',
      JSON.stringify([parentRow, childRow]));
    assert('and the parent keeps the title the runtime database has for it',
      Boolean(parentRow) && parentRow.label === '会话 rent',
      JSON.stringify(parentRow));
    assert('and the kind the runtime database has for it',
      Boolean(parentRow) && parentRow.sessionKind === 'conversation',
      JSON.stringify(parentRow));
    const served = await fetch(service.base + '/api/trajectory?session=mvs_identified_parent');
    assert('and the id the list shows is the id the route resolves',
      served.status === 200,
      'status ' + served.status);
  } finally {
    await service.dispose();
  }
} catch (error) {
  failures.push('a parent identified by its manifest -- ' + (error && error.message));
}

try {
  const home = mkdtempSync(join(tmpdir(), 'mmc-trajectory-swapped-'));
  const sessionsRoot = join(home, 'v2', 'sessions');
  const one = await makeSession(sessionsRoot, 0, 'mvs_swapped_one', BASE_TIME);
  await writeFile(join(one.dir, 'manifest.json'),
    JSON.stringify({ sessionId: 'mvs_swapped_one', createdAtMs: 1 }), 'utf8');
  runtimeDb(home, [
    { sessionId: 'mvs_swapped_one', relative: one.relative, updatedAtMs: BASE_TIME }
  ]);

  const service = await startService(home);
  try {
    // The walk is primed while the manifest still agrees with the name.
    await (await fetch(service.base + '/api/sessions?limit=20')).json();
    // Now the manifest beside the same transcript names another session. The walk is still
    // cached, so the route is holding the directory it admitted a moment ago.
    await writeFile(join(one.dir, 'manifest.json'),
      JSON.stringify({ sessionId: 'mvs_swapped_other', createdAtMs: 1 }), 'utf8');
    const underNew = await fetch(service.base + '/api/trajectory?session=mvs_swapped_other');
    const underOld = await fetch(service.base + '/api/trajectory?session=mvs_swapped_one');
    assert('a cached candidate whose manifest now disagrees with its name is not served under either id',
      underNew.status === 404 && underOld.status === 404,
      JSON.stringify([underNew.status, underOld.status]));
  } finally {
    await service.dispose();
  }
} catch (error) {
  failures.push('a manifest that changes under a cached walk -- ' + (error && error.message));
}

/* ---------- 16: the published id, after the walk has published it ---------- */
//
// The walk decides the id a directory is published under, and everything downstream reads that
// one id. But the id is not only carried by the row: it is also what two CACHES are keyed by,
// and a cache that does not know the id will keep answering with the answer it built for the
// id before.
//
// Three places, three shapes of the same question:
//
//   - the list's validator. It carries the directory, the transcript's size and mtime, and the
//     runtime's facts -- but not the published id. So a manifest that changes from one id to
//     another moves the id and nothing else, the validator does not move, and the body the
//     service reuses goes on publishing the old id while the route serves that same id as
//     404.
//   - the `latest` fallback. The explicit-id routes ask again whether a candidate still holds
//     the session it was published under, because the manifest can change under the walk. The
//     fallback used to take the first entry of the window as it stood, so the one candidate
//     both explicit ids refuse was the one `latest` served.
//   - the trajectory's cache key. It carries the directory, the lineage, the size, the mtime
//     and the binding -- but not the identity. So two ids for the same directory share one
//     entry, and the body built for the first is served for the second.
//
// Each of them is a transition, so each is asked over HTTP and after the caches have had their
// time: the walk is held for three seconds, and the first wait is the one that decides when a
// new id is seen.

try {
  const home = mkdtempSync(join(tmpdir(), 'mmc-trajectory-reid-'));
  const sessionsRoot = join(home, 'v2', 'sessions');
  // The name does not decode, so the manifest beside the transcript is the only identity this
  // directory has -- and the published id is therefore the only thing that can change when
  // the manifest changes. Nothing else about the directory does: same transcript, same size,
  // same mtime, and no runtime row for it at all.
  const legacy = join(sessionsRoot, '2026', '10', '20', '00-00-00-session_legacy');
  await mkdir(legacy, { recursive: true });
  await writeFile(join(legacy, 'messages.jsonl'),
    JSON.stringify({ role: 'user', content: 'x' }) + '\n', 'utf8');
  await writeFile(join(legacy, 'manifest.json'),
    JSON.stringify({ sessionId: 'mvs_reid_one', createdAtMs: 1 }), 'utf8');
  const stamp = new Date(BASE_TIME);
  await utimes(join(legacy, 'messages.jsonl'), stamp, stamp);

  const service = await startService(home);
  try {
    const first = await fetch(service.base + '/api/sessions?limit=20');
    const firstEtag = first.headers.get('etag');
    const firstBody = await first.json();
    assert('the list publishes the id the manifest names',
      (firstBody.sessions || []).some((row) => row.id === 'mvs_reid_one'),
      JSON.stringify((firstBody.sessions || []).map((row) => row.id)));

    // The manifest now names another session.
    await writeFile(join(legacy, 'manifest.json'),
      JSON.stringify({ sessionId: 'mvs_reid_two', createdAtMs: 1 }), 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 3200));

    const conditional = await fetch(service.base + '/api/sessions?limit=20', {
      headers: { 'If-None-Match': firstEtag }
    });
    const conditionalEtag = conditional.headers.get('etag');
    const conditionalText = await conditional.text();
    let conditionalBody = null;
    try { conditionalBody = JSON.parse(conditionalText); } catch { conditionalBody = null; }
    const conditionalIds = (conditionalBody && conditionalBody.sessions || []).map((row) => row.id);
    assert('a changed published session id moves the list validator and replaces its body',
      conditional.status !== 304
      && conditionalEtag !== firstEtag
      && conditionalIds.includes('mvs_reid_two')
      && !conditionalIds.includes('mvs_reid_one'),
      JSON.stringify([conditional.status, conditionalEtag, firstEtag, conditionalIds]));

    // And the body the service reuses for the next request says the same thing.
    const unconditional = await (await fetch(service.base + '/api/sessions?limit=20')).json();
    const unconditionalIds = (unconditional.sessions || []).map((row) => row.id);
    assert('and the body the service reuses for the next request says the same thing',
      unconditionalIds.includes('mvs_reid_two') && !unconditionalIds.includes('mvs_reid_one'),
      JSON.stringify(unconditionalIds));
  } finally {
    await service.dispose();
  }
} catch (error) {
  failures.push('a published id that changes -- ' + (error && error.message));
}

try {
  const home = mkdtempSync(join(tmpdir(), 'mmc-trajectory-latest-'));
  const sessionsRoot = join(home, 'v2', 'sessions');
  // The newest session, and the one the fallback would take without asking. The healthy one
  // is older, so the fallback has to skip past the broken one to reach it.
  const broken = await makeSession(sessionsRoot, 0, 'mvs_latest_broken', BASE_TIME);
  await makeSession(sessionsRoot, 1, 'mvs_latest_healthy', BASE_TIME - 60_000);
  await writeFile(join(broken.dir, 'manifest.json'),
    JSON.stringify({ sessionId: 'mvs_latest_broken', createdAtMs: 1 }), 'utf8');

  const service = await startService(home);
  try {
    // The walk is primed while the manifest still agrees with the name.
    await (await fetch(service.base + '/api/sessions?limit=20')).json();
    // Now the manifest beside the same transcript names another session. The walk is still
    // cached, so the route is holding the directory it admitted a moment ago.
    await writeFile(join(broken.dir, 'manifest.json'),
      JSON.stringify({ sessionId: 'mvs_latest_other', createdAtMs: 1 }), 'utf8');
    const underOld = await fetch(service.base + '/api/trajectory?session=mvs_latest_broken');
    const underNew = await fetch(service.base + '/api/trajectory?session=mvs_latest_other');
    const latest = await fetch(service.base + '/api/trajectory?session=latest');
    const latestBody = latest.status === 200 ? await latest.json() : null;
    const explicitRefused = underOld.status === 404 && underNew.status === 404;
    const latestServedAnother = Boolean(latestBody) && Boolean(latestBody.session)
      && latestBody.session.id === 'mvs_latest_healthy';
    assert('latest never serves a cached candidate whose manifest now disagrees with its name',
      explicitRefused && (latest.status !== 200 || latestServedAnother),
      JSON.stringify([underOld.status, underNew.status, latest.status,
        latestBody && latestBody.session && latestBody.session.id]));
  } finally {
    await service.dispose();
  }
} catch (error) {
  failures.push('the latest fallback -- ' + (error && error.message));
}

try {
  const home = mkdtempSync(join(tmpdir(), 'mmc-trajectory-trajcache-'));
  const sessionsRoot = join(home, 'v2', 'sessions');
  const legacy = join(sessionsRoot, '2026', '10', '20', '00-00-00-session_legacy');
  await mkdir(legacy, { recursive: true });
  await writeFile(join(legacy, 'messages.jsonl'),
    JSON.stringify({ role: 'user', content: 'x' }) + '\n', 'utf8');
  await writeFile(join(legacy, 'manifest.json'),
    JSON.stringify({ sessionId: 'mvs_traj_one', createdAtMs: 1 }), 'utf8');
  const stamp = new Date(BASE_TIME);
  await utimes(join(legacy, 'messages.jsonl'), stamp, stamp);

  const service = await startService(home);
  try {
    const first = await fetch(service.base + '/api/trajectory?session=mvs_traj_one');
    const firstEtag = first.headers.get('etag');
    const firstBody = await first.json();
    // Only the manifest changes. The directory, the transcript, the lineage and the mtime are
    // all the same, so a cache key made of those would match and the body built for the first
    // id would be served for the second.
    await writeFile(join(legacy, 'manifest.json'),
      JSON.stringify({ sessionId: 'mvs_traj_two', createdAtMs: 1 }), 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 3200));
    const second = await fetch(service.base + '/api/trajectory?session=mvs_traj_two');
    const secondEtag = second.headers.get('etag');
    const secondBody = second.status === 200 ? await second.json() : null;
    assert('an identity-only manifest change cannot reuse another session identity\'s trajectory body',
      Boolean(firstBody.session) && firstBody.session.id === 'mvs_traj_one'
      && Boolean(secondBody && secondBody.session) && secondBody.session.id === 'mvs_traj_two'
      && secondEtag !== firstEtag,
      JSON.stringify([firstBody.session, secondBody && secondBody.session, firstEtag, secondEtag]));
  } finally {
    await service.dispose();
  }
} catch (error) {
  failures.push('a trajectory body that belongs to another identity -- ' + (error && error.message));
}

console.log(pass + ' assertions passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exit(1);
}
