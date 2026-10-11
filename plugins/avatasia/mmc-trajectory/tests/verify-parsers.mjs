// Authoring-time verification probe. Lives OUTSIDE the Mini App payload on purpose.
// Run: node tests/run.mjs
import { join } from 'node:path';
import { homedir } from 'node:os';
import * as server from '../miniapp/node/server.mjs';

const {
  resolveSessionsRoot,
  collectSessionEntries,
  readSessionIdentity,
  readHead,
  parseMessagesJsonl,
  countRolesInPrefix,
  buildTrajectoryPayload,
  createRedactor,
  isSessionDirName,
  normalizeLimit,
  toolCallSummary,
  normalizeUsage,
} = server;

const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
const LIST_PEEK_BYTES = 256 * 1024;
const failures = [];
const check = (name, ok, detail = '') => {
  if (!ok) failures.push(`${name} :: ${detail}`);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
};

// --- pure helpers ------------------------------------------------------------
check('isSessionDirName rejects mutation folders', isSessionDirName('.history-mutation-abc') === false);
check('isSessionDirName accepts session folders', isSessionDirName('03-51-13-137-session_bXZz') === true);
check('normalizeLimit clamps', normalizeLimit('abc', 20, 1, 50) === 20
  && normalizeLimit('0', 20, 1, 50) === 1
  && normalizeLimit('999', 20, 1, 50) === 50
  && normalizeLimit('12', 20, 1, 50) === 12);
check('normalizeUsage rejects absent usage', normalizeUsage(undefined) === null);
check('normalizeUsage maps input/output', JSON.stringify(normalizeUsage({ input: 5, output: 7, cacheRead: 1, cacheWrite: 0, totalTokens: 12 })) === '{"input":5,"output":7,"cacheRead":1,"cacheWrite":0,"totalTokens":12}');
check('toolCallSummary renders braces', toolCallSummary('read', { path: 'a\nb' }).includes('path='));

// torn-line tolerance
const torn = '{"message_id":"msg-a","turn_id":"t1","message":{"role":"user","content":"a"}}\n{"message_id":"msg-b","tur';
const tornParsed = parseMessagesJsonl(torn);
check('torn trailing line is skipped and counted', tornParsed.rows.length === 1 && tornParsed.skipped === 1, JSON.stringify(tornParsed));
const broken = '{"message_id":"msg-a","turn_id":"t1","message":{"role":"user","content":"a"}}\nnot json at all\n{"message_id":"msg-c","turn_id":"t1","message":{"role":"custom","content":"raw string"}}';
const brokenParsed = parseMessagesJsonl(broken);
check('bad middle line counted not thrown', brokenParsed.rows.length === 2 && brokenParsed.skipped === 1);
const bareString = buildTrajectoryPayload({
  session: { id: 'mvs_probe0000' },
  rows: [{ message_id: 'msg-c', turn_id: 't1', message: { role: 'custom', content: '<system-reminder>x' } }],
});
check('bare-string custom content survives', bareString.turns[0].records[0].kind === 'system'
  && bareString.turns[0].records[0].text === '<system-reminder>x');
const noContent = buildTrajectoryPayload({
  session: { id: 'mvs_probe0000' },
  rows: [{ message_id: 'msg-d', turn_id: 't1', message: { role: 'compactionSummary', summary: '# checkpoint', timestamp: 1 } }],
});
check('a compaction with no content still yields one record',
  noContent.turns[0].records.length === 1 && noContent.turns[0].records[0].kind === 'compaction');

// --- real data --------------------------------------------------------------
const location = resolveSessionsRoot({ MAVIS_HOME: join(homedir(), '.minimax') });
console.log(`\nsessionsRoot resolved from MAVIS_HOME: ${location.sessionsRoot.includes('.minimax') ? 'ok (.minimax home)' : 'UNEXPECTED'}`);
const redact = createRedactor([location.sessionsRoot, location.root]);

const entries = await collectSessionEntries(location.sessionsRoot);
check('enumerates > 5 sessions', entries.length > 5, `found ${entries.length}`);
check('all entries have messages.jsonl bytes', entries.every((e) => e.sizeBytes > 0));

let idOk = 0;
let idBad = 0;
for (const entry of entries) {
  const identity = await readSessionIdentity(entry.dir);
  if (/^mvs_[0-9a-f]{32}$/.test(identity.id)) idOk += 1;
  else {
    idBad += 1;
    console.log(`  unexpected id: ${identity.id}`);
  }
}
check('session ids match mvs_<32 hex>', idOk === entries.length, `${idOk} ok / ${idBad} bad`);

const latest = entries[0];
const identity = await readSessionIdentity(latest.dir);
const head = await readHead(join(latest.dir, 'messages.jsonl'), Math.min(latest.sizeBytes, identity.catalogBytes ?? MAX_MESSAGE_BYTES, MAX_MESSAGE_BYTES));
const parsed = parseMessagesJsonl(head.text);
check('latest session parses > 0 messages', parsed.rows.length > 0, `rows=${parsed.rows.length} skipped=${parsed.skipped} bytes=${head.read}/${head.size}`);

const payload = buildTrajectoryPayload({
  session: { id: identity.id, createdAtMs: latest.lastActiveAt },
  rows: parsed.rows,
  sizeBytes: latest.sizeBytes,
  truncated: head.read < head.size,
  redact,
});
console.log(`\nlatest=${identity.id}`);
console.log(`  label          = ${JSON.stringify(payload.session.label)}`);
console.log(`  messages       = ${payload.stats.messages}`);
console.log(`  turns          = ${payload.stats.turns}`);
console.log(`  toolCalls      = ${payload.stats.toolCalls}`);
console.log(`  toolResults    = ${payload.stats.toolResults}`);
console.log(`  thinkingBlocks = ${payload.stats.thinkingBlocks}`);
console.log(`  tokens         = ${JSON.stringify(payload.stats.tokens)}`);
console.log(`  durationMs     = ${payload.stats.durationMs}`);
console.log(`  truncated      = ${payload.session.truncated}`);

check('messages parsed', payload.stats.messages > 0);
check('turns grouped', payload.stats.turns > 0 && payload.stats.turns <= payload.stats.messages);
check('turn indexes are 1-based and sequential',
  payload.turns.every((t, i) => t.index === i + 1));

const allRecords = payload.turns.flatMap((t) => t.records);
const globalIndexes = allRecords.map((r) => r.index);
check('record indexes are globally continuous 1-based',
  globalIndexes.length > 0
  && globalIndexes[0] === 1
  && globalIndexes.every((v, i) => v === i + 1),
  `records=${allRecords.length}`);
check('every record has a turn', allRecords.every((r) => payload.turns.some((t) => t.id === r.turnId)));

const KIND_CONTRACT = ['user', 'steer', 'reply', 'narration', 'thinking', 'toolCall', 'toolResult', 'system', 'compaction'];
const kinds = new Set(allRecords.map((r) => r.kind));
// Checked against a written-out list, not against the client's own KIND_ORDER: the point
// is that the service emits nothing outside the contract, so reading the expectation from
// the code under test would make this assertion agree with itself.
check('kinds within contract', [...kinds].every((k) => KIND_CONTRACT.includes(k)), [...kinds].join(','));
check('assistant split into multiple kinds', kinds.has('toolCall') && kinds.has('thinking'), [...kinds].join(','));
// Assistant text splits on stopReason: `stop` is the answer a turn delivered (答复), `toolUse`
// is the commentary written on the way to a tool call (过程). A single kind covering both
// buried 51 answers under 901 preambles in a working session.
// `qa` is deliberately NOT in this contract. 问答 belongs to the turn — the exchange where
// the agent asked the reader something and the reply came back as a tool result — and a
// record may not claim that word. client-check.mjs asserts the same thing from the other side.
check('no record kind is named qa', !kinds.has('qa'), [...kinds].join(','));
// A checkpoint is its own kind precisely so it can be kept or dropped on its own; if it
// stopped appearing here the ledger would be folding it back into something else.
check('compactions are their own kind, not filed under system',
  allRecords.filter((r) => r.title === 'compaction').every((r) => r.kind === 'compaction'));

// NOTE: pairing invariants are asserted over a 12-session corpus further down,
// not over entries[0]. The newest session is whatever is being appended to right
// now, so a mid-write file can legitimately contain zero completed tool calls and
// would make a newest-session-only assertion flip between runs.
check('non-assistant records have null tokens',
  allRecords.filter((r) => r.kind === 'user' || r.kind === 'system' || r.kind === 'toolResult' || r.kind === 'compaction').every((r) => r.tokens === null));

// field caps
const overCap = allRecords.filter((r) => (r.text?.length ?? 0) > 20000 || (r.thinking?.length ?? 0) > 20000 || (r.result?.length ?? 0) > 20000);
check('text/thinking/result capped at 20000', overCap.length === 0, `${overCap.length} over cap`);
check('truncated flag set only when capped', allRecords.every((r) => r.textTruncated === true || (r.text?.length ?? 0) <= 20000));
check('raw dropped over 65536 bytes', allRecords.every((r) => {
  if (r.raw === null) return r.rawOmitted === true;
  return Buffer.byteLength(JSON.stringify(r.raw), 'utf8') <= 65536;
}));

const serialized = JSON.stringify(payload);
// leak check across the whole serialized payload
const leakPatterns = ['C:\\Users\\ava\\.minimax', 'C:/Users/ava/.minimax', '/Users/ava/.minimax', '.minimax\\v2', '.minimax/v2', '.minimax\\'];
const leaks = leakPatterns.filter((p) => serialized.includes(p));
check('no absolute .minimax path in payload', leaks.length === 0, leaks.join(' | '));

// labels across many sessions
const labels = [];
for (const entry of entries.slice(0, 12)) {
  const id2 = await readSessionIdentity(entry.dir);
  const peek = await readHead(join(entry.dir, 'messages.jsonl'), LIST_PEEK_BYTES);
  const counts = countRolesInPrefix(peek.text);
  labels.push({ id: id2.id, label: undefined, counts, payload: null });
}
const withRows = [];
for (const entry of entries.slice(0, 12)) {
  const id2 = await readSessionIdentity(entry.dir);
  const peek = await readHead(join(entry.dir, 'messages.jsonl'), Math.min(entry.sizeBytes, MAX_MESSAGE_BYTES));
  const p = parseMessagesJsonl(peek.text);
  const built = buildTrajectoryPayload({ session: { id: id2.id }, rows: p.rows, sizeBytes: entry.sizeBytes, redact });
  withRows.push({ id: id2.id, label: built.session.label, rows: p.rows.length, turns: built.stats.turns, json: JSON.stringify(built), records: built.turns.flatMap((t) => t.records) });
}

// --- pairing invariants over the whole corpus (deterministic) ---------------
const corpusCalls = withRows.flatMap((r) => r.records.filter((x) => x.kind === 'toolCall'));
const corpusResults = withRows.flatMap((r) => r.records.filter((x) => x.kind === 'toolResult'));
check('corpus contains completed tool activity', corpusResults.length > 0 && corpusCalls.length > 0,
  `${corpusCalls.length} calls / ${corpusResults.length} results across ${withRows.length} sessions`);
const corpusCallIds = new Set(corpusCalls.map((c) => c.toolCallId).filter(Boolean));
const corpusPaired = corpusResults.filter((r) => r.toolCallId && corpusCallIds.has(r.toolCallId));
check('corpus: every paired result carries a measured duration',
  corpusPaired.length > 0
  && corpusPaired.every((r) => typeof r.durationMs === 'number' && r.durationMs >= 0),
  `${corpusPaired.length}/${corpusResults.length} results paired and timed`);
check('corpus: unpaired toolResults report null duration, never a guess',
  corpusResults.filter((r) => !corpusCallIds.has(r.toolCallId)).every((r) => r.durationMs === null),
  `${corpusResults.length - corpusPaired.length} unpaired results, all null`);
check('corpus: toolCall records share the measured pair duration',
  corpusCalls.filter((c) => typeof c.durationMs === 'number').length === corpusPaired.length,
  `${corpusCalls.filter((c) => typeof c.durationMs === 'number').length} timed calls vs ${corpusPaired.length} pairs`);
const corpusKinds = new Set(withRows.flatMap((r) => r.records.map((x) => x.kind)));
check('corpus: assistant content splits into toolCall + thinking',
  corpusKinds.has('toolCall') && corpusKinds.has('thinking'), [...corpusKinds].sort().join(','));
const allSampled = JSON.stringify(withRows.map((r) => r.json));
const crossLeaks = ['C:\\Users\\ava\\.minimax', 'C:/Users/ava/.minimax', '/Users/ava/.minimax', '.minimax\\v2', '.minimax/v2', '.minimax\\']
  .filter((p) => allSampled.includes(p));
check('no .minimax path across 12 sampled sessions', crossLeaks.length === 0, crossLeaks.join(' | '));
console.log('\nper-session sample (latest first):');
for (const row of withRows.slice(0, 6)) {
  console.log(`  ${row.id}  msgs=${String(row.rows).padStart(3)}  turns=${String(row.turns).padStart(2)}  label=${JSON.stringify(row.label).slice(0, 78)}`);
}
check('all sampled sessions produced a label', withRows.every((r) => typeof r.label === 'string' && r.label.length > 0));
check('labels are single-line and <= 60 chars', withRows.every((r) => !r.label.includes('\n') && r.label.length <= 60));
check('list peek counts stay approximate but non-zero', labels.some((l) => l.counts.messages > 0));

const totalRows = withRows.reduce((sum, r) => sum + r.rows, 0);
check('multi-session parse produced records', totalRows > 0, `${totalRows} rows across ${withRows.length} sessions`);

// no-session-id-mutation double counting: a folder must never appear twice
const dirs = entries.map((e) => e.dir);
check('no duplicate session folders', new Set(dirs).size === dirs.length);

console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} FAILURES`}`);
for (const failure of failures) console.log(` - ${failure}`);
process.exit(failures.length === 0 ? 0 : 1);