// Distil the developer's real ~/.minimax session store into a synthetic fixture tree.
//
//   node tests/make-fixtures.mjs            report what would be distilled, write nothing
//   node tests/make-fixtures.mjs --record   write tests/fixtures/minimax-home/
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
import { mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
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
