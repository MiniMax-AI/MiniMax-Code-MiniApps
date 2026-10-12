/**
 * `?since=` has to be worth trusting, and the only way to know that is to merge a real tail
 * onto a real payload and check the result against the whole thing it was cut from.
 *
 * The one assertion this file is built around:
 *
 *   mergeDelta(full, buildDeltaPayload(full, k))  ==  full
 *
 * Everything else exists to say *why* that could fail — a turn that lost its `closed`, a turn
 * appended instead of merged, a record counted twice on a replay — because a protocol that is
 * only right on the happy path is a protocol that loses records the first time a poll is
 * answered twice.
 *
 * The expected values are counted off `fixtures/trajectory.json` by code that shares nothing
 * with either side, and the merge runs the page's own functions in a vm.
 *
 * mutate-incremental.py breaks each rule below in the shipped files and requires this guard to
 * report it by name.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { buildDeltaPayload, parseSince } from '../miniapp/node/server.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE = fileURLToPath(new URL('./fixtures/trajectory.json', import.meta.url));
const HTML = fileURLToPath(new URL('../miniapp/client/index.html', import.meta.url));

const html = readFileSync(HTML, 'utf8');
const server = readFileSync(fileURLToPath(new URL('../miniapp/node/server.mjs', import.meta.url)), 'utf8');
const full = JSON.parse(readFileSync(FIXTURE, 'utf8'));

let pass = 0;
const failures = [];
function assert(name, cond) {
  if (cond) pass += 1;
  else failures.push(name);
}

function fnSource(signature) {
  const at = html.indexOf(signature);
  if (at < 0) return null;
  let depth = 0;
  let seen = false;
  for (let i = at; i < html.length; i += 1) {
    if (html[i] === '{') { depth += 1; seen = true; }
    else if (html[i] === '}') {
      depth -= 1;
      if (seen && depth === 0) return html.slice(at, i + 1);
    }
  }
  return null;
}

/** The records of a payload, flattened, as [turnIndex, recordIndex, record.id] triples. */
function shapeOf(payload) {
  const turns = Array.isArray(payload.turns) ? payload.turns : [];
  const out = [];
  for (let t = 0; t < turns.length; t += 1) {
    const records = Array.isArray(turns[t].records) ? turns[t].records : [];
    for (let r = 0; r < records.length; r += 1) {
      out.push([turns[t].index, turns[t].id, records[r].index, records[r].id]);
    }
  }
  return out;
}

/** Everything about a payload except the records, so a merge that loses `closed` is caught. */
function turnShapeOf(payload) {
  const turns = Array.isArray(payload.turns) ? payload.turns : [];
  return turns.map((turn) => ({
    id: turn.id,
    index: turn.index,
    closed: turn.closed,
    records: Array.isArray(turn.records) ? turn.records.length : -1,
  }));
}

// ---------------------------------------------------------------- the cursor

// An absent or unusable cursor is not an error. It is a page that has nothing yet, and a page
// that has nothing yet needs the whole payload — putting the first poll on a 400 would be a
// worse answer than sending 41 MB.
assert('a missing cursor is not a cursor', parseSince(null) === null);
assert('a blank cursor is not a cursor', parseSince('') === null);
assert('a whitespace cursor is not a cursor', parseSince('  ') === null);
assert('a cursor that is not a number is not a cursor', parseSince('abc') === null);
assert('a fractional cursor is not a cursor', parseSince('1.5') === null);
assert('a negative cursor is not a cursor', parseSince('-1') === null);
assert('cursor zero is a cursor', parseSince('0') === 0);
assert('a real cursor is a cursor', parseSince('7') === 7);

// ------------------------------------------------------- the tail, off the fixture

const allIndices = [];
for (const turn of full.turns) for (const record of turn.records) allIndices.push(record.index);
const UP_TO = Math.max(...allIndices);
const COUNT = allIndices.length;
assert('the fixture is read whole, so the numbers below are about something', COUNT > 20);

// The cursor is deliberately in the middle of a turn. A tail that begins at a turn boundary
// never exercises the merge-into-an-existing-turn path, which is the half that can lose a
// `closed` or double a turn.
const CUT = Math.floor(allIndices[Math.floor(COUNT / 2)]);
const delta = buildDeltaPayload(full, CUT);
assert('a mid-turn cursor still produces a tail', delta !== null);
assert('the tail is marked as a tail', delta !== null && delta.delta.since === CUT);
assert('the tail says how far the server got', delta !== null && delta.delta.upTo === UP_TO);

{
  const expected = allIndices.filter((index) => index > CUT);
  const got = [];
  for (const turn of delta.turns) for (const record of turn.records) got.push(record.index);
  assert('the tail carries every record after the cursor, and no others',
    got.length === expected.length && got.every((value, i) => value === expected[i]));
  assert('and the tail says the same count', delta.delta.records === expected.length);
}

assert('the tail is smaller than the whole thing it was cut from',
  JSON.stringify(delta).length < JSON.stringify(full).length);

// `stats` is an accumulator — every counter in it came from walking all the rows — so it
// travels whole or the page would have to re-derive the server's own arithmetic.
assert('stats travel whole, because a tail cannot be added to an accumulator',
  JSON.stringify(delta.stats) === JSON.stringify(full.stats));
assert('and so does session', JSON.stringify(delta.session) === JSON.stringify(full.session));

// A turn that gained nothing is not in the tail at all.
{
  const gained = new Set();
  for (const turn of delta.turns) for (const record of turn.records) gained.add(record.index);
  for (const turn of full.turns) {
    const any = turn.records.some((record) => gained.has(record.index));
    if (!any) {
      assert('a turn that gained no records is absent from the tail',
        !delta.turns.some((incoming) => incoming.id === turn.id));
      break;
    }
  }
}

// A turn travels whole, with only its records cut down. `closed` in particular: the live turn
// is the one where it decides whether rows are anomalies at all, and a partial turn would
// leave the page holding a stale `false` for exactly that one.
{
  // In a stitched fixture the turn still being written into is not the last one — this
  // fixture's last turn is closed and turns 2..22 are not.
  const liveTurn = full.turns.filter((turn) => turn.closed === false).pop() ?? null;
  assert('the fixture has a turn still being written into', liveTurn !== null);
  const carried = liveTurn !== null
    && liveTurn.records.some((record) => record.index > CUT)
    ? delta.turns.find((turn) => turn.id === liveTurn.id)
    : null;
  assert('an unclosed turn that gained records is in the tail', carried !== null);
  if (carried !== null && carried !== undefined) {
    assert('and it carries its own closed flag, not a default',
      carried.closed === liveTurn.closed);
    assert('and its identity', carried.index === liveTurn.index && carried.id === liveTurn.id);
  }
}

// Nothing new is still a tail, and it is an empty one. The 304 would normally have caught this
// case first, which is exactly why an empty tail has to be correct rather than merely rare.
{
  const empty = buildDeltaPayload(full, UP_TO);
  assert('a cursor at the very end produces an empty tail rather than a whole payload',
    empty !== null && empty.delta.records === 0 && empty.turns.length === 0);
  assert('and that tail still travels stats whole', JSON.stringify(empty.stats) === JSON.stringify(full.stats));
}

// The page being *ahead* of the server is what a generation switch looks like from here. A tail
// from there would be empty, and an empty tail is indistinguishable from "nothing to add".
assert('a cursor past the end produces no tail at all', buildDeltaPayload(full, UP_TO + 1) === null);
assert('a cursor past the end by a lot produces no tail either', buildDeltaPayload(full, UP_TO + 1000) === null);
assert('a negative cursor produces no tail', buildDeltaPayload(full, -1) === null);
assert('a fractional cursor produces no tail', buildDeltaPayload(full, 2.5) === null);
assert('a payload with no turns produces no tail', buildDeltaPayload({ session: {}, stats: {}, turns: [] }, 0) === null);
assert('a cursor of zero is the whole thing', JSON.stringify(buildDeltaPayload(full, 0).turns) === JSON.stringify(full.turns));

// --------------------------------------------------------------- the merge, run

const page = { console };
vm.createContext(page);
for (const name of ['mergeTurnRecords', 'mergeDelta', 'payloadCursor']) {
  const src = fnSource('function ' + name + '(');
  if (!src) throw new Error('could not extract ' + name);
  vm.runInContext(src, page);
}

/**
 * The headline. Laying a tail onto the payload it was cut from has to give back the payload,
 * not something close to it — same turns, same order, same `closed`, same records once each.
 */
for (const cut of [0, 1, CUT, Math.max(1, CUT - 1), Math.min(UP_TO, CUT + 1), UP_TO]) {
  const tail = buildDeltaPayload(full, cut);
  if (tail === null) continue;
  const merged = page.mergeDelta(full, tail);
  assert(`mergeDelta at cursor ${cut} gives back the turns it started from`,
    JSON.stringify(turnShapeOf(merged)) === JSON.stringify(turnShapeOf(full)));
  assert(`mergeDelta at cursor ${cut} gives back every record exactly once`,
    JSON.stringify(shapeOf(merged)) === JSON.stringify(shapeOf(full)));
}

// A protocol that is only right on the happy path loses records the first time a poll is
// answered twice. Replaying the same tail must change nothing.
{
  const once = page.mergeDelta(full, buildDeltaPayload(full, CUT));
  const twice = page.mergeDelta(once, buildDeltaPayload(full, CUT));
  assert('replaying the same tail changes nothing',
    JSON.stringify(shapeOf(twice)) === JSON.stringify(shapeOf(once)));
  assert('and does not duplicate a single record',
    shapeOf(twice).length === shapeOf(full).length);
}

// Replaying out of order, and a tail whose cursor is behind what is already held, both happen
// when a response is retried or when two polls overlap.
{
  const near = buildDeltaPayload(full, CUT);
  const far = buildDeltaPayload(full, Math.max(0, CUT - 5));
  const merged = page.mergeDelta(page.mergeDelta(full, near), far);
  assert('a tail older than what is already held adds nothing',
    JSON.stringify(shapeOf(merged)) === JSON.stringify(shapeOf(full)));
}

// Merging onto nothing is what a page that lost its payload has to survive.
{
  const fresh = page.mergeDelta(null, buildDeltaPayload(full, CUT));
  assert('merging onto no payload yields the tail itself, not a crash',
    Array.isArray(fresh.turns) && fresh.turns.length === buildDeltaPayload(full, CUT).turns.length);
  assert('and it is a payload, session and stats included',
    JSON.stringify(fresh.stats) === JSON.stringify(full.stats));
}

assert('the cursor of the whole payload is its highest record index',
  page.payloadCursor(full) === UP_TO);
assert('the cursor of an empty payload is zero, not NaN',
  page.payloadCursor({ turns: [] }) === 0 && page.payloadCursor(null) === 0);

// ------------------------------------------------- the reason a turn travels whole

// The fixture cannot show this, because nothing in it is still growing. So hand-build the case
// that matters, with every expected value written out rather than counted:
//
//   before   t1 closed [r1 r2]   t2 open   [r3]        the page, at record 3
//   after    t1 closed [r1 r2]   t2 CLOSED [r3 r4]     the session moves on: r4 arrives, t2 ends
//   tail     (from cursor 3)     t2 CLOSED [r4]        one record, and the turn it was in has
//                                                           turned from open to closed
//
// 无答复 is decided by `closed`, so a merge that kept the turn fields it already had would
// leave the page calling a finished turn unanswered, and the button's count would disagree
// with the ledger for exactly those rows.
{
  const t1 = { id: 't1', index: 1, closed: true, records: [{ id: 'r1', index: 1 }, { id: 'r2', index: 2 }] };
  const t2open = { id: 't2', index: 2, closed: false, records: [{ id: 'r3', index: 3 }] };
  const t2closed = {
    id: 't2', index: 2, closed: true,
    records: [{ id: 'r3', index: 3 }, { id: 'r4', index: 4 }],
  };
  const before = { session: { id: 's1' }, stats: { messages: 3 }, turns: [t1, t2open] };
  const after = { session: { id: 's1' }, stats: { messages: 4 }, turns: [t1, t2closed] };

  const tail = buildDeltaPayload(after, 3);
  assert('the tail from cursor 3 is one turn with one record',
    tail !== null && tail.turns.length === 1 && tail.delta.records === 1);
  assert('and that turn is t2, closed, carrying only r4',
    tail.turns[0].id === 't2' && tail.turns[0].closed === true
    && tail.turns[0].records.length === 1 && tail.turns[0].records[0].id === 'r4');
  assert('and the untouched turn t1 is not in the tail at all',
    !tail.turns.some((turn) => turn.id === 't1'));

  const merged = page.mergeDelta(before, tail);
  assert('the merge takes the closed flag from the tail, not from the copy it already had',
    merged.turns[1].closed === true);
  assert('the merge keeps r3, which only the old copy had',
    merged.turns[1].records.length === 2
    && merged.turns[1].records[0].id === 'r3' && merged.turns[1].records[1].id === 'r4');
  assert('and leaves the turn it was never told about alone',
    merged.turns.length === 2 && merged.turns[0].records.length === 2);
  assert('stats came from the tail, whole', merged.stats.messages === 4);
  assert('and the merge of before+tail equals after', JSON.stringify(merged) === JSON.stringify(after));
}

// --------------------------------------------------------------- the wiring

// A cursor is only ever asked alongside the validator it was taken against. Sending one
// without the other is how a page ends up asking a server for the tail of a payload it does
// not have — which is a session switch, or a generation switch, or a manual refresh.
assert('the request carries the cursor and the validator under one condition',
  /!manual && state\.sinceFor === cacheKey && state\.since > 0[\s\S]{0,120}&since=/.test(html)
  && /state\.etag && state\.etagFor === cacheKey/.test(html));
assert('a manual refresh drops the cursor as well as the validator',
  /if \(manual\) \{\s*\n\s*state\.etag = '';\s*\n\s*state\.etagFor = '';\s*\n\s*state\.since = 0;\s*\n\s*state\.sinceFor = '';/.test(html));
// The merge is gated on the delta marker *and* on having a payload to lay it onto. Without the
// second half a delta after a session switch would be merged onto a different session's turns.
assert('the merge needs both the delta marker and a payload in hand',
  /var mergeable = body && body\.delta && state\.payload && Array\.isArray\(state\.payload\.turns\);/.test(html));
// The server cuts the tail only on the fresh-build path. The cached path serves the bytes it
// already has, and reaching it with a cursor means the session changed anyway.
assert('the server cuts a tail only where it has just built the payload',
  /const delta = since === null \? null : buildDeltaPayload\(payload, since\);/.test(server));
assert('and it still sends the whole body when there is no cursor',
  /sendJsonBody\(response, 200, delta === null \? body : JSON\.stringify\(delta\)/.test(server));
// The cursor the page sends next is the server's own word, not a re-walk of the records.
assert('the cursor after a delta is the server upTo, not a second walk',
  /state\.since = mergeable \? body\.delta\.upTo : payloadCursor\(payload\);/.test(html));

// ---------------------------------------------------------------- reporting

for (const name of failures) console.log('FAIL ' + name);
console.log(pass + ' checks passed' + (failures.length ? ', ' + failures.length + ' FAILED' : ', ALL PASSED'));
process.exit(failures.length ? 1 : 0);
