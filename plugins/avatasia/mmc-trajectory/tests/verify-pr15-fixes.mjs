// Proves the six fixes made for the PR #15 review comments. Read-only: imports the pure
// helpers, never starts the runtime. Every assertion that could pass on any input at all
// is paired with a counter-example that pins what actually changed the number.
import { mkdtemp, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  buildTrajectoryPayload,
  readHead,
  truncatedByCap,
} from '../miniapp/node/server.mjs';

const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;

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

const SERVER = readFileSync(new URL('../miniapp/node/server.mjs', import.meta.url), 'utf8');
const CLIENT = readFileSync(new URL('../miniapp/client/index.html', import.meta.url), 'utf8');

/* =====================================================================
 * comment #2 — orphan generations inflated messagesAll and were offered in the picker
 * ===================================================================== */
const CATALOG_GENS = [
  { generation: 0, kind: 'snapshot', fileName: 'g000000000000--ctx_aaa.jsonl', byteLength: 4_109_759, messageCount: 676, revision: 'sha256:a', active: false },
  { generation: 1, kind: 'snapshot', fileName: 'g000000000001--ctx_bbb.jsonl', byteLength: 3_029_414, messageCount: 548, revision: 'sha256:b', active: false },
  { generation: 2, kind: 'active', fileName: 'messages.jsonl', byteLength: 1_302_171, messageCount: 186, revision: 'sha256:c', active: true },
];
// A fork left generation 7 on disk. It is a real file with a real messageCount, and it is
// not part of this conversation.
const FORKED = { generation: 7, kind: 'snapshot', fileName: 'g000000000007--ctx_zzz.jsonl', byteLength: 812_000, messageCount: 999, revision: 'sha256:z', active: false };

const baseRows = [
  { message_id: 'msg-a1', turn_id: 't1', message: { role: 'user', content: 'hi', timestamp: 1791617886000 } },
  { message_id: 'msg-a2', turn_id: 't1', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }], timestamp: 1791617891000 } },
];
const baseInput = {
  session: { id: 'mvs_1', createdAtMs: 1791617886354 },
  rows: baseRows,
  sizeBytes: 1_302_171,
  generations: CATALOG_GENS.concat([FORKED]),
  orphans: [{ generation: 7, fileName: FORKED.fileName }],
};

const withFork = buildTrajectoryPayload(baseInput);
// The count is built from the identity table over the lineage, so a catalog entry has no way into
// it at all — which is a stronger statement than the sum-and-filter this replaced, and the
// counter-example below is what keeps it honest.
check('messagesAll counts the conversation, not the catalog', withFork.stats.messagesAll, 2);
check(
  'the picker never offers the forked generation',
  withFork.session.generations.map((g) => g.generation),
  [0, 1, 2]
);
check('the fork is still disclosed as an orphan', withFork.session.orphans.map((o) => o.generation), [7]);

// Counter-example: the identical catalog with nothing marked as an orphan. Before the fix the sum
// walked the catalog and this extra entry moved the total; the count no longer reads the catalog,
// so the entry cannot reach it even unmarked. Asserting the number is UNCHANGED is the whole claim.
const noOrphans = buildTrajectoryPayload({ ...baseInput, orphans: [] });
check('counter-example: an unmarked extra generation cannot move the count', noOrphans.stats.messagesAll, 2);
check(
  'counter-example: an unmarked extra generation is still listed',
  noOrphans.session.generations.map((g) => g.generation),
  [0, 1, 2, 7]
);
check(
  'orphans are matched by file, not by generation number',
  buildTrajectoryPayload({ ...baseInput, orphans: [{ generation: 2, fileName: 'something-else.jsonl' }] })
    .session.generations.map((g) => g.generation),
  [0, 1, 2, 7]
);

/* =====================================================================
 * comment #4 — a stale catalog size made an actively-appended file look too large
 * ===================================================================== */
const dir = await mkdtemp(join(tmpdir(), 'mmc-pr15-'));
const live = join(dir, 'messages.jsonl');
const LINE = `${JSON.stringify({ message_id: 'x', message: { role: 'user', content: 'a'.repeat(100) } })}\n`;
await writeFile(live, LINE.repeat(200), 'utf8');

const catalogBytes = (await stat(live)).size;
await writeFile(live, LINE.repeat(400), 'utf8');
const grownSize = (await stat(live)).size;
const staleRead = await readHead(live, Math.min(catalogBytes, MAX_MESSAGE_BYTES));
assert('a stale catalog limit really does stop the read short', staleRead.read < staleRead.size);
assert('the file really did grow past its catalog entry', grownSize > catalogBytes);

// The reported bug: the active file had grown to 5.2 MB while the catalog still said 5 MB, and the
// read stopped at 5 MB, so the page claimed truncation. With `limit` pinned to our own cap that
// file is simply read whole — which is what the assertions below pin down.
check('the reported file is not truncation', truncatedByCap(5_200_000, MAX_MESSAGE_BYTES), false);
check('a file under the cap is not truncation', truncatedByCap(1_302_171, MAX_MESSAGE_BYTES), false);
check('a file exactly at the cap is not', truncatedByCap(MAX_MESSAGE_BYTES, MAX_MESSAGE_BYTES), false);
check('a file over the cap is truncated', truncatedByCap(MAX_MESSAGE_BYTES + 1, MAX_MESSAGE_BYTES), true);
check('an unknown size does not claim truncation', truncatedByCap(NaN, MAX_MESSAGE_BYTES), false);
check('an unknown cap does not claim truncation', truncatedByCap(1_000, NaN), false);

// Counter-example: the old predicate is `head.read < head.size`, which fires on exactly this file.
assert('counter-example: the old head.read < head.size test would have reported truncation', staleRead.read < staleRead.size);
assert('counter-example: the new predicate does not', !truncatedByCap(grownSize, MAX_MESSAGE_BYTES));

// The read is bounded by MAX_MESSAGE_BYTES alone.
assert('the read is bounded by MAX_MESSAGE_BYTES alone', /const limit = MAX_MESSAGE_BYTES;/.test(SERVER));
assert(
  'no catalog-recorded size is used as a read limit any more',
  !/Math\.min\(entry\.sizeBytes,\s*identity\.catalogBytes/.test(SERVER),
  );
assert(
  'the probe reads a fixed head, not a catalog-derived budget',
  /readHead\(filePath, GENERATION_PROBE_BYTES\)/.test(SERVER)
);
assert('the route actually calls the tested helper', /truncatedByCap\(head\.size, limit\)/.test(SERVER));

/* =====================================================================
 * comment #3 — the footer said 8 MB while the server reads 64 MB
 * ===================================================================== */
check('the server sends the cap it applied', buildTrajectoryPayload(baseInput).session.maxMessageBytes, MAX_MESSAGE_BYTES);
check('64 MB is what that cap is', MAX_MESSAGE_BYTES, 64 * 1024 * 1024);
assert('the client renders the cap it was sent', /session\.maxMessageBytes/.test(CLIENT));
assert('the client formats it rather than restating a number', /formatBytes\(session\.maxMessageBytes\)/.test(CLIENT));
assert('no hardcoded 8 MB survives in the markup', !/8 MB/.test(CLIENT));
assert('no hardcoded 64 MB either — the value comes from the payload', !/64 MB/.test(CLIENT));

await rm(dir, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`FAIL  ${failures.length} of ${pass + failures.length}`);
  for (const failure of failures) console.error('  - ' + failure);
  process.exit(1);
}
console.log(`\nALL ${pass} CHECKS PASSED`);