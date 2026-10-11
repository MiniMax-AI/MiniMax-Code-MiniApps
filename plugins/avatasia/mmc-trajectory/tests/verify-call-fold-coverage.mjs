// Coverage probe: with "fold every call" on, how much tool work is still on screen?
//
// The user reported that most tool calls and tool results stayed visible after folding.
// Rather than trust a screenshot, this drives the delivered buildTurnPlan over the real
// served payload with every collapsible owner folded, and counts what survives.
//
// It loads the delivered index.html itself and runs its real inline script in a sandbox,
// so there is no copied logic that could drift from what ships.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const HTML = join(HERE, '..', 'miniapp', 'client', 'index.html');
const PAYLOAD = join(HERE, 'fixtures', 'trajectory.json');

const html = readFileSync(HTML, 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])[0];
if (!script) throw new Error('no inline script found');

const bootIndex = script.lastIndexOf("if (document.readyState === 'loading')");
const body = bootIndex === -1 ? script : script.slice(0, bootIndex);
const noop = () => {};
const sandbox = {
  console,
  window: {
    localStorage: { getItem: () => null, setItem: noop },
    matchMedia: () => ({ addEventListener: noop, addListener: noop }),
    setTimeout: () => 0,
    clearTimeout: noop,
    setInterval: () => 0,
    clearInterval: noop
  },
  document: { documentElement: { dataset: {} }, body: { classList: { add: noop, remove: noop } } }
};
vm.createContext(sandbox);
vm.runInContext(body, sandbox);

const payload = JSON.parse(readFileSync(PAYLOAD, 'utf8'));
const entries = [];
for (const turn of payload.turns ?? []) {
  for (const record of turn.records ?? []) entries.push({ turn, record });
}
const groups = sandbox.visibleTurns(entries);

// The client renders through visibleEntries(), so that is the only definition of "on
// screen" this probe may use. Anything else would test the probe's own idea of the filter.
sandbox.state.flat = entries;
sandbox.state.kinds = sandbox.KIND_ORDER.slice();
sandbox.state.query = '';
sandbox.state.overviewSelection = null;

function countByKind(groups) {
  const out = {};
  for (const group of groups) {
    for (const entry of group.entries) out[entry.record.kind] = (out[entry.record.kind] ?? 0) + 1;
  }
  return out;
}

// Unticking the two tool kinds is the whole filter, so this is the same state the reader
// leaves the page in after clearing 工具调用 and 工具结果 in the chip row.
const NO_TOOL_KINDS = sandbox.KIND_ORDER.filter((k) => k !== 'toolCall' && k !== 'toolResult');
const withToolKinds = sandbox.KIND_ORDER.filter((k) => k === 'toolCall' || k === 'toolResult');
sandbox.state.kinds = NO_TOOL_KINDS;
const after = countByKind(sandbox.visibleTurns(sandbox.visibleEntries()));
sandbox.state.kinds = sandbox.KIND_ORDER.slice();

const before = countByKind(groups);
const kinds = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
console.log(`session      : ${payload.session.id}`);
console.log(`records      : ${entries.length}   turns: ${groups.length}\n`);
console.log('kind          on-screen   hidden by unticking the tool kinds');
let leaks = 0;
for (const kind of kinds) {
  const b = before[kind] ?? 0;
  const a = after[kind] ?? 0;
  const isCall = kind === 'toolCall' || kind === 'toolResult';
  if (isCall && a !== 0) leaks += a;
  console.log(`  ${kind.padEnd(12)} ${String(a).padStart(9)} ${String(b - a).padStart(11)}${isCall && a ? '  <-- LEAK' : ''}`);
}

/* The list renders a window, not the whole session. Unticking the tool kinds has to hide
 * every tool row in that window with no placeholder row standing in for them, so the count
 * of tool rows on screen has to be exactly zero — not "few", not "the ones that happened to
 * have an assistant row above them". */
const WINDOW = 200;
sandbox.state.kinds = NO_TOOL_KINDS;
const cut = sandbox.visibleEntries().slice(-WINDOW);
const cutKinds = countByKind(sandbox.visibleTurns(cut));
sandbox.state.kinds = sandbox.KIND_ORDER.slice();
const windowLeak = (cutKinds.toolCall ?? 0) + (cutKinds.toolResult ?? 0);
const lastRow = cut[cut.length - 1];
console.log(`\n--- window of the newest ${WINDOW} ---`);
console.log(`  first record shown : #${cut[0].record.index} ${cut[0].record.kind}`);
console.log(`  last record shown  : #${lastRow.record.index} ${lastRow.record.kind}`);
console.log(`  tool rows on screen: ${windowLeak}`);

console.log(leaks === 0 && windowLeak === 0
  ? '\nOK — unticking 工具调用 and 工具结果 leaves no tool call and no tool result anywhere it can be seen'
  : `\nLEAK — ${leaks + windowLeak} tool rows still visible with the tool kinds unticked`);
process.exit(leaks === 0 && windowLeak === 0 ? 0 : 1);
