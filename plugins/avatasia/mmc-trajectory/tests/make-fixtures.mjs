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
import { mkdir, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { homedir } from 'node:os';
import * as server from '../miniapp/node/server.mjs';

const { resolveSessionsRoot, collectSessionEntries, readHead, MAX_MESSAGE_BYTES } = server;

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

const picked = entries;
const fixtureSessions = [];
const seen = new Set();

for (const entry of picked) {
  // Keep walking until the quota is met: the newest entries include sessions too short to
  // distil, and verify-parsers asserts `entries.length > 5`, so a short run would sit exactly
  // on the boundary.
  if (fixtureSessions.length >= SESSIONS_WANTED) break;
  const head = await readHead(join(entry.dir, 'messages.jsonl'), Math.min(entry.sizeBytes, SCAN_BYTES));
  const scanned = [];
  for (const line of head.text.split('\n')) {
    if (!line.trim()) continue;
    let parsed;
    try { parsed = JSON.parse(line); } catch { continue; }
    const message = parsed && typeof parsed === 'object' ? (parsed.message ?? parsed) : null;
    if (!message || typeof message !== 'object' || typeof message.role !== 'string') continue;
    scanned.push({ turn_id: parsed.turn_id, message, shape: classify(message) });
    if (scanned.length >= SCAN_ROWS) break;
  }
  if (scanned.length < 12) continue;

  // Taking the head of a session does not reach tool calls -- they start well into the
  // transcript. So force-include one row per shape, then stride the rest.
  const chosen = new Set();
  for (const test of Object.values(NEEDED)) {
    const at = scanned.findIndex((r) => test(r.shape));
    if (at >= 0) chosen.add(at);
  }
  const stride = Math.max(1, Math.floor(scanned.length / ROWS_PER_SESSION));
  for (let i = 0; i < scanned.length && chosen.size < ROWS_PER_SESSION; i += stride) chosen.add(i);

  const turnSeq = new Map();
  const rows = [...chosen].sort((a, b) => a - b).slice(0, ROWS_PER_SESSION).map((i) => {
    const src = scanned[i];
    const key = typeof src.turn_id === 'string' && src.turn_id ? src.turn_id : `turn-${i}`;
    if (!turnSeq.has(key)) turnSeq.set(key, `turn-${String(turnSeq.size + 1).padStart(3, '0')}`);
    return { message_id: sid('msg-'), turn_id: turnSeq.get(key), message: synth(src.message), __shape: src.shape };
  });

  for (const r of rows) for (const [name, test] of Object.entries(NEEDED)) if (!seen.has(name) && test(r.__shape)) seen.add(name);
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
