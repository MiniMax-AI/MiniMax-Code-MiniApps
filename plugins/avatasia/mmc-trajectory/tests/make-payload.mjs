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

// `?session=latest` resolves to the most recently touched store, which is how collectSessionEntries
// already orders them.
const entry = entries[0];
const identity = await readSessionIdentity(entry.dir);
const head = await readHead(join(entry.dir, 'messages.jsonl'), entry.sizeBytes);
const parsed = parseMessagesJsonl(head.text);
const redact = createRedactor([location.sessionsRoot, location.root]);

const payload = buildTrajectoryPayload({
  session: { id: identity.id, createdAtMs: entry.lastActiveAt },
  rows: parsed.rows,
  sizeBytes: head.size,
  truncated: head.read < head.size,
  redact,
});
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
  + `  silentReplies=${flat.filter((r) => r.kind === 'reply' && !r.text).length}`);
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
writeFileSync(OUT, text, 'utf8');
console.log('\nwritten');
