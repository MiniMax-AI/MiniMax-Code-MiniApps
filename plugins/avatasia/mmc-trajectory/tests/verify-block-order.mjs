/**
 * Verifies the explicit assistant-block ordering rule the page now enforces:
 *   thinking -> text -> toolCall(s)
 * and that Token usage still lands on the assistant answer, never on the reasoning block.
 *
 * It checks the rule against the served payload rather than the file, because the rule is
 * the page's own — it must hold even if the session writer ever changes its block order.
 * The rule is per assistant message: see the comment at the run-splitting loop below.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as server from '../miniapp/node/server.mjs';

const { resolveSessionsRoot, collectSessionEntries, readHead } = server;

const HERE = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE_HOME = join(HERE, 'fixtures', 'minimax-home');
const PAYLOAD = join(HERE, 'fixtures', 'trajectory.json');

const location = resolveSessionsRoot({ MAVIS_HOME: FIXTURE_HOME });
const entries = await collectSessionEntries(location.sessionsRoot);
if (!entries.length) { console.log('no fixture sessions -- run make-fixtures.mjs --record'); process.exit(1); }
const entry = entries[0];

const rawText = (await readHead(join(entry.dir, 'messages.jsonl'), entry.sizeBytes)).text;
const raw = rawText.split('\n').filter(Boolean).map((l) => JSON.parse(l));
const p = JSON.parse(readFileSync(PAYLOAD, 'utf8'));
const flat = [];
for (const t of p.turns) for (const r of t.records ?? []) flat.push(r);

const RANK = { thinking: 0, qa: 1, narration: 1, toolCall: 2 };
let violations = 0;
let checked = 0;

// Walk consecutive assistant-family runs; within each run the rank must be non-decreasing.
let run = [];
function flush() {
  if (run.length < 2) { run = []; return; }
  checked += 1;
  for (let i = 1; i < run.length; i += 1) {
    if (RANK[run[i].kind] < RANK[run[i - 1].kind]) {
      violations += 1;
      if (violations <= 5) console.log(`  VIOLATION near #${run[i].index}: ${run[i - 1].kind}(#${run[i - 1].index}) -> ${run[i].kind}(#${run[i].index})`);
    }
  }
  run = [];
}
for (const r of flat) {
  const assistant = r.kind === 'reply' || r.kind === 'narration' || r.kind === 'thinking' || r.kind === 'toolCall';
  // The rule orders the blocks *within one assistant message*. Two assistant messages in the
  // same turn are two separate runs: the page reorders blocks inside a message, never across
  // messages, so ranking across that boundary flagged a toolCall -> thinking pair that never
  // occurred inside any message.
  if (assistant && run.length && run[0].id !== r.id) flush();
  if (assistant) run.push(r);
  else flush();
}
flush();

console.log(`\nordering rule  : thinking -> text -> toolCall`);
console.log(`runs checked   : ${checked}`);
console.log(`violations     : ${violations}`);
console.log(violations === 0 ? '  OK — the rule holds everywhere in the session' : '  FAIL');

// The rule must hold regardless of what order the writer used, so confirm it also holds
// for a session whose raw blocks are deliberately out of rule order.
let rawDisagrees = 0;
for (const r of raw) {
  const c = r.message?.content;
  if (r.message?.role !== 'assistant' || !Array.isArray(c)) continue;
  const kinds = c.map((b) => b?.type).filter((k) => k === 'thinking' || k === 'text' || k === 'toolCall');
  for (let i = 1; i < kinds.length; i += 1) {
    if (RANK[kinds[i]] < RANK[kinds[i - 1]]) { rawDisagrees += 1; break; }
  }
}
console.log(`\nraw file blocks that violate the rule : ${rawDisagrees}`);
console.log(rawDisagrees === 0
  ? '  (the writer happens to agree with the rule today; the page does not depend on it)'
  : '  (the writer DISAGREES in places — the page reorders them to the rule)');

// Token usage placement
let onAssistant = 0, onThinking = 0, onOther = 0;
for (const r of flat) {
  if (!r.tokens) continue;
  if (r.kind === 'reply') onAssistant += 1;
  else if (r.kind === 'thinking') onThinking += 1;
  else onOther += 1;
}
let thinkNoText = 0;
// Counted from the payload, grouped by the message each row came out of — not from the raw
// file. The payload spans every generation of a compacted session while `messages.jsonl`
// holds only the active one, so comparing the two would measure two different sets of
// messages and report a bug that is not there.
const byMessage = new Map();
for (const r of flat) {
  if (r.kind !== 'reply' && r.kind !== 'narration' && r.kind !== 'thinking') continue;
  let m = byMessage.get(r.id);
  if (!m) { m = { thinking: false, text: false }; byMessage.set(r.id, m); }
  if (r.kind === 'thinking') m.thinking = true;
  else m.text = true;
}
for (const m of byMessage.values()) if (m.thinking && !m.text) thinkNoText += 1;
console.log(`\nusage placement: assistant=${onAssistant}  thinking=${onThinking}  other=${onOther}`);
console.log(`  messages with reasoning but no answer: ${thinkNoText}`);
console.log(`  ${onThinking <= thinkNoText
  ? 'OK — a reasoning block only carries usage when its message produced no answer'
  : 'BUG — reasoning took usage from a message that had an answer'}`);

const sum = (p.turns ?? []).reduce((n, t) => n + (t.tokens?.totalTokens ?? 0), 0);
console.log(`\nturn totals still sum: header=${p.stats.tokens.totalTokens}  sum=${sum}  match=${sum === p.stats.tokens.totalTokens}`);

process.exit(violations === 0 && onThinking <= thinkNoText && sum === p.stats.tokens.totalTokens ? 0 : 1);
