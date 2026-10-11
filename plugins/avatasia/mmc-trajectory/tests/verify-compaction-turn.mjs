// The runtime writes a turn's compaction checkpoint under "<turnId>:compaction" while every row
// after it carries the bare id. Keying on the whole string gave the checkpoint a turn of its own,
// emitted after the whole turn it interrupts. These checks pin the corrected grouping.
//
// Read-only: imports the pure builder, never starts the runtime.
import { buildTrajectoryPayload } from '../miniapp/node/server.mjs';

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

const T = 1_700_000_000_000;
const user = (turn, text, at) => ({
  message_id: `u-${turn}`,
  turn_id: turn,
  message: { role: 'user', content: [{ type: 'text', text }], timestamp: at },
});
const assistant = (turn, text, at) => ({
  message_id: `a-${turn}`,
  turn_id: turn,
  message: { role: 'assistant', content: [{ type: 'text', text }], timestamp: at, stopReason: 'stop' },
});
const checkpoint = (turn, generation, at) => ({
  message_id: `c-${turn}`,
  turn_id: `${turn}:compaction`,
  history_artifact: { generation, parentSnapshot: { generation: generation - 1 } },
  message: { role: 'compactionSummary', content: [{ type: 'text', text: 'summary' }], timestamp: at },
});

/* ---- a turn interrupted by a compaction stays one turn, in order ---- */
const TURN = 'turn-1';
const payload = buildTrajectoryPayload({
  session: { id: 'mvs_1', createdAtMs: T },
  rows: [
    user(TURN, 'do the thing', T),
    assistant(TURN, 'working on it', T + 1000),
    checkpoint(TURN, 1, T + 2000),
    assistant(TURN, 'done', T + 3000),
  ],
});

check('the checkpoint does not open a turn of its own', payload.turns.length, 1);
check(
  'every record is in that one turn',
  payload.turns[0].records.map((r) => r.kind),
  ['user', 'reply', 'compaction', 'reply'],
);
check('indexes run 1..n with no gap', payload.turns[0].records.map((r) => r.index), [1, 2, 3, 4]);
check('the turn keeps the bare id it interrupted', payload.turns[0].id, TURN);
assert(
  'the turn is classified by what it did, not by the checkpoint inside it',
  payload.turns[0].turnClass !== 'compaction',
);
check('the checkpoint is still counted as a record', payload.stats.compactions, 1);
check('no turn is left classified as a checkpoint', payload.stats.compactionTurns, 0);
// A record has to name a turn that exists. The file's suffixed id names none, so leaving it on
// the record is how a checkpoint ends up claiming a turn the payload never contains.
check(
  'every record names a turn that exists',
  payload.turns.every((t) => t.records.every((r) => r.turnId === t.id)),
  true,
);
check('the checkpoint record names that turn', payload.turns[0].records[2].turnId, TURN);

/* ---- the suffix is only stripped from an actual checkpoint ---- */
// Same id shape, but an ordinary assistant row. It must keep its own turn: the rule is gated on
// the role, not on the string, so a turn genuinely named "...:compaction" is not swallowed.
const impostor = buildTrajectoryPayload({
  session: { id: 'mvs_1', createdAtMs: T },
  rows: [
    user(TURN, 'hello', T),
    assistant(TURN, 'hi', T + 10),
    { message_id: 'x', turn_id: `${TURN}:compaction`, message: { role: 'assistant', content: [{ type: 'text', text: 'not a checkpoint' }], timestamp: T + 20 } },
  ],
});
check('a non-checkpoint keeps its own turn', impostor.turns.length, 2);
check('and it is not counted as a compaction', impostor.stats.compactions, 0);

/* ---- a bare suffix must not collapse into the turn-less bucket ---- */
// turn_id exactly ":compaction" strips to "", which is the key every row with no turn_id uses.
// Guarded by the length check so it stays its own turn instead of merging with all of them.
// Built inline rather than through `checkpoint()`, which would have made it ":compaction:compaction".
const bareCheckpoint = {
  message_id: 'bare',
  turn_id: ':compaction',
  history_artifact: { generation: 1, parentSnapshot: { generation: 0 } },
  message: { role: 'compactionSummary', content: [{ type: 'text', text: 'summary' }], timestamp: T + 5 },
};
const bare = buildTrajectoryPayload({
  session: { id: 'mvs_1', createdAtMs: T },
  rows: [
    { message_id: 'n1', message: { role: 'user', content: [{ type: 'text', text: 'no turn id' }], timestamp: T } },
    bareCheckpoint,
  ],
});
check('a bare ":compaction" id stays separate from turn-less rows', bare.turns.length, 2);
check('and the turn-less row is still first', bare.turns[0].records[0].kind, 'user');

/* ---- a turn with no prompt and no reply is not a checkpoint just for holding one ---- */
// It is a stretch of work the file never opened. Calling it a checkpoint would take it out of the
// prompted count and name it after something it is not.
// Built without the prompt on purpose: what is under test is the classification of a turn that
// holds a checkpoint alongside work but was never opened by the reader.
const workOnly = buildTrajectoryPayload({
  session: { id: 'mvs_1', createdAtMs: T },
  rows: [
    checkpoint('turn-w', 1, T + 10),
    { message_id: 'c1', turn_id: 'turn-w', message: { role: 'toolCall', content: [{ type: 'toolCall', name: 'bash' }], timestamp: T + 20 } },
    { message_id: 'c2', turn_id: 'turn-w', message: { role: 'toolResult', content: [{ type: 'text', text: 'ok' }], timestamp: T + 30 } },
  ],
});
assert('a turn holding work and a checkpoint is not classed as a checkpoint', workOnly.turns[0].turnClass !== 'compaction');
check('it counts as a turn without a prompt', workOnly.stats.turnsWithoutPrompt, 1);
check('and it is not in the prompted count either', workOnly.stats.turnsWithPrompt, 0);

/* ---- two turns separated by a checkpoint each keep their own ---- */
const both = buildTrajectoryPayload({
  session: { id: 'mvs_1', createdAtMs: T },
  rows: [
    user('turn-a', 'first', T),
    checkpoint('turn-a', 1, T + 10),
    assistant('turn-a', 'a done', T + 20),
    user('turn-b', 'second', T + 1000),
    checkpoint('turn-b', 2, T + 1010),
    assistant('turn-b', 'b done', T + 1020),
  ],
});
check('two turns stay two turns', both.turns.map((t) => t.id), ['turn-a', 'turn-b']);
check('each turn keeps its own checkpoint', both.turns.map((t) => t.records.length), [3, 3]);
check('indexes are contiguous across both', both.turns.flatMap((t) => t.records.map((r) => r.index)), [1, 2, 3, 4, 5, 6]);
check('both checkpoints counted', both.stats.compactions, 2);

/* ---- timestamps going backwards inside a turn stay put ---- */
// A steer carries the time the reader typed, which is before the tool result it interrupted. The
// ledger order is causal and must not be re-sorted to hide that.
const steered = buildTrajectoryPayload({
  session: { id: 'mvs_1', createdAtMs: T },
  rows: [
    user('turn-s', 'go', T),
    { message_id: 'r1', turn_id: 'turn-s', message: { role: 'toolResult', content: [{ type: 'text', text: 'ok' }], timestamp: T + 5000 } },
    { message_id: 's1', turn_id: 'turn-s', message: { role: 'user', content: [{ type: 'text', text: 'actually, do this instead' }], timestamp: T + 1000 } },
  ],
});
check(
  'a steer stays after the tool result it interrupted',
  steered.turns[0].records.map((r) => r.kind),
  ['user', 'toolResult', 'steer'],
);
check('and its index still follows the file order', steered.turns[0].records.map((r) => r.index), [1, 2, 3]);

if (failures.length > 0) {
  console.error(`FAIL  ${failures.length} of ${pass + failures.length}`);
  for (const failure of failures) console.error('  - ' + failure);
  process.exit(1);
}
console.log(`\nALL ${pass} CHECKS PASSED`);