/**
 * The picker shows the conversation the reader is in.
 *
 * The list was built from one number: the mtime of `messages.jsonl`. That number answers "when
 * did this session last write a message", and the picker needs to answer "is this session still
 * in use". On the path a reader actually takes — open a conversation, read its history, say
 * nothing for the rest of the day — nothing is written, so the file keeps its old mtime and the
 * conversation ages out of the window while the page is displaying it. The window's length was
 * decided by the reader's behaviour, which is not something a picker can do.
 *
 * So the visible set is no longer the window and nothing else. Three rules, each with a reason:
 *
 *   1. The current conversation is always in the list, and first. It is asked of the runtime
 *      database rather than guessed from mtime, because the conversation being read is not
 *      necessarily the one whose file was written last. When it is outside the window it is
 *      built from the path the runtime recorded for it, under the same containment check the
 *      'latest' resolver gives it.
 *   2. The sessions of the current conversation's workspace come before the sessions of other
 *      workspaces. The workspace is the one the runtime database records for the current
 *      conversation — and it is compared here, on the server, because it is an absolute path on
 *      the reader's machine and has no business in a browser.
 *   3. Each group keeps the walk's recency order.
 *
 * Two sets, and they are not the same set: the walk's own list is untouched, because it is what
 * 'latest' falls back to when the runtime database is unavailable, and reordering it would
 * change what 'latest' means. Only the visible set is reordered.
 *
 * The eight invariants below are checked against real stores and real runtime databases built
 * here, not against a copy of the logic: the interesting cases are the ones a regex cannot see —
 * a database whose columns are older than the code, a recorded path that escapes the store, a
 * conversation whose file is the oldest of all.
 *
 * `tests/mutate-session-picker.py` breaks each of them in the shipped source and requires this
 * guard to report it by name.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { mkdir, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SERVER = fileURLToPath(new URL('../miniapp/node/server.mjs', import.meta.url));

// `node:sqlite` is still flagged experimental, and the flag goes to stderr the moment the module
// is first loaded. The runner reads `stdout + stderr` and prints the LAST non-empty line, so the
// warning lands where this guard's own result line should be and the guard gets reported with
// the text of an unrelated warning instead of its verdict. Narrowly filtered, and installed
// BEFORE the import that provokes it: anything else still prints.
const emitWarning = process.emitWarning;
process.emitWarning = (warning, ...rest) => (
  String(warning).startsWith('SQLite is an experimental feature')
    ? undefined
    : emitWarning.call(process, warning, ...rest));

const { DatabaseSync } = await import('node:sqlite');
// `SERVER` is a plain filesystem path, and a dynamic import of one on Windows is read as a URL
// with an unsupported scheme. The module has to be asked for by its file: URL.
const {
  buildVisibleSessionList,
  collectSessionCandidates,
  decodeSessionIdFromDirName,
  readSessionTitles,
  resolveCurrentConversation,
  sameWorkspacePath,
  sessionTagFor,
} = await import(pathToFileURL(SERVER).href);

let pass = 0;
const failures = [];
function assert(name, cond, detail) {
  if (cond) { pass += 1; return; }
  failures.push(detail ? name + ' -- ' + detail : name);
}

/* ---------- the fixtures: a store and a runtime database, built here ---------- */

/** The session id the directory name encodes. */
const ID = (n) => 'mvs_picker' + String(n).padStart(3, '0') + 'zzzz';

/** A minute apart, so the recency order is the creation order and nothing is ambiguous. */
const BASE_TIME = Date.UTC(2026, 9, 20, 0, 0, 0);

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
 * A runtime database, with the optional columns the caller asks for. A database that predates a
 * column simply does not have it, which is the case the read ladder exists for.
 *
 * @param {string} home
 * @param {readonly string[]} optionalColumns
 * @param {readonly { sessionId: string, kind?: string, purpose?: string | null, workspace?: string | null, relative?: string | null }[]} rows
 */
function runtimeDb(home, optionalColumns, rows) {
  mkdirSync(join(home, 'v2', 'sqlite'), { recursive: true });
  const db = new DatabaseSync(join(home, 'v2', 'sqlite', 'runtime-state.sqlite'));
  const columns = ['session_id', 'title', 'status', 'history_relative_dir', 'session_kind',
    'archived', 'updated_at_ms'].concat(optionalColumns);
  db.exec('create table local_runtime_sessions (' + columns.join(', ') + ')');
  // The resolver asks whether a session holds a live lease, so the table has to exist even when
  // no row does.
  db.exec('create table local_runtime_session_locks (session_id text, expires_at_ms integer)');
  const insert = db.prepare('insert into local_runtime_sessions (' + columns.join(', ')
    + ') values (' + columns.map(() => '?').join(', ') + ')');
  for (const row of rows) {
    const values = [row.sessionId, '会话 ' + row.sessionId.slice(-4), 'idle', row.relative ?? null,
      row.kind ?? 'conversation', 0, 1];
    for (const column of optionalColumns) {
      if (column === 'purpose') values.push(row.purpose ?? null);
      else if (column === 'workspace_dir') values.push(row.workspace ?? null);
      else if (column === 'parent_session_id') values.push(null);
      else throw new Error('unknown column ' + column);
    }
    insert.run(...values);
  }
  db.close();
}

/**
 * What the picker would show, for one store and one runtime database: the walk's list, the
 * current conversation, the titles, and the visible set the route builds from them.
 *
 * @param {string} sessionsRoot
 * @param {string} home
 * @param {number} limit
 */
async function visibleFor(sessionsRoot, home, limit) {
  const entries = (await collectSessionCandidates(sessionsRoot)).recentEntries;
  const current = await resolveCurrentConversation(home);
  const ids = entries.map((entry) => decodeSessionIdFromDirName(basename(entry.dir))).filter(Boolean);
  if (current && current.sessionId && ids.indexOf(current.sessionId) < 0) ids.push(current.sessionId);
  const titles = await readSessionTitles(home, ids);
  const visible = await buildVisibleSessionList(entries, current, titles, sessionsRoot, limit);
  return { entries, current, titles, visible };
}

const dirsOf = (visible) => visible.map((entry) => entry.dir);
const sameOrder = (visible, expected) => dirsOf(visible).join('|') === expected.map((m) => m.dir).join('|');

const homes = [];
const store = async (count, offset = 0) => {
  const home = mkdtempSync(join(tmpdir(), 'mmc-trajectory-picker-'));
  homes.push(home);
  const sessionsRoot = join(home, 'v2', 'sessions');
  const made = [];
  for (let i = 0; i < count; i += 1) {
    made.push(await makeSession(sessionsRoot, i + offset, ID(i + offset), BASE_TIME - (i + offset) * 60_000));
  }
  return { home, sessionsRoot, made };
};

/* ---------- 1 & 2: the current conversation is in the list, and first ---------- */

try {
  // Thirty-one sessions, so the current one falls outside the walk's window of thirty. It is the
  // OLDEST of them: the reader opened it and read it without writing anything since.
  const { home, sessionsRoot, made } = await store(31);
  runtimeDb(home, ['parent_session_id', 'purpose', 'workspace_dir'], [
    { sessionId: ID(30), relative: made[30].relative, workspace: 'workspace-one' },
  ]);
  const one = await visibleFor(sessionsRoot, home, 20);
  assert('the current conversation is in the visible list even though its file is the oldest',
    one.visible.some((entry) => entry.dir === made[30].dir),
    dirsOf(one.visible).join('|'));
  assert('and the current conversation is first',
    one.visible[0]?.dir === made[30].dir,
    dirsOf(one.visible).slice(0, 3).join('|'));
  assert('and the list is no longer than it was — the current conversation joins it, it does not grow it',
    one.visible.length === 20, String(one.visible.length));
  assert('and the rest of the list is still the most recent sessions',
    one.visible[1]?.dir === made[0].dir && one.visible[19]?.dir === made[18].dir,
    dirsOf(one.visible).slice(0, 3).join('|'));
} catch (error) {
  failures.push('the current conversation is in the visible list even though its file is the oldest -- '
    + String(error && error.message ? error.message : error));
}

/* ---------- 3 & 4: the current workspace first, each group in recency order ---------- */

try {
  const { home, sessionsRoot, made } = await store(5);
  // The workspaces alternate, so a partition that did not happen and a partition that happened
  // produce two different orders rather than the same one twice.
  const plan = ['workspace-one', 'workspace-two', 'workspace-one', 'workspace-two', 'workspace-one'];
  runtimeDb(home, ['parent_session_id', 'purpose', 'workspace_dir'], plan.map((workspace, index) => ({
    sessionId: ID(index),
    relative: made[index].relative,
    workspace,
  })));
  const two = await visibleFor(sessionsRoot, home, 20);
  assert('the sessions of the current workspace come before the sessions of other workspaces',
    two.visible.findIndex((entry) => entry.dir === made[2].dir)
      < two.visible.findIndex((entry) => entry.dir === made[1].dir),
    dirsOf(two.visible).join('|'));
  assert('every session of the current workspace is ahead of every session of another workspace',
    two.visible.findIndex((entry) => entry.dir === made[4].dir)
      < two.visible.findIndex((entry) => entry.dir === made[3].dir),
    dirsOf(two.visible).join('|'));
  assert('the order is the current conversation, then its workspace, then the rest',
    sameOrder(two.visible, [made[0], made[2], made[4], made[1], made[3]]),
    dirsOf(two.visible).join('|'));
  assert('each group keeps the recency order',
    two.visible.findIndex((entry) => entry.dir === made[2].dir)
      < two.visible.findIndex((entry) => entry.dir === made[4].dir)
    && two.visible.findIndex((entry) => entry.dir === made[1].dir)
      < two.visible.findIndex((entry) => entry.dir === made[3].dir),
    dirsOf(two.visible).join('|'));
} catch (error) {
  failures.push('the sessions of the current workspace come before the sessions of other workspaces -- '
    + String(error && error.message ? error.message : error));
}

/* ---------- 5: no runtime database, no current conversation, no change ---------- */

try {
  const { home, sessionsRoot, made } = await store(5);
  const three = await visibleFor(sessionsRoot, home, 20);
  assert('without a runtime database the list is the plain recency order',
    sameOrder(three.visible, [made[0], made[1], made[2], made[3], made[4]]),
    dirsOf(three.visible).join('|'));
  assert('and without a runtime database there is no current conversation to pin',
    three.current === null);
} catch (error) {
  failures.push('without a runtime database the list is the plain recency order -- '
    + String(error && error.message ? error.message : error));
}

/* ---------- 6: a database without the purpose column ---------- */

try {
  const { home, sessionsRoot, made } = await store(5);
  // No `purpose` column at all: the read has to stop one rung short and still answer with the
  // title and the kind, and a conversation with no purpose of its own gets no badge.
  runtimeDb(home, ['parent_session_id'], made.map((m, index) => ({ sessionId: ID(index), relative: m.relative })));
  const four = await visibleFor(sessionsRoot, home, 20);
  assert('a database without the purpose column still lists every session',
    four.visible.length === 5
    && made.every((m) => four.visible.some((entry) => entry.dir === m.dir)),
    dirsOf(four.visible).join('|'));
  assert('a database without the purpose column still reports the title and the kind of every session',
    four.visible.every((entry) => {
      const meta = four.titles.get(decodeSessionIdFromDirName(basename(entry.dir)));
      return Boolean(meta && meta.title && meta.kind);
    }));
  assert('a database without the purpose column puts no kind badge on any row',
    four.visible.every((entry) => {
      const meta = four.titles.get(decodeSessionIdFromDirName(basename(entry.dir)));
      return sessionTagFor(meta ? meta.kind : null, meta ? meta.purpose : null) === null;
    }));
} catch (error) {
  failures.push('a database without the purpose column still lists every session -- '
    + String(error && error.message ? error.message : error));
}

/* ---------- 7: a database without the workspace column ---------- */

try {
  const { home, sessionsRoot, made } = await store(5);
  // The workspace column is the one that orders the list, and it is the newest of the two. A
  // database without it cannot be partitioned, so the list is the plain recency order — and the
  // rows keep their titles, their kinds and their purposes.
  const plan = ['workspace-one', 'workspace-two', 'workspace-one', 'workspace-two', 'workspace-one'];
  runtimeDb(home, ['parent_session_id', 'purpose'], plan.map((_workspace, index) => ({
    sessionId: ID(index),
    relative: made[index].relative,
  })));
  const five = await visibleFor(sessionsRoot, home, 20);
  assert('a database without the workspace column still lists every session',
    five.visible.length === 5
    && made.every((m) => five.visible.some((entry) => entry.dir === m.dir)),
    dirsOf(five.visible).join('|'));
  assert('a database without the workspace column produces no workspace partition',
    sameOrder(five.visible, [made[0], made[1], made[2], made[3], made[4]]),
    dirsOf(five.visible).join('|'));
  assert('a database without the workspace column still reports the title of every session',
    five.visible.every((entry) => {
      const meta = five.titles.get(decodeSessionIdFromDirName(basename(entry.dir)));
      return Boolean(meta && meta.title);
    }));
} catch (error) {
  failures.push('a database without the workspace column still lists every session -- '
    + String(error && error.message ? error.message : error));
}

/* ---------- 8: a recorded path that escapes the store ---------- */

try {
  const { home, sessionsRoot, made } = await store(31);
  // The path the runtime recorded points out of the sessions root. It is a database column
  // rather than a name this app chose, so it gets the same containment check a catalog file
  // name gets — and the conversation is not injected from it.
  const outside = join(home, 'v2', 'outside');
  await mkdir(outside, { recursive: true });
  await writeFile(join(outside, 'messages.jsonl'),
    JSON.stringify({ role: 'user', content: 'x' }) + '\n', 'utf8');
  runtimeDb(home, ['parent_session_id', 'purpose', 'workspace_dir'], [
    { sessionId: ID(30), relative: '../outside', workspace: 'workspace-one' },
  ]);
  const six = await visibleFor(sessionsRoot, home, 20);
  assert('a recorded path that escapes the sessions root is refused',
    !six.visible.some((entry) => entry.dir === outside),
    dirsOf(six.visible).join('|'));
  assert('and the current conversation is not injected from it',
    !six.visible.some((entry) => entry.dir === made[30].dir),
    dirsOf(six.visible).join('|'));
  assert('and the list is still the plain recency order',
    sameOrder(six.visible, made.slice(0, 20)),
    dirsOf(six.visible).join('|'));
} catch (error) {
  failures.push('a recorded path that escapes the sessions root is refused -- '
    + String(error && error.message ? error.message : error));
}

/* ---------- 9: what a workspace path is, compared ---------- */

assert('two spellings of one Windows path are the same workspace',
  sameWorkspacePath('D:\\work\\project', 'd:/work/project/'));
assert('two different workspaces are not the same workspace',
  !sameWorkspacePath('D:\\work\\project', 'D:\\work\\other'));
assert('a workspace that is not there is not a workspace',
  !sameWorkspacePath(null, 'D:\\work')
  && !sameWorkspacePath('', 'D:\\work')
  && !sameWorkspacePath('D:\\work', null)
  && !sameWorkspacePath('D:\\work', ''));
assert('a POSIX path is compared as it stands, because two spellings there are two directories',
  !sameWorkspacePath('/work/Project', '/work/project'));

/* ---------- 10: what may leave the service ---------- */
//
// The workspace is an absolute path on the reader's machine, and the purpose is free text that
// can carry anything a person typed into it. Neither may reach the browser: the page gets an
// ordered list and a token, and that is all. The field list the page receives is the whole
// boundary, so it is asserted rather than assumed.
const serverText = readFileSync(SERVER, 'utf8');
const strip = /function stripInternalFields\(value\) \{[\s\S]*?\n\}/.exec(serverText);
assert('the field list the page receives names neither the workspace nor the raw purpose',
  strip !== null && !/workspace/.test(strip[0]) && !/purpose/.test(strip[0]),
  strip === null ? 'no strip function found' : strip[0].slice(0, 120));
assert('the kind badge is the one field that says what kind of session this is',
  strip !== null && /sessionTag: value\.sessionTag \?\? null,/.test(strip[0]));

for (const home of homes) rmSync(home, { recursive: true, force: true });

console.log('[session-picker] ' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('[session-picker] OK');
