// Offline self-check for miniapp/client/index.html (read-only w.r.t. the package).
// 1) extracts the inline <script> and runs `node --check`
// 2) extracts the PURE:START/PURE:END block and unit-tests the DOM-free helpers
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
// The service's own fold over a set of records. The page has a copy of it — two copies of one
// question is two answers, and the difference between them is nobody's to explain — so the two are
// compared here rather than trusted.
import { recordSetFingerprint } from '../miniapp/node/server.mjs';

const HTML = fileURLToPath(new URL('../miniapp/client/index.html', import.meta.url));
const SERVER = fileURLToPath(new URL('../miniapp/node/server.mjs', import.meta.url));
// Scratch files go to a throwaway directory, not into the checkout: this script writes
// an extracted copy of the inline script and runs `node --check` on it.
const OUT = mkdtempSync(join(tmpdir(), 'traj-client-check-'));

const html = readFileSync(HTML, 'utf8');

/* ---------- 1) syntax check of the inline script ---------- */
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (scripts.length !== 1) throw new Error('expected exactly one inline script, got ' + scripts.length);
writeFileSync(OUT + '/client-extracted.mjs', scripts[0]);
try {
  execFileSync(process.execPath, ['--check', OUT + '/client-extracted.mjs'], { stdio: 'pipe' });
  console.log('[1] node --check: PASS (' + scripts[0].split('\n').length + ' script lines)');
} catch (error) {
  console.log('[1] node --check: FAIL\n' + error.stderr);
  process.exit(1);
}

/* ---------- 2) pure helpers ---------- */
const rawSlice = html.split('PURE:START')[1].split('PURE:END')[0];
let block = rawSlice.slice(rawSlice.indexOf('*/') + 2);           // drop the PURE:START header comment
const lastCloser = block.lastIndexOf('*/');                      // drop the dangling PURE:END header opener
const dangling = block.indexOf('/*', lastCloser === -1 ? 0 : lastCloser + 2);
if (dangling >= 0) block = block.slice(0, dangling);
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(block, sandbox);

let pass = 0;
const failures = [];
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass += 1;
  else failures.push(name + ': got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected));
}
function assert(name, cond) {
  if (cond) pass += 1;
  else failures.push(name);
}

/* null rendering — never 0, never invented */
check('duration null', sandbox.formatDuration(null), '—');
check('duration undefined', sandbox.formatDuration(undefined), '—');
check('duration zero', sandbox.formatDuration(0), '0 ms');
check('duration 431', sandbox.formatDuration(431), '431 ms');
check('duration 1500', sandbox.formatDuration(1500), '1.50 s');
check('duration 90000', sandbox.formatDuration(90000), '1 分 30 秒');
check('duration NaN', sandbox.formatDuration(NaN), '—');
check('int null', sandbox.formatInt(null), '—');
check('int group', sandbox.formatInt(1234567), '1,234,567');
check('int zero', sandbox.formatInt(0), '0');
check('offset null', sandbox.formatOffset(null), '—');
check('offset 887', sandbox.formatOffset(887), '+887 ms');
check('offset 12000', sandbox.formatOffset(12000), '+12 s');
check('offset 0', sandbox.formatOffset(0), '+0 ms');
check('clock null', sandbox.formatClock(null), '—');
check('ago null', sandbox.formatAgo(null, Date.now()), '—');
check('ago 30s', sandbox.formatAgo(Date.now() - 30000, Date.now()), '刚刚');
check('ago 5min', sandbox.formatAgo(Date.now() - 300000, Date.now()), '5 分钟前');
check('bytes null', sandbox.formatBytes(null), '—');
check('bytes 244100', sandbox.formatBytes(244100), '238.4 KB');
check('safeText null', sandbox.safeText(null), '');
check('safeText obj', sandbox.safeText({ a: 1 }), '{"a":1}');
check('truncate empty', sandbox.truncateText('', 10), '');
check('truncate long', sandbox.truncateText('abcdefghij', 5), 'abcd…');
check('labels', sandbox.KIND_LABELS.toolResult, '工具结果');

/* kind label — a compaction is its own kind, so it can never be called 系统 */
check('kindLabel compaction', sandbox.kindLabel({ kind: 'compaction', title: 'compaction' }), '压缩');
check('kindLabel plain system', sandbox.kindLabel({ kind: 'system', title: 'context' }), '系统');
check('kindLabel reply', sandbox.kindLabel({ kind: 'reply' }), '答复');
check('kindLabel narration', sandbox.kindLabel({ kind: 'narration' }), '过程');
check('kindLabel unknown falls back to kind', sandbox.kindLabel({ kind: 'weird' }), 'weird');
check('kindLabel null record is dash', sandbox.kindLabel(null), '—');
check('kindLabel null record is dash string', sandbox.kindLabel('x'), '—');
// 问答 already means something else here: the server classifies *turns* that way — the
// exchange where the agent asked the reader something and the reply came back through the
// tool result. That turn is a composite, not a record. A record kind wearing the same
// name once shipped as `qa` and was really 答复 (stopReason === 'stop'), so this asserts
// no record kind may claim the word. If a future kind genuinely is a Q&A exchange, it
// belongs at turn level, and this line is the one to argue with first.
check('no record kind is labelled 问答',
  sandbox.KIND_ORDER.some((k) => sandbox.KIND_LABELS[k] === '问答'), false);
// The label follows the kind and nothing else. A title that used to mean "compaction"
// now means what it says: the filter decides what a record is, so the name has to as well.
check('kindLabel ignores title', sandbox.kindLabel({ kind: 'system', title: 'compaction' }), '系统');
check('every kind has a label', sandbox.KIND_ORDER.every((k) => typeof sandbox.KIND_LABELS[k] === 'string' && sandbox.KIND_LABELS[k].length > 0), true);
check('every label has a kind', Object.keys(sandbox.KIND_LABELS).every((k) => sandbox.KIND_ORDER.indexOf(k) >= 0), true);

/* generation selector — one generation is not a choice, and the newest comes first.
   `logicalMessageCount` is how many logical messages that generation stores; the catalog's
   `messageCount` counts stored rows, and a message the store wrote twice is one message. */
const gens = [
  { generation: 0, kind: 'snapshot', messageCount: 676, logicalMessageCount: 610, active: false },
  { generation: 1, kind: 'snapshot', messageCount: 548, logicalMessageCount: 494, active: false },
  { generation: 2, kind: 'active', messageCount: 186, logicalMessageCount: 180, active: true }
];
check('generationOptions empty for one', sandbox.generationOptions([{ generation: 0 }], 0), []);
check('generationOptions empty for none', sandbox.generationOptions([], null), []);
check('generationOptions empty for junk', sandbox.generationOptions(null, 0), []);
const opts = sandbox.generationOptions(gens, 2);
check('generationOptions count includes the all option', opts.length, 4);
check('generationOptions leads with the whole lineage', opts[0].generation, 'all');
check('generationOptions all label', opts[0].label, '全部（默认）');
check('generationOptions all is never marked active', opts[0].active, false);
check('generationOptions newest generation first', opts[1].generation, 2);
check('generationOptions active marked', opts[1].active, true);
check('generationOptions active label', opts[1].label, '第 2 代（当前）');
check('generationOptions archived label carries the stored count', opts[2].label, '第 1 代（494 条）');
check('generationOptions exposes that count to the option', opts[2].messageCount, 494);
check(
  'generationOptions prefers the stored count over the catalog row count',
  sandbox.generationOptions([
    { generation: 0, messageCount: 676, logicalMessageCount: 610 },
    { generation: 1, messageCount: 548, logicalMessageCount: 494 }
  ], 1)[2].label,
  '第 0 代（610 条）'
);
check('generationOptions last option', opts[3].generation, 0);
check(
  'generationOptions drops entries without a generation',
  sandbox.generationOptions([{ generation: 1 }, null, { kind: 'x' }, { generation: 2, active: true }], 2).length,
  3
);
check('generationOptions falls back to the active flag', sandbox.generationOptions(gens, null)[1].active, true);
check(
  'generationOptions missing count drops the suffix',
  sandbox.generationOptions([{ generation: 0, logicalMessageCount: null }, { generation: 1, messageCount: 5, logicalMessageCount: 5, active: true }], 1)[2].label,
  '第 0 代'
);

/* escaping / hostile text */
const XSS = '</pre><script>alert("xss")</script>&`${danger}';
const escaped = sandbox.escapeHtml(XSS);
assert('escapeHtml has no raw <', !escaped.includes('<'));
assert('escapeHtml has no raw >', !escaped.includes('>'));
assert('escapeHtml has no raw quote', !escaped.includes('"'));
assert('escapeHtml escapes amp', escaped.includes('&amp;'));
check('safeText keeps hostile text verbatim', sandbox.safeText(XSS), XSS);

const colored = sandbox.jsonColorize({ evil: XSS, n: 42, b: true, z: null, s: 'a$&b' });
assert('jsonColorize emits no injected tag', !colored.includes('<script') && !colored.includes('</pre>'));
assert('jsonColorize keeps literal $&', colored.includes('$&'));
const stripped = colored.replace(/<[^>]+>/g, '');
check('jsonColorize round-trips to escaped json', stripped, sandbox.escapeHtml(JSON.stringify({ evil: XSS, n: 42, b: true, z: null, s: 'a$&b' }, null, 2)));
assert('jsonColorize colors numbers', colored.includes('tok-num'));
check('jsonColorize undefined', sandbox.jsonColorize(undefined), '');
check('jsonColorize null', sandbox.jsonColorize(null), '<span class="tok-null">null</span>');

/* search: the server says which records match, and the page asks a set */
const hostile = {
  index: 41,
  kind: 'reply',
  summary: 'Ask about <script>alert(1)</script>',
  text: 'Answering now',
  result: null,
  thinking: null
};
// The five fields are no longer scanned here — that is the whole point of the move — so what is
// held is a set of record indexes and the record's own content is irrelevant to the decision.
const hit41 = sandbox.searchHitSet([{ index: 41 }, { index: 7 }]);
check('the hit set holds the server\'s indexes', Array.from(hit41).sort((a, b) => a - b), [7, 41]);
check('a record the server named passes whatever the needle says', sandbox.matchesQuery(hostile, 'script', hit41), true);
check('a record whose text contains the needle but which the server did not name fails',
  sandbox.matchesQuery(hostile, 'script', sandbox.searchHitSet([{ index: 7 }])), false);
check('an unmatched needle matches nothing', sandbox.matchesQuery(hostile, 'zzz', sandbox.searchHitSet([])), false);
check('an empty query filters nothing', sandbox.matchesQuery(hostile, '', hit41), true);
check('an unanswered needle filters nothing, and says so elsewhere', sandbox.matchesQuery(hostile, 'zzz', null), true);
check('an unanswered needle is not an empty result', sandbox.searchHitSet(null), null);
check('a real empty result is an empty set', sandbox.searchHitSet([]).size, 0);
check('a hit without an index is dropped rather than becoming one', sandbox.searchHitSet([{ index: 'x' }, { index: 3 }]).size, 1);
check('a null hit is dropped', sandbox.searchHitSet([null, { index: 3 }]).size, 1);
check('a record with no index cannot be in the set',
  sandbox.matchesQuery({ kind: 'user' }, 'x', sandbox.searchHitSet([{ index: 1 }])), false);
check('a missing record does not throw',
  sandbox.matchesQuery(null, 'x', sandbox.searchHitSet([{ index: 1 }])), false);

/* search: the four states the count line has to tell apart */
const status = (over) => sandbox.searchStatusLabel(Object.assign(
  { query: 'abc', searchError: null, searchPending: false, searchHits: new Set([1]), searchTotal: 3, searchTruncated: false },
  over,
));
check('no needle, no status', sandbox.searchStatusLabel({ query: '', searchTotal: 0 }), '');
check('a needle answered with hits', status({}), '命中 3 条');
check('a needle answered with nothing', status({ searchHits: new Set(), searchTotal: 0 }), '未找到');
check('a needle still out', status({ searchPending: true }), '搜索中');
check('a needle that failed says so rather than showing an empty table',
  status({ searchError: 'search_failed' }), '搜索失败，以下为上次结果');
check('a failure outranks 「searching」, because it is the truth about the request',
  status({ searchPending: true, searchError: 'search_failed' }), '搜索失败，以下为上次结果');
check('an unanswered needle is not 「未找到」',
  status({ searchHits: null, searchTotal: 0, searchPending: false }), '命中 0 条');
check('a truncated answer says so', status({ searchTruncated: true }), '命中 3 条（已截断）');
check('a needle answered with nothing and truncated reads as not found',
  status({ searchHits: new Set(), searchTotal: 0, searchTruncated: true }), '未找到');
check('no state is not a crash', sandbox.searchStatusLabel(null), '');
check('no kinds match', sandbox.hasKind({ kind: 'system' }, ['user']), false);

/* search: the TRANSITION, which the four states above cannot see.
 *
 * Every case in the block above hands `searchStatusLabel` a state object written out for that one
 * case, and the `runSearch` checks further down read its source as text. Both are blind to the same
 * thing: a state is a snapshot, so neither can see that a search which failed once and was then
 * re-run and answered still said 「搜索失败，以下为上次结果」 — the label reads the error first, so
 * the stale error outranked the fresh hit set it was describing. Only the two paths a READER
 * triggers cleared the field: typing, and pressing clear. A poll that re-runs the current query
 * after the transcript changed is not a reader, so nothing it did could clear it.
 *
 * This runs it instead of reading it. `runSearch` is not between PURE:START and PURE:END — it
 * talks to the network — so it could not join the sandbox above; here the SHIPPED source of the
 * functions it needs is sliced out by `fnSource` and evaluated. That is the page's own text rather
 * than a copy of it: rename a function in index.html and this fails with "no such function" instead
 * of quietly continuing to exercise the old shape. */
{
  const netCtx = { console, AbortController, setTimeout, clearTimeout, encodeURIComponent };
  vm.createContext(netCtx);
  const needed = ['function isCount(value)', 'function formatInt(value)', 'function searchHitSet(hits)',
    'function sessionParam()', 'function displayedSessionParam()', 'function displayedGeneration()',
    'function displayedRecordsByIndex()', 'function displayedRecordVersions()',
    'function displayedRecordSet(versions)', 'function recordSetFingerprint(versions)',
    'function searchStatusLabel(searchState)',
    'function searchAnswerDoesNotApply()', 'function runSearch(needle)'];
  const sources = needed.map((sig) => fnSource(sig));
  check('the shipped search functions are all still findable by signature',
    needed.filter((sig, i) => !sources[i]), []);

  vm.runInContext([
    // The shape `runSearch` writes into. Every field it touches is here; nothing else about the
    // page's state is, because nothing else about the page's state is what is under test.
    'var state = { query: "retry me", sessionId: null, hostSessionId: null, followLatest: true,',
    '  generation: null, searchHits: null, searchTotal: 0, searchTruncated: false,',
    '  searchPending: false, searchError: null, searchRefresh: 0, searchRefreshFor: "",',
    '  searchSet: "",',
    // The body on screen. `displayedSessionParam()` reads it and the answer is checked against
    // it, so a harness with no body on screen cannot ask either question. Its `generation` is
    // the slice the body IS: null is the whole lineage, a number is that one generation.
    //
    // `flat` is the same body's records, which is what a hit is checked against: a hit names a
    // POSITION, and the position only names a record if the version on both sides agrees.
    '  flat: [ { turn: {}, record: { index: 1, v: "version-one" } },',
    '          { turn: {}, record: { index: 5, v: "version-five" } },',
    '          { turn: {}, record: { index: 7, v: "version-seven" } } ],',
    '  payload: { session: { id: "mvs_displayed", generation: null } } };',
    'var searchSeq = 0;',
    'var searchController = null;',
    // The two renderers paint the page; neither is what is being tested and neither has a DOM here.
    'function resetWindowMode() {}',
    'function renderLedger() {}',
    // A signature that no longer resolves becomes a function that throws when reached, so the
    // failure names the function rather than arriving as a syntax error nobody can read.
    ...sources.map((src, i) => src || (needed[i] + ' { throw new Error(' + JSON.stringify(needed[i])
      + ' is not in index.html any more); }')),
  ].join('\n'), netCtx);

  const settle = async (turns = 3) => {
    // fetch -> response.json() -> then -> then -> then is all microtasks plus the json() promise.
    // Three macrotask turns drain all of them, so the count does not have to be right.
    for (let i = 0; i < turns; i += 1) await new Promise((done) => setImmediate(done));
  };

  // The page re-asks against the body it fetches when an answer turns out to be about another
  // version of the records. The fetch itself is not what is under test here, so it is a stub that
  // counts the calls: how many times the page was willing to chase the answer IS the behaviour.
  netCtx.refreshes = 0;
  netCtx.fetchTrajectory = function () {
    netCtx.refreshes += 1;
    return Promise.resolve();
  };

  // Every URL the search asked for, so the question it asked can be read off the requests
  // rather than out of the source.
  const asked = [];
  netCtx.fetch = (url) => {
    asked.push(String(url));
    return Promise.reject(Object.assign(new Error('api'), { code: 'search_failed' }));
  };
  netCtx.runSearch('retry me');
  await settle();
  const afterFailure = netCtx.searchStatusLabel(netCtx.state);

  netCtx.fetch = (url) => {
    asked.push(String(url));
    return Promise.resolve({ ok: true, status: 200,
      json: () => Promise.resolve({ hits: [{ index: 7, v: 'version-seven' }], total: 1, truncated: false,
        // The server names the session it answered for. That name is what the page checks the
        // answer against before it lets the hits filter the body on screen.
        session: { id: 'mvs_displayed', generation: null } }) });
  };
  netCtx.runSearch('retry me');
  await settle();

  check('a search that failed says so', afterFailure, '搜索失败，以下为上次结果');
  check('and the retry that answers it clears the failure, not just the pending flag',
    netCtx.state.searchError, null);
  check('so the label reports the answer instead of the stale failure',
    netCtx.searchStatusLabel(netCtx.state), '命中 1 条');
  check('and the hit set it describes is the new one', [...netCtx.state.searchHits], [7]);

  /* The search has to be about the body on screen, and the answer has to say so.
   *
   * The search used to ask for `latest`, which is a different question from 「what is on
   * screen」: the runtime can make another conversation current while the page still shows
   * this one, and the answer then describes another session's records. The hits are indexes,
   * so they FILTER this body's rows against another body's matches — a row that matches
   * reads as a miss, and a row that does not read as a hit. Both are wrong in opposite
   * directions, which is why the number of hits alone never showed the defect.
   *
   * Two things have to hold and neither one is enough:
   *
   *   - the request names the displayed session, and
   *   - the answer is checked against it.
   *
   * A request that names the displayed session can still be answered about another one if
   * the runtime moved in between, and an answer that is checked can still be about another
   * session if the wrong question was asked. Both halves are asserted below.
   */
  check('the search asks about the session on screen',
    /[?&]session=mvs_displayed(&|$)/.test(asked[1]), true);
  check('and it does not ask about whatever is current now',
    /[?&]session=latest(&|$)/.test(asked[1]), false);

  // The answer comes back about another session. The hits must not be installed: they are
  // indexes into another body's records, and installing them would report this body's rows
  // against another body's matches.
  const installed = [...netCtx.state.searchHits];
  asked.length = 0;
  netCtx.fetch = (url) => {
    asked.push(String(url));
    return Promise.resolve({ ok: true, status: 200,
      json: () => Promise.resolve({ hits: [{ index: 99 }], total: 1, truncated: false,
        session: { id: 'mvs_other', generation: null } }) });
  };
  netCtx.runSearch('retry me');
  await settle();
  check('an answer about another session does not install its hit set',
    [...netCtx.state.searchHits], installed);
  check('and it does not report the other session\'s count either',
    netCtx.state.searchTotal, 1);
  check('it says the search failed, so the reader is told there is no answer',
    netCtx.state.searchError, 'session_mismatch');
  check('and the label shows the failure rather than the hit count',
    netCtx.searchStatusLabel(netCtx.state), '搜索失败，以下为上次结果');
  check('and the request it made still named the session on screen',
    /[?&]session=mvs_displayed(&|$)/.test(asked[0]), true);

  // The same session, but another slice of it. A slice is a different body, so an answer
  // about one slice is not an answer about another.
  //
  // The slice on screen is the body the page is SHOWING, not the generation the reader picked.
  // The two come apart when the load of a picked generation fails: the selection says one thing
  // and the body on screen says another, and only the body's own slice is the question the
  // search may ask and answer.
  netCtx.state.payload = { session: { id: 'mvs_displayed', generation: 3 } };
  netCtx.state.generation = 3;
  asked.length = 0;
  netCtx.fetch = (url) => {
    asked.push(String(url));
    return Promise.resolve({ ok: true, status: 200,
      json: () => Promise.resolve({ hits: [{ index: 98 }], total: 1, truncated: false,
        session: { id: 'mvs_displayed', generation: 2 } }) });
  };
  netCtx.runSearch('retry me');
  await settle();
  check('an answer about another slice of the same session does not install its hit set',
    [...netCtx.state.searchHits], installed);
  check('and the request named the slice that is on screen',
    /[?&]generation=3(&|$)/.test(asked[0]), true);
  check('and it failed for the same reason',
    netCtx.state.searchError, 'session_mismatch');

  // The reader picks another generation and the load of it FAILS. The body on screen is still
  // the old one; the selection is the new one. A search that asked about the selection would be
  // asking about a body that is not there, and the answer it got back would carry indexes of
  // THAT body — which then filtered the rows the reader is actually looking at.
  netCtx.state.payload = { session: { id: 'mvs_displayed', generation: 0 } };
  netCtx.state.generation = 1;
  asked.length = 0;
  netCtx.fetch = (url) => {
    asked.push(String(url));
    return Promise.resolve({ ok: true, status: 200,
      json: () => Promise.resolve({ hits: [{ index: 1, v: 'version-one' }], total: 1, truncated: false,
        session: { id: 'mvs_displayed', generation: 0 } }) });
  };
  netCtx.runSearch('retry me');
  await settle();
  check('the search asks about the slice on screen, not the one the reader picked',
    /[?&]generation=0(&|$)/.test(asked[0]), true);
  check('and it does not ask about the selection',
    /[?&]generation=1(&|$)/.test(asked[0]), false);
  check('so the answer about the body on screen is installed',
    [...netCtx.state.searchHits], [1]);
  check('and there is no failure, because the answer and the body agree',
    netCtx.state.searchError, null);

  // The other direction, because a check that accepts every answer is not a check either. An
  // answer about the SELECTED slice is not an answer about the body on screen, and its indexes
  // must not filter that body.
  asked.length = 0;
  netCtx.fetch = (url) => {
    asked.push(String(url));
    return Promise.resolve({ ok: true, status: 200,
      json: () => Promise.resolve({ hits: [{ index: 42 }], total: 1, truncated: false,
        session: { id: 'mvs_displayed', generation: 1 } }) });
  };
  netCtx.runSearch('retry me');
  await settle();
  check('an answer about the selected slice does not install its hit set',
    [...netCtx.state.searchHits], [1]);
  check('and it says the answer was about another body',
    netCtx.state.searchError, 'session_mismatch');

  // The other direction, because a check that rejects every answer is not a check. The page
  // follows the runtime to another conversation, and the answer about THAT conversation is
  // the one that belongs to the body on screen now.
  netCtx.state.payload = { session: { id: 'mvs_displayed_b', generation: null } };
  netCtx.state.generation = null;
  asked.length = 0;
  netCtx.fetch = (url) => {
    asked.push(String(url));
    return Promise.resolve({ ok: true, status: 200,
      json: () => Promise.resolve({ hits: [{ index: 5, v: 'version-five' }], total: 1, truncated: false,
        session: { id: 'mvs_displayed_b', generation: null } }) });
  };
  netCtx.runSearch('retry me');
  await settle();
  check('the answer about the conversation the page moved to is installed',
    [...netCtx.state.searchHits], [5]);
  check('and there is no failure, because this time there is an answer',
    netCtx.state.searchError, null);
  check('and the request asked about the conversation on screen at that moment',
    /[?&]session=mvs_displayed_b(&|$)/.test(asked[0]), true);

  /* The version. A hit is a POSITION, and the same position in two bodies can be two different
   * records: a transcript rewritten under the page leaves the indexes alone and changes the
   * records behind them. The session and the slice say WHICH BODY the answer is about; they say
   * nothing about whether the record at a given index is still the same record.
   *
   * So an answer about the rewritten body would light up a row whose text does not contain the
   * needle at all — the page would be saying 「命中 1 条」 about a row that does not match. The
   * version on the hit and the version on the body have to agree before a hit may filter
   * anything. */
  const beforeVersion = [...netCtx.state.searchHits];
  netCtx.state.payload = { session: { id: 'mvs_displayed', generation: null } };
  netCtx.state.generation = null;
  netCtx.state.searchRefresh = 0;
  netCtx.state.searchRefreshFor = '';
  netCtx.refreshes = 0;
  asked.length = 0;
  netCtx.fetch = (url) => {
    asked.push(String(url));
    return Promise.resolve({ ok: true, status: 200,
      json: () => Promise.resolve({ hits: [{ index: 7, v: 'a-newer-version' }], total: 1, truncated: false,
        session: { id: 'mvs_displayed', generation: null } }) });
  };
  netCtx.runSearch('retry me');
  await settle(24);
  check('a search answer for a newer body cannot filter the displayed older body',
    [...netCtx.state.searchHits], beforeVersion);
  check('and the page asks again against the body it fetches, a bounded number of times',
    netCtx.refreshes, 2);
  check('and then it says the answer does not apply to what is on screen',
    netCtx.state.searchError, 'search_version_mismatch');
  check('and the label shows the failure rather than a count it cannot stand behind',
    netCtx.searchStatusLabel(netCtx.state), '搜索失败，以下为上次结果');

  // A hit about a record this body does not have — the session grew after the body was built.
  // It cannot be shown, so it is not counted either: the number the reader sees has to be the
  // number of rows that are lit up.
  netCtx.state.searchRefresh = 0;
  netCtx.state.searchRefreshFor = '';
  netCtx.refreshes = 0;
  netCtx.fetch = (url) => {
    asked.push(String(url));
    return Promise.resolve({ ok: true, status: 200,
      json: () => Promise.resolve({
        hits: [{ index: 7, v: 'version-seven' }, { index: 4242, v: 'a-record-not-on-screen' }],
        total: 2, truncated: false,
        session: { id: 'mvs_displayed', generation: null } }) });
  };
  netCtx.runSearch('retry me');
  await settle();
  check('a hit about a record that is not on screen is not installed',
    [...netCtx.state.searchHits], [7]);
  check('and the count is the number of rows that are lit up',
    netCtx.state.searchTotal, 1);
  check('and no failure is reported, because that answer did apply',
    netCtx.state.searchError, null);
  check('and the page did not go chasing a body it did not need to',
    netCtx.refreshes, 0);

  /* WHICH SET the answer is about.
   *
   * A search answer is about a SET of records: it says 「these match and the rest do not」, and
   * the part that matters to the reader is the part it does NOT name. So the request has to say
   * which set — how many records the page has, and a fingerprint of their versions — and the
   * service has to answer only if it searched THAT set. Without it, an answer about another body
   * dims a record the reader can see, and says nothing about it.
   */
  check('the search names how many records the body on screen has',
    /[?&]n=3(&|$)/.test(asked[0]), true);
  check('and a fingerprint of their versions',
    /[?&]fp=[0-9a-f]{16}(&|$)/.test(asked[0]), true);
  check('and the page folds a set of records into the same answer the service does',
    netCtx.recordSetFingerprint(['version-one', 'version-five', 'version-seven']),
    recordSetFingerprint(['version-one', 'version-five', 'version-seven']));
  check('and a set that is not the same is not the same answer',
    netCtx.recordSetFingerprint(['version-one', 'version-five'])
      === netCtx.recordSetFingerprint(['version-one', 'version-seven']), false);
  check('and the count is appended, so the request still names the session first',
    /[?&]session=mvs_displayed(&|$)/.test(asked[0]), true);

  // The service refuses: the body it searched is not the body on screen. That is the same thing a
  // hit with the wrong version says, and it has to be answered the same way — the answer is not
  // installed, the body is fetched once more, and the same question is put again against it.
  const beforeRefusal = [...netCtx.state.searchHits];
  netCtx.state.searchRefresh = 0;
  netCtx.state.searchRefreshFor = '';
  netCtx.refreshes = 0;
  asked.length = 0;
  netCtx.fetch = (url) => {
    asked.push(String(url));
    return Promise.resolve({ ok: false, status: 409,
      json: () => Promise.resolve({ error: 'search_version_mismatch', message: 'x' }) });
  };
  netCtx.runSearch('retry me');
  await settle(24);
  check('an answer the service refuses is not installed',
    [...netCtx.state.searchHits], beforeRefusal);
  check('and the page asks again against a body it fetches, a bounded number of times',
    netCtx.refreshes, 2);
  check('and then it says the answer does not apply to what is on screen',
    netCtx.state.searchError, 'search_version_mismatch');
  check('and the label shows the failure rather than a count it cannot stand behind',
    netCtx.searchStatusLabel(netCtx.state), '搜索失败，以下为上次结果');
}

/* The answer has to be about the records that are ON SCREEN — and a body can change without
 * changing its shape.
 *
 * The change detector is a cheap one, on purpose: it compares structural counters, because
 * rebuilding 200+ rows every 2.5s is wasteful when nothing changed. But a record's TEXT can be
 * rewritten under the page while every one of those counters stays the same — the same message
 * count, the same turn count, the same timestamps, the same usage. The body on screen is then a
 * different SET of records, and the answer standing on screen is about the old ones: the reader
 * is told 「命中 1 条」 about a row that does not contain the needle, and nothing anywhere says
 * so.
 *
 * The request side already knows this — it names the set it is asking about, and the service
 * refuses a search about another set. But a refusal only happens if a REQUEST is made, and here
 * none is: the answer is not re-asked, it is simply left standing.
 *
 * So this runs the real `applyPayload` with a body that was rewritten in place, and asks what
 * the page does about it. */
{
  const applyCtx = { console, AbortController, setTimeout, clearTimeout, encodeURIComponent };
  vm.createContext(applyCtx);
  const needed = ['function isCount(value)', 'function signatureOf(payload)', 'function flattenTurns(turns)',
    'function payloadCursor(payload)', 'function deltaMatchesNumbering(previous, delta)',
    'function recordSetFingerprint(versions)', 'function displayedRecordVersions()',
    'function displayedRecordSet(versions)', 'function displayedSessionParam()',
    'function displayedGeneration()', 'function applyPayload(body, manual)'];
  const sources = needed.map((sig) => fnSource(sig));
  check('the shipped functions the answer-set rule needs are all still findable by signature',
    needed.filter((sig, i) => !sources[i]), []);
  vm.runInContext([
    'var turnById = new Map();',
    'var state = { payload: null, flat: [], signature: "", loading: false, hardError: null,',
    '  since: null, sinceFor: null, etag: "", etagFor: "", query: "", searchSet: "" };',
    // The re-ask is what is under test, so it is recorded rather than performed — and the set is
    // recorded the way the shipped `runSearch` records it, because the page keeps answering
    // about the set it last asked about.
    'var asked = [];',
    'function runSearch(needle) { asked.push(String(needle)); state.searchSet = displayedRecordSet(); }',
    // The page paints itself; none of that is what is under test and none of it has a DOM here.
    'function render() {}',
    'function announce() {}',
    'function noteFresh() {}',
    'function rePinWindow() {}',
    ...sources.map((src, i) => src || (needed[i] + ' { throw new Error(' + JSON.stringify(needed[i])
      + ' is not in index.html any more); }')),
  ].join('\n'), applyCtx);

  // One record, and the body that holds it. The SHAPE is the same in every one of these bodies:
  // the same session, the same counters, the same turn, the same one record. Only the record's own
  // version token moves — and that is exactly what a rewrite in place looks like from here.
  const bodyWith = (version, stats) => ({
    session: { id: 'mvs_displayed', generation: null },
    stats: Object.assign({ messages: 1, toolCalls: 0, errors: 0, durationMs: 1000,
      tokens: { totalTokens: 10 } }, stats || {}),
    turns: [{ id: 'turn-1', records: [{ index: 1, v: version, summary: 'ALPHA BODY' }] }]
  });

  // The body on screen, and a question that was answered for it.
  const alpha = bodyWith('the-version-of-alpha');
  applyCtx.state.payload = alpha;
  applyCtx.state.flat = applyCtx.flattenTurns(alpha.turns);
  applyCtx.state.signature = applyCtx.signatureOf(alpha);
  applyCtx.state.query = 'alpha';
  applyCtx.state.searchSet = applyCtx.displayedRecordSet();
  applyCtx.asked.length = 0;

  // The same body again: nothing moved, so the question is not put again.
  applyCtx.applyPayload(bodyWith('the-version-of-alpha'), false);
  check('a body that did not change does not put the question again', applyCtx.asked, []);

  // The record's text is rewritten in place. Every counter is the same; only the record's own
  // version token is different, so the body on screen is a different SET of records.
  applyCtx.applyPayload(bodyWith('the-version-of-charlie'), false);
  check('a content-only payload change retires the previous search answer',
    applyCtx.asked, ['alpha']);

  // And it is retired once, not on every poll afterwards.
  applyCtx.asked.length = 0;
  applyCtx.applyPayload(bodyWith('the-version-of-charlie'), false);
  check('and the question is not put again on every poll after that',
    applyCtx.asked, []);

  // The rule that was already there: a body whose SHAPE changed puts the question again, even
  // when its records are the same ones. A change of counters is a change of body, and the answer
  // on screen was computed against the old one.
  applyCtx.asked.length = 0;
  applyCtx.applyPayload(bodyWith('the-version-of-charlie', { durationMs: 2000 }), false);
  check('a payload that changed re-runs the search rather than filtering by the old answer',
    applyCtx.asked, ['alpha']);
}

/* handoff: the session the record came from, across a navigation.
 *
 * The handoff reads two things asynchronously — the record's raw message and its four bulk
 * fields — and the page can be showing another conversation by the time they answer. The text
 * that goes to the Host NAMES the session, so a session read at the END of the reads would put
 * one conversation's name on another conversation's message: the reader would be told which
 * conversation they are looking at, and told wrong.
 *
 * This runs the shipped `handoffSelected` over a deferred raw read and moves the page while
 * that read is in flight, which is the only moment the two can differ. */
{
  const handoffSources = {
    handoff: fnSource('function handoffSelected()'),
    selected: fnSource('function selectedRecord()'),
    bridge: fnSource('function hostBridge()'),
  };
  check('the shipped handoff functions are all still findable by signature',
    Object.keys(handoffSources).filter((key) => !handoffSources[key]), []);

  if (handoffSources.handoff && handoffSources.selected && handoffSources.bridge) {
    const handoffCtx = { console, setTimeout, clearTimeout };
    vm.createContext(handoffCtx);
    // The page's own pure helpers, so the markdown is the shipped one and not a copy of it.
    vm.runInContext(block, handoffCtx);
    const appended = [];
    // The Host bridge, so `hostBridge()` finds a message sink without being stubbed away.
    handoffCtx.window = { mcode: { miniapp: { message: { append: (text) => { appended.push(text); } } } } };
    handoffCtx.dom = { handoffBtn: { disabled: false }, inspectorStatus: { textContent: '' } };
    handoffCtx.state = {
      selectedId: 'rec-1',
      flat: [{
        id: 'rec-1',
        record: { id: 'rec-1', index: 1, kind: 'user', role: 'user', timestamp: 1791600000000 },
        turn: { id: 't1', index: 3 },
      }],
      // The conversation the selected record belongs to.
      payload: { session: { id: 'mvs_a', label: 'A 会话' } },
    };
    let releaseRaw = null;
    handoffCtx.rawSourceFor = () => new Promise((resolve) => { releaseRaw = resolve; });
    handoffCtx.fetchDetail = () => Promise.resolve(null);
    handoffCtx.inspectorSay = () => {};
    handoffCtx.stripVolatile = (record) => record;
    vm.runInContext(
      handoffSources.handoff + '\n' + handoffSources.selected + '\n' + handoffSources.bridge,
      handoffCtx,
    );

    handoffCtx.handoffSelected();
    // The page moves to another conversation while the record's raw read is still in flight.
    handoffCtx.state.payload = { session: { id: 'mvs_b', label: 'B 会话' } };
    if (releaseRaw) releaseRaw({ raw: '{"kind":"user"}', omitted: false });
    for (let i = 0; i < 5; i += 1) await new Promise((done) => setImmediate(done));

    check('the handoff names the session the selected record came from',
      appended.length === 1 && appended[0].includes('mvs_a'), true);
    check('and not the conversation the page moved to while the read was pending',
      appended.length === 1 && appended[0].includes('mvs_b'), false);
  }
}

/* flatten + signature */
check('flatten empty', sandbox.flattenTurns(undefined), []);
check('flatten junk', sandbox.flattenTurns([{ id: 'a' }, null, { id: 'b', records: [null, { id: 'r' }] }]).length, 1);
check('signature empty', sandbox.signatureOf(null), 'empty');
const payload = {
  session: { id: 'mvs_1' },
  stats: { messages: 5, toolCalls: 2, errors: 0, durationMs: 100, tokens: { totalTokens: 9 } },
  turns: [{ id: 't1', index: 1, records: [{ id: 'r1', kind: 'user' }, { id: 'r2', kind: 'narration' }] }]
};
const sigA = sandbox.signatureOf(payload);
check('signature stable', sigA, sandbox.signatureOf(JSON.parse(JSON.stringify(payload))));
payload.stats.messages = 6;
assert('signature changes with counts', sigA !== sandbox.signatureOf(payload));

/* handoff markdown */
const turn = { id: 't1', index: 3 };
// No `error` field any more: it was the same string as `result`, set only when `isError` was already
// true, and it no longer rides along on the row at all. The message comes from the record-detail
// read and is passed in, so the fixture passes it in too.
const failing = {
  kind: 'toolCall', index: 42, toolName: 'read', toolCallId: 'call_bb89',
  timestamp: 1791603931971, relativeMs: 887, durationMs: null, isError: true,
  model: 'MiniMax-M3.1-Flash-Preview', provider: 'minimax',
  api: 'anthropic-messages', stopReason: 'toolUse', textTruncated: true,
  tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15 },
  arguments: { path: 'a.txt' }
};
const ERROR_TEXT = 'boom <b>x</b>';
const raw = sandbox.truncateJson({ blob: 'x'.repeat(20000) }, sandbox.HANDOFF_RAW_LIMIT);
check('truncateJson caps at 8000', raw.text.length, 8000);
check('truncateJson flags', raw.truncated, true);
check('truncateJson small', sandbox.truncateJson({ a: 1 }, 8000).truncated, false);
// 「原文过大」 is not a field on the record any more: it arrives with the /raw answer, because
// deciding it meant serializing every message in the session on every poll (see
// tests/verify-raw-lazy.mjs).
// The markdown therefore takes the verdict as its own argument, and this asserts that a
// caller who passes it still gets the line — and that one who does not, gets silence.
const md = sandbox.buildHandoffMarkdown({ id: 'mvs_1', label: '测试会话' }, turn, failing, raw.text, raw.truncated, true, ERROR_TEXT);
const mdWithoutVerdict = sandbox.buildHandoffMarkdown({ id: 'mvs_1', label: '测试会话' }, turn, failing, raw.text, raw.truncated, undefined, ERROR_TEXT);
assert('md omits the flag when no verdict was passed', !mdWithoutVerdict.includes('原文过大已被省略'));
assert('md locates turn', md.includes('第 3 轮'));
assert('md locates record', md.includes('#42'));
assert('md names kind', md.includes('工具调用'));
assert('md marks failure', md.includes('状态：失败') && md.includes(ERROR_TEXT));
// The detail read is allowed to fail on its own so the report still goes out. Saying so beats a
// line reading 「失败」 with nothing after it, which reads as "the tool said nothing".
const mdWithoutError = sandbox.buildHandoffMarkdown({ id: 'mvs_1', label: '测试会话' }, turn, failing, raw.text, raw.truncated, true);
assert('md still reports the failure when the error text did not arrive', mdWithoutError.includes('状态：失败'));
assert('and says the text is missing rather than printing an empty value', mdWithoutError.includes('（错误信息未能读取）'));
assert('md renders null duration as dash', md.includes('耗时：—'));
assert('md notes truncation', md.includes('已截断到 8000 字符'));
assert('md notes flags', md.includes('原文过大已被省略') && md.includes('正文已被上游截断'));
assert('md reports limit constant', sandbox.HANDOFF_RAW_LIMIT === 8000);

/* a compaction must read as 压缩 in the handoff text too, not 系统 */
const compaction = {
  kind: 'compaction', title: 'compaction', index: 1, role: 'compactionSummary',
  tokensBefore: 367401, summary: '## Goal ...'
};
const mdCompaction = sandbox.buildHandoffMarkdown(
  { id: 'mvs_1', label: '测试会话' },
  { id: 't0', index: 1 },
  compaction,
  '{"kind":"compactionSummary"}',
  false
);
assert('md names a compaction 压缩', mdCompaction.includes('· 压缩'));
assert('md never calls a compaction 系统', !mdCompaction.includes('· 系统'));

/* large-session fixture: 3,000 records / 40 turns, plus null-heavy rows */
const turns = [];
let n = 0;
for (let t = 0; t < 40; t += 1) {
  const records = [];
  for (let r = 0; r < 75; r += 1) {
    n += 1;
    records.push({
      index: n, id: 'msg-' + n, turnId: 't' + t,
      kind: sandbox.KIND_ORDER[n % 6],
      timestamp: 1791603931971 + n, relativeMs: n * 37,
      title: 'read', summary: n % 11 === 0 ? XSS : '第 ' + n + ' 条 ' + 'x'.repeat(80),
      text: n % 7 === 0 ? YAMLED() : null,
      thinking: n % 5 === 0 ? { text: 'thinking ' + n } : null,
      arguments: n % 3 === 0 ? { path: 'p' + n } : null,
      result: n % 4 === 0 ? null : { ok: true, out: 'y'.repeat(400) },
      error: n % 13 === 0 ? 'boom' : null,
      isError: n % 13 === 0,
      durationMs: n % 17 === 0 ? null : n % 900,
      tokens: n % 6 === 0 ? null : { input: n, output: n, cacheRead: 0, cacheWrite: 0, totalTokens: n * 2 },
      raw: n % 8 === 0 ? { big: 'z'.repeat(2000) } : null,
      rawOmitted: n % 9 === 0, textTruncated: n % 12 === 0
    });
  }
  turns.push({ id: 't' + t, index: t + 1, toolCalls: 12, errors: t % 4 === 0 ? 1 : 0, durationMs: t % 6 === 0 ? null : 12000, tokens: { input: 10, output: 5, cacheRead: 2, cacheWrite: 0, totalTokens: 17 }, records });
}
function YAMLED() { return XSS; }
const big = { session: { id: 'mvs_big', truncated: true }, stats: { messages: n, turns: 40, durationMs: 900000, tokens: { totalTokens: 30000 } }, turns };

const t0 = process.hrtime.bigint();
const flat = sandbox.flattenTurns(big.turns);
let matched = 0;
for (const entry of flat) if (sandbox.matchesQuery(entry.record, 'x')) matched += 1;
for (const entry of flat) sandbox.escapeHtml(sandbox.safeText(entry.record.summary));
const t1 = process.hrtime.bigint();
const elapsedMs = Number(t1 - t0) / 1e6;

check('large fixture record count', flat.length, 3000);
assert('large fixture search matches', matched > 0);
assert('large fixture pipeline under 800ms (' + elapsedMs.toFixed(1) + 'ms)', elapsedMs < 800);
assert('page window stays at 200 of 3000', Math.min(200, flat.length) === 200);
check('window slicing keeps newest', flat.slice(flat.length - 200)[0].record.id, flat[flat.length - 200].record.id);
assert('signature on large fixture stable', sandbox.signatureOf(big) === sandbox.signatureOf(big));

/* ---------- 3) static policy checks on the delivered file ---------- */
// An unterminated CSS comment silently swallows every rule after it, and the page
// still renders — just unstyled. Compare the rule set with comments stripped so a
// swallowed block fails here instead of showing up as a strange-looking button.
const styleBlock = (html.match(/<style>([\s\S]*?)<\/style>/) || ['', ''])[1];
const styleNoComments = styleBlock.replace(/\/\*[\s\S]*?\*\//g, '');
const opensBeforeCloses = (styleBlock.match(/\/\*/g) || []).length - (styleBlock.match(/\*\//g) || []).length;
assert('style block has balanced /* */ comments', opensBeforeCloses === 0);
for (const selector of ['.tbtn', '.tbtn-icon', '.overview-plot', '.ov-span', '.window-bar', '.turn-head']) {
  assert('css rule survives comment stripping: ' + selector, styleNoComments.includes(selector + ' {') || styleNoComments.includes(selector + ','));
}

// The generation banner describes a context the reader chose out of a lineage. Whether that
// generation is still growing is the difference between a promise and a description, and the
// picker can pin the LIVE one — so promising immutability for whichever generation was picked is
// the wrong sentence half the time. The wording is only reachable through the DOM, so it is
// checked here against the delivered file rather than through the sandbox.
assert('the generation banner names both states, not just the sealed one',
  html.includes('当时封存的快照') && html.includes('仍在随后续对话更新'));
assert('...and reads which one applies from the active generation',
  /var live = [^;]*session\.activeGeneration === shown;/.test(html));

// 「全部上下文共 N 条」 is the comparison the reader is there for. Taking it from the generation
// on screen leaves the sentence true and useless, so it has to read the session total — which is
// the logical message count, not the rows the catalog counted per file.
const statsAllBody = fnSource('function statsAll()') || '';
assert('the whole-context count reads the session total', statsAllBody.includes('stats.messagesAll'));

/* ---------- the row key, and the one place selection is per message ---------- */
// One message can expand into several rows. Anything that has to name ONE row has to use the
// row's own key; selection is the deliberate exception, and that exception is the feature.
const keySrc = fnSource('function recordKey(record)') || '';
assert('the row key prefers the row index over the message id',
  /isCount\(record\.index\)\)\s*return String\(record\.index\)/.test(keySrc));
const rowSrc = fnSource('function buildRow(entry, rail)') || '';
assert('a ledger row is keyed by its own row, not by its message',
  /setAttribute\('data-row-id', recordKey\(record\)\)/.test(rowSrc));
assert('...while clicking a row still selects the message it belongs to',
  /selectRecord\(record\.id\)/.test(rowSrc) && /aria-current/.test(rowSrc));
assert('the scroll anchor reads that key back out of the DOM',
  /querySelector\('\[data-row-id="'/.test(html));

// The overview had one id doing two jobs. A hover needs the row's key to mark one span; a click
// needs the message's id. Returning the key forced both onto one number.
const spanSrc = fnSource('function overviewModel(entries)') || '';
assert('an overview span is keyed by its row, not by its message', /id: recordKey\(record\)/.test(spanSrc));
const selSrc = fnSource('function recordInSelection(record, selection, spansById)') || '';
assert('the time brush looks a span up by the row key too',
  /spansById\.get\(recordKey\(record\)\)/.test(selSrc));
const spanAtSrc = fnSource('function spanAt(clientX, clientY)') || '';
// The hit test has to hand back a SPAN. It used to read the record id off the DOM node under the
// pointer, and that is what forced click and hover onto one number; it now resolves through the
// model instead, which returns the span. Asserting the *shape* of the answer rather than the line
// that produced it is what lets the resolution move without the requirement moving with it.
//
// This is NOT the whole property, and the two rejections below are not an exhaustive account of it.
// They catch the two spellings that have actually shipped here — resolving through the DOM, and
// returning `.record.id` directly — and a second acceptance review found a third that walks past
// both: `recordKey(hit.record)` and `hit.id` both return a key, keep the model resolution, and read
// clean. Enumerating return values as syntax does not terminate. `verify-overview.mjs` owns the
// property itself: it runs `spanAt` and asks what came back, because every key-returning shape
// answers a string and a span is not one.
assert('the hit test returns the span, so click and hover stop sharing one number',
  /nearestSpanAt\(/.test(spanAtSrc)
  && !/getAttribute\('data-record-id'\)/.test(spanAtSrc)
  && !/\.record\.(id|index)\b/.test(spanAtSrc));
const nearestSrc = fnSource('function nearestSpanAt(time, lane)') || '';
assert('...and so does the nearest-span lookup', /best = span;/.test(nearestSrc) && !/best = span\.id;/.test(nearestSrc));
const pointerUp = fnSource('function onOverviewPointerUp(event)') || '';
assert('clicking a span selects the message, not the row',
  /selectRecord\(span\.record\.id\)/.test(pointerUp) && /selectRecord\(nearest\.record\.id\)/.test(pointerUp));
assert('hovering a span marks only that span',
  /var id = hovered \? hovered\.id : null;/.test(html));

// turnSubNode is the one presenter of the line under 对话轮次. It used to have a dead
// sibling: turnContextSuffix() built the same string, had no caller outside this file, and
// these two checks ran against it. That was the wrong subject — a check that exercises a
// presenter nothing renders passes while the rendered line is broken, which is the very defect
// the checks exist to catch.
//
// So they run turnSubNode now, and really run it: `el` and `document.createTextNode` are
// stubbed below and the rendered text is read back off the tree. Reading its source with a
// regex is the pattern two checks further down, and it is weaker — the invariant is about the
// characters the reader receives, not about a substring surviving an edit.
function fnSource(signature) {
  const m = html.match(new RegExp(signature.replace(/[()]/g, '\\$&') + ' \\{[\\s\\S]*?\\n {6}\\}'));
  return m ? m[0] : null;
}
function stubNode(tag, text) {
  return {
    tag,
    textContent: text === undefined || text === null ? '' : String(text),
    className: '',
    children: [],
    setAttribute: () => {},
    addEventListener: () => {},
    appendChild(n) { this.children.push(n); return n; }
  };
}
function textOf(node) {
  return node.children.length ? node.children.map(textOf).join('') : node.textContent;
}
function liftTurnFns() {
  // The stubs go in before the lift: turnSubNode reads state and KIND_LABELS at render time
  // and builds its tree through el() and document.createTextNode(), none of which the PURE
  // sandbox has. Installing them after would leave the lift failing for a reason that has
  // nothing to do with what is under test.
  sandbox.el = (tag, className, text) => {
    const n = stubNode(tag, text);
    if (className) n.className = className;
    return n;
  };
  sandbox.document = { createTextNode: (t) => stubNode('#text', t) };
  sandbox.state = { kinds: ['steer', 'compaction'] };
  sandbox.KIND_LABELS = { steer: '追加', compaction: '压缩' };
  sandbox.onKindToggle = () => {};
  for (const name of [
    'function turnContextParts(stats)',
    'function turnBreakdown(stats)',
    'function turnSubNode(stats)'
  ]) {
    const src = fnSource(name);
    if (!src) return false;
    vm.runInContext(src, sandbox);
  }
  return true;
}

// The viewport checks read the code, not the prose around it. Stripping comments first is not
// leniency — it is the difference between a rule about CSS and a rule about text: a comment that
// explains *why* 100vh is banned used to fail this check, so documenting the reason was the one
// way guaranteed to break it, and the incentive was to leave the reason unwritten.
//
// Line comments are removed by whole line rather than by scanning for `//`, because `//` inside
// a string literal is a URL in this page and a naive scan would delete the rest of the line with
// it — turning a pass into a fail for an unrelated rule.
const codeOnly = html
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');

/* ------------------------------------------------------------------ session picker: the two picks */
// A session that the runtime spawned from another one used to be listed exactly like a top-level
// conversation, because nothing in the list said otherwise: the parent column existed in the store
// and was never read, and the one field that did reach the page (`sessionKind`) had no reader in
// it at all. A reader comparing two entries could not tell a sub-agent run from a conversation.
//
// The observation still stands: `sessionKind` is sent and still has no reader. What the reader now
// gets instead is `sessionTag` — the token the service derives from the row's purpose and kind —
// and it is the one the page draws. The raw kind column is still on the wire and still unread.
//
// How a run is told apart is now WHICH CONTROL it is in, not what its label says: the conversation
// pick holds conversations, and the run pick holds the runs of the conversation that was picked.
// The label says nothing about it — one fact, one signal — and the signal is the control itself.
const labelSrc = fnSource('function sessionOptionLabel(session, now)');
if (!labelSrc) {
  failures.push('session picker: could not lift sessionOptionLabel');
} else {
  vm.runInContext(labelSrc, sandbox);
  const NOW = 1_800_000_000_000;
  const base = { label: '一个会话', lastActiveAt: NOW - 60_000, messageCount: 42 };
  const plain = sandbox.sessionOptionLabel({ ...base }, NOW);
  const run = sandbox.sessionOptionLabel({ ...base, sessionParentId: 'mvs_parent' }, NOW);

  // The label does not say it — the control does. A version that put the mark back into the
  // label would say it twice, and a version that dropped it without moving the row would say it
  // not at all.
  assert('a run is not marked in its label',
    run === plain);
  assert('and a conversation is not marked either',
    plain.indexOf('子会话') < 0);
  // An empty parent id is "no parent", not "a parent named the empty string".
  assert('an empty parent id is not a parent',
    sandbox.sessionOptionLabel({ ...base, sessionParentId: '' }, NOW) === plain);
}

/* ------------------------------------------------------------------ session picker: kind badge */
// The other half of the same defect: a cron run, a background task and a lightweight exchange were
// listed exactly like the reader's own conversations, because the service read the runtime
// database's `purpose` column not at all — so it had no way to tell them apart, and a row that
// looked like a conversation was presented as one.
//
// The badge is driven by a token the service derived, never by the raw purpose: that value is free
// text and can carry anything a person typed into it, so publishing it would hand the reader's
// browser somebody else's words. The token set is closed, and a token this page does not know
// about produces no badge rather than one this page invented.
//
// Same discipline as the layer check above, and for the same reason: the failure worth catching
// is not a typo in the string, it is the badge being applied to everything or to nothing, and both
// of those still contain the right characters.
const tagBadge = sandbox.sessionTagBadge;
assert('the badge helper is in the pure block, so a label can be built without a DOM',
  typeof tagBadge === 'function');
if (typeof tagBadge === 'function') {
  check('a lightweight session is badged 轻量', tagBadge('lightweight'), ' · 轻量');
  check('a scheduled session is badged 定时', tagBadge('scheduled'), ' · 定时');
  check('a background task is badged 任务', tagBadge('task'), ' · 任务');
  check('no kind at all is no badge', tagBadge(null), '');
  check('an empty token is no badge', tagBadge(''), '');
  check('a token this page does not know is no badge', tagBadge('something-else'), '');

  const NOW = 1_800_000_000_000;
  const base = { label: '一个会话', lastActiveAt: NOW - 60_000, messageCount: 42 };
  const plain = sandbox.sessionOptionLabel({ ...base }, NOW);
  const light = sandbox.sessionOptionLabel({ ...base, sessionTag: 'lightweight' }, NOW);

  assert('a lightweight session is badged in the picker', light.indexOf('轻量') >= 0);
  assert('a scheduled session is badged in the picker',
    sandbox.sessionOptionLabel({ ...base, sessionTag: 'scheduled' }, NOW).indexOf('定时') >= 0);
  assert('a background task is badged in the picker',
    sandbox.sessionOptionLabel({ ...base, sessionTag: 'task' }, NOW).indexOf('任务') >= 0);
  // The three "no badge" cases, which are three different ways of saying the same thing.
  assert('a session with no kind of its own carries no badge',
    sandbox.sessionOptionLabel({ ...base, sessionTag: null }, NOW) === plain);
  assert('an empty token carries no badge',
    sandbox.sessionOptionLabel({ ...base, sessionTag: '' }, NOW) === plain);
  assert('a row with no kind field at all carries no badge',
    sandbox.sessionOptionLabel({ ...base }, NOW) === plain);
  // Identity, not shape: the only thing that differs between these two inputs is the field, so
  // the only thing allowed to differ between the two labels is the badge.
  assert('the badge is driven by the field, not by where the row sits in the list',
    light.replace(' · 轻量', '') === plain);
  assert('and nothing else about the label changes with it',
    light.length === plain.length + ' · 轻量'.length);
  // Where the badge sits inside the label: the name first, then the times and the count, then
  // what the session IS. Moved to the front, the row still carries the right characters in the
  // right places — every check that asks 「does the row say 轻量」 passes — and the row now reads
  // as a category with a name attached to it.
  assert('the badge comes after the name, not in front of it',
    light.indexOf(' · 轻量') > light.indexOf(base.label),
    JSON.stringify(light));
  // Both facts at once: the kind says what the session IS, and the parent says where it came
  // from. The kind is in the label; the parent is in the position, so the label carries the kind
  // and no longer says 「子会话」 in words — one fact, one signal.
  const both = sandbox.sessionOptionLabel({ ...base, sessionTag: 'lightweight', sessionParentId: 'mvs_parent' }, NOW);
  assert('a row with both a kind and a parent still shows the kind',
    both.indexOf(' · 轻量') >= 0);
  assert('and no longer claims to be a branch in words — where it sits says that',
    both.indexOf('子会话') < 0,
    both);
}

const checks = [
  ['no remote http(s) resource', !/<(script|link|img|iframe)[^>]+(src|href)=["']https?:/i.test(html)],
  ['no @import', !/@import/.test(html)],
  ['no emoji', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(html)],
  ['no gradient', !/gradient\(/i.test(codeOnly)],
  ['no backdrop-filter glass', !/backdrop-filter/.test(codeOnly)],
  // 100vh is not the reader's viewport inside a host iframe, which is why every offset on this
  // page is measured instead. Checked against the CSS, and the fallback side of that: the dock
  // heights are allowed to be vh only as fallbacks, because the shipped values are written from
  // window.innerHeight by applyInspectorDock().
  ['no fixed h-screen', !/h-screen|100vh/.test(codeOnly)],
  ['has --mcode-* tokens', (html.match(/--mcode-/g) || []).length > 40],
  ['no --dsw-* leakage', !/--dsw-/.test(html)],
  ['no remote font family names', !/JetBrains|Inter['"]?\s*,|@font-face/.test(html)],
  // This used to be `(html.match(/\.innerHTML/g) || []).length === 2` — a count wearing a
  // property's name. It failed the moment a third legitimate `jsonColorize` call was added, and
  // it would have passed just as happily if one of the two had been deleted and the other turned
  // into an injection. The property is the rule: every one of them writes through jsonColorize,
  // and only onto a <pre>.
  ['innerHTML only on pre via jsonColorize',
    [...html.matchAll(/([A-Za-z_$][\w$]*)\.innerHTML\s*=\s*([^;\n]*)/g)]
      .length > 0
    && [...html.matchAll(/([A-Za-z_$][\w$]*)\.innerHTML\s*=\s*([^;\n]*)/g)]
      .every((m) => m[1] === 'pre' && /jsonColorize\(/.test(m[2]))],
  ['lang zh-CN', /<html lang="zh-CN">/.test(html)],
  ['title 会话轨迹', /<title>会话轨迹<\/title>/.test(html)],
  ['AbortController used', /new AbortController\(\)/.test(html)],
  ['no alert/confirm', !/\b(alert|confirm|prompt)\s*\(/.test(html)],
  // The rule is "no session data in browser storage", not "never touch the storage
  // API". The Duration button persists one boolean view preference, exactly as the
  // reference implementation does, so the check looks at what is actually written
  // rather than at whether the word localStorage appears anywhere.
  ['no localStorage of domain data', (() => {
    const allowed = /window\.localStorage\.(?:get|set)Item\(\s*DURATION_PREF_KEY\s*,?\s*(?:'true'\s*\|\s*'false'|value\s*\?\s*'true'\s*:\s*'false')?\s*\)/g;
    const stripped = html.replace(allowed, '');
    return !/localStorage|sessionStorage/.test(stripped);
  })()],
  ['duration preference stores only true/false', /DURATION_PREF_KEY = 'mmc-trajectory\.duration'/.test(html) && !/localStorage\.setItem\([^)]*state\./.test(html)],
  ['reduced motion honored', /prefers-reduced-motion: reduce/.test(html)],
  ['role=alert present', /role="alert"/.test(html)],
  ['role=status present', (html.match(/role="status"/g) || []).length >= 3],
  ['semantic header/main/section/footer/nav/form', ['<header', '<main', '<section', '<footer', '<nav', '<form'].every((tag) => html.includes(tag))],
  ['semantic table rendered (static or via createElement)', html.includes('<table') || html.includes("el('table'")],
  ['session poll interval 2500ms, declared as the list\'s own cadence', /\bSESSION_POLL_INTERVAL = 2500\b/.test(html) && !/\bPOLL_INTERVAL = /.test(html)],
  ['trajectory poll interval 8000ms, slower than the list\'s', /\bTRAJECTORY_POLL_INTERVAL = 8000\b/.test(html)],
  // Two ticks, not one. The single `POLL_INTERVAL` this replaced cannot come back as a substring
  // of either name — `SESSION_POLL_INTERVAL` contains `POLL_INTERVAL`, so an assertion written
  // against the old bare name passes against either constant and means nothing.
  ['no single shared poll interval is left behind', !/\bPOLL_INTERVAL\b/.test(html.replace(/SESSION_POLL_INTERVAL|TRAJECTORY_POLL_INTERVAL/g, ''))],
  ['handoff raw limit 8000', /HANDOFF_RAW_LIMIT = 8000/.test(html)],
  ['all 6 append error codes handled', ['user_cancelled', 'invalid_request', 'text_too_large', 'not_allowed', 'target_unavailable', 'result_unknown'].every((c) => html.includes(c))],
  // The type chips are the one filter. A second row of layer buttons was removed because a
  // preset the reader can outgrow ends up contradicting the chips it was meant to summarise;
  // these assertions are here so a future "simplify" or "restore" does not quietly bring
  // it back, and so nobody re-adds a parallel copy of state.kinds.
  ['no layer buttons in the markup', !/turns-btn|thinking-btn|calls-btn/.test(html)],
  ['no layer machinery in the script', !/LAYER_KINDS|LAYER_ORDER|layerSelected|layerPartial|applyLayerToKinds|setLayerButton|dom\.turnsBtn|dom\.thinkingBtn|dom\.callsBtn/.test(html)],
  // Every kind the server can emit has to be reachable as a control. A kind with no control
// is a kind the reader cannot keep or drop on its own — which is exactly what compaction
// was while it sat inside `system`. The list is written out rather than derived from the
// markup so that adding a kind without one fails here instead of quietly shipping.
// Derived from KIND_ORDER rather than written out, so adding a kind cannot leave this list
// behind. It was hardcoded once and went stale the moment `steer` landed — the guard fired
// correctly, but only because a human had to notice.
['every kind has a control',
  sandbox.KIND_ORDER.every((k) => html.includes('data-kind="' + k + '"'))],
['every kind has exactly one control', (() => {
  // A count alone is not enough: renaming one control to another kind keeps the count at
  // 9 while leaving a kind unreachable and another listed twice. Compare the multiset.
  // Written out on purpose rather than derived from KIND_ORDER — deriving it would make
  // this compare the markup against itself and pass for any set of controls at all.
  const found = [...html.matchAll(/class="tbtn tbtn-action" data-kind="([^"]+)"/g)].map((m) => m[1]);
  const expected = ['user', 'steer', 'reply', 'narration', 'thinking', 'toolCall', 'toolResult', 'system', 'compaction'];
  return found.length === expected.length
    && expected.every((k) => found.filter((f) => f === k).length === 1);
})()],
['compaction is not filed under system', !/kind:\s*'system',\s*\n\s*title:\s*'compaction'/.test(readFileSync(SERVER, 'utf8'))],
// Every kind button's visible word has to be the one in KIND_LABELS. The two used to be
// written independently — the label in the markup, the accessible name in applyKindButton —
// so renaming a kind half-applied: the button showed 问答 while announcing 答复. Neither
// copy was wrong on its own and no other assertion could see the disagreement.
['kind button labels match KIND_LABELS', (() => {
  const buttons = [...html.matchAll(
    /data-kind="(\w+)"[\s\S]{0,200}?class="tbtn-label">([^<]*)</g)];
  if (buttons.length !== sandbox.KIND_ORDER.length) return false;
  return sandbox.KIND_ORDER.every((k) => {
    const hit = buttons.filter((b) => b[1] === k);
    return hit.length === 1 && hit[0][2] === sandbox.KIND_LABELS[k];
  });
})()],
['every kind button has a label span', (html.match(/class="tbtn-label"/g) || []).length === sandbox.KIND_ORDER.length],
  // The window bar used to be rebuilt on every render, and a render happens every poll, so
  // a click landing between the clear and the re-append went to a button that was no
  // longer in the document. It is built once into its own container now; a rebuild is a
  // regression of that, not a stylistic choice.
  ['window bar is updated, not rebuilt', /windowBarParts = buildWindowBarParts\(\)/.test(html) && !/ledger\.appendChild\(buildWindowBar/.test(html)],
  ['window bar container is static markup', /<div class="window-bar" id="window-bar"/.test(html)],
  ['the axis button is built with the window bar, not hardcoded in the page', !/id="duration-btn"/.test(html) && /var axis = el\('button', 'tbtn tbtn-toggle window-bar-axis'\)/.test(html)],
  ['the axis button is applied by a helper, not by two callers', /function applyAxisButton\(button\)/.test(html) && !/function renderViewControls/.test(html)],
  // One filter means one writer per control and no parallel copy. Four controls assign
  // state.kinds — the per-kind buttons, 全部, 清除筛选, and 异常's own reset, which has to put
  // the axis back because in that mode the axis filters nothing and must not go on displaying a
  // condition that is not in force. A fifth would be another path deciding what is on screen,
  // which is what this check exists to catch; if one is ever genuinely wanted, change the check
  // in the same commit that adds the control rather than loosening it silently.
  //
  // 清除筛选 reaches the field by *delegating* to resetBaseFilters() rather than through a
  // fourth assignment, so counting assignments alone would report a control gone missing the
  // moment two paths share one writer. The delegation is counted in its place. Both halves are
  // checked because either alone is satisfiable by the wrong thing: three assignments with no
  // delegation is three controls, and a delegation that never happens is one.
  ['state.kinds is written from exactly four controls', (() => {
    const direct = (html.match(/state\.kinds\s*=[^=]/g) || []).length;
    const delegated = /function clearFilters\(\)\s*\{\s*resetBaseFilters\(\);/.test(html);
    return direct === 3 && delegated;
  })()],
  // That the fourth writer also updates the buttons is checked by verify-anomaly.mjs, not here:
  // it is a property of 异常, and it needs a mutation control that mutate-anomaly.py can run.
  // The breakdown is the only place the turn count explains itself, and its whole job is that
  // the parts add up to the headline and that the first two add up to the reply count. Those
  // were comments until a probe showed them wrong: the line used to read 已收尾 54 · 提问待答 5
  // · 中断 4 while the comment claimed 已收尾 and the reply count were the same number. They
  // were 54 and 59, because a turn that stops to ask gets its answer in the NEXT turn. The
  // function is lifted out of the page and run against synthetic stats so the arithmetic is
  // checked, not assumed.
  ['turn breakdown parts sum to the headline', (() => {
  const src = html.match(/function turnBreakdown\(stats\) \{[\s\S]*?\n {6}\}/);
  if (!src) return false;
  vm.runInContext(src[0], sandbox);
  const cases = [
    { turnsWithPrompt: 63, qaTurns: 5, openTurns: 9 },
    { turnsWithPrompt: 0, qaTurns: 0, openTurns: 0 },
    { turnsWithPrompt: 10, qaTurns: 0, openTurns: 0 },
    { turnsWithPrompt: 10, qaTurns: 3, openTurns: 3 },
    { turnsWithPrompt: 1, qaTurns: 1, openTurns: 1 },
  ];
  return cases.every((stats) => {
    const line = sandbox.turnBreakdown(stats);
    const nums = [...line.matchAll(/(\d[\d,]*)/g)].map((m) => Number(m[1].replace(/,/g, '')));
    // Every number printed must be one of the three parts, and the parts must total the headline.
    const sum = nums.reduce((a, n) => a + n, 0);
    return sum === stats.turnsWithPrompt;
  });
})()],
  // Scoped to the rendered label, not the whole file: the doc comment above turnSubNode
  // explains why 续作答答 was renamed and has to be able to say so.
  ['turn breakdown renders 提问轮, not 提问待答',
    /'提问轮 ' \+ formatInt\(asked\)/.test(html) && !/'提问待答 ' \+ formatInt/.test(html) && !/'续作答答 ' \+ formatInt/.test(html)],
  // The line under 对话轮次 is one string of `·`-separated parts, and a reader adds up what
  // they see. The breakdown group sums to the headline; the context group does not belong to
  // it. Shipping them unmarked is what made two disjoint fives (the turns that asked, and the
  // prompt-less turns that answered) read as one number counted twice. The boundary word is
  // the fix, so assert it is there rather than asserting the reader will notice.
['context group is marked as a separate population', (() => {
  if (!liftTurnFns()) return false;
  const line = textOf(sandbox.turnSubNode({ steers: 15, compactions: 10, continuationTurns: 5 }));
  // The boundary is the separator FOLLOWED by 另有. The leading `·` is what joins this group
  // to the breakdown and must stay — an earlier version of this guard asserted it was absent,
  // which was wrong: without it the two groups run together, which is the original defect.
  return /·\s*另有\s/.test(line);
})()],
  // And the whole rendered line, as the reader receives it, still partitions correctly once
  // the context group is set aside: the numbers before 另有 sum to the headline.
  ['numbers before 另有 sum to the headline', (() => {
  const line = textOf(sandbox.turnSubNode({ turnsWithPrompt: 63, qaTurns: 5, openTurns: 9,
    steers: 15, compactions: 10, continuationTurns: 5 }));
  const before = line.split('另有')[0];
  const nums = [...before.matchAll(/(\d[\d,]*)/g)].map((m) => Number(m[1].replace(/,/g, '')));
  return nums.reduce((a, n) => a + n, 0) === 63;
})()],
  // The two record-counting terms on the KPI line are the kind chips spelled inline. If they
  // grew their own writer, state.kinds would have a fourth opinion and the number on the card
  // could stop matching what the chip below it is actually showing — the same class of bug as
  // the layer buttons that were deleted earlier. Scoped to this function's own source: an
  // unbounded `[\s\S]*?` also reaches onKindToggle's legitimate assignment further down and
  // reports a violation that is not there.
  ['KPI kind links go through onKindToggle, not a second writer', (() => {
  const src = fnSource('function turnSubNode(stats)');
  if (!src) return false;
  return /onKindToggle\(kind, state\.kinds\.indexOf\(kind\) < 0\)/.test(src)
    && !/state\.kinds\s*=[^=]/.test(src);
})()],
  // ...and they read state at click time. A captured flag goes stale between the poll that
  // re-rendered the card and the click, which shows up as a link whose look and its effect
  // disagree — the exact failure the layer-button era had.
  ['KPI kind links do not close over a rendered flag', (() => {
  const src = fnSource('function turnSubNode(stats)');
  return Boolean(src) && !/onKindToggle\([^)]*,\s*(?:on|true|false)\s*\)/.test(src);
})()],
  // Exactly the two terms that count records become controls. 续作轮 counts turns, as do the
  // three breakdown terms, and a turn outcome is not a record kind — a 收尾 turn holds eight
  // kinds at once, so no kind set can select it. Wiring those up would be a second axis
  // wearing a kind's name.
  ['exactly the record-counting context terms are links', (() => {
  if (!liftTurnFns()) return false;
  const parts = sandbox.turnContextParts({ steers: 15, compactions: 10, compactionTurns: 0, continuationTurns: 5 });
  const linked = parts.filter((p) => p.kind).map((p) => p.kind).sort();
  const unlinked = parts.filter((p) => !p.kind).map((p) => p.label);
  return linked.length === 2
    && linked[0] === 'compaction' && linked[1] === 'steer'
    && unlinked.length === 1 && unlinked[0] === '续作轮'
    // and each linked kind is a real kind with a chip behind it
    && linked.every((k) => sandbox.KIND_ORDER.includes(k));
})()],
  // The fixture above carries `compactionTurns: 0` next to `compactions: 10` on purpose. A
  // checkpoint is filed inside the turn it interrupted, so counting turns reports zero for every
  // session that was ever compacted — which is the one thing the reader most wants to know. This
  // guard fails the moment the term goes back to reading the turn count.
  ['the compaction term counts checkpoints, not checkpoint-turns', (() => {
  if (!liftTurnFns()) return false;
  const parts = sandbox.turnContextParts({ steers: 0, compactions: 12, compactionTurns: 0, continuationTurns: 0 });
  return parts.length === 1
    && parts[0].label === '压缩'
    && parts[0].value === '12'
    && parts[0].kind === 'compaction';
})()],
  // ---------------------------------------------------------------------------------
  // Every field scopedStats WRITES has to be one it DECLARES.
  //
  // scopedStats re-scopes the server's stats to a time range, and it does that by writing its
  // own literal rather than reading the server's. That literal is a second copy of a shape that
  // lives in two processes, and a copy of a shape drifts silently: `steers` was declared on the
  // server (server.mjs `steers: 0`) and not here, while the function still did
  // `stats.steers += 1`. `undefined + 1` is NaN, NaN is sticky, and `isCount()` refuses a
  // non-finite number — so both readers of that field quietly dropped the term, and 「追加 N」
  // vanished from the card the moment a range went on. Nothing threw.
  //
  // It stayed invisible because the guard that compares scopedStats against the server numbers
  // field by field carries a HARDCODED list, and `steers` was not in it. A hardcoded list can
  // only catch the fields someone remembered to write down. This one cannot: it reads the two
  // halves off the function itself, so a field that is written without being declared fails by
  // name whatever it is called.
  // ---------------------------------------------------------------------------------
  ['every stats field scopedStats writes is one it declares', (() => {
    const src = fnSource('function scopedStats()');
    if (!src) return false;
    const literal = src.slice(src.indexOf('var stats = {'), src.indexOf('};', src.indexOf('var stats = {')));
    if (!literal) return false;
    const declared = new Set();
    // `field: 0,` and `field: { ... }` — the two shapes the literal actually uses.
    for (const m of literal.matchAll(/^\s*([A-Za-z_$][\w$]*):/gm)) declared.add(m[1]);
    const written = new Set();
    // `stats.x += 1`, `stats.x = 0`, `stats.x++`, and the nested `stats.tokens.input += 1`:
    // a nested write needs its PARENT declared, which is the root name this captures.
    for (const m of src.matchAll(/\bstats\.([A-Za-z_$][\w$]*)\s*(?==[^=]|\+\+|--|\+=|-=|\*=|\/=|\.\w)/g)) {
      written.add(m[1]);
    }
    // Reads are not writes: `stats.messagesAll` is read from `base` and `stats.tokens` is only
    // ever read as a parent, so neither has to be a counter. What must hold is the other
    // direction — nothing may be written that the literal does not declare.
    return [...written].every((field) => declared.has(field));
  })()],
  // The explanation has to exist on the card, be reachable without a mouse, and be named by
  // aria-describedby rather than only by a `title` (which is invisible to touch and to most
  // assistive tech once the hover is gone).
  ['turn card carries an accessible explanation', (() => {
  if (!/function turnTipLines\(stats\)/.test(html)) return false;
  if (!/turnSubNode\(stats\),\s*\n\s*false,\s*\n\s*'kpi-tip-turns',\s*\n\s*turnTipLines\(stats\)/.test(html)) return false;
  return /card\.setAttribute\('aria-describedby', tipId\)/.test(html)
    && /tipNode\.setAttribute\('role', 'tooltip'\)/.test(html)
    && /card\.classList\.add\('has-tip'\)/.test(html)
    && /card\.setAttribute\('tabindex', '0'\)/.test(html);
})()],
  // Every term on the line has to be explained, or the tooltip is decoration. The breakdown's
  // three terms, both linked context terms, and the unlinked one.
  ['the tip explains every term on the line', (() => {
  const src = fnSource('function turnTipLines(stats)');
  if (!src) return false;
  return ['收尾 ', '提问轮 ', '中断 ', '追加与压缩', '续作轮'].every((term) => src.includes(term));
})()],
  // 总数与序号不能共用一个词，而且总数旁边必须说出窗口实际覆盖的范围。The panel title printed
  // stats.turns (every turn in the file) as 「轮次 82」 and a turn header printed turn.index as
  // 「轮次 78」 — same two characters, two different quantities, which coincided while the
  // newest turn had a row. That left a second, steadier trap: with a 200-record window the
  // table can start at 第 81 轮 under a title saying 共 83 轮, because the window begins
  // mid-session. Both numbers were right and nothing said so, so it read as a wrong total.
  // 「共 N 轮」 can only be a total; 「第 N 轮」 can only be an ordinal; and the title must
  // carry the visible range whenever the window does not cover the whole session.
  ['panel title reads a total, turn headers read an ordinal', (() => {
  const head = /var title = '第 ' \+ \(isCount\(turn\.index\) \? turn\.index : DASH\) \+ ' 轮';/;
  if (!head.test(html)) return false;
  return !/'轮次 ' \+ \(isCount\((?:turn|group\.turn)\.index\)/.test(html)
    && !/'轮次 ' \+ turnIndex/.test(html)
    && !/\? '轮次 ' \+ turn\.index : DASH/.test(html);
})()],
  // The panel title must describe the table and nothing else. It used to lead with
  // 「共 84 轮」 — the session total — above a table whose first header read 第 82 轮, because
  // the default window holds only the newest 200 records and turn 82 alone holds 183 of them.
  // Both numbers were true and nothing said so, so the pair read as a contradiction, and the
  // natural expectation ("these should be equal, equal to 84") could not be satisfied by any
  // wording. The fix is not a better word: it is to stop putting two different scopes in the
  // same spot. The title is now the rendered range; the session total moved to the window bar,
  // next to the record counts it explains.
  ['panel title states only the rendered turn range', (() => {
  const src = fnSource('function turnRangeLabel(firstTurn, lastTurn)');
  if (!src) return false;
  if (/共 /.test(src)) return false;                       // no session total in the title
  if (!/'第 ' \+ formatInt\(firstTurn\) \+ '–' \+ formatInt\(lastTurn\) \+ ' 轮'/.test(src)) return false;
  return /'第 ' \+ formatInt\(firstTurn\) \+ ' 轮'/.test(src);
})()],
  ['the session total lives on the window bar instead', (() => {
  const src = fnSource('function updateWindowBar(shown, hiddenAbove, total)');
  if (!src) return false;
  if (!/var sessionTurns = state\.payload && state\.payload\.stats \? state\.payload\.stats\.turns : null;/.test(src)) return false;
  // Both readings of the count have to name it, not one of them. The bar shows 已显示 … once a
  // window is settled and 正在显示 N / M … while a batched build is still running, and the two are
  // separate statements rather than one text with a suffix. A mid-build line that quietly dropped
  // the session total would leave the reader, mid-scroll through 18,924 rows, without the one
  // number saying how much of the session is left — so each branch is pinned on its own, with its
  // own indentation, rather than "the string appears somewhere in this function".
  // The anchor carries `matchedLabel` because the settled line inserts the filter result between
  // 共 N 条 and 已显示 — the two pairs a reader can add. Both branches still have to name the
  // session total on their own; pinning each with its own indentation is what keeps "the string
  // appears somewhere in this function" from passing when only one of them has it.
  const branches = [
    "          (isCount(sessionTurns) ? '全场 ' + formatInt(sessionTurns) + ' 轮 · ' : '') +\n"
      + "          '共 ' + formatInt(total) + ' 条' + matchedLabel + ' · 已显示 '",
    "            (isCount(sessionTurns) ? '全场 ' + formatInt(sessionTurns) + ' 轮 · ' : '') +\n"
      + "            '共 ' + formatInt(total) + ' 条 · 正在显示 '"
  ];
  return branches.every((branch) => src.indexOf(branch) >= 0);
})()],
  ['the title is written after the groups are built', (() => {
  // If it is set before `visibleTurns`, the range is not knowable and the label silently
  // degrades — the exact defect, back again.
  const at = html.indexOf('dom.ledgerMeta.textContent = turnRangeLabel');
  const groupsAt = html.indexOf('var groups = visibleTurns(windowed)');
  return at > 0 && groupsAt > 0 && at > groupsAt;
})()],
  // The window opens on the newest page, and the button names the ACTION rather than the state.
  //
  // It briefly opened on 全部, on the theory that a page hiding 8,000 records behind a click
  // makes a poor first impression. Measured on this session that froze the page: ~9,900 rows
  // and ~57,000 real DOM elements with no virtual scrolling, rebuilt every 2.5s poll — a
  // single inspect took 13.7s. So 全部 is opt-in.
  //
  // The label went the other way twice and is now settled: it names what pressing the button
  // will do. The count beside it already reports the current state, so a label restating the
  // state spends its width saying nothing — at the default it read 只看最新 200 条 directly
  // above 已显示 200 条. Action and report answer different questions and cannot contradict.
  ['the window opens on the newest page, and the button names the action', (() => {
  if (!/allRecords: false,/.test(html)) return false;
  if (!/limit: PAGE_STEP,/.test(html)) return false;
  if (!/var DEFAULT_WINDOW_MODE = 'latest';/.test(html)) return false;
  const src = fnSource('function applyWindowMode(parts, hiddenAbove)');
  if (!src) return false;
  // Arms opposite to the count: allRecords true -> offer the page, false -> offer everything.
  if (!/state\.allRecords \? '显示最新 ' \+ formatInt\(PAGE_STEP\) \+ ' 条' : '显示全部'/.test(src)) return false;
  // aria-pressed stays on the state, which is why the accessible name repeats it.
  if (!/'aria-pressed', state\.allRecords \? 'true' : 'false'/.test(src)) return false;
  if (!/classList\.toggle\('btn-quiet', state\.allRecords\)/.test(src)) return false;
  return /state\.allRecords \? '正在显示全部记录 · 点击改为只显示最新 ' \+ formatInt\(PAGE_STEP\) \+ ' 条'/.test(src);
})()],
  // One definition of the default, quoted by every reset. Eight call sites used to hard-code
  // 'latest', so changing the default left all eight resetting to a window that may no longer
  // be the default — a reader whose view was reset by any filter click would land somewhere
  // nobody chose. The constant's value is checked by the guard above; this one checks only
  // that the resets quote it rather than repeating it.
  ['every window reset quotes the default, not a literal', (() => {
  if (!/var DEFAULT_WINDOW_MODE = '(?:latest|all)'/.test(html)) return false;
  const reset = fnSource('function resetWindowMode()');
  if (!reset || !/setWindowMode\(DEFAULT_WINDOW_MODE\)/.test(reset)) return false;
  // A reset must not read the window it is resetting; that preserves the value being discarded.
  if (/state\.allRecords/.test(reset)) return false;
  // No reset may name a mode literally. The only legitimate caller that reads state is the
  // mode button, which *toggles* rather than resets — so the test is "does any call pass
  // a literal", not "does any call avoid DEFAULT".
  const resets = html.match(/setWindowMode\('(latest|all)'\);/g) || [];
  if (resets.length) return false;
  // One direct setWindowMode call: the toggle in buildWindowBarParts. Everything else goes
  // through the helper. The \b matters — resetWindowMode contains the substring setWindowMode,
  // and without it every reset counts as a direct call and the guard can never pass.
  //
  // The window-reset inventory moved by one because the search answer now arrives from the server:
  // the moment it does, the table holds a different set of records, and that is a filter change
  // like any other. It used to be twelve because the page filtered its own records synchronously,
  // so there was never a moment at which the answer changed.
  const direct = (html.match(/\bsetWindowMode\((?!mode\)|DEFAULT_WINDOW_MODE)/g) || []).length;
  return direct === 1 && (html.match(/resetWindowMode\(\);/g) || []).length === 13;
})()],
  // The search half is asynchronous now, so the four rules below have no pure function to hang on
  // and are read out of the source instead. Each of them is a way the page can render something
  // plausible and wrong: a stale answer on screen, an answer that empties the table while it is
  // still out, a filter left applied after the reader cleared it, and a slice search answered about
  // the whole lineage.
  ['the search request in flight is aborted when a newer one starts', (() => {
    const src = fnSource('function runSearch(needle)');
    if (!src) return false;
    if (!/if \(searchController\) searchController\.abort\(\);/.test(src)) return false;
    return /var controller = new AbortController\(\);/.test(src) && /signal: controller\.signal/.test(src);
  })()],
  ['only the newest search answer is allowed to write', (() => {
    const src = fnSource('function runSearch(needle)');
    if (!src) return false;
    // One guard on the way in is not enough: the catch must be gated too, or a FAILED older
    // request can put its error on top of a newer request's answer.
    const gates = src.match(/if \(seq !== searchSeq\) return;/g) || [];
    return gates.length === 2 && /var seq = \(searchSeq \+= 1\);/.test(src);
  })()],
  ['clearing the filters drops the answer with them', (() => {
    const src = fnSource('function resetBaseFilters()');
    if (!src) return false;
    return /state\.searchHits = null;/.test(src) && /state\.searchError = null;/.test(src);
  })()],
  ['a search is asked about the slice the body on screen is', (() => {
    const src = fnSource('function runSearch(needle)');
    if (!src) return false;
    return /'\/api\/trajectory\/search\?session='/.test(src)
      && /&generation=' \+ encodeURIComponent\(String\(generation\)\)/.test(src)
      // The slice the reader PICKED is a different question, and the page has to ask the one
      // that belongs to the body it is showing.
      && !/String\(state\.generation\)/.test(src);
  })()],
  // Clicking the window button must not move the page. It scrolled to the document tail
  // whenever it narrowed the window, on the theory that "back to the tail" should land on the
  // newest record. The reader clicked a control they were already looking at, so the jump threw
  // away whatever they had been reading; renderLedger's row anchor is the correct behaviour.
  ['the window button does not scroll the page', (() => {
  const src = fnSource('function buildWindowBarParts()');
  if (!src) return false;
  const click = src.slice(src.indexOf('var mode = el('));
  if (!click) return false;
  // No scroll call inside the mode button's own handler.
  return !/window\.scroll(To|By)/.test(click)
    && /setWindowMode\(state\.allRecords \? 'latest' : 'all'\);\s*\n\s*renderLedger\(\);/.test(click);
})()],
  // `.btn` sets display:inline-flex, which outranks the user-agent [hidden] rule. So a `.btn`
  // toggled off with .hidden stayed on screen — and 「向上加载更早的 N 条」 only wrote its label
  // when it was showing, so on load it rendered as a bordered empty box between the axis toggle
  // and the window button. Six other classes in this file already carry the patch; `.btn` was
  // the one that was missed, and it is patched on the class rather than on the instance.
  ['a .btn toggled with hidden is actually hidden', (() => {
  // No space before the attribute selector: the rule reads `.btn[hidden]`, not `.btn [hidden]`.
  // The brackets are escaped — unescaped, [hidden] is a character class and this can never
  // match anything.
  if (!/\n      \.btn\[hidden\] \{\n        display: none;\n      \}/.test(html)) return false;
  // And the button that exposed it must not be blank even when hidden.
  const mode = fnSource('function applyWindowMode(parts, hiddenAbove)');
  if (!mode) return false;
  return /parts\.more\.textContent = '向上加载更早的 ' \+ formatInt\(Math\.min\(PAGE_STEP, Math\.max\(hiddenAbove, 0\)\)\) \+ ' 条';/.test(mode)
    && !/if \(hiddenAbove > 0\) \{\s*\n\s*parts\.more\.textContent/.test(mode);
})()],
  // 「向上加载更早的 N 条」 is meaningless in 全部: state.limit is Infinity, and Infinity + 200
  // is still Infinity, so the click would re-render and change nothing. Hidden in that mode, but
  // the guard keeps "it is hidden" from being the only thing standing between a reader and a
  // dead button.
  ['the load-more button does nothing in 全部 instead of pretending to', (() => {
  const src = fnSource('function buildWindowBarParts()');
  if (!src) return false;
  const more = src.slice(src.indexOf('var more = el('), src.indexOf('var mode = el('));
  if (!more) return false;
  return /if \(state\.allRecords\) return;/.test(more)
    && /state\.limit \+= PAGE_STEP;/.test(more);
})()],
  // `limit` above PAGE_STEP means the reader pressed 向上加载更早的 N 条. A poll that resets it
  // takes that back silently, so the button re-renders and appears to do nothing — which is
  // what it did: this session grows fast enough that the count looked unchanged either way.
  // Only a limit that is still exactly PAGE_STEP is tail-following, and only that re-pins.
  ['a poll does not undo a window the reader widened', (() => {
  const src = fnSource('function rePinWindow()');
  if (!src) return false;
  if (!/if \(state\.allRecords\) return state\.limit;/.test(src)) return false;
  return /if \(state\.limit > PAGE_STEP\) return state\.limit;/.test(src);
})()],
  // A checkpoint is drawn as a band, not as a row. It has to be routed there in the one place
  // the ledger builds its list — routing it anywhere else would leave the row grid laying it out
  // like ordinary work while the CSS sits unused.
  //
  // That place is fillGroupRows(), which the build calls: the rows of a group are built by the
  // build and by the observer that fills a group the reader scrolls to, and a second copy of the
  // loop would be two definitions of what a row is. Both halves are checked — a routing rule in a
  // function the ledger does not call is a rule about nothing.
  ['a compaction record renders as a band, not as a row', (() => {
  if (!/function buildCompactionBand\(entry\)/.test(html)) return false;
  const fill = fnSource('function fillGroupRows(list, group)');
  if (!fill) return false;
  const render = fnSource('function renderLedger()');
  if (!render) return false;
  // The test and the branch it decides have to be one thing.
  //
  // Checking that the word 'compaction' appears in the function is not the same as checking
  // that a compaction record is rendered as a band: a version that computes the test and then
  // ignores it says the same word and renders the record as a row. That is not a hypothetical
  // — the two were once the same line, and splitting them (the test into a variable, the
  // branch into an `if`) left the old assertion checking a word rather than a decision.
  //
  // So the band branch is taken out of the function and read on its own, and the branch has to
  // be the one the test opens. The row branch is checked too: a version that renders EVERY
  // record as a band has the band branch right and is wrong in the other direction.
  const band = fill.match(/if \(isBand\) \{([\s\S]*?)\n {10}\} else \{/);
  return /var isBand = group\.entries\[j\]\.record\.kind === 'compaction';/.test(fill)
    && !!band
    && /item\.className = 'compaction-cell'/.test(band[1])
    && /item\.appendChild\(buildCompactionBand\(group\.entries\[j\]\)\)/.test(band[1])
    && /item\.appendChild\(buildRow\(group\.entries\[j\], rails\[j\]\)\)/.test(fill)
    && /fillGroupRows\(holds \? list : null, group\)/.test(render);
})()],
  // The band is a real control: it carries the same data-row-id the inspector looks up, so
  // clicking it opens the checkpoint's details rather than doing nothing. The two halves are
  // deliberately different units — the DOM key has to name ONE row for the scroll anchor, and
  // the selection stays on the message — so both are matched.
  ['the compaction band is selectable and states what it is', (() => {
  const src = fnSource('function buildCompactionBand(entry)');
  if (!src) return false;
  return /setAttribute\('data-row-id', recordKey\(record\)\)/.test(src)
    && /selectRecord\(record\.id\)/.test(src)
    // The point of the band is that it says what changed, so the generation and the moment both
    // have to be in it. Neither is decoration. The condition is matched whole: a mutation that
    // hard-codes `opened` still leaves `record.generation` sitting in the branch it no longer
    // reaches, and this has to fail on that.
    && /var opened = isCount\(record\.generation\)/.test(src)
    && /formatOffset\(record\.relativeMs\)/.test(src)
    && /record\.index/.test(src);
})()],
  // `display: inline-flex` on the pills beat the UA `[hidden]` rule once already in this file, so a
  // band that can be hidden needs its own rule rather than trusting the user-agent sheet.
  ['the compaction band has its own styles, using defined tokens only', (() => {
  if (!/\n      \.compaction-band \{/.test(html)) return false;
  const block = html.slice(html.indexOf('\n      .compaction-band {'));
  if (!block) return false;
  const rule = block.slice(0, block.indexOf('\n      }'));
  // Every custom property it names has to be one this file actually defines for both themes.
  const used = [...rule.matchAll(/var\((--mcode-[a-z-]+)\)/g)].map((m) => m[1]);
  const defined = new Set(
    [...html.matchAll(/^\s*(--mcode-[a-z-]+):/gm)].map((m) => m[1])
  );
  return used.length > 0 && used.every((token) => defined.has(token));
})()],
  // ---- the 记录序号 column -------------------------------------------------
  // The first grid track was 42px, which holds `#` plus four digits. A session that
  // passed 10,000 records pushed the fifth digit out of the track, and a grid item is
  // `overflow: visible` by default, so the digit spilled into the kind column and was
  // painted over by the opaque pill: `#10950`..`#10959` all read `#1095`. Ten rows in a
  // row showed the reader one number, and unlike a wrong number that one cannot be
  // checked — it looks exactly like a real index.
  //
  // The requirement below is derived rather than asserted. The old track held five
  // characters and would not hold six, so one character is at most 42 / 5 = 8.4px. A
  // label is `#` plus at most seven digits, so 8 characters need at most 67.2px.
  ['the 序号 column is wide enough for the label it must show', (() => {
    const labelChars = 8;
    const maxCharPx = 42 / 5;
    const required = Math.ceil(labelChars * maxCharPx);
    const hits = [...html.matchAll(/--traj-index-col:\s*(\d+)px/g)];
    // Exactly one declaration: a second one would be a value some of these tracks use
    // and the rest do not, which is the drift this constant exists to prevent.
    if (hits.length !== 1) return false;
    return Number(hits[0][1]) >= required;
  })()],
  ['every grid that renders a 序号 uses the shared column', (() => {
    const rules = [
      ['.row', /\n {6}\.row \{[^}]*?grid-template-columns:\s*([^;]+);/s],
      ['.compaction-band', /\n {6}\.compaction-band \{[^}]*?grid-template-columns:\s*([^;]+);/s],
      ['.skeleton-row', /\n {6}\.skeleton-row \{[^}]*?grid-template-columns:\s*([^;]+);/s],
      // The narrow-screen override is the one that used to shrink this track to 28px.
      ['narrow override', /\n {8}\.row,\n {8}\.skeleton-row \{[^}]*?grid-template-columns:\s*([^;]+);/s]
    ];
    return rules.every(([, pattern]) => {
      const match = pattern.exec(html);
      return !!match && match[1].trim().startsWith('var(--traj-index-col)');
    });
  })()],
  // The 时间区间 pickers must be sized by their own content. A `datetime-local` is laid out by
  // the browser from the localized date it has to draw, so a width in the stylesheet is a guess
  // about something the user agent already knows — and the guess was made twice and wrong both
  // times: 18ch clipped the year off the text box that preceded it, and 20ch clipped the minutes
  // behind the calendar icon on the picker itself. What must not come back is a fixed width, or
  // a flex context that lets the toolbar squeeze the control, which is the same clipping by
  // another route.
  ['the 时间区间 pickers are sized by their content, not by a fixed width', (() => {
    const rule = /\n {6}\.range-input \{([^}]*)\}/.exec(html);
    if (!rule) return false;
    if (/^\s*(min-)?width\s*:/m.test(rule[1])) return false;
    return /flex:\s*none;/.test(rule[1]);
  })()],
  // Exactly one rule: a second one could carry the width this is here to prevent.
  ['and no later rule gives the 时间区间 pickers a width', (() => {
    const rules = [...html.matchAll(/\.range-input[^{]*\{([^}]*)\}/g)];
    return rules.length === 1 && !/^\s*(min-)?width\s*:/m.test(rules[0][1]);
  })()],
  // Containment is what turns a future width regression from a lie into a visible
  // ellipsis. The digit spilling onto the pill is the whole defect: both the missing
  // digit and the number it was hiding are invisible, and the row reads as a
  // different, entirely valid index.
  ['a 序号 that still does not fit is ellipsised, never spilled onto the pill', (() => {
    const start = html.indexOf('\n      .row-index {');
    if (start < 0) return false;
    const rule = html.slice(start, html.indexOf('\n      }', start));
    return /overflow:\s*hidden/.test(rule)
      && /text-overflow:\s*ellipsis/.test(rule)
      && /white-space:\s*nowrap/.test(rule);
  })()],
];
for (const [name, ok] of checks) {
  if (ok) pass += 1;
  else failures.push('policy: ' + name);
}

/* ------------------------------------------------------------------ session picks: the cascade */
// Two controls now. The conversation pick names the conversation; the run pick names the run
// inside it, and holds the runs of the conversation the first pick named. A run used to sit in
// the conversation pick as a peer of the conversations — thirteen of twenty rows on this machine
// were runs of the one conversation being read — and it used to sit there indented under its
// conversation, which made the dropdown forty rows long.
//
// The failures worth catching are not strings that survived an edit: they are a run sitting in
// the conversation pick, a run pick that is empty when it should not be, a run pick that lists
// the runs of the wrong conversation, and a pick that does not switch. So everything below is
// read back out of a rendered picker, not out of its source.
//
// The functions are lifted HERE, before the picker section below, because that section runs
// `renderSessionSelect` too and the picker now asks the same question this section asks: which
// rows are runs, and which control holds them.
const layerFns = [
  'function sessionOptionLabel(session, now)',
  'function childrenByParent()',
  'function ownerSessionId()',
  'function renderSessionSelect()',
  'function renderChildSelect()',
  'function selectSession(id)',
  'function setFollow(enabled)',
  'function onSessionSelectChange()',
  'function onChildSelectChange()'
];
const layerSrc = layerFns.map((name) => fnSource(name));
if (layerSrc.some((src) => !src)) {
  failures.push('session layers: could not lift ' + layerFns.filter((_, i) => !layerSrc[i]).join(', '));
} else {
  // selectSession() drops what the ledger knows about the groups of the session it is leaving, so
  // the two maps it uses have to exist here. They are the page's own, lifted as empty ones: what
  // is under test is which session is chosen, not what the ledger remembers about it.
  sandbox.ledgerState = new Map();
  sandbox.ledgerContent = new Map();
  vm.runInContext(layerSrc.join('\n'), sandbox);
}

// A declaration rather than a const, because the picker section below uses it and this section
// is written after it: a `const` would be in its temporal dead zone there, and the failure would
// read as a broken stub rather than as an ordering mistake.
function stubSelect() {
  const options = [];
  return {
    options,
    selectedIndex: -1,
    _value: '',
    get value() { return this._value; },
    set value(next) {
      this._value = next;
      this.selectedIndex = options.findIndex((option) => option.value === next);
    },
    get firstChild() { return options[0] || null; },
    removeChild(child) {
      const at = options.indexOf(child);
      if (at >= 0) options.splice(at, 1);
      return child;
    },
    appendChild(node) {
      options.push(node);
      if (this.selectedIndex < 0) this.selectedIndex = options.length - 1;
      return node;
    },
    insertBefore(node, reference) {
      const at = reference ? options.indexOf(reference) : -1;
      options.splice(at < 0 ? options.length : at, 0, node);
      return node;
    },
  };
}

/* ------------------------------------------------------------------ session picker: where the pinned row goes */
// The picker can hold a row the server did not send: the session the reader pinned by hand, which
// aged out of the twenty the service returns. The page adds that row itself, and where it puts it
// is a promise about what the reader sees — the service's first row is the conversation the
// runtime database reports as current, and the pinned row is a different thing, so "the current
// conversation is first" does not by itself say where the pinned row lands.
//
// It is checked by RUNNING `renderSessionSelect` against a stub select, not by reading its
// source. A regex over the source would pass for a version that inserted the row in the right
// place for the wrong reason, and would not notice a version that inserted it in the right place
// only when the list happened to be empty. What the reader gets is the order of the options, so
// that is what is read back.
const renderSelectSrc = fnSource('function renderSessionSelect()');
if (!renderSelectSrc) {
  failures.push('session picker: could not lift renderSessionSelect');
} else {
  // A select, as far as this function touches it: the options it holds, the one that is
  // selected, and the two ways a row can be added to it. The browser picks the first option
  // when the list is built and picks by value afterwards, and `insertBefore` puts a row at a
  // position rather than at the end — which is the whole point of the row in question.
  sandbox.el = (tag, className, text) => {
    const node = stubNode(tag, text);
    if (className) node.className = className;
    node.value = '';
    return node;
  };
  sandbox.clear = (node) => { while (node && node.firstChild) node.removeChild(node.firstChild); };
  if (!sandbox.state) sandbox.state = {};
  sandbox.state.sessions = [
    { id: 'mvs_server_first', label: '服务端第一行', lastActiveAt: 1_800_000_000_000, messageCount: 3 },
    { id: 'mvs_server_second', label: '服务端第二行', lastActiveAt: 1_799_999_000_000, messageCount: 4 },
  ];
  sandbox.state.followLatest = false;
  sandbox.state.sessionId = 'mvs_the_pinned_one';
  vm.runInContext(renderSelectSrc, sandbox);

  const select = stubSelect();
  sandbox.dom = { sessionSelect: select };
  sandbox.renderSessionSelect();

  const texts = select.options.map((option) => option.textContent);
  // The row the reader pinned is the one the service did not send, so it is on its own: the
  // first row is 「跟随最新」 and the pinned row is the first of the session rows.
  assert('the row the reader pinned is the first session row, above the rows the service sent',
    texts.length === 4
    && texts[0].indexOf('跟随最新') >= 0
    && texts[1].indexOf('当前会话（不在最近列表）') >= 0
    && select.options[1].value === 'mvs_the_pinned_one',
    texts.join(' | '));
  assert('and the service\'s own first row is still the one right after it',
    select.options[2] && select.options[2].value === 'mvs_server_first',
    texts.join(' | '));
  assert('and the pinned row is the one that ends up selected',
    select.value === 'mvs_the_pinned_one' && select.selectedIndex === 1,
    String(select.value) + ' @ ' + String(select.selectedIndex));

  // And the other direction: a pinned session the service DID send needs no row of its own, or
  // the reader would see the same conversation twice.
  sandbox.state.sessionId = 'mvs_server_second';
  const second = stubSelect();
  sandbox.dom = { sessionSelect: second };
  sandbox.renderSessionSelect();
  assert('a pinned session the service sent is not added a second time',
    second.options.length === 3
    && second.options.every((option, index) => option.value !== 'mvs_the_pinned_one')
    && second.value === 'mvs_server_second',
    second.options.map((option) => option.value).join(' | '));
}

/* ------------------------------------------------------------------ session picks: the cascade */
// The functions were lifted above, before the picker section: the picker asks the same question
// this section asks, so it needs them too.
if (layerSrc.every((src) => src)) {
  const NOW = 1_800_000_000_000;
  const MAIN_A = 'mvs_main_a';
  const MAIN_B = 'mvs_main_b';
  // Thirteen of them, because that is the number this machine actually has: the list is not a
  // window, and a fixture with three rows would not notice one that quietly dropped the tenth.
  const childrenOfA = Array.from({ length: 13 }, (_, i) => ({
    id: 'mvs_child_a' + i,
    sessionParentId: MAIN_A,
    label: '子代理甲 ' + i,
    lastActiveAt: NOW - (i + 1) * 1000,
    messageCount: i + 1
  }));
  const childrenOfB = [{
    id: 'mvs_child_b0', sessionParentId: MAIN_B, label: '子代理乙',
    lastActiveAt: NOW - 3000, messageCount: 5
  }];
  const layerState = {
    sessions: [
      { id: MAIN_A, label: '主会话甲', lastActiveAt: NOW, messageCount: 10 },
      { id: MAIN_B, label: '主会话乙', lastActiveAt: NOW - 60_000, messageCount: 20 }
    ],
    children: childrenOfA.concat(childrenOfB),
    followLatest: true,
    sessionId: MAIN_A,
    hostSessionId: null
  };
  sandbox.state = layerState;
  // The two picks, as two stub selects: the conversation one and the run one.
  const convo = stubSelect();
  const runs = stubSelect();
  sandbox.el = (tag, className, text) => {
    const node = stubNode(tag, text);
    if (className) node.className = className;
    node.value = '';
    return node;
  };
  sandbox.clear = (node) => { while (node && node.firstChild) node.removeChild(node.firstChild); };
  sandbox.dom = {
    sessionSelect: convo,
    childSelect: runs,
    followBtn: { setAttribute: () => {} },
    followState: { textContent: '' }
  };
  sandbox.fetchSessions = () => {};
  sandbox.fetchTrajectory = () => {};
  sandbox.announce = () => {};

  sandbox.renderSessionSelect();
  sandbox.renderChildSelect();

  // 1. While the page follows the newest conversation there is nothing to offer: that list
  //    changes under the reader, and a run picked out of it belongs to a conversation that is no
  //    longer on screen.
  assert('the run pick is empty while the page follows the newest conversation',
    runs.options.length === 1 && runs.options[0].value === '' && runs.value === '',
    runs.options.map((option) => option.value).join(' | '));
  assert('and it is disabled, so there is nothing to pick',
    runs.disabled === true, String(runs.disabled));

  // 2. The conversation pick holds conversations and nothing else. This is the rule the whole
  //    feature exists for: a run must never sit where a conversation sits.
  const convoValues = convo.options.map((option) => option.value);
  assert('the conversation pick holds no run at all',
    !convoValues.some((value) => /^mvs_child_/.test(value)),
    convoValues.join(' | '));
  assert('and it holds every conversation',
    convoValues.length === 3
    && convoValues.indexOf(MAIN_A) === 1
    && convoValues.indexOf(MAIN_B) === 2,
    convoValues.join(' | '));

  // 3. With a conversation picked, the run pick holds its runs — all of them, in the order the
  //    service sent them.
  layerState.followLatest = false;
  layerState.sessionId = MAIN_A;
  sandbox.renderSessionSelect();
  sandbox.renderChildSelect();
  const aIds = childrenOfA.map((child) => child.id);
  const runValues = runs.options.map((option) => option.value);
  assert('the run pick holds every run of the conversation on screen',
    runValues.length === 14, runValues.join(' | '));
  assert('and they keep the order the service sent',
    runValues.slice(1).join(',') === aIds.join(','), runValues.join(' | '));
  assert('and the first option is the conversation itself',
    runValues[0] === '' && (runs.options[0].textContent || '').indexOf('主会话本身') >= 0,
    JSON.stringify(runs.options[0] && runs.options[0].textContent));
  assert('and nothing is picked while no run is picked',
    runs.value === '', String(runs.value));

  // 4. The two picks agree about what is on screen: a run belongs to a conversation, and the
  //    conversation pick says which one. Asked while a RUN is on screen -- asked while a
  //    conversation is on screen it would have the same answer either way, and a guard that
  //    cannot tell the two apart is not a guard.
  layerState.sessionId = 'mvs_child_a5';
  assert('the owner of a run is the conversation it hangs off',
    sandbox.ownerSessionId() === MAIN_A, sandbox.ownerSessionId());
  layerState.sessionId = MAIN_A;

  // 5. Picking a run switches the page to it — that run's own trajectory, since a run is a
  //    session with its own transcript — and leaves the conversation pick on its parent.
  runs.value = 'mvs_child_a5';
  sandbox.onChildSelectChange();
  assert('picking a run switches the page to that run',
    layerState.sessionId === 'mvs_child_a5' && layerState.followLatest === false,
    layerState.sessionId + ' / follow=' + layerState.followLatest);
  sandbox.renderSessionSelect();
  assert('and the conversation pick stays on its parent',
    convo.value === MAIN_A, String(convo.value));

  // 6. And picking the conversation itself returns to the conversation.
  sandbox.renderChildSelect();
  runs.value = '';
  sandbox.onChildSelectChange();
  assert('picking the conversation itself returns to the conversation',
    layerState.sessionId === MAIN_A, String(layerState.sessionId));

  // 7. And picking another conversation moves the run pick with it, and clears the run.
  convo.value = MAIN_B;
  sandbox.onSessionSelectChange();
  sandbox.renderChildSelect();
  assert('picking another conversation moves the run pick with it',
    runs.options.length === 2 && runs.options[1].value === 'mvs_child_b0',
    runs.options.map((option) => option.value).join(' | '));
  assert('and clears the run that was picked',
    runs.value === '', String(runs.value));

  // 8. A parent id is data, not a key the page may assume. The runtime database's parent
  //    column crosses the wire unchanged, and the page groups its runs by that value. The
  //    names a plain object inherits -- '__proto__', 'constructor' -- are truthy and are not
  //    arrays, so a version that groups into a plain object reads one of them as a group and
  //    throws on it, and the picker stops updating after an otherwise successful list.
  const hostile = ['__proto__', 'constructor', 'toString', 'valueOf'];
  const realState = sandbox.state;
  sandbox.state = {
    sessions: [{ id: MAIN_A, label: '主会话甲', lastActiveAt: NOW, messageCount: 10 }],
    children: hostile.map((parentId, index) => ({
      id: 'mvs_hostile_' + index,
      sessionParentId: parentId,
      label: '异常父 ' + index,
      lastActiveAt: NOW - index,
      messageCount: 1
    })),
    followLatest: false,
    sessionId: MAIN_A,
    hostSessionId: null
  };
  let grouped = null;
  let groupingError = null;
  try {
    grouped = sandbox.childrenByParent();
  } catch (error) {
    groupingError = error;
  }
  check('a parent id that names an inherited object property does not break the grouping',
    groupingError === null && grouped !== null, true);
  check('and those runs are not folded into a conversation that owns them',
    grouped !== null
    && Object.keys(grouped).every((key) => hostile.indexOf(key) >= 0)
    && hostile.every((key) => !grouped[key] || grouped[key].length === 1), true);
  let renderError = null;
  try {
    sandbox.renderChildSelect();
  } catch (error) {
    renderError = error;
  }
  check('and the run pick still draws with such a parent on the page', renderError === null, true);
  sandbox.state = realState;
}

/* ------------------------------------------------------------------ session list: overlapping polls */
// The list is polled, and every poll replaces the one before it. Two things have to hold
// while that happens, and both used to be false:
//
//   * a request that has been replaced must not take the next request's controller with it;
//   * an answer that arrives late must not replace a newer list.
//
// The first is what made the second possible: the replaced request cleared the shared
// controller on its way out, so the request that replaced it had nothing to abort, and the
// request before that answered last and won.
//
// So this section drives three overlapping requests against a controllable fetch, and
// reads back what the page ends up showing. It is the transition, not the shape of the
// source: a regex would pass for a version that carries the sequence number and ignores it.

const fetchSessionsSrc = fnSource('function fetchSessions(manual)');
const inflightDecl = /var sessionsInflight = null;/.exec(html);
const seqDecl = /var sessionsSeq = 0;/.exec(html);
if (!fetchSessionsSrc || !inflightDecl || !seqDecl) {
  failures.push('session list: could not lift fetchSessions and the state it keeps');
} else {
  vm.runInContext(inflightDecl[0] + '\n' + seqDecl[0] + '\n' + fetchSessionsSrc, sandbox);

  // A fetch the section drives: every request gets a promise the section settles, and the
  // signal is the real one, so an abort is an abort.
  const requests = [];
  sandbox.fetch = function (url, options) {
    const entry = {
      url: url,
      signal: options && options.signal,
      // The headers the page sent, so a section can ask what the request claimed about the
      // list it already had. A validator is only ever read by the server, so the only way to
      // see whether the page still holds the right one is to look at what it asked with.
      headers: (options && options.headers) || {},
      settle: null,
      fail: null
    };
    entry.promise = new Promise((resolve, reject) => {
      entry.settle = resolve;
      entry.fail = reject;
    });
    requests.push(entry);
    return entry.promise;
  };
  sandbox.AbortController = AbortController;
  sandbox.state = {
    sessions: [], children: [], sessionsEtag: '', sessionsEtagFor: '', sessionsLoaded: false
  };
  sandbox.noteFresh = () => false;
  sandbox.renderBars = () => {};
  sandbox.freshnessReason = () => 'unknown';
  sandbox.renderSessionSelect = () => {};
  sandbox.renderChildSelect = () => {};

  const abortError = () => {
    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    return error;
  };
  const answer = (entry, body, etag) => entry.settle({
    status: 200,
    ok: true,
    headers: { get: (name) => (name === 'etag' ? (etag || '') : '') },
    json: () => Promise.resolve(body)
  });

  // Three requests: the first is replaced by the second, the second is replaced by the
  // third. The second's answer arrives last, and it is the older one.
  const first = sandbox.fetchSessions(false);
  const second = sandbox.fetchSessions(false);
  check('the second request stops the first', requests[0].signal.aborted, true);
  // The browser delivers an abort as a rejection, and that rejection is handled while the
  // second request is already in flight -- which is exactly when the controller used to be
  // cleared.
  requests[0].fail(abortError());
  await first;
  const third = sandbox.fetchSessions(false);
  check('a replaced request does not take the controller of the request that replaced it',
    requests[1].signal.aborted, true);
  answer(requests[2], { sessions: [{ id: 'mvs_new_main' }], children: [{ id: 'mvs_new_run' }] }, '"older"');
  await third;
  answer(requests[1], { sessions: [{ id: 'mvs_old_main' }], children: [{ id: 'mvs_old_run' }] });
  await second;
  check('a late answer does not replace the newer list on screen',
    sandbox.state.sessions.map((row) => row.id), ['mvs_new_main']);
  check('and the run list is the newer one too',
    sandbox.state.children.map((row) => row.id), ['mvs_new_run']);

  // A 304 that arrives late. This is the second case of the same rule, and it is a different
  // case: a 200 carries a body, so a stale one has something visible to overwrite. A 304
  // carries a VALIDATOR instead, so a stale one has nothing to overwrite but the tag that
  // describes the list on screen -- and that tag is what the next poll asks the server with.
  //
  // It used to write that tag before the sequence gate, so the list on screen and the tag that
  // described it were two different things: the next poll asked the server about the old list,
  // the server said "not modified", and the page kept the new one.
  const late = sandbox.fetchSessions(false);
  const lateReplacement = sandbox.fetchSessions(false);
  answer(requests[4], { sessions: [{ id: 'mvs_newest_main' }], children: [] }, '"newest"');
  await lateReplacement;
  check('the newer list is on screen',
    sandbox.state.sessions.map((row) => row.id), ['mvs_newest_main']);
  requests[3].settle({
    status: 304,
    ok: false,
    headers: { get: (name) => (name === 'etag' ? '"older"' : '') }
  });
  await late;
  check('a late 304 does not overwrite the validator the newer answer installed',
    sandbox.state.sessionsEtag, '"newest"');
  check('and the list on screen is still the newer one',
    sandbox.state.sessions.map((row) => row.id), ['mvs_newest_main']);

  // And the poll after it asks the server about the list that is on screen.
  const next = sandbox.fetchSessions(false);
  check('the next request carries the validator of the list on screen',
    requests[5].headers['If-None-Match'], '"newest"');

  // A manual refresh drops the validator on purpose: the reader asked for the list again, so
  // the request must not claim to already have it.
  sandbox.fetchSessions(true);
  check('a manual refresh sends no validator',
    requests[6].headers['If-None-Match'], undefined);
}

// The trajectory poll is the second implementation of the same rule the session list follows,
// and it used to write the validator BEFORE its sequence gate. A 304 that arrived late then
// put its own older tag over the newer one, so the body on screen and the tag that described
// it were two different things: the next poll asked the server about the old body and kept the
// new one on screen.
//
// The counterexample, driven against the shipped function: the page holds A, two polls are in
// flight, the newer one answers first with B and B's tag, and the older one answers with a 304
// carrying A's tag. The old tag must not survive that.
const fetchTrajectorySrc = fnSource('function fetchTrajectory(manual)');
const sessionParamSrc = fnSource('function sessionParam()');
const trajInflightDecl = /var inflight = null;/.exec(html);
const trajSeqDecl = /var refreshSeq = 0;/.exec(html);
if (!fetchTrajectorySrc || !sessionParamSrc || !trajInflightDecl || !trajSeqDecl) {
  failures.push('trajectory poll: could not lift fetchTrajectory and the state it keeps');
} else {
  vm.runInContext(
    trajInflightDecl[0] + '\n' + trajSeqDecl[0] + '\n' + sessionParamSrc + '\n' + fetchTrajectorySrc,
    sandbox
  );

  const trajRequests = [];
  sandbox.fetch = function (url, options) {
    const entry = {
      url: url,
      signal: options && options.signal,
      headers: (options && options.headers) || {},
      settle: null
    };
    entry.promise = new Promise((resolve) => { entry.settle = resolve; });
    trajRequests.push(entry);
    return entry.promise;
  };
  sandbox.AbortController = AbortController;
  sandbox.state = {
    payload: null, generation: null, etag: '', etagFor: '', since: 0, sinceFor: '',
    loading: false, followLatest: true, sessionId: '', hostSessionId: ''
  };
  sandbox.renderLoading = () => {};
  sandbox.noteFresh = () => false;
  sandbox.render = () => {};
  const applied = [];
  sandbox.applyPayload = function (body) { applied.push(body); };

  const trajAnswer = (entry, body, etag) => entry.settle({
    status: 200,
    ok: true,
    headers: { get: (name) => (name === 'etag' ? (etag || '') : '') },
    json: () => Promise.resolve(body)
  });
  const trajNotModified = (entry, etag) => entry.settle({
    status: 304,
    ok: false,
    headers: { get: (name) => (name === 'etag' ? (etag || '') : '') }
  });

  const older = sandbox.fetchTrajectory(false);
  const newer = sandbox.fetchTrajectory(false);
  check('the second poll stops the first', trajRequests[0].signal.aborted, true);
  trajAnswer(trajRequests[1], { session: { id: 'mvs_b' } }, '"tag-b"');
  await newer;
  check('the newer body is the one on screen', applied.map((b) => b.session.id), ['mvs_b']);
  check('and the validator describes it', sandbox.state.etag, '"tag-b"');

  // The older answer arrives late and carries the older tag.
  trajNotModified(trajRequests[0], '"tag-a"');
  await older;
  check('a replaced trajectory request writes no validator', sandbox.state.etag, '"tag-b"');
  check('and it leaves the body on screen alone',
    applied.map((b) => b.session.id), ['mvs_b']);

  // And the poll after it asks the server about the body that is on screen.
  sandbox.fetchTrajectory(false);
  check('the next poll carries the validator of the body on screen',
    trajRequests[2].headers['If-None-Match'], '"tag-b"');

  // The same rule for a late 200: a replaced request must not put its body on screen either.
  const lateOld = sandbox.fetchTrajectory(false);
  const lateNew = sandbox.fetchTrajectory(false);
  trajAnswer(trajRequests[4], { session: { id: 'mvs_c' } }, '"tag-c"');
  await lateNew;
  trajAnswer(trajRequests[3], { session: { id: 'mvs_a' } }, '"tag-a"');
  await lateOld;
  check('a replaced trajectory request writes no body either',
    applied.map((b) => b.session.id), ['mvs_b', 'mvs_c']);
  check('and the validator is still the newer one', sandbox.state.etag, '"tag-c"');
}

// A record index is a position within ONE body, so a read that carries that index has to ask
// about the session that body was built for. The client already says so in its own cache key —
// `rawCacheKey` names the displayed session — but the request used to ask for `latest`, which
// is "whichever session is current now" and not necessarily the one on screen. The runtime can
// make another session current while the page still shows this one, and the page then showed
// that other session's words under this session's record.
const requestRawSrc = fnSource('function requestRaw(index, version)');
const requestDetailSrc = fnSource('function requestDetail(index, version)');
const displayedSessionSrc = fnSource('function displayedSessionParam()');
const displayedGenerationSrc = fnSource('function displayedGeneration()');
const recordVersionOfSrc = fnSource('function recordVersionOf(record)');
const rawCacheKeySrc = fnSource('function rawCacheKey(index, version)');
if (!requestRawSrc || !requestDetailSrc || !displayedSessionSrc || !displayedGenerationSrc
  || !recordVersionOfSrc || !rawCacheKeySrc) {
  failures.push('secondary reads: could not lift requestRaw, requestDetail and the session they ask for');
} else {
  vm.runInContext(displayedSessionSrc + '\n' + displayedGenerationSrc + '\n'
    + recordVersionOfSrc + '\n'
    + requestRawSrc + '\n' + requestDetailSrc + '\n' + rawCacheKeySrc, sandbox);

  const secondary = [];
  sandbox.fetch = function (url) {
    secondary.push(url);
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ raw: 'ALPHA BODY', index: 1, text: 'ALPHA BODY' })
    });
  };
  // The page is following the newest conversation, and it is showing A. The runtime may already
  // have made B current — the page does not know that, and it must not care: A is on screen.
  //
  // `flat` is the body on screen's records. A read that names an index has to name the RECORD
  // behind that index, and the record's version is what says which one it is: the same position
  // in a newer body can be a different record entirely.
  sandbox.state = {
    payload: { session: { id: 'mvs_displayed', generation: null } },
    flat: [{ turn: {}, record: { index: 1, v: 'the-version-of-record-one' } }],
    generation: null, etag: '"tag"', followLatest: true, sessionId: '', hostSessionId: ''
  };
  await sandbox.requestRaw(1, 'the-version-of-record-one');
  await sandbox.requestDetail(1, 'the-version-of-record-one');
  check('a raw read asks for the session on screen',
    /[?&]session=mvs_displayed(&|$)/.test(secondary[0]), true);
  check('and it does not ask for whatever is current now',
    /[?&]session=latest(&|$)/.test(secondary[0]), false);
  check('a detail read asks for the session on screen',
    /[?&]session=mvs_displayed(&|$)/.test(secondary[1]), true);
  check('and it does not ask for whatever is current now',
    /[?&]session=latest(&|$)/.test(secondary[1]), false);
  check('a raw read names the version of the record it is asking for',
    /[?&]v=the-version-of-record-one(&|$)/.test(secondary[0]), true);
  check('and a detail read names it too',
    /[?&]v=the-version-of-record-one(&|$)/.test(secondary[1]), true);

  // The slice on screen is not the generation the reader picked. A selection whose load failed
  // leaves the previous body up, and a read that asks about the selection asks about a body
  // that is not there — its answer is about records the reader cannot see.
  sandbox.state = {
    payload: { session: { id: 'mvs_displayed', generation: 2 } },
    flat: [{ turn: {}, record: { index: 1, v: 'the-version-of-record-one' } }],
    generation: 7, etag: '"tag"', followLatest: true, sessionId: '', hostSessionId: ''
  };
  await sandbox.requestRaw(1, 'the-version-of-record-one');
  await sandbox.requestDetail(1, 'the-version-of-record-one');
  check('a raw read asks for the slice on screen',
    /[?&]generation=2(&|$)/.test(secondary[2]), true);
  check('and not for the one the reader picked',
    /[?&]generation=7(&|$)/.test(secondary[2]), false);
  check('a detail read asks for the slice on screen too',
    /[?&]generation=2(&|$)/.test(secondary[3]), true);
  check('and not for the one the reader picked',
    /[?&]generation=7(&|$)/.test(secondary[3]), false);

  // The browser's own raw cache is keyed the same way, and for the same reason: a record index
  // is a position inside one body, and the body on screen is not always the body the reader last
  // selected. A key built from the selection would serve the previous slice's message under the
  // current slice's record — and the reader would be reading another generation's words.
  check('the raw cache key names the slice on screen',
    sandbox.rawCacheKey(1).includes('#2#'), true);
  check('and not the one the reader picked',
    sandbox.rawCacheKey(1).includes('#7#'), false);
  check('and it still names the session on screen',
    sandbox.rawCacheKey(1).startsWith('mvs_displayed#'), true);

  // With nothing on screen there is no session to name, and the read falls back to the session
  // parameter rather than sending an empty one.
  sandbox.state = { payload: null, generation: null, etag: '', followLatest: true, sessionId: '', hostSessionId: '' };
  await sandbox.requestRaw(1, 'the-version-of-record-one');
  check('with no body on screen the read falls back to the current session',
    /[?&]session=latest(&|$)/.test(secondary[4]), true);
}

/* A read that is retried must ask about the SAME record.
 *
 * The retry exists because the service let go of the session: it reloads the body and asks again.
 * The body it reloads is a DIFFERENT one — the transcript moved while the tab was open — so a
 * version read off the screen at that moment belongs to the NEW body's record at that index, and
 * the retry is a different question wearing the same question's clothes. The service would answer
 * it, because it is a perfectly good question about a perfectly good record: the wrong one.
 *
 * So the version travels with the RECORD the reader opened, and the reload does not change it. */
{
  const fetchRawSrc = fnSource('function fetchRaw(record, retried)');
  const fetchDetailSrc = fnSource('function fetchDetail(record, retried)');
  const requestDetailSrc2 = fnSource('function requestDetail(index, version)');
  const isCountSrc = fnSource('function isCount(value)');
  if (!fetchRawSrc || !fetchDetailSrc || !requestRawSrc || !requestDetailSrc2 || !isCountSrc
    || !recordVersionOfSrc) {
    failures.push('secondary read retry: could not lift fetchRaw, fetchDetail and the requests they make');
  } else {
    vm.runInContext('var rawCache = {};\nvar rawPending = {};\nvar detailCache = {};\nvar detailPending = {};\n'
      + isCountSrc + '\n' + recordVersionOfSrc + '\n'
      + requestRawSrc + '\n' + requestDetailSrc2 + '\n'
      + fetchRawSrc + '\n' + fetchDetailSrc, sandbox);

    const retried = [];
    let attempts = 0;
    sandbox.fetch = function (url) {
      retried.push(String(url));
      attempts += 1;
      if (attempts === 1 || attempts === 3) {
        return Promise.resolve({ ok: false, status: 503,
          json: () => Promise.resolve({ error: 'trajectory_not_cached' }) });
      }
      return Promise.resolve({ ok: true, status: 200,
        json: () => Promise.resolve({ raw: 'ALPHA BODY', index: 1, text: 'ALPHA BODY', omitted: false }) });
    };
    // The reload is what brings the NEW body: the same index, another record. A version read off
    // the screen after this point is the new record's version, and the retry would be asking
    // about it.
    sandbox.fetchTrajectory = function () {
      sandbox.state.flat = [{ turn: {}, record: { index: 1, v: 'a-newer-version' } }];
      return Promise.resolve();
    };
    sandbox.state = {
      payload: { session: { id: 'mvs_displayed', generation: null } },
      flat: [{ turn: {}, record: { index: 1, v: 'the-version-of-record-one' } }],
      generation: null, etag: '"tag"', followLatest: true, sessionId: '', hostSessionId: ''
    };
    const opened = { index: 1, v: 'the-version-of-record-one' };
    await sandbox.fetchRaw(opened);
    await sandbox.fetchDetail(opened);
    check('the first read names the version of the record the reader opened',
      /[?&]v=the-version-of-record-one(&|$)/.test(retried[0] || ''), true);
    check('a read that is retried asks about that same record',
      /[?&]v=the-version-of-record-one(&|$)/.test(retried[1] || ''), true);
    check('and not about the record that happens to be at that index after the reload',
      /[?&]v=a-newer-version(&|$)/.test(retried[1] || ''), false);
    check('and the same for the record\'s fields',
      /[?&]v=the-version-of-record-one(&|$)/.test(retried[2] || ''), true);
    check('a field read that is retried asks about that same record too',
      /[?&]v=the-version-of-record-one(&|$)/.test(retried[3] || ''), true);
    check('and not about the record that happens to be at that index after the reload',
      /[?&]v=a-newer-version(&|$)/.test(retried[3] || ''), false);

    /* The retry must not JOIN another read.
     *
     * The reload brings a body in which the record at that position is a DIFFERENT one, and the
     * panel that rebuilds on it asks for the record now on screen. The read of the record the
     * reader opened is still in flight, and it has to ask about ITS OWN record: the two reads are
     * at the same position, and the key that decides whose answer a caller gets is the only
     * thing that can tell them apart.
     *
     * The key used to be built out of what is on screen — the validator, the slice, the position —
     * so after the reload the retry of the old record and the new record's own read had the SAME
     * key. The retry was then answered with the new record's body without asking anything: the
     * reader opened ALPHA and the page handed back CHARLIE. The version belongs in the key, and
     * it is the caller's version, not the screen's. */
    for (const [readName, what] of [['fetchRaw', 'a retried read'],
      ['fetchDetail', 'a retried field read']]) {
      vm.runInContext('rawCache = {}; rawPending = {}; detailCache = {}; detailPending = {};', sandbox);
      const joined = [];
      sandbox.state = {
        payload: { session: { id: 'mvs_displayed', generation: null } },
        flat: [{ turn: {}, record: { index: 1, v: 'the-version-of-record-one' } }],
        generation: null, etag: '"tag-old"', followLatest: true, sessionId: '', hostSessionId: ''
      };
      sandbox.fetch = function (url) {
        joined.push(String(url));
        // The first attempt is refused because the service let go of the session.
        if (joined.length === 1) {
          return Promise.resolve({ ok: false, status: 503,
            json: () => Promise.resolve({ error: 'trajectory_not_cached' }) });
        }
        // The old record's own request: the service refuses it, because the record at that
        // position is not the one that was asked for.
        if (/[?&]v=the-version-of-record-one(&|$)/.test(joined[joined.length - 1])) {
          return Promise.resolve({ ok: false, status: 409,
            json: () => Promise.resolve({ error: 'raw_stale' }) });
        }
        // The record now on screen, which the rebuild of the panel asks for.
        return Promise.resolve({ ok: true, status: 200,
          json: () => Promise.resolve({ raw: 'CHARLIE BODY longer', index: 1, text: 'CHARLIE BODY longer' }) });
      };
      sandbox.fetchTrajectory = function () {
        // The new body is on screen, with its own validator, and the panel rebuilds on it: that
        // starts a read of the record now at that position.
        sandbox.state.etag = '"tag-new"';
        sandbox.state.flat = [{ turn: {}, record: { index: 1, v: 'the-version-of-record-two' } }];
        sandbox.fetchRaw({ index: 1, v: 'the-version-of-record-two' });
        return Promise.resolve();
      };
      let refused = null;
      let handed = null;
      try {
        handed = await sandbox[readName]({ index: 1, v: 'the-version-of-record-one' });
      } catch (err) {
        refused = err && err.code ? err.code : String(err);
      }
      check(what + ' cannot join a newer record\'s pending read after reload',
        refused, 'raw_stale');
      check(what + ' is not answered with the other record\'s body', handed, null);
      check(what + ' asked about the record the reader opened, on a request of its own',
        joined.filter((u) => /[?&]v=the-version-of-record-one(&|$)/.test(u)).length, 2);
    }
  }
}

console.log('[2] pure helpers: ' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('[3] static policy checks: PASS');
console.log('OK  (large-fixture pipeline ' + elapsedMs.toFixed(1) + 'ms for 3000 records)');
