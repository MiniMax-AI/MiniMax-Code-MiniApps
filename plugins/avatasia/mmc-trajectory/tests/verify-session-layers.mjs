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
 *   4. The layer is decided by `parent_session_id` and by nothing else. `purpose` says what a
 *      session IS (a scheduled run, a background task), which is a different question from what
 *      it hangs off, and the two are orthogonal: a sub-agent is a task AND somebody's child.
 *      A judge that used `purpose` would call a scheduled run a sub-agent, and a sub-agent
 *      spawned by something other than a task a main session.
 *
 * The fourth rule is the one that decides the other three, so the fixture below contains a row
 * that is a child with no purpose, and a row that is a main session whose purpose says 「task」.
 * The two columns disagree, and the layer follows the parent.
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
 */
function runtimeDb(home, rows) {
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
  db.close();
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
      workspace: 'workspace-one',
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

console.log(pass + ' assertions passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exit(1);
}
