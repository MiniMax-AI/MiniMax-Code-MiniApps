// Server-side checks for the history-generation chain introduced by compaction.
// Read-only: imports the pure helpers, never starts the runtime.
import { resolve } from 'node:path';
import {
  parseCatalogGenerations,
  activeCatalogGeneration,
  resolveArtifactPath,
  trajectoryCacheKey,
  buildTrajectoryPayload,
  parseMessagesJsonl,
  readGenerationMarker,
  walkLineage,
  ROW_GENERATION,
  buildMessageIdentity,
  selectIdentityView,
} from '../miniapp/node/server.mjs';

let pass = 0;
const failures = [];
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass += 1;
  else failures.push(`${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function assert(name, cond) {
  if (cond) pass += 1;
  else failures.push(name);
}

const CATALOG = {
  schemaVersion: 1,
  sessionId: 'mvs_1',
  activeGeneration: 2,
  activeRevision: 'sha256:aa0ee431211d51509d33f4f5ceebcf94987951d606fca17b4cb648b423a3a907',
  artifacts: [
    { revision: 'sha256:1a78ed0edac4cacefdf13606f47fa36c04fafe4ac9e4b85b46b62f763a72a088', generation: 0, kind: 'snapshot', fileName: 'g000000000000--ctx_456bed0e.jsonl', byteLength: 4109759, messageCount: 676 },
    { revision: 'sha256:73ec52fa210562ec193e9bf72a6700bc58abde6ebec2e032d5b7cd4444544647', generation: 1, kind: 'snapshot', fileName: 'g000000000001--ctx_652d24b2.jsonl', byteLength: 3029414, messageCount: 548 },
    { revision: 'sha256:aa0ee431211d51509d33f4f5ceebcf94987951d606fca17b4cb648b423a3a907', generation: 2, kind: 'active', fileName: 'messages.jsonl', byteLength: 1302171, messageCount: 186 },
  ],
};

/* ---- shape ---- */
const gens = parseCatalogGenerations(CATALOG);
check('three generations', gens.length, 3);
check('ordered by generation', gens.map((g) => g.generation), [0, 1, 2]);
check('active flag on the active artifact', gens[2].active, true);
check('snapshots are not active', gens.slice(0, 2).map((g) => g.active), [false, false]);
check('byteLength kept', gens[0].byteLength, 4109759);
check('messageCount kept', gens[1].messageCount, 548);
check('revision kept', gens[2].revision, CATALOG.activeRevision);
check('active generation', activeCatalogGeneration(CATALOG, gens), 2);

/* ---- degraded catalogs must never invent data ---- */
check('null catalog', parseCatalogGenerations(null), []);
check('array catalog', parseCatalogGenerations([]), []);
check('catalog without artifacts', parseCatalogGenerations({ schemaVersion: 1 }), []);
check('active generation with no catalog entries', activeCatalogGeneration({}, []), null);
check('active generation falls back to the active flag', activeCatalogGeneration({}, [{ generation: 5, active: true }]), 5);
check('active generation falls back to the last one', activeCatalogGeneration({}, [{ generation: 7, active: false }]), 7);
check('declared generation not in the list is ignored', activeCatalogGeneration({ activeGeneration: 9 }, gens), 2);

/* ---- malformed entries are dropped, not coerced ---- */
const messy = parseCatalogGenerations({
  artifacts: [
    null,
    'nope',
    [],
    { generation: -1, fileName: 'a.jsonl' },
    { generation: 1.5, fileName: 'a.jsonl' },
    { generation: '1', fileName: 'a.jsonl' },
    { generation: 0, fileName: 'messages.txt' },
    { generation: 0, fileName: '.hidden.jsonl' },
    { generation: 0, fileName: 'a b.jsonl' },
    { generation: 0, fileName: 'ok.jsonl', byteLength: -5, messageCount: 'x', revision: 'md5:zzz' },
    { generation: 0, fileName: 'float.jsonl', byteLength: 1.5, messageCount: 2.5 },
    { generation: true, fileName: 'bool.jsonl' },
  ],
});
check('every malformed entry dropped', messy.filter((g) => g.fileName !== 'ok.jsonl').length, 0);
check('the one well-named entry survives', messy.map((g) => g.fileName), ['ok.jsonl']);
check('bad numbers on a surviving entry become null', [messy[0].byteLength, messy[0].messageCount, messy[0].revision], [null, null, null]);
const partial = parseCatalogGenerations({ artifacts: [{ generation: 3, fileName: 'g3.jsonl', byteLength: null, messageCount: null, revision: null }] });
check('missing numbers become null, not zero', [partial[0].byteLength, partial[0].messageCount, partial[0].revision], [null, null, null]);
check('missing kind defaults to snapshot', partial[0].kind, 'snapshot');
const dup = parseCatalogGenerations({ artifacts: [{ generation: 4, fileName: 'first.jsonl' }, { generation: 4, fileName: 'second.jsonl' }] });
check('duplicate generation keeps the first', dup.map((g) => g.fileName), ['first.jsonl']);

/* ---- path traversal: a catalog must not get to choose a file ---- */
const dir = resolve('D:/sess/2026/10/10/abc-session');
const snap = gens[0];
const activeArt = gens[2];
check('snapshot resolves under snapshots/', resolveArtifactPath(dir, snap), resolve(dir, 'snapshots/g000000000000--ctx_456bed0e.jsonl'));
check('active resolves to the plain file', resolveArtifactPath(dir, activeArt), resolve(dir, 'messages.jsonl'));
const escapes = [
  '../../../../Windows/System32/config/SAM',
  '..\\..\\evil.jsonl',
  '/etc/passwd',
  'C:/Windows/win.ini',
  'sub/dir.jsonl',
  'sub\\dir.jsonl',
  '..',
  '.',
  '',
  'a'.repeat(201) + '.jsonl',
  null,
  undefined,
  {},
];
for (const name of escapes) {
  check(`rejected path: ${JSON.stringify(name)}`, resolveArtifactPath(dir, { generation: 1, fileName: name, active: false }), null);
}
check('rejected path for an active artifact too', resolveArtifactPath(dir, { generation: 1, fileName: '../evil.jsonl', active: true }), null);

/* ---- cache keys must not collide across generations ---- */
const entry = { dir, sizeBytes: 1302171, lastActiveAt: 1791617886354 };
const identity = { catalogBytes: 1302171 };
const keys = [0, 1, 2].map((g) => trajectoryCacheKey(entry, identity, null, g));
assert('three distinct keys', new Set(keys).size === 3);
const autoKey = trajectoryCacheKey(entry, identity, null, null);
assert('auto key differs from every explicit generation', !keys.includes(autoKey));
assert(
  'unchanged session still reuses a key',
  trajectoryCacheKey(entry, identity, null, 2) === trajectoryCacheKey(entry, identity, null, 2)
);

/* ---- payload: session-wide totals and the checkpoint's own story ---- */
const rows = [
  {
    message_id: 'msg-c1',
    turn_id: 't0',
    history_artifact: {
      schemaVersion: 1,
      generation: 2,
      producedBy: 'llm_checkpoint',
      parentSnapshot: {
        generation: 1,
        compactionId: 'ctx_652d24b2-73c0-40cc-8276-c58676946733',
        revision: 'sha256:73ec52fa210562ec193e9bf72a6700bc58abde6ebec2e032d5b7cd4444544647',
      },
    },
    message: { role: 'compactionSummary', summary: '## Goal …', tokensBefore: 367401, timestamp: 1791617886354 },
  },
  { message_id: 'msg-a1', turn_id: 't1', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }], timestamp: 1791617891000 } },
];
const payload = buildTrajectoryPayload({
  session: { id: 'mvs_1', createdAtMs: 1791617886354 },
  rows,
  sizeBytes: 1302171,
  generations: gens,
  generation: 2,
});
check('messages counts this generation only', payload.stats.messages, 2);
// What it used to assert — the session-wide number must not shrink to one generation — is now
// carried by the identity path below, where it is actually true. What it asserts here is the
// definition: logical messages, not the rows the catalog recorded per file.
check('messagesAll counts logical messages, not catalog rows', payload.stats.messagesAll, 2);
check('...and the physical row count is reported separately', payload.stats.messageRowsAll, 2);
check('compactions counted', payload.stats.compactions, 1);
check('generation echoed on the session', payload.session.generation, 2);
check('generation list passed through', payload.session.generations.length, 3);

const comp = payload.turns.flatMap((t) => t.records).find((r) => r.title === 'compaction');
assert('compaction record exists', !!comp);
check('tokensBefore survives', comp.tokensBefore, 367401);
check('producedBy survives', comp.producedBy, 'llm_checkpoint');
check('generation survives', comp.generation, 2);
check('parentGeneration survives', comp.parentGeneration, 1);
check('parentCompactionId survives', comp.parentCompactionId, 'ctx_652d24b2-73c0-40cc-8276-c58676946733');
check('parentRevision survives', comp.parentRevision, CATALOG.artifacts[1].revision);

const plain = buildTrajectoryPayload({ session: { id: 'mvs_2' }, rows: rows.slice(1), generations: [{ generation: 0, messageCount: 9, active: true }], generation: 0 });
check('single generation falls back to the row count', plain.stats.messagesAll, 1);
const plainSystem = buildTrajectoryPayload({ session: { id: 'mvs_3' }, rows: [{ message_id: 'm-s', turn_id: 't0', message: { role: 'system', content: 'injected', timestamp: 1 } }] });
const sysRecord = plainSystem.turns.flatMap((t) => t.records)[0];
check('an ordinary system record gains no checkpoint fields', [sysRecord.producedBy, sysRecord.generation, sysRecord.parentCompactionId], [null, null, null]);
check('no generations means messagesAll mirrors messages', plainSystem.stats.messagesAll, 1);

/* ---- generation markers: a rotation is only believable because the file says so ---- */
const markerRow = (generation, parentGeneration) => JSON.stringify({
  message_id: 'msg-c' + generation,
  turn_id: 't0',
  history_artifact: {
    schemaVersion: 1,
    generation,
    producedBy: 'llm_checkpoint',
    parentSnapshot: {
      generation: parentGeneration,
      compactionId: 'ctx-' + generation,
      revision: 'sha256:' + 'a'.repeat(64),
    },
  },
  message: { role: 'compactionSummary', summary: '## Goal', tokensBefore: 100 + generation, timestamp: generation },
}) + '\n';
const plainRow = JSON.stringify({
  message_id: 'msg-a1', turn_id: 't1',
  message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }], timestamp: 9 },
}) + '\n';

const m2 = readGenerationMarker(markerRow(2, 1) + plainRow);
check('marker reads the generation it opened', m2.generation, 2);
check('marker reads the parent generation', m2.parentGeneration, 1);
check('marker reads the parent compaction id', m2.parentCompactionId, 'ctx-2');
check('marker reads the parent revision', m2.parentRevision, 'sha256:' + 'a'.repeat(64));
check('a file with no marker is generation 0', readGenerationMarker(plainRow), null);
check('an empty file has no marker', readGenerationMarker(''), null);
check('junk has no marker', readGenerationMarker('not json\n'), null);
check('a null artifact has no marker', readGenerationMarker(JSON.stringify({ message: { role: 'compactionSummary' } }) + '\n'), null);
check('generation 0 cannot be a rotation marker', readGenerationMarker(markerRow(0, null)), null);
check('a string generation is not trusted', readGenerationMarker(JSON.stringify({
  history_artifact: { generation: '2' }, message: { role: 'compactionSummary' },
}) + '\n'), null);
check('a bogus parent revision is dropped, not passed on', readGenerationMarker(JSON.stringify({
  history_artifact: { generation: 2, parentSnapshot: { generation: 1, revision: 'md5:zz' } },
  message: { role: 'compactionSummary' },
}) + '\n').parentRevision, null);

/* ---- walking the lineage, the way the runtime walks it ---- */
const FILES = {
  'messages.jsonl': markerRow(2, 1) + plainRow,
  'g1.jsonl': markerRow(1, 0) + plainRow,
  'g0.jsonl': plainRow,
};
const CATALOG_GENS = parseCatalogGenerations(CATALOG);
/** A catalog with the generation of each file spelled out, so a test can lie on purpose. */
const fixtureCatalog = (pairs) => ({
  generations: pairs.map(([generation, fileName]) => ({
    generation,
    kind: fileName === 'messages.jsonl' ? 'active' : 'snapshot',
    fileName,
    byteLength: 1000,
    messageCount: 10,
    revision: 'sha256:' + String(generation).repeat(64).slice(0, 64),
    active: fileName === 'messages.jsonl',
  })),
});
const probeFrom = (files) => async (generation) => {
  const name = generation === null ? 'messages.jsonl' : files[`gen${generation}`];
  if (name === undefined || files[name] === undefined) return null;
  return { fileName: name, marker: readGenerationMarker(files[name]) };
};

const full = await walkLineage(fixtureCatalog([[0,'g0.jsonl'],[1,'g1.jsonl'],[2,'messages.jsonl']]), probeFrom({
  ...FILES, gen0: 'g0.jsonl', gen1: 'g1.jsonl',
}));
check('lineage covers every generation', full.chain.map((l) => l.generation), [0, 1, 2]);
check('lineage is oldest first', full.chain.map((l) => l.fileName), ['g0.jsonl', 'g1.jsonl', 'messages.jsonl']);
check('no orphans on a clean chain', full.orphans, []);

const single = await walkLineage(fixtureCatalog([[0,'messages.jsonl']]), probeFrom({ ...FILES, gen1: 'g1.jsonl', 'messages.jsonl': plainRow }));
check('an uncompacted session is one generation', single.chain.map((l) => l.generation), [0]);

/* a snapshot whose parent generation is not exactly one lower is not part of this lineage */
const skipped = await walkLineage(fixtureCatalog([[0,'g0.jsonl'],[1,'g1.jsonl'],[2,'messages.jsonl']]), probeFrom({
  ...FILES, gen0: 'g0.jsonl', gen1: 'g1.jsonl',
  'g1.jsonl': markerRow(1, 5) + plainRow,
}));
check('a generation with a diverging parent is refused', skipped.chain.map((l) => l.generation), [2]);
check('everything below the break is orphaned', skipped.orphans.map((o) => o.generation), [0, 1]);

/* a file that claims a different generation than it was reached for is refused */
const lying = await walkLineage(fixtureCatalog([[0,'g0.jsonl'],[1,'g1.jsonl'],[2,'messages.jsonl']]), probeFrom({
  ...FILES, gen0: 'g0.jsonl', gen1: 'g1.jsonl',
  'g1.jsonl': markerRow(7, 6) + plainRow,
}));
check('a file claiming the wrong generation is refused', lying.chain.map((l) => l.generation), [2]);
check('the refused file and everything below it are orphaned', lying.orphans.map((o) => o.generation), [0, 1]);

/* a gap in the chain: generation 0 is missing from the catalog */
const gapped = await walkLineage(fixtureCatalog([[1,'g1.jsonl'],[2,'messages.jsonl']]), probeFrom({ ...FILES, gen1: 'g1.jsonl' }));
check('a missing ancestor stops the walk', gapped.chain.map((l) => l.generation), [1, 2]);

/* a fork leaves snapshots behind that the active chain never reaches */
const forked = await walkLineage(
  { generations: [...fixtureCatalog([[0,'g0.jsonl'],[1,'g1.jsonl'],[2,'messages.jsonl']]).generations, { generation: 5, kind: 'snapshot', fileName: 'orphan.jsonl', byteLength: 10, messageCount: 1, revision: null, active: false }] },
  probeFrom({ ...FILES, gen0: 'g0.jsonl', gen1: 'g1.jsonl' })
);
check('an unreachable snapshot is left out of the chain', forked.chain.map((l) => l.generation), [0, 1, 2]);
check('an unreachable snapshot is reported', forked.orphans.map((o) => o.fileName), ['orphan.jsonl']);

check('a missing active file yields no chain', (await walkLineage(fixtureCatalog([[0,'messages.jsonl']]), async () => null)).chain, []);

/* ---- rows carry their generation without leaking into JSON ---- */
const stitched = [];
for (const [gen, text] of [[0, plainRow], [1, markerRow(1, 0) + plainRow], [2, markerRow(2, 1) + plainRow]]) {
  for (const row of parseMessagesJsonl(text).rows) {
    row[ROW_GENERATION] = gen;
    stitched.push(row);
  }
}
const stitchedPayload = buildTrajectoryPayload({
  session: { id: 'mvs_9', createdAtMs: 1 },
  rows: stitched,
  generations: fixtureCatalog([[0,'g0.jsonl'],[1,'g1.jsonl'],[2,'messages.jsonl']]).generations,
  orphans: [{ generation: 5, fileName: 'orphan.jsonl' }],
});
const allRecords = stitchedPayload.turns.flatMap((t) => t.records);
const generationsLogical = (payload) => payload.session.generations
  .slice()
  .sort((a, b) => a.generation - b.generation)
  .map((g) => g.logicalMessageCount);
check('every record carries a generation', allRecords.every((r) => Number.isInteger(r.generation)), true);
check('generations appear in stitch order', [...new Set(allRecords.map((r) => r.generation))], [0, 1, 2]);
check('the symbol never reaches the body', JSON.stringify(stitchedPayload).includes('rowGeneration'), false);
check('orphans are reported on the session', stitchedPayload.session.orphans.map((o) => o.generation), [5]);
// Five stored rows, three of them the same `msg-a1` re-recorded in each generation. The catalog
// claims thirty; the conversation has three.
check('the stitched rows collapse into logical messages, not stored rows', stitchedPayload.stats.messagesAll, 3);
check('the physical row count stays available separately', stitchedPayload.stats.messageRowsAll, 5);

/* The session-wide number has to survive being read one generation at a time, which is the
   property the catalog sum used to supply. The route builds the identity table over the whole
   lineage and projects afterwards, so the slice carries the lineage's count with it. */
const stitchedIdentity = buildMessageIdentity(stitched.map((row) => ({
  row,
  generation: /** @type {number} */ (row[ROW_GENERATION]),
  locator: null,
})));
check('the identity table merges the three copies of one message', stitchedIdentity.stats.identities, 3);
const slice = selectIdentityView(stitchedIdentity, 1);
const slicePayload = buildTrajectoryPayload({
  session: { id: 'mvs_9s', createdAtMs: 1 },
  rows: slice.rows,
  generations: fixtureCatalog([[0,'g0.jsonl'],[1,'g1.jsonl'],[2,'messages.jsonl']]).generations,
  identity: stitchedIdentity,
  openerByTurn: slice.openerByTurn,
});
check('a single-generation slice shows only that generation', slicePayload.stats.messages, 2);
check('...while still reporting the whole conversation', slicePayload.stats.messagesAll, 3);
// Per-generation counts overlap by construction: msg-a1 is stored in all three.
check('each generation reports the messages IT stores', generationsLogical(stitchedPayload), [1, 2, 2]);

/* ---- a steer whose opener is stored in an earlier generation ----
   Deciding the opener from the projected slice is what made this prompt look like the first
   prompt of its own turn, which counted it as a conversation instead of a redirect and dropped
   the turn out of the 对话 total while the reader was looking straight at it. */
const crossGen = [
  { row: { message_id: 'c-1', turn_id: 'tx', message: { role: 'user', content: [{ type: 'text', text: 'start it' }], timestamp: 10 } }, generation: 0, locator: null },
  { row: { message_id: 'c-2', turn_id: 'tx', message: { role: 'assistant', content: [{ type: 'text', text: 'on it' }], timestamp: 11 } }, generation: 0, locator: null },
  { row: { message_id: 'c-3', turn_id: 'tx', message: { role: 'user', content: [{ type: 'text', text: 'no, the other one' }], timestamp: 20 } }, generation: 1, locator: null },
];
const crossIdentity = buildMessageIdentity(crossGen);
check('the opener is the first prompt of the turn, from generation 0', crossIdentity.openers.get('tx'), 'c-1');
const crossSlice = selectIdentityView(crossIdentity, 1);
const crossPayload = buildTrajectoryPayload({
  session: { id: 'mvs_x', createdAtMs: 10 },
  rows: crossSlice.rows,
  identity: crossIdentity,
  openerByTurn: crossSlice.openerByTurn,
});
const crossKinds = crossPayload.turns.flatMap((t) => t.records).map((r) => r.kind);
check('the prompt alone in the slice is still a steer', crossKinds, ['steer']);
check('...so it is not counted as a conversation prompt', [crossPayload.stats.userMessages, crossPayload.stats.steers], [0, 1]);
check('...and the turn is still a prompted turn', [crossPayload.stats.turnsWithPrompt, crossPayload.turns[0].turnClass], [1, 'prompt']);
check('...and it says the opener is elsewhere', [crossPayload.turns[0].openerInView, crossPayload.turns[0].openerOutOfView], [false, true]);

const crossWhole = selectIdentityView(crossIdentity, null);
const crossWholePayload = buildTrajectoryPayload({
  session: { id: 'mvs_x', createdAtMs: 10 },
  rows: crossWhole.rows,
  identity: crossIdentity,
  openerByTurn: crossWhole.openerByTurn,
});
check('the whole lineage files the opener as dialogue and the rest as a steer',
  crossWholePayload.turns.flatMap((t) => t.records).map((r) => r.kind), ['user', 'narration', 'steer']);
check('...and both are inside the view', [crossWholePayload.turns[0].openerInView, crossWholePayload.turns[0].openerOutOfView], [true, false]);

/* ---- a turn total is only readable if it says what it is made of ---- */
const turnRows = [];
const push = (turnId, message) => turnRows.push({ message_id: turnId + '-' + message.role + Math.random().toString(36).slice(2, 7), turn_id: turnId, message });
push('t-prompt', { role: 'user', content: 'hello', timestamp: 1 });
push('t-prompt', { role: 'assistant', content: [{ type: 'text', text: 'hi' }], timestamp: 2 });
push('t-injected', { role: 'user', content: '<system-reminder>x</system-reminder>', canonicalTextRange: [0, 22], timestamp: 3 });
push('t-injected', { role: 'assistant', content: [{ type: 'text', text: 'ok' }], timestamp: 4 });
push('t-compact', {
  role: 'compactionSummary',
  summary: '## Goal',
  tokensBefore: 10,
  timestamp: 5,
});
const turnPayload = buildTrajectoryPayload({ session: { id: 'mvs_t', createdAtMs: 1 }, rows: turnRows, generations: [] });
check('every turn is counted once', turnPayload.stats.turns, 3);
check('only a turn with a typed prompt counts as dialogue', turnPayload.stats.turnsWithPrompt, 1);
check('a turn whose only user record was injected has no prompt', turnPayload.stats.turnsWithoutPrompt, 1);
check('the parts add up to the total', turnPayload.stats.turnsWithPrompt + turnPayload.stats.compactionTurns + turnPayload.stats.turnsWithoutPrompt, turnPayload.stats.turns);
check('a checkpoint turn is counted as a compaction, not as dialogue', turnPayload.stats.compactionTurns, 1);
const noCompactions = buildTrajectoryPayload({
  session: { id: 'mvs_u', createdAtMs: 1 },
  rows: [{ message_id: 'a', turn_id: 't', message: { role: 'user', content: 'hi', timestamp: 1 } }],
  generations: [],
});
check('the breakdown exists even with a single turn', [noCompactions.stats.turns, noCompactions.stats.turnsWithPrompt, noCompactions.stats.turnsWithoutPrompt, noCompactions.stats.compactionTurns], [1, 1, 0, 0]);

/* ---- 问答 is the turn that asked, and it has not closed ----
 *
 * The reader's answer to a question card does not arrive as a message, so the turn the agent
 * asked in keeps going and the work that follows lands in a later, prompt-less turn. The old
 * rule filed that later turn as 问答 — which meant a turn could read 问答 while the reader still had
 * not answered, and that a turn holding hundreds of tool calls was labelled a Q&A.
 *
 * What is true of the data: a turn either ends with exactly one reply (stopReason: stop) or
 * with none, and the turn that called a tool which waits on the reader is one that has not
 * ended. So 问答 is a prompted turn that is still open, and the continuation is conversation.
 *
 * stopReason is set on the assistant messages below. Without it their text files as
 * narration, and the answer turn looks unlabelled for a reason that has nothing to do with
 * the rule under test.
 */
const askThenAnswer = [
  { message_id: 'q1', turn_id: 't-ask', message: { role: 'user', content: 'pick one', timestamp: 1 } },
  { message_id: 'q2', turn_id: 't-ask', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'c1', name: 'ask_user', arguments: {} }], stopReason: 'toolUse', timestamp: 2 } },
  { message_id: 'q3', turn_id: 't-ask', message: { role: 'toolResult', toolCallId: 'c1', content: 'waiting for the local user', timestamp: 3 } },
  { message_id: 'q4', turn_id: 't-compact', message: { role: 'compactionSummary', summary: '## Goal', tokensBefore: 5, timestamp: 4 } },
  { message_id: 'q5', turn_id: 't-answer', message: { role: 'user', content: '<system-reminder><agent-context>x</agent-context></system-reminder>', canonicalTextRange: [0, 52], timestamp: 5 } },
  { message_id: 'q6', turn_id: 't-answer', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }], stopReason: 'stop', timestamp: 6 } },
];
const answerPayload = buildTrajectoryPayload({ session: { id: 'mvs_a', createdAtMs: 1 }, rows: askThenAnswer, generations: [] });
const answerClasses = answerPayload.turns.map((t) => t.turnClass);
check('问答 counts the turn that asked, and only that turn', answerPayload.stats.qaTurns, 1);
check('the turn holding the ask_user call is the one that counts as 问答', answerClasses[0], 'prompt');
check('the turn after it is a continuation, not a Q&A', answerClasses[2], 'continuation');
check('a continuation still counts as conversation work', answerPayload.stats.continuationTurns, 1);
check('the asking turn is open because the reader has not answered', answerPayload.stats.openTurns, 1);
check('the continuation closed, so it is not open', answerPayload.stats.openTurns === 1, true);
check('a checkpoint between them is still a checkpoint', answerPayload.stats.compactionTurns, 1);
check('nothing is left in the unlabelled bucket', answerPayload.stats.turnsWithoutPrompt, 0);
check('the four classes partition the turns',
  answerPayload.stats.turnsWithPrompt + answerPayload.stats.continuationTurns
    + answerPayload.stats.compactionTurns + answerPayload.stats.turnsWithoutPrompt,
  answerPayload.stats.turns);

/* a turn that asks and is then answered still shows the open turn until the answer lands */
check('a closed turn is not a Q&A even when it once asked', (() => {
  const closed = [
    { message_id: 'k1', turn_id: 't', message: { role: 'user', content: 'pick', timestamp: 1 } },
    { message_id: 'k2', turn_id: 't', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'c', name: 'ask_user', arguments: {} }], stopReason: 'toolUse', timestamp: 2 } },
    { message_id: 'k3', turn_id: 't', message: { role: 'toolResult', toolCallId: 'c', content: 'waiting', timestamp: 3 } },
    { message_id: 'k4', turn_id: 't', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }], stopReason: 'stop', timestamp: 4 } },
  ];
  const p = buildTrajectoryPayload({ session: { id: 'mvs_d', createdAtMs: 1 }, rows: closed, generations: [] });
  return [p.stats.qaTurns, p.stats.openTurns, p.turns[0].closed];
})(), [0, 0, true]);

/* a second prompt inside a turn is a steer: same turn, not another conversation turn */
const withSteer = [
  { message_id: 's1', turn_id: 't', message: { role: 'user', content: 'do the thing', timestamp: 1 } },
  { message_id: 's2', turn_id: 't', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'c1', name: 'bash', arguments: {} }], stopReason: 'toolUse', timestamp: 2 } },
  { message_id: 's3', turn_id: 't', message: { role: 'user', content: 'no, the other one', timestamp: 3 } },
  { message_id: 's4', turn_id: 't', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }], stopReason: 'stop', timestamp: 4 } },
];
const steerPayload = buildTrajectoryPayload({ session: { id: 'mvs_e', createdAtMs: 1 }, rows: withSteer, generations: [] });
check('the prompt that opened the turn is the only one counted as dialogue', steerPayload.stats.userMessages, 1);
check('a prompt written mid-turn is counted apart', steerPayload.stats.steers, 1);
check('the steer does not open a second conversation turn', steerPayload.stats.turnsWithPrompt, 1);
check('the turn still closes exactly once', steerPayload.stats.openTurns, 0);
check('the records are filed user then steer',
  steerPayload.turns[0].records.filter((r) => r.kind === 'user' || r.kind === 'steer').map((r) => r.kind),
  ['user', 'steer']);
check('the steer is marked, so the detail panel can say where it came from',
  steerPayload.turns[0].records.filter((r) => r.kind === 'steer').map((r) => r.steered), [true]);

/* a prompt-less turn that neither asked nor closed stays unlabelled */
const orphanTurn = [
  { message_id: 'o1', turn_id: 't-plain', message: { role: 'user', content: 'hello', timestamp: 1 } },
  { message_id: 'o2', turn_id: 't-plain', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }], stopReason: 'stop', timestamp: 2 } },
  { message_id: 'o3', turn_id: 't-mystery', message: { role: 'user', content: '<system-reminder>y</system-reminder>', canonicalTextRange: [0, 26], timestamp: 3 } },
  { message_id: 'o4', turn_id: 't-mystery', message: { role: 'assistant', content: [{ type: 'text', text: '?' }], stopReason: 'toolUse', timestamp: 4 } },
];
const orphanPayload = buildTrajectoryPayload({ session: { id: 'mvs_c', createdAtMs: 1 }, rows: orphanTurn, generations: [] });
check('a prompt-less turn with no cause is not guessed at', orphanPayload.stats.turnsWithoutPrompt, 1);
check('a prompt-less turn with no cause is not called a Q&A', orphanPayload.stats.qaTurns, 0);

console.log(`[1] generations: ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log('  FAIL ' + f);
process.exit(failures.length === 0 ? 0 : 1);