// Produce the `/api/trajectory` payload offline, from the committed fixture store.
//
//   node tests/make-payload.mjs            report, write nothing
//   node tests/make-payload.mjs --record   rewrite fixtures/trajectory.json
//   node tests/make-payload.mjs --check    fail if the committed payload is stale
//
// Five guards want one `/api/trajectory` body and used to get it by booting the service and
// fetching from it, which meant a port, a listener, and a machine that had sessions. The route
// at server.mjs:1925 is `buildTrajectoryPayload(...)` plus a handful of `session.*` fields, so
// the same body falls out of the fixture store offline.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as server from '../miniapp/node/server.mjs';

const { resolveSessionsRoot, collectSessionEntries, readSessionIdentity, readHead,
  parseMessagesJsonl, buildTrajectoryPayload, createRedactor } = server;

const HERE = fileURLToPath(new URL('.', import.meta.url));
const USE_REAL = process.argv.includes('--real');
const FIXTURE_HOME = join(HERE, 'fixtures', 'minimax-home');
const OUT = join(HERE, 'fixtures', 'trajectory.json');

const location = USE_REAL ? resolveSessionsRoot() : resolveSessionsRoot({ MAVIS_HOME: FIXTURE_HOME });
const entries = await collectSessionEntries(location.sessionsRoot);
if (!entries.length) {
  console.error(`no sessions under ${location.sessionsRoot} -- run make-fixtures.mjs --record first`);
  process.exit(2);
}

/**
 * Which session the fixture is recorded from.
 *
 * It used to be `entries[0]` — the most recently touched one. That is not a rule, it is a
 * timestamp, and it changed the answer without anyone deciding it should: re-recording the fixture
 * on a machine whose store had been touched since silently replaced 23 turns and 88 records with
 * 1 turn and 103, taking with it every guard value that was calibrated on the old one. The
 * committed fixture was still passing its guards afterwards, which is exactly why nothing caught
 * it — a guard that reads a stale fixture is testing a payload the server cannot produce.
 *
 * So: the session with the most turns, ties broken by name. Deterministic, and stated.
 *
 * @param {Array<any>} candidates
 * @param {(entry: any) => Promise<{ turns: any[] }>} project
 */
async function pickEntry(candidates, project) {
  let best = null;
  let bestTurns = -1;
  for (const candidate of candidates) {
    let payload;
    try { payload = await project(candidate); } catch { continue; }
    const turns = Array.isArray(payload.turns) ? payload.turns.length : 0;
    if (turns > bestTurns || (turns === bestTurns && best !== null && String(candidate.dir) < String(best.dir))) {
      best = candidate;
      bestTurns = turns;
    }
  }
  return best;
}

const readOne = async (entry) => {
  // The entry carries no id — `readSessionIdentity` is where one comes from, and a payload whose
  // `session.id` is undefined would quietly make every session-keyed guard assert nothing.
  const identity = await readSessionIdentity(entry.dir);
  const head = await readHead(join(entry.dir, 'messages.jsonl'), entry.sizeBytes);
  const parsed = parseMessagesJsonl(head.text);
  const redact = createRedactor([location.sessionsRoot, location.root]);
  return { head, parsed, payload: buildTrajectoryPayload({
    session: { id: identity.id, createdAtMs: entry.lastActiveAt },
    rows: parsed.rows, sizeBytes: head.size, truncated: head.read < head.size, redact,
  }) };
};

const entry = USE_REAL ? entries[0] : await pickEntry(entries, readOne);
if (!entry) {
  console.error('no fixture session could be projected');
  process.exit(2);
}
const built = await readOne(entry);
const { head, parsed, payload } = built;
const redact = createRedactor([location.sessionsRoot, location.root]);

// the fields the route sets after building; kept in step with server.mjs:1935-1952
payload.session.lastActiveAt = entry.lastActiveAt;
payload.session.activeGeneration = null;
payload.session.stitched = false;
payload.session.binding = 'fixture';
payload.session.leased = false;

// The fixture store is already synthetic, but this file gets committed: assert it, do not assume.
// --real deliberately reports on real transcripts, which do contain paths, so it is not asserted.
const text = JSON.stringify(payload);
if (!USE_REAL) {
  for (const re of [/[A-Za-z]:[\\/]/, /\/Users\//, /\bava\b/, /\.minimax/i]) {
    const at = text.match(re);
    if (at) {
      console.error(`payload leak ${re}: ${JSON.stringify(text.slice(Math.max(0, at.index - 60), at.index + 80))}`);
      process.exit(1);
    }
  }
}

const flat = payload.turns.flatMap((t) => t.records);
console.log(`session   : ${payload.session.id}${USE_REAL ? '  (real store)' : ''}`);
console.log(`turns     : ${payload.turns.length}  records: ${flat.length}  rows: ${parsed.rows.length} (${parsed.skipped} skipped)`);
console.log(`kinds     : ${[...new Set(flat.map((r) => r.kind))].sort().join(', ')}`);
console.log(`anomalies : toolError=${flat.filter((r) => r.isError === true).length}`
  + `  compaction=${flat.filter((r) => r.kind === 'compaction').length}`
  + `  openTurns=${payload.turns.filter((t) => t.closed === false).length}`
  + `  silentReplies=${flat.filter((r) => r.kind === 'reply' && r.hasText === false).length}`);
console.log(`size      : ${(text.length / 1024).toFixed(0)} KB -> ${OUT}`);

if (process.argv.includes('--check')) {
  let current = null;
  try { current = readFileSync(OUT, 'utf8'); } catch { /* missing */ }
  if (current === text) { console.log('payload up to date'); process.exit(0); }
  console.log(`payload OUT OF DATE (${current ? current.length : 0} -> ${text.length} chars)`);
  process.exit(1);
}
if (!process.argv.includes('--record')) {
  console.log('\n(dry run -- pass --record to write)');
  process.exit(0);
}

/**
 * What the guards read this file for. `--record` refuses without all of it.
 *
 * `make-fixtures.mjs` gates the session store the same way. This one had no gate at all, and the
 * store is synthetic but the choice of session was not: recording from a session without an empty
 * reply silently deletes the only fixture the 空答复 rule is tested on, and every guard reading it
 * afterwards asserts against a shape that is not there.
 *
 * `silent` is counted off `hasText`, not off `text`: the flag is what the page decides with now,
 * and a coverage count read off a field the payload no longer carries would read zero for a
 * fixture that is perfectly good.
 */
const coverage = {
  turns: payload.turns.length,
  toolError: flat.filter((r) => r.isError === true).length,
  compaction: flat.filter((r) => r.kind === 'compaction').length,
  openTurns: payload.turns.filter((t) => t.closed === false).length,
  silent: flat.filter((r) => r.kind === 'reply' && r.hasText === false).length,
};
const missing = Object.entries(coverage).filter(([, n]) => n < 1).map(([name]) => name);
if (missing.length) {
  console.error(`refusing to record: the fixture would have no ${missing.join(', ')}`);
  console.error('the guards that read this file assert on those, and would go quietly vacuous');
  process.exit(1);
}
writeFileSync(OUT, text, 'utf8');
console.log('\nwritten');
