/**
 * Verifies the response rail: every row must carry the responseId of the model call it came
 * from, rows sharing one must be adjacent, and the four rail states must describe the
 * visible sequence correctly under filtering (where groupmates can be hidden).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The payload used to come from a booted service on a port passed in. It is now the committed
// one built from the fixture store by make-payload.mjs, so this runs anywhere.
const HERE = fileURLToPath(new URL('.', import.meta.url));
const p = JSON.parse(readFileSync(join(HERE, 'fixtures', 'trajectory.json'), 'utf8'));
const flat = [];
for (const t of p.turns) for (const r of t.records ?? []) flat.push(r);

console.log(`session=${p.session.id} records=${flat.length}`);

// 1. responseId presence
let withResp = 0, without = 0;
const byKind = {};
for (const r of flat) {
  byKind[r.kind] = byKind[r.kind] ?? { n: 0, resp: 0 };
  byKind[r.kind].n += 1;
  if (r.responseId) { withResp += 1; byKind[r.kind].resp += 1; } else without += 1;
}
console.log(`\nresponseId present on ${withResp} records, absent on ${without}`);
console.log('  by kind:');
for (const [k, v] of Object.entries(byKind)) {
  console.log(`    ${k.padEnd(11)} ${String(v.resp).padStart(4)}/${String(v.n).padEnd(4)} carry responseId`);
}

// 2. rows sharing a responseId must be contiguous
const seen = new Map();
let nonContiguous = 0;
flat.forEach((r, i) => {
  if (!r.responseId) return;
  if (!seen.has(r.responseId)) seen.set(r.responseId, []);
  seen.get(r.responseId).push(i);
});
for (const [rid, idxs] of seen) {
  for (let k = 1; k < idxs.length; k += 1) {
    if (idxs[k] !== idxs[k - 1] + 1) { nonContiguous += 1; break; }
  }
}
console.log(`\nresponseIds spanning >1 row : ${[...seen.values()].filter((v) => v.length > 1).length}`);
console.log(`  of those, non-contiguous  : ${nonContiguous}  ${nonContiguous === 0 ? '(a single rail span is always valid)' : '<-- rail would bridge unrelated rows'}`);

// 3. the rail algorithm, replayed on the visible sequence
function railStates(entries) {
  const positions = new Map();
  entries.forEach((e, i) => {
    const rid = e.record.responseId;
    if (!rid) return;
    if (!positions.has(rid)) positions.set(rid, []);
    positions.get(rid).push(i);
  });
  const out = new Array(entries.length).fill(null);
  positions.forEach((idxs) => {
    idxs.forEach((at, n) => {
      const state = idxs.length === 1 ? 'solo' : at === idxs[0] ? 'start' : at === idxs[idxs.length - 1] ? 'end' : 'mid';
      out[at] = { state, index: n + 1, size: idxs.length };
    });
  });
  return out;
}

function report(label, entries) {
  const rails = railStates(entries);
  const counts = {};
  for (const r of rails) if (r) counts[r.state] = (counts[r.state] ?? 0) + 1;
  const rowsWithRail = rails.filter(Boolean).length;
  const groups = new Set(entries.map((e) => e.record.responseId).filter(Boolean)).size;
  console.log(`\n${label}`);
  console.log(`  rows=${entries.length}  response groups=${groups}  rows carrying a rail=${rowsWithRail}`);
  console.log(`  states: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ') || '(none)'}`);
  // invariant: every row of a group gets a rail, every row without a responseId gets none
  let bad = 0;
  entries.forEach((e, i) => {
    const has = Boolean(rails[i]);
    if (has !== Boolean(e.record.responseId)) bad += 1;
  });
  console.log(`  invariant (rail iff responseId): ${bad === 0 ? 'OK' : `BROKEN in ${bad} rows`}`);
  return bad;
}

console.log('\n--- unfiltered ---');
let bad = report('all records', flat.map((record) => ({ record })));

console.log('\n--- filtered to thinking only (groupmates hidden) ---');
const thinkOnly = flat.filter((r) => r.kind === 'thinking').map((record) => ({ record }));
bad += report('thinking only', thinkOnly);

console.log('\n--- filtered to assistant + thinking (partial groups) ---');
const partial = flat.filter((r) => r.kind === 'assistant' || r.kind === 'thinking').map((record) => ({ record }));
bad += report('assistant+thinking', partial);

console.log(`\nVERDICT: ${bad === 0 ? 'rail grouping is correct in every view' : `${bad} problem(s)`}`);
process.exit(bad === 0 ? 0 : 1);
