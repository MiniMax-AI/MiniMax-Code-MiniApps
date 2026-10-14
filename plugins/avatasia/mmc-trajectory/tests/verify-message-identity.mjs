/**
 * Message identity across a lineage: one logical message, several stored copies, and several
 * content versions of it.
 *
 * The route used to hand every stored row to the projector, so a message the runtime wrote into
 * both a sealed snapshot and the active file appeared twice, and a message whose old tool result
 * the runtime trimmed on compaction appeared twice with different text. Neither is a row that can
 * simply be dropped — one is a second copy of one version, the other is a second version of one
 * message — so this covers the merge, not the deletion.
 *
 * Every fixture here is SYNTHETIC. The session store is read-only input, and a real trim case costs
 * megabytes to reproduce, which is not something a committed fixture should be.
 */
import { buildMessageIdentity, selectIdentityView, openerRowsForView, logicalCountByGeneration, buildTrajectoryPayload } from '../miniapp/node/server.mjs';

let pass = 0;
const failures = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass += 1;
  else failures.push(`${label}\n     expected ${e}\n     actual   ${a}`);
}
function assert(label, cond) {
  if (cond) pass += 1;
  else failures.push(label);
}

const REMOVED = '[Tool result removed by context compaction.]';

/** A row the way the store holds one. */
function row(id, turn, message, extra) {
  return { message_id: id, turn_id: turn, message, ...(extra ?? {}) };
}
function toolResult(text) {
  return { role: 'toolResult', toolCallId: 'call_1', toolName: 'bash', content: [{ type: 'text', text }], isError: false };
}
function user(text) {
  return { role: 'user', content: [{ type: 'text', text }] };
}
/** The route reads one occurrence per row, with the locator digest alongside. */
const occ = (rowValue, generation, digest) => ({ row: rowValue, generation, locator: { digest } });

const TRIM_DECLARATION = { schemaVersion: 1, generation: 1, producedBy: 'tool_trim', parentSnapshot: { generation: 0, compactionId: 'ctx_1' } };

/* ---------- 1. a second copy of the same content is one version, not two ---------- */
{
  const occurrences = [
    occ(row('m1', 't1', toolResult('exit 0')), 0, 'dA'),
    occ(row('m1', 't1', toolResult('exit 0')), 1, 'dA'),
  ];
  const id = buildMessageIdentity(occurrences);
  check('an identical re-record is one version', id.identities.get('m1').versions.length, 1);
  check('...seen twice', id.identities.get('m1').versions[0].occurrences.length, 2);
  check('...counted as identical, not trimmed', id.stats.identical, 1);
  check('...and the lineage view keeps one row', selectIdentityView(id, null).rows.length, 1);
}

/* ---------- 2. the generation's own annotation is provenance, not a new version ---------- */
{
  const base = row('m2', 't1', toolResult('exit 0'));
  const annotated = row('m2', 't1', toolResult('exit 0'), { history_artifact: TRIM_DECLARATION });
  const id = buildMessageIdentity([occ(base, 0, 'dB'), occ(annotated, 1, 'dC')]);
  check('history_artifact alone does not make a version', id.identities.get('m2').versions.length, 1);
  check('...and is not reported as a difference', id.stats.unclassified, 0);
  check('...while the generation is still recognised as trimmed', [...id.trimmedGenerations], [1]);
}

/* ---------- 3. a declared trim is a second version, not a copy ---------- */
{
  const id = buildMessageIdentity([
    occ(row('m3', 't1', toolResult('exit 0')), 0, 'dD'),
    occ(row('m3', 't1', toolResult(REMOVED)), 1, 'dE'),
    occ(row('m3', 't1', toolResult(REMOVED), { history_artifact: TRIM_DECLARATION }), 1, 'dF'),
  ]);
  const versions = id.identities.get('m3').versions;
  check('a trimmed result is a second version', versions.length, 2);
  check('...marked as the runtime trimming it', versions[1].relation, 'trimmed');
  check('...and counted as trimmed', id.stats.trimmed, 1);
  check('...not as an unexplained difference', id.stats.unclassified, 0);
}

/* ---------- 4. drop any one predicate and it stops being a declared trim ---------- */
{
  // The declaration goes on the declaring generation's OWN opener row, which is where the store
  // puts it — the rows the runtime rewrote carry no annotation. Hanging it on the changed row
  // instead made every case below fail at predicate 2 for a reason that had nothing to do with the
  // case, so predicates 1 and 3 could both be removed and this section still passed.
  const mk = (label, expected, opts = {}) => {
    const older = row('m4', 't1', toolResult('exit 0'));
    const newer = row('m4', 't1', toolResult(REMOVED));
    (opts.mutate ?? (() => {}))(older, newer);
    const occurrences = [occ(older, 0, 'dG'), occ(newer, 1, 'dH')];
    if (opts.declare !== false) {
      occurrences.push(occ(row('op', 't0', user('carry on'), { history_artifact: TRIM_DECLARATION }), 1, 'dI'));
    }
    const id = buildMessageIdentity(occurrences);
    check(label, id.stats.trimmed, expected);
    return id;
  };

  // Without this the whole section could pass with the fixture shape itself broken.
  mk('a declared trim is recognised in the shape the store actually writes', 1);

  // Only predicate 1 can catch this one: the roles are equal to each other, so "everything but the
  // content is the same" holds. A role that was never a tool result is not something a trim makes.
  mk('a role that was never a tool result is never a trim, however else the two rows match', 0, {
    mutate: (older, newer) => { older.message.role = 'user'; newer.message.role = 'user'; },
  });
  mk('a role change is never a trim', 0, {
    mutate: (older, newer) => { newer.message.role = 'assistant'; },
  });
  mk('a change outside the content is never a trim', 0, {
    mutate: (older, newer) => { newer.message.toolName = 'grep'; },
  });
  mk('changed content that is not the placeholder is never a trim', 0, {
    mutate: (older, newer) => { newer.message.content = [{ type: 'text', text: 'something else entirely' }]; },
  });
  const noDeclaration = mk('a rewrite no generation declared is never a trim', 0, { declare: false });
  check('...and it is reported rather than thrown away', noDeclaration.stats.unclassified, 1);
  check('...which is a difference, not a failure', noDeclaration.stats.conflicts, 0);
}

/* ---------- 5. rows with no usable id are never keyed together ---------- */
{
  const noId = { message: toolResult('x'), turn_id: 't9' };
  const emptyId = { message_id: '', turn_id: 't9', message: toolResult('x') };
  const numericId = { message_id: 7, turn_id: 't9', message: toolResult('x') };
  const id = buildMessageIdentity([occ(noId, 0, 'z1'), occ(emptyId, 0, 'z2'), occ(numericId, 0, 'z3')]);
  check('no usable id means no identity at all', id.identities.size, 0);
  check('...and all three pass through', id.stats.unkeyed, 3);
  check('...into the view', selectIdentityView(id, null).rows.length, 3);
}

/* ---------- 6. turn and role decide which projection a message belongs to ---------- */
{
  const id = buildMessageIdentity([
    occ(row('m5', 't1', user('do it')), 0, 'e1'),
    occ(row('m5', 't2', user('do it')), 1, 'e2'),
  ]);
  check('a turn_id conflict is reported', id.conflicts.map((c) => c.reason), ['turn_id']);
  const role = buildMessageIdentity([
    occ(row('m6', 't1', user('do it')), 0, 'e3'),
    occ(row('m6', 't1', toolResult('done')), 1, 'e4'),
  ]);
  check('a role conflict is reported too', role.conflicts.map((c) => c.reason), ['role']);
}

/* ---------- 7. the two views show different versions of the same message ---------- */
{
  const shared = buildMessageIdentity([
    occ(row('k1', 't1', toolResult('exit 0')), 0, 'f1'),
    occ(row('k1', 't1', toolResult('exit 0')), 1, 'f2'),
    occ(row('k2', 't1', user('go')), 0, 'f3'),
    occ(row('k2', 't1', user('go')), 1, 'f4'),
    occ(row('k3', 't1', toolResult('boom')), 0, 'f5'),
    occ(row('k3', 't1', toolResult(REMOVED), { history_artifact: TRIM_DECLARATION }), 1, 'f6'),
  ]);
  const all = selectIdentityView(shared, null);
  check('the whole lineage shows one row per message', all.rows.length, 3);
  check('...and it shows the original, never the placeholder',
    all.rows.filter((r) => JSON.stringify(r.message.content).includes('Tool result removed')).length, 0);
  check('...keeping the full result', all.rows.some((r) => JSON.stringify(r.message.content).includes('exit 0')), true);

  const g0 = selectIdentityView(shared, 0);
  const g1 = selectIdentityView(shared, 1);
  check('generation 0 holds all three', g0.rows.length, 3);
  check('generation 1 holds all three', g1.rows.length, 3);
  check('...where generation 1 stores the placeholder',
    g1.rows.filter((r) => JSON.stringify(r.message.content).includes('Tool result removed')).length, 1);
  check('...and generation 0 does not',
    g0.rows.filter((r) => JSON.stringify(r.message.content).includes('Tool result removed')).length, 0);
  // 3 + 3 - 3 shared = 3: the generation counts are overlapping sets, and their sum is 6.
  assert('generation counts overlap, so their sum is not the lineage count',
    g0.rows.length + g1.rows.length !== all.rows.length);
}

/* ---------- 8. a message only in one generation is absent from the other ---------- */
{
  const id = buildMessageIdentity([
    occ(row('o1', 't1', user('old')), 0, 'g1'),
    occ(row('o2', 't1', user('new')), 1, 'g2'),
  ]);
  check('generation 0 sees only its own', selectIdentityView(id, 0).rows.length, 1);
  check('generation 1 sees only its own', selectIdentityView(id, 1).rows.length, 1);
  check('the lineage sees both', selectIdentityView(id, null).rows.length, 2);
}

/* ---------- 9. the turn opener is decided over the lineage, not over the slice ---------- */
{
  // A steer whose turn opened in generation 0. Projecting generation 1 alone must not turn it into
  // the turn's first visible prompt, because the opener is known from the whole lineage.
  const id = buildMessageIdentity([
    occ(row('p1', 't7', user('start the work')), 0, 'h1'),
    occ(row('p2', 't7', user('no, the other one')), 1, 'h2'),
  ]);
  check('the opener is the first prompt of the turn', id.openers.get('t7'), 'p1');

  // The point of computing this over the lineage: the opener's own row may be outside the slice
  // being projected, and the classification still has to name it.
  const split = buildMessageIdentity([
    occ(row('s1', 'tA', user('open it')), 0, 'h3'),
    occ(row('s2', 'tA', user('steer it')), 1, 'h4'),
  ]);
  check('the opener is known from another generation', split.openers.get('tA'), 's1');
  const laterOnly = selectIdentityView(split, 1);
  assert('the opener is not a row in the generation-1 slice',
    laterOnly.rows.length === 1 && laterOnly.rows[0].message_id === 's2');
  assert('yet the opener map still names it, so this prompt is not the turn opener',
    laterOnly.rows[0].message_id !== split.openers.get('tA'));

  const injected = buildMessageIdentity([occ(row('r1', 't9', user('<system-reminder>noise</system-reminder>')), 0, 'h5')]);
  assert('an injected block does not open a turn', injected.openers.has('t9') === false);
}

/* ---------- 10. the numbers the payload promises are identity numbers ---------- */
{
  // Four stored rows, two logical messages. `g1` is sealed in generation 0 and re-recorded in
  // generation 1 — once with the same bytes, once with the placeholder the runtime wrote when it
  // trimmed the old tool result. `g2` is a prompt that only ever lived in generation 1.
  const gen = (id, generation, message, extra) => ({ row: row(id, 't1', message, extra), generation, locator: { digest: id + '@' + generation } });
  const table = buildMessageIdentity([
    gen('g1', 0, toolResult('exit 0')),
    gen('g2', 1, user('go')),
    gen('g1', 1, toolResult('exit 0')),
    gen('g1', 1, toolResult(REMOVED), { history_artifact: TRIM_DECLARATION }),
  ]);
  check('a message stored three times is one message', table.stats.identities, 2);
  check('...of which one copy is byte-identical', table.stats.identical, 1);
  check('...and one is a trimmed second version', table.stats.trimmed, 1);

  const counts = [...logicalCountByGeneration(table)].sort((a, b) => a[0] - b[0]);
  check('each generation reports the messages it stores, once each', counts, [[0, 1], [1, 2]]);
  assert('the per-generation counts overlap rather than summing to the conversation',
    counts.reduce((sum, [, n]) => sum + n, 0) !== table.stats.identities);

  const all = selectIdentityView(table, null);
  const payload = buildTrajectoryPayload({
    session: { id: 'mvs_i' },
    rows: all.rows,
    generations: [{ generation: 0, messageCount: 900, active: false }, { generation: 1, messageCount: 800, active: true }],
    identity: table,
    openerByTurn: all.openerByTurn,
  });
  check('messagesAll is the logical message count, not the catalog rows', payload.stats.messagesAll, 2);
  check('the physical row count is reported beside it', payload.stats.messageRowsAll, 4);
  check('...and what is on screen agrees in the whole-lineage view', payload.stats.messages, 2);
  check('the generations carry their own stored counts',
    payload.session.generations.map((g) => g.logicalMessageCount), [1, 2]);

  const slice = selectIdentityView(table, 0);
  const slicePayload = buildTrajectoryPayload({
    session: { id: 'mvs_i' },
    rows: slice.rows,
    generations: [{ generation: 0, messageCount: 900, active: false }, { generation: 1, messageCount: 800, active: true }],
    identity: table,
    openerByTurn: slice.openerByTurn,
  });
  check('a slice shows only its own messages', slicePayload.stats.messages, 1);
  check('...while the session-wide count does not follow it down', slicePayload.stats.messagesAll, 2);

  // The opener a view reports has to be the very row that view projects. Matching on the
  // occurrence wrapper instead of the row finds nothing, because the identity table wraps every
  // occurrence in an object of its own — and then every turn looks like its opener is missing.
  assert('the opener is found by row identity inside the view that holds it',
    all.openerByTurn.get('t1').row === all.rows.find((r) => r.message_id === 'g2'));
  assert('...and the direct helper agrees with the view it came from',
    openerRowsForView(table, all.occurrences).get('t1').row === all.openerByTurn.get('t1').row);
  check('...while a view without the opener reports it as absent, not as unknown',
    slice.openerByTurn.get('t1').row, null);
}

/* ---------- report ---------- */
console.log(`[1] message identity: ${pass} assertions, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  console.log('verify-message-identity');
  process.exit(1);
}
console.log('verify-message-identity');
