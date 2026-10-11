// Verify the canonicalTextRange fix: real prompts are recovered, injected blocks are demoted to `system`.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  resolveSessionsRoot,
  collectSessionEntries,
  readSessionIdentity,
  readHead,
  parseMessagesJsonl,
  buildTrajectoryPayload,
  createRedactor,
  splitUserMessage,
  canonicalPromptRange,
} from '../miniapp/node/server.mjs';

const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;

let failures = 0;
const check = (name, cond, extra = '') => {
  if (cond) console.log('PASS ', name, extra);
  else {
    failures += 1;
    console.log('FAIL ', name, extra);
  }
};

const root = resolveSessionsRoot().sessionsRoot;
const redactor = createRedactor([root, resolveSessionsRoot().home]);

// --- unit: split semantics -------------------------------------------------
check('canonicalRange detected', canonicalPromptRange({ canonicalTextRange: { startOffset: 10, endOffset: 20 } })?.start === 10);
check('no range -> null', canonicalPromptRange({}) === null);
check('range + prefix splits', (() => {
  const r = splitUserMessage({ canonicalTextRange: { startOffset: 10, endOffset: 14 } }, '<reminder>REAL');
  return r.injected === '<reminder>' && r.prompt === 'REAL';
})());
check('pure injected -> no prompt', splitUserMessage({}, '<system-reminder>\nx\n</system-reminder>').prompt === null);
check('background-task injection -> no prompt', splitUserMessage({}, '<background-task-finished> hi').prompt === null);
check('runaway guard -> no prompt', splitUserMessage({}, '  [runaway guard] repeated').prompt === null);
check('plain user text -> prompt', splitUserMessage({}, '  你好，帮我看下这个').prompt === '你好，帮我看下这个');

// --- integration: real sessions -------------------------------------------
const entries = await collectSessionEntries(root);
let labelsFixed = 0;
let promptsFound = 0;
let fakeUsers = 0;

for (const entry of entries.slice(0, 10)) {
  const identity = await readSessionIdentity(entry.dir);
  const head = await readHead(join(entry.dir, 'messages.jsonl'), MAX_MESSAGE_BYTES);
  const parsed = parseMessagesJsonl(head.text);
  const payload = buildTrajectoryPayload({
    session: identity,
    rows: parsed.rows,
    sizeBytes: head.size,
    truncated: entry.sizeBytes > MAX_MESSAGE_BYTES,
    redact: redactor,
  });

  const all = payload.turns.flatMap((t) => t.records);
  const users = all.filter((r) => r.kind === 'user');
  const injected = all.filter((r) => r.title === 'injected');

  if (users.some((u) => u.summary.startsWith('<system-reminder>'))) fakeUsers += 1;
  if (users.length) promptsFound += 1;
  if (injected.length) labelsFixed += 1;

  const json = JSON.stringify(payload);
  if (json.includes('.minimax')) check('no path leak', false, entry.sessionId);

  if (entry === entries[0]) {
    console.log('\n--- latest session detail ---');
    console.log('label        :', payload.session.label);
    console.log('userMessages :', payload.stats.userMessages, '| injectedBlocks:', payload.stats.injectedBlocks);
    console.log('kinds        :', [...new Set(all.map((r) => r.kind))].join(', '));
    console.log('turns        :', payload.turns.length, '| records:', all.length);
    console.log('first user   :', users[0] ? JSON.stringify(users[0].summary.slice(0, 70)) : '(none)');
    console.log('first inject :', injected[0] ? JSON.stringify(injected[0].summary.slice(0, 70)) : '(none)');
    console.log('');
  }
}

check('no fake "user" rows starting with <system-reminder>', fakeUsers === 0, `offenders=${fakeUsers}`);
check('sessions with a real prompt are labelled', promptsFound > 0, `promptsFound=${promptsFound}`);
check('injected blocks are demoted to system records', labelsFixed > 0, `sessionsWithInjected=${labelsFixed}`);
check('stats.injectedBlocks present', typeof buildTrajectoryPayload({ session: { id: 'x' }, rows: [] }).stats.injectedBlocks === 'number');

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
