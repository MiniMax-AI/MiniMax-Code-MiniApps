/**
 * `/api/runtime` is the one route in this package whose contract is entirely about what it does
 * NOT send. Its own comment says it: 「Names and structure only」, and 「this route must never hand
 * the browser a filesystem location」. Every other route's contract is about the values it
 * publishes; this one's is about the values it withholds.
 *
 * It was the only row in a promise-to-guard map that came back 「nothing」, and asking the question
 * is what turned up the reason there should be one. Three fields in that response are not
 * basenames, counts or flags — they are substrings of exception text:
 *
 *   `sqlite.error`      the message from importing node:sqlite
 *   `sqlite.queryError` the message from a database that could not be opened or queried
 *   `diagError`         the STACK of anything the handler itself threw
 *
 * `diagError` is the one that leaks on every single run: a Node stack frame names the file it is
 * in, by absolute path, once per frame, so a 600-character slice of one is mostly directory names.
 * And it fires on precisely the failure paths this route exists to report, so the reader looking at
 * this output is the reader who is already having a bad day. On Windows those paths carry the user
 * profile directory, which is the identity leak this package treats as a release blocker elsewhere.
 *
 * Three kinds of check, each named for what it is, because a guard that does not say which of its
 * checks are the strong kind is worse than one that has none:
 *
 *   1. BEHAVIOURAL. The redactor is the real exported `createRedactor`, and the text it is handed
 *      is a REAL stack captured by throwing from a real module written inside a real temporary
 *      home — so the paths in it are the ones that would actually have gone out. Nothing here is
 *      typed out to make a point.
 *
 *   2. SHAPE, on three lines, count-checked: that the three fields go through `redact`, and that
 *      they do so BEFORE `slice`. These cannot be behavioural, and the reason is worth recording:
 *      the handler is a closure inside `start()`, and this suite's own convention
 *      (`verify-search-endpoint.mjs` states it) is read-only, pure helpers, never start the
 *      runtime. Moving a route handler out of its closure purely so a test could call it is a
 *      bigger change to shipped code than the property is worth. So the shape checks hold the
 *      wiring, the behavioural one holds the property, and neither is asked to do the other's job.
 *
 *   3. That the published location fields stay NAMES. `basename` is what turns a path into a fact
 *      about this machine that the browser cannot use to find anything.
 *
 * `tests/mutate-runtime-diag.py` reverts each of the three redacting fields and requires this guard
 * to report it by name.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { basename, join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { createRedactor, resolveSessionsRoot, scrubAbsolutePaths } from '../miniapp/node/server.mjs';

const SESSION_STORE_TOKEN = '<session-store>';
const SERVER = fileURLToPath(new URL('../miniapp/node/server.mjs', import.meta.url));
const server = readFileSync(SERVER, 'utf8');

let pass = 0;
const failures = [];
function assert(name, cond, detail) {
  if (cond) pass += 1;
  else failures.push(detail ? name + ' -- ' + detail : name);
}

const home = mkdtempSync(join(mkdtempSync(join(tmpdir(), 'mmc-trajectory-diag-')), '.minimax'));
try {
  const where = resolveSessionsRoot({ MMC_TRAJECTORY_ROOT: home });
  const redact = createRedactor([where.sessionsRoot, where.root, join(homedir(), '.minimax')]);

  // --- 1. BEHAVIOURAL: a real stack, out of a real module, under the home the redactor knows ----
  const thrower = join(home, 'thrower.mjs');
  writeFileSync(thrower, 'export function boom() {\n  throw new Error("boom");\n}\n');
  const { boom } = await import(pathToFileURL(thrower).href);

  let frame = null;
  try {
    boom();
  } catch (error) {
    frame = String(error.stack);
  }
  assert('a real stack names the file it is in, by absolute path',
    typeof frame === 'string' && frame.includes('thrower.mjs'),
    frame ? frame.split('\n')[1] : 'no stack');
  assert('and that path is the READER\'s own directory, spelled the way a stack spells it',
    typeof frame === 'string' && frame.includes(home.replace(/\\/g, '/')),
    frame ? frame.split('\n')[1] : 'no stack');

  /* The shape of that path is the part worth pinning, and it is not the obvious one. Node prints a
   * stack frame as a URL — `file:///C:/Users/…/thrower.mjs` — with FORWARD slashes and a scheme in
   * front. The store locations are held as backslash paths, so `split(prefix).join(token)` does not
   * match a single frame, and the `.minimax` fallback catches the store's own directories while
   * leaving everything else in the frame standing. That was measured on a real stack, not assumed:
   * `redact` on its own leaves `file:///` in the output.
   *
   * So the property this route needs is owned by `scrubAbsolutePaths`, and the assertions below ask
   * that question of it directly rather than of the route, which is a closure inside `start()`. */
  const cleaned = typeof frame === 'string' ? scrubAbsolutePaths(redact(frame)) : '';
  assert('and the store redactor alone does NOT clean it, which is why this route needs a second pass',
    typeof frame === 'string' && /file:\/\//.test(redact(frame)), redact(frame).split('\n')[1]);
  assert('BEHAVIOURAL: the path scrubber takes the reader\'s own directory out of the stack',
    !cleaned.includes(home) && !cleaned.includes(encodeURI(home)), cleaned.split('\n')[1]);
  assert('leaving no file URL and no drive-qualified path anywhere in the remainder',
    !/file:\/\//.test(cleaned) && !/[A-Za-z]:[\\/]/.test(cleaned), cleaned.split('\n')[1]);
  assert('while still leaving the diagnostic itself readable',
    cleaned.includes('boom') && cleaned.includes(SESSION_STORE_TOKEN), cleaned.split('\n')[0]);

  // The residual, and it is the common one. A stack frame does not only name the store: every other
  // frame in it is somewhere else entirely — the node install, a temp directory, a dependency — and
  // none of those is under `.minimax`, so the store redactor has nothing to match them against and
  // the whole frame passes. This is a SECOND throw, from a module outside the store, because that is
  // the case the first one cannot see: it sits under `.minimax`, where the fallback happens to save
  // it, and a guard that only tested that would be reporting safety it has not checked.
  const outside = mkdtempSync(join(tmpdir(), 'mmc-trajectory-outside-'));
  const outsideThrower = join(outside, 'elsewhere.mjs');
  writeFileSync(outsideThrower, 'export function boom2() {\n  throw new Error("boom2");\n}\n');
  const { boom2 } = await import(pathToFileURL(outsideThrower).href);
  let outsideFrame = null;
  try {
    boom2();
  } catch (error) {
    outsideFrame = String(error.stack);
  }
  // Everything below compares against the SLASHED spelling, because that is the one a stack uses.
  // Comparing a Windows path against a `file:///C:/...` frame reads as "nothing matched" and turns
  // a check into a vacuous pass — which is worse than no check, because it is green.
  const slashed = (p) => p.replace(/\\/g, '/');
  try {
    assert('a real stack from OUTSIDE the store names an absolute path there too',
      typeof outsideFrame === 'string' && outsideFrame.includes(slashed(outsideThrower)));
    assert('and the store redactor leaves that one completely alone, which is the whole reason '
      + 'this route has a second pass',
      typeof outsideFrame === 'string' && redact(outsideFrame).includes(slashed(outsideThrower)),
      typeof outsideFrame === 'string' ? redact(outsideFrame).split('\n')[1] : '');
    assert('BEHAVIOURAL: while the scrubber removes it',
      typeof outsideFrame === 'string' && !scrubAbsolutePaths(redact(outsideFrame)).includes(slashed(outside)));
    assert('and the diagnostic still says what happened',
      scrubAbsolutePaths(redact(outsideFrame)).includes('boom2'));
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }

  // It has to be narrow. Every URL, route and regex in this package starts with a `/`, so a scrub
  // that matched a bare slash would blank half the output and make the route useless for the one
  // job it has. The POSIX shape is deliberately anchored on a root only a filesystem has.
  assert('and it does not blank the things it must leave alone',
    scrubAbsolutePaths('GET /api/trajectory?since=12 -> 304') === 'GET /api/trajectory?since=12 -> 304',
    scrubAbsolutePaths('GET /api/trajectory?since=12 -> 304'));
  assert('including a POSIX store path, which it DOES blank',
    !scrubAbsolutePaths('at probe (/home/someone/.minimax/v2/x)').includes('/home/'));

  // --- 2. the two SQLite strings, which are a weaker case and are labelled as one ---------------
  // On this runtime their messages carry no path at all — `unable to open database file` is the
  // whole text — so nothing leaks through them today. What the shape checks below own is that the
  // channel stays closed if a message ever does carry one. That is a smaller claim than "this
  // leaks", and saying so is the difference between a guard and a story about a guard.
  const dbPath = join(home, 'v2', 'sqlite', 'runtime-state.sqlite');
  mkdirSync(join(home, 'v2', 'sqlite'), { recursive: true });
  mkdirSync(dbPath, { recursive: true });   // a directory where a file belongs: refused
  let sqliteMessage = null;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const probe = new DatabaseSync(dbPath, { readOnly: true });
    probe.prepare('select count(*) as n from local_runtime_sessions').get();
    probe.close();
  } catch (error) {
    sqliteMessage = String(error && error.message ? error.message : error);
  }
  assert('a real SQLite refusal is produced here, so the check above is about a real string',
    typeof sqliteMessage === 'string' && sqliteMessage.length > 0);
  assert('and on this runtime it happens to carry no path, which is why those two fields are held '
    + 'as a channel rather than as a leak',
    typeof sqliteMessage === 'string' && !sqliteMessage.includes(home), sqliteMessage);
  assert('the redactor leaves that message intact, so nothing is redacted into uselessness',
    typeof sqliteMessage === 'string' && redact(sqliteMessage) === sqliteMessage);

  // --- 3. SHAPE: three fields, redacted, and redacted BEFORE they are clipped --------------------
  for (const anchor of ['sqlite.error = scrubAbsolutePaths(redact(String(',
    'sqlite.queryError = scrubAbsolutePaths(redact(String(',
    'diagError = scrubAbsolutePaths(redact(String(']) {
    assert('SHAPE: ' + anchor.split(' ')[0] + ' goes through both passes', server.includes(anchor));
  }
  // The order is part of the rule, not a style note: `redact(x).slice(n)` and `redact(x.slice(n))`
  // differ only in whether a secret can be cut in half, and half a Windows profile path is still a
  // profile path.
  for (const [field, pattern] of [
    ['sqlite.error', /sqlite\.error = scrubAbsolutePaths\(redact\(String\([\s\S]*?\)\)\)\.slice\(0, 200\);/],
    ['sqlite.queryError', /sqlite\.queryError = scrubAbsolutePaths\(redact\(String\([\s\S]*?\)\)\)\.slice\(0, 240\);/],
    ['diagError', /diagError = scrubAbsolutePaths\(redact\(String\([\s\S]*?\)\)\)\.slice\(0, 600\);/],
  ]) {
    assert(`SHAPE: ${field} is redacted and scrubbed BEFORE it is clipped, so no path is cut in half`,
      pattern.test(server));
  }

  // --- 4. the published location fields stay names ----------------------------------------------
  assert('the database file is published as a basename',
    /sqlite\.dbFile = basename\(join\(location\.root/.test(server));
  for (const field of ['cwdBasename', 'dataDirBasename']) {
    assert(`${field} is a basename and not the value it was derived from`,
      new RegExp(`${field}: basename\\(`).test(server));
  }
  assert('and nothing publishes the sessions root or the data directory verbatim',
    !/:\s*location\.sessionsRoot\s*[,}]/.test(server)
    && !/:\s*context\.dataDir\s*[,}]/.test(server));
} finally {
  rmSync(home, { recursive: true, force: true });
}

console.log('[runtime-diag] ' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  for (const f of failures) console.log('FAIL  ' + f);
  process.exit(1);
}
console.log('[runtime-diag] OK');
