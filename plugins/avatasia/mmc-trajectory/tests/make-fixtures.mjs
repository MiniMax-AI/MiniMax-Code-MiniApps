// Distil the developer's real ~/.minimax session store into a synthetic fixture tree.
//
//   node tests/make-fixtures.mjs                    report what would be distilled, write nothing
//   node tests/make-fixtures.mjs --record           write tests/fixtures/minimax-home/
//   node tests/make-fixtures.mjs --check            judge the committed fixture (no live store)
//   node tests/make-fixtures.mjs --check --root=DIR judge some other fixture tree
//   node tests/make-fixtures.mjs --checkselftest     prove --check can reject a bad fixture
//   node tests/make-fixtures.mjs --emit-demo-tree=good|leak|hole|drift   write one, print its path
//   node tests/make-fixtures.mjs --selftest         prove the leak gate can catch a leak
//
// The guards must not depend on whoever runs them: a clean CI runner has no ~/.minimax, and
// the two guards that read the real store went red there (13/15). So the store is distilled
// here once, the payload text is replaced, and the structure is committed.
//
// What is preserved is exactly what the assertions look at: roles, content-part types,
// stopReason (the reply/narration split turns on it), toolCallId pairing, usage numbers,
// numeric ranges, and the injection markers splitUserMessage keys off. What is replaced is
// every string payload. No conversation text, path, or identifier from the real machine
// reaches the fixture.
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import * as server from '../miniapp/node/server.mjs';

const { resolveSessionsRoot, collectSessionEntries, readHead, resolveArtifactPath } = server;

const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const OUT_ROOT = join(HERE, 'fixtures', 'minimax-home');
const SESSIONS_WANTED = 8;
const ROWS_PER_SESSION = 60;
const SCAN_BYTES = 8 * 1024 * 1024;
const SCAN_ROWS = 6000;

// Strings that are structural, not payload: dropping them would change what the parser sees.
const KEEP_KEYS = new Set(['type', 'role', 'stopReason', 'finishReason', 'subtype', 'kind', 'sender']);

// Prefixes splitUserMessage() branches on. Losing one would silently stop exercising that branch.
const INJECT_PREFIXES = [
  '<system-reminder>', '<background-task-finished>', '<runaway guard>',
  '<agent-context>', '<async-audit>', '<media-output-reminder>',
];

// Coverage the committed guards require. --record refuses to write unless all of it is present,
// otherwise the fixture would pass CI by accident and fail the moment someone looked.
const NEEDED = {
  userPrompt: (r) => r.role === 'user' && !INJECT_PREFIXES.some((p) => String(r.text || '').startsWith(p)),
  injected: (r) => r.role === 'user' && INJECT_PREFIXES.some((p) => String(r.text || '').startsWith(p)),
  toolCall: (r) => r.role === 'assistant' && r.parts.includes('toolCall'),
  thinking: (r) => r.role === 'assistant' && r.parts.includes('thinking'),
  reply: (r) => r.role === 'assistant' && r.stopReason === 'stop' && r.text,
  narration: (r) => r.role === 'assistant' && r.stopReason === 'toolUse' && r.text,
  toolResult: (r) => r.role === 'toolResult' || r.role === 'tool',
  compaction: (r) => r.role === 'compactionSummary' || r.role === 'compaction',
  // verify-anomaly.mjs asserts the anomaly rules against this payload, which is only meaningful
  // if there is something to find: a reply that delivered nothing, and a tool result that
  // failed. A sample without them makes the guard vacuous.
  // `silent` has to be an assistant message that produced no segment at all -- server.mjs:1094
  // only pushes a text:null reply when segmentOrder is empty. An assistant message that called
  // a tool but said nothing still emits its toolCall record, so it is not a silent reply.
  silent: (r) => r.role === 'assistant' && r.stopReason === 'stop' && !r.text && r.parts.length === 0,
  toolError: (r) => (r.role === 'toolResult' || r.role === 'tool') && r.isError === true,
};

let seq = 0;
const sid = (tag) => `${tag}${(seq++).toString(36).padStart(4, '0')}`;

// A toolCall's id and its toolResult's toolCallId must stay equal: verify-parsers asserts the
// corpus pairs up and that the pair counts agree. Regenerating each occurrence independently
// silently breaks the pairing, so ids are memoised per original value.
const ID_KEYS = new Set(['id', 'toolCallId', 'parentToolCallId']);
const idMap = new Map();
const toolMap = new Map();

function synthString(value, key) {
  if (KEEP_KEYS.has(key)) return value;
  const raw = String(value);
  const prefix = INJECT_PREFIXES.find((p) => raw.startsWith(p));
  if (prefix) return `${prefix}\nfixture ${sid('injected-')} block`;
  if (ID_KEYS.has(key) && raw) {
    if (!idMap.has(raw)) idMap.set(raw, `call_${String(idMap.size).padStart(4, '0')}`);
    return idMap.get(raw);
  }
  // Tool names are structural -- nothing in the payload branches on them, but the parser
  // keys records by them, and a result must name the same tool as its call.
  if ((key === 'name' || key === 'toolName') && /^[A-Za-z_][A-Za-z0-9_.-]{0,40}$/.test(raw)) {
    if (!toolMap.has(raw)) toolMap.set(raw, `tool_${String(toolMap.size).padStart(2, '0')}`);
    return toolMap.get(raw);
  }
  return `fixture ${sid('text-')} placeholder`;
}

// Nothing that identifies this machine may reach the committed fixture. Checked on the
// rendered bytes, not on the synthesised objects, because the leak path runs through
// arguments and summaries as easily as through text.
const LEAKS = [/[A-Za-z]:[\\/]/, /\/Users\//, /\bava\b/, /\.minimax/i, /homedir/i];

function assertNoLeaks(text, where) {
  for (const re of LEAKS) {
    const at = text.match(re);
    if (at) {
      const from = Math.max(0, at.index - 60);
      throw new Error(`fixture leak ${re} in ${where}: ${JSON.stringify(text.slice(from, at.index + 90))}`);
    }
  }
}

function synth(value, key = '') {
  if (typeof value === 'string') return synthString(value, key);
  if (Array.isArray(value)) return value.map((v) => synth(v, key));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = synth(v, k);
    return out;
  }
  return value;                       // numbers and booleans are structure, not payload
}

// A privacy gate that cannot fail is worse than no gate: it would be trusted.
if (process.argv.includes('--selftest')) {
  const dirty = [
    ['windows path', 'see C:\\Users\\ava\\notes.md'],
    ['posix path', 'see /Users/ava/notes.md'],
    ['user name', 'owner ava rebuilt it'],
    ['store path', 'root is .minimax here'],
    ['homedir call', 'resolved via homedir()'],
  ];
  let ok = true;
  for (const [label, text] of dirty) {
    try { assertNoLeaks(text, label); console.log(`  MISSED  ${label}`); ok = false; }
    catch { console.log(`  caught  ${label}`); }
  }
  try { assertNoLeaks('fixture text-0001 placeholder', 'control'); console.log('  ok      clean control passes'); }
  catch { console.log('  MISSED  clean control wrongly rejected'); ok = false; }
  console.log(ok ? '\nself-test passed' : '\nself-test FAILED');
  process.exit(ok ? 0 : 1);
}

function classify(message) {
  const parts = Array.isArray(message.content) ? message.content : [];
  const text = parts.filter((p) => p.type === 'text').map((p) => p.text).join('');
  return {
    role: message.role,
    parts: parts.map((p) => p.type),
    stopReason: message.stopReason,
    isError: message.isError === true,
    text,
  };
}

const record = process.argv.includes('--record');
const check = process.argv.includes('--check');

// --record rewrites the fixture and --check judges it. Running both would let the writer grade
// its own homework, so refuse the combination outright.
if (record && check) {
  console.error('--record rewrites the fixture, --check judges it; pick one');
  process.exit(2);
}

// ---- --check ---------------------------------------------------------------------------
// It never reads the live store, so it works on a runner with no ~/.minimax. It does not compare
// bytes either: the promise was never "identical to what this machine distils today" -- that
// drifts with every session written, and chasing it is how a fixture ends up half-regenerated
// for no reason anyone can name. The promise is the weaker one that was actually made: the
// committed fixture is still usable by the guards, still covers every shape they assert on, and
// still carries nothing from this machine.

const NEEDED_NAMES = Object.keys(NEEDED);
const SESSIONS_FLOOR = 6;        // verify-parsers asserts entries.length > 5
const ROWS_FLOOR = 12;           // the distiller refuses to keep anything shorter

const shapeOf = (c) => ({ role: c.role, parts: c.parts.join(','), stopReason: c.stopReason ?? '', isError: c.isError });
const flagsOf = (c) => NEEDED_NAMES.filter((n) => NEEDED[n](c));

async function walk(dir) {
  let out = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out = out.concat(await walk(full));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

async function checkFixture(root) {
  const problems = [];
  const files = await walk(root);
  const bodies = files.filter((f) => f.endsWith('messages.jsonl'));
  if (!bodies.length) {
    problems.push(`no messages.jsonl anywhere under ${root} -- the fixture is empty`);
    return { problems, sessions: 0, rows: 0 };
  }

  for (const f of files) {
    try { assertNoLeaks(await readFile(f, 'utf8'), relative(root, f)); }
    catch (e) { problems.push(e.message); }
  }

  const seen = new Set();
  let rows = 0;
  for (const f of bodies.sort()) {
    const rel = relative(root, f);
    let kept = 0;
    const lines = (await readFile(f, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      if (!line.trim()) return;
      const at = `${rel}:${i + 1}`;
      let parsed;
      try { parsed = JSON.parse(line); } catch { problems.push(`${at} is not JSON`); return; }
      const message = parsed && typeof parsed.message === 'object' ? parsed.message : null;
      if (!message || typeof message.role !== 'string') {
        problems.push(`${at} has no message.role -- the service keys records off it`);
        return;
      }
      if (typeof parsed.message_id !== 'string' || typeof parsed.turn_id !== 'string') {
        problems.push(`${at} is missing the message_id/turn_id wrapper the committed format has`);
      }
      kept += 1; rows += 1;

      // Distil it again and demand the same reading. Two different failures hide here: a synth
      // rule that no longer preserves structure (role/parts/stopReason/isError drift), and an
      // empty-string payload that becomes a placeholder and so stops being the empty thing the
      // `silent` rule was written to find. The first is a broken distiller; the second is a
      // fixture that has quietly left the space the guards reason about.
      const now = classify(message);
      const again = classify(synth(message));
      if (JSON.stringify(shapeOf(now)) !== JSON.stringify(shapeOf(again))) {
        problems.push(`${at} is not shape-stable: distilling it again yields ${JSON.stringify(shapeOf(again))}`);
      }
      const a = flagsOf(now); const b = flagsOf(again);
      if (a.join() !== b.join()) {
        problems.push(`${at} changes coverage when distilled again: ${a.join() || '(none)'} -> ${b.join() || '(none)'}`);
      }
      for (const n of a) seen.add(n);
    });
    if (kept < ROWS_FLOOR) problems.push(`${rel} keeps ${kept} rows, below the ${ROWS_FLOOR} floor`);
  }

  if (bodies.length < SESSIONS_FLOOR) {
    problems.push(`${bodies.length} sessions present; verify-parsers asserts entries.length > 5`);
  }
  const absent = NEEDED_NAMES.filter((n) => !seen.has(n));
  if (absent.length) {
    problems.push(`MISSING coverage: ${absent.join(', ')} -- verify-anomaly.mjs asserts against exactly these`);
  }
  return { problems, sessions: bodies.length, rows };
}

// A gate that cannot fail is not a gate. This is the self-test that keeps --check honest: it has
// to clear a good tree and reject each of the ways this fixture has already gone wrong.
const DEMO_CORE = [
  { role: 'user', content: [{ type: 'text', text: 'start' }] },
  { role: 'user', content: [{ type: 'text', text: '<system-reminder>\nblock' }] },
  { role: 'assistant', content: [{ type: 'thinking', thinking: 'hm' }, { type: 'text', text: 'on it' }], stopReason: 'toolUse' },
  { role: 'assistant', content: [{ type: 'toolCall', id: 'toolu_01', name: 'demo_tool', input: { q: 'x' } }], stopReason: 'toolUse' },
  { role: 'toolResult', content: [{ type: 'text', text: 'fine' }], toolCallId: 'toolu_01', name: 'demo_tool' },
  { role: 'assistant', content: [], stopReason: 'stop' },
  { role: 'assistant', content: [{ type: 'text', text: 'answered' }], stopReason: 'stop' },
  { role: 'toolResult', content: [{ type: 'text', text: 'broke' }], toolCallId: 'toolu_02', name: 'demo_tool', isError: true },
  { role: 'compactionSummary', content: [{ type: 'text', text: 'earlier' }] },
];
// The second silent row is what keeps the shape-drift case honest: removing the first one still
// leaves `silent` covered, so the failure has to be the drift line and nothing else.
const DEMO_FILL = [
  { role: 'user', content: [{ type: 'text', text: 'more' }] },
  { role: 'assistant', content: [], stopReason: 'stop' },
  { role: 'assistant', content: [{ type: 'text', text: 'sure' }], stopReason: 'stop' },
  { role: 'user', content: [{ type: 'text', text: 'and again' }] },
  { role: 'assistant', content: [{ type: 'text', text: 'ok' }], stopReason: 'stop' },
];

function demoRows(mutate) {
  const all = [...DEMO_CORE, ...DEMO_FILL];
  return all.map((message, i) => (mutate ? mutate(message, i) : message)).map((message, i) => ({
    message_id: `msg-${String(i).padStart(4, '0')}`,
    turn_id: `turn-${String(Math.floor(i / 2) + 1).padStart(3, '0')}`,
    message,
  }));
}

async function demoTree(label, mutate, every, sessions = SESSIONS_FLOOR, rows = 0) {
  const root = await mkdtemp(join(tmpdir(), `fixture-check-${label}-`));
  for (let i = 0; i < sessions; i++) {
    const dir = join(root, 'v2', 'sessions', 'fixture-agent', `00-00-0${i}-000-session_fixture${String(i).padStart(2, '0')}`);
    await mkdir(dir, { recursive: true });
    const body = demoRows(mutate && (every || i === 0) ? mutate : null);
    const kept = rows ? body.slice(0, rows) : body;
    await writeFile(join(dir, 'messages.jsonl'), `${kept.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
    await writeFile(join(dir, 'manifest.json'), `${JSON.stringify({
      sessionId: `mvs_${'0'.repeat(24)}${(i + 1).toString(16).padStart(8, '0')}`,
      createdAtMs: 1750000000000 + i * 1000,
    }, null, 2)}\n`, 'utf8');
  }
  return root;
}

// The three ways this fixture has actually gone wrong, as row mutations. They live at module
// scope, not inside --checkselftest, because the self-test and --emit-demo-tree need the same
// ones and two copies of "a broken fixture" is how they drift apart.
const DEMO_LEAK = (m) => (m.role === 'user' && !String(m.content[0].text).startsWith('<')
  ? { ...m, content: [{ type: 'text', text: 'see C:\\Users\\ava\\notes.md' }] } : m);
const DEMO_HOLE = (m) => (m.isError === true ? { ...m, isError: false } : m);
// An empty string is the payload case that stops being empty once synthed.
const DEMO_DRIFT = (m, i) => (i === 5 ? { ...m, content: [{ type: 'text', text: '' }] } : m);

const DEMO_CASES = {
  good: { label: 'good tree', mutate: null, every: false },
  leak: { label: 'machine path leaked in', mutate: DEMO_LEAK, every: false },
  hole: { label: 'a shape went missing', mutate: DEMO_HOLE, every: true },
  drift: { label: 'empty payload drifts', mutate: DEMO_DRIFT, every: false },
  // The two floors are constants too, and a constant nobody can break is a comment. These give
  // each one something to be caught on.
  thin: { label: 'too few sessions', mutate: null, every: false, sessions: 2 },
  short: { label: 'rows below the floor', mutate: null, every: false, rows: 3 },
};

if (process.argv.includes('--checkselftest') || process.argv.includes('--checkselftest-broken')) {
  // `every` matters: a coverage hole has to be punched in all six sessions, or the other five
  // still cover the shape and the case passes for the wrong reason -- which is exactly the
  // mistake the first version of this self-test made.
  const cases = [
    ['good tree', null, false, (r) => r.problems.length === 0, 0],
    ['machine path leaked in', DEMO_LEAK, false, (r) => r.problems.some((p) => p.includes('fixture leak')), null],
    ['a shape went missing', DEMO_HOLE, true, (r) => r.problems.some((p) => p.startsWith('MISSING coverage')), null],
    ['empty payload drifts', DEMO_DRIFT, false, (r) => r.problems.some((p) => p.includes('changes coverage when distilled again')), null],
  ];
  let ok = true;
  // A healthy tree never misses a case, so `ok` is never cleared and the wiring between "a case
  // missed" and "the process exits non-zero" is untestable from the outside: neuter the assignment
  // and the loop still prints `ok` four times. Mutation 8 of mutate-fixture.py survived until this
  // existed. The case below can never pass, so it forces the failure path and lets it be read.
  if (process.argv.includes('--checkselftest-broken')) {
    cases.push(['this case cannot pass', null, false, () => false, null]);
  }
  for (const [label, mutate, every, verdict, exact] of cases) {
    const root = await demoTree(label.replace(/\W+/g, '-'), mutate, every);
    const r = await checkFixture(root);
    await rm(root, { recursive: true, force: true });
    const passed = exact === null ? verdict(r) : r.problems.length === exact;
    const detail = passed
      ? (exact === null ? `(${r.problems.length} problems, expected kind present)` : 'clean')
      : `got ${r.problems.length} problems: ${JSON.stringify(r.problems.slice(0, 3))}`;
    console.log(`  ${passed ? 'ok     ' : 'MISSED '} ${label.padEnd(24)} ${detail}`);
    if (!passed) ok = false;
  }
  console.log(ok ? '\ncheck self-test passed' : '\ncheck self-test FAILED');
  process.exit(ok ? 0 : 1);
}

// Write one of the demo trees somewhere a caller can point --check at, and print the path. Without
// this, --checkselftest proves checkFixture() works while nothing proves the --check *branch*
// reports its verdict -- and a neutered branch looks perfectly green from the outside, which is
// exactly what mutation A of this file demonstrated.
const emit = process.argv.find((a) => a.startsWith('--emit-demo-tree='));
if (emit) {
  const which = emit.slice('--emit-demo-tree='.length);
  const spec = DEMO_CASES[which];
  if (!spec) {
    console.error(`unknown demo tree "${which}"; expected one of ${Object.keys(DEMO_CASES).join(', ')}`);
    process.exit(2);
  }
  const root = await demoTree(which, spec.mutate, spec.every, spec.sessions, spec.rows);
  console.log(root);
  process.exit(0);
}

// --root=<dir> points the judgement at some other tree. Same reason as above: the committed
// fixture is the one thing that must never be broken to test the thing that judges it.
const rootFlag = process.argv.find((a) => a.startsWith('--root='));
const checkRoot = rootFlag ? rootFlag.slice('--root='.length) : OUT_ROOT;

if (check) {
  const r = await checkFixture(checkRoot);
  console.log(`fixture root : ${checkRoot}`);
  console.log(`sessions     : ${r.sessions} (floor ${SESSIONS_FLOOR})`);
  console.log(`rows         : ${r.rows}`);
  console.log(`coverage     : ${NEEDED_NAMES.join(', ')}`);
  if (r.problems.length) {
    console.error(`\nFIXTURE CHECK FAILED (${r.problems.length})`);
    for (const p of r.problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log('\nfixture check OK');
  process.exit(0);
}

const location = resolveSessionsRoot();
const entries = await collectSessionEntries(location.sessionsRoot);
if (!entries.length) {
  console.error(`no sessions under ${location.sessionsRoot} -- nothing to distil`);
  process.exit(2);
}

// A compacted session does not keep its old messages in messages.jsonl: the runtime rotates
// them into g<gen>--ctx_*.jsonl and records the lineage in history-catalog.json. The shapes the
// guards need -- an empty reply above all -- live in those older generations, so scanning the
// active file alone finds none of them.
async function lineageFiles(dir) {
  let artifacts = [];
  try {
    const cat = JSON.parse(await readFile(join(dir, 'history-catalog.json'), 'utf8'));
    if (Array.isArray(cat.artifacts)) artifacts = [...cat.artifacts].sort((a, b) => a.generation - b.generation);
  } catch { /* never compacted: the active file is the whole session */ }
  // Snapshots live in a `snapshots/` subdirectory and the active file at the root; that split is
  // the service's own rule, so reuse resolveArtifactPath rather than restating it.
  const files = artifacts.map((a) => resolveArtifactPath(dir, { ...a, active: a.kind === 'active' })).filter(Boolean);
  if (!files.length) files.push(join(dir, 'messages.jsonl'));
  return files;
}

const picked = entries;
const fixtureSessions = [];
const seen = new Set();

const parseLine = (line) => {
  if (!line.trim()) return null;
  let parsed;
  try { parsed = JSON.parse(line); } catch { return null; }
  const message = parsed && typeof parsed === 'object' ? (parsed.message ?? parsed) : null;
  if (!message || typeof message !== 'object' || typeof message.role !== 'string') return null;
  return { turn_id: parsed.turn_id, message, shape: classify(message) };
};

for (const entry of picked) {
  // Keep walking until the quota is met: the newest entries include sessions too short to
  // distil, and verify-parsers asserts `entries.length > 5`, so a short run would sit exactly
  // on the boundary.
  if (fixtureSessions.length >= SESSIONS_WANTED) break;
  const files = await lineageFiles(entry.dir);

  // Two passes over the lineage. The first only locates the first row of each required shape
  // and counts rows per file; the second keeps the selected rows. Holding every parsed row of a
  // compacted 80 MB session would cost far more than that.
  const counts = [];
  const firstAt = new Map();
  let total = 0;
  outer:
  for (const file of files) {
    const head = await readHead(file, Number.MAX_SAFE_INTEGER);
    let n = 0;
    for (const line of head.text.split('\n')) {
      const row = parseLine(line);
      if (!row) continue;
      for (const [name, test] of Object.entries(NEEDED)) if (!firstAt.has(name) && test(row.shape)) firstAt.set(name, total);
      n += 1; total += 1;
    }
    counts.push(n);
    if (firstAt.size === Object.keys(NEEDED).length) break outer;
  }
  if (total < 12) continue;

  const chosen = new Set(firstAt.values());
  const stride = Math.max(1, Math.floor(total / ROWS_PER_SESSION));
  for (let i = 0; i < total && chosen.size < ROWS_PER_SESSION; i += stride) chosen.add(i);

  const pickedRows = [];
  let base = 0;
  for (let f = 0; f < files.length && pickedRows.length < ROWS_PER_SESSION; f += 1) {
    const head = await readHead(files[f], Number.MAX_SAFE_INTEGER);
    let at = base;
    for (const line of head.text.split('\n')) {
      const row = parseLine(line);
      if (!row) continue;
      if (chosen.has(at)) pickedRows.push(row);
      at += 1;
      if (pickedRows.length >= ROWS_PER_SESSION) break;
    }
    base += counts[f];
  }

  const turnSeq = new Map();
  let rows = pickedRows.map((r) => {
    const key = typeof r.turn_id === 'string' && r.turn_id ? r.turn_id : `turn-${r.shape.role}`;
    if (!turnSeq.has(key)) turnSeq.set(key, `turn-${String(turnSeq.size + 1).padStart(3, '0')}`);
    for (const [name, test] of Object.entries(NEEDED)) if (!seen.has(name) && test(r.shape)) seen.add(name);
    return { message_id: sid('msg-'), turn_id: turnSeq.get(key), message: synth(r.message), __shape: r.shape };
  });

  // A live session's last turn is the one still running, so it has no answer yet. The anomaly
  // guard's live-turn exclusion only means anything if the fixture has such a turn: if the last
  // turn were closed, mutating liveTurn to return null would change no count and the mutation
  // would survive. The distilled session therefore ends on an open turn, like the real one.
  const answers = (r) => r.__shape.role === 'assistant' && r.__shape.stopReason === 'stop' && r.__shape.text;
  for (;;) {
    const lastTurn = rows.length ? rows[rows.length - 1].turn_id : null;
    if (!lastTurn || !rows.some((r) => r.turn_id === lastTurn && answers(r))) break;
    const trimmed = rows.filter((r) => r.turn_id !== lastTurn);
    if (trimmed.length < 12) break;          // a session this short is not worth reshaping
    rows = trimmed;
  }

  console.log(`  ${entry.dir.split(/[\\/]/).pop().slice(0, 28)}  files=${files.length}  rows=${total}  kept=${rows.length}`);
  fixtureSessions.push({ dir: entry.dir, rows });
}

console.log(`sessions on disk : ${entries.length}`);
console.log(`distilling       : ${fixtureSessions.length}`);
console.log(`rows per session : ${ROWS_PER_SESSION} (cap)`);
console.log(`coverage needed  : ${Object.keys(NEEDED).join(', ')}`);
console.log(`coverage present : ${[...seen].join(', ')}`);
const absent = Object.keys(NEEDED).filter((k) => !seen.has(k));
if (absent.length) {
  console.error(`\nMISSING coverage : ${absent.join(', ')}`);
  console.error('raise SESSIONS_WANTED or ROWS_PER_SESSION and re-run');
  process.exit(1);
}

let bytes = 0;
const planned = [];
fixtureSessions.forEach((session, i) => {
  const name = `00-00-0${i}-000-session_fixture${String(i).padStart(2, '0')}`;
  const dir = join(OUT_ROOT, 'v2', 'sessions', 'fixture-agent', name);
  const body = session.rows.map((r) => JSON.stringify({ message_id: r.message_id, turn_id: r.turn_id, message: r.message })).join('\n') + '\n';
  const manifest = JSON.stringify({
    sessionId: `mvs_${'0'.repeat(24)}${(i + 1).toString(16).padStart(8, '0')}`,
    createdAtMs: 1750000000000 + i * 1000,
  }, null, 2);
  assertNoLeaks(body, name);
  assertNoLeaks(manifest, name);
  bytes += Buffer.byteLength(body, 'utf8') + Buffer.byteLength(manifest, 'utf8');
  planned.push({ dir, body, manifest, order: i });
});

console.log(`\nfixture would be ${planned.length} sessions, ${(bytes / 1024).toFixed(0)} KB at ${relative(process.cwd(), OUT_ROOT)}`);
if (!record) {
  console.log('\n(dry run -- pass --record to write)');
  process.exit(0);
}

await rm(OUT_ROOT, { recursive: true, force: true });
for (const s of planned) {
  await mkdir(s.dir, { recursive: true });
  await writeFile(join(s.dir, 'messages.jsonl'), s.body, 'utf8');
  await writeFile(join(s.dir, 'manifest.json'), s.manifest, 'utf8');
  // deterministic ordering: collectSessionEntries sorts by mtimeMs descending
  const when = new Date(1750000000000 + (planned.length - s.order) * 60000);
  await utimes(join(s.dir, 'messages.jsonl'), when, when);
}
console.log(`\nwritten: ${OUT_ROOT}`);
