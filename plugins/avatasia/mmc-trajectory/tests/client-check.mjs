// Offline self-check for miniapp/client/index.html (read-only w.r.t. the package).
// 1) extracts the inline <script> and runs `node --check`
// 2) extracts the PURE:START/PURE:END block and unit-tests the DOM-free helpers
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const HTML = fileURLToPath(new URL('../miniapp/client/index.html', import.meta.url));
const SERVER = fileURLToPath(new URL('../miniapp/node/server.mjs', import.meta.url));
// Scratch files go to a throwaway directory, not into the checkout: this script writes
// an extracted copy of the inline script and runs `node --check` on it.
const OUT = mkdtempSync(join(tmpdir(), 'traj-client-check-'));

const html = readFileSync(HTML, 'utf8');

/* ---------- 1) syntax check of the inline script ---------- */
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (scripts.length !== 1) throw new Error('expected exactly one inline script, got ' + scripts.length);
writeFileSync(OUT + '/client-extracted.mjs', scripts[0]);
try {
  execFileSync(process.execPath, ['--check', OUT + '/client-extracted.mjs'], { stdio: 'pipe' });
  console.log('[1] node --check: PASS (' + scripts[0].split('\n').length + ' script lines)');
} catch (error) {
  console.log('[1] node --check: FAIL\n' + error.stderr);
  process.exit(1);
}

/* ---------- 2) pure helpers ---------- */
const rawSlice = html.split('PURE:START')[1].split('PURE:END')[0];
let block = rawSlice.slice(rawSlice.indexOf('*/') + 2);           // drop the PURE:START header comment
const lastCloser = block.lastIndexOf('*/');                      // drop the dangling PURE:END header opener
const dangling = block.indexOf('/*', lastCloser === -1 ? 0 : lastCloser + 2);
if (dangling >= 0) block = block.slice(0, dangling);
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(block, sandbox);

let pass = 0;
const failures = [];
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass += 1;
  else failures.push(name + ': got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected));
}
function assert(name, cond) {
  if (cond) pass += 1;
  else failures.push(name);
}

/* null rendering — never 0, never invented */
check('duration null', sandbox.formatDuration(null), '—');
check('duration undefined', sandbox.formatDuration(undefined), '—');
check('duration zero', sandbox.formatDuration(0), '0 ms');
check('duration 431', sandbox.formatDuration(431), '431 ms');
check('duration 1500', sandbox.formatDuration(1500), '1.50 s');
check('duration 90000', sandbox.formatDuration(90000), '1 分 30 秒');
check('duration NaN', sandbox.formatDuration(NaN), '—');
check('int null', sandbox.formatInt(null), '—');
check('int group', sandbox.formatInt(1234567), '1,234,567');
check('int zero', sandbox.formatInt(0), '0');
check('compact null', sandbox.formatCompact(null), '—');
check('compact 12500', sandbox.formatCompact(12500), '12.5k');
check('compact 2500000', sandbox.formatCompact(2500000), '2.5M');
check('offset null', sandbox.formatOffset(null), '—');
check('offset 887', sandbox.formatOffset(887), '+887 ms');
check('offset 12000', sandbox.formatOffset(12000), '+12 s');
check('offset 0', sandbox.formatOffset(0), '+0 ms');
check('clock null', sandbox.formatClock(null), '—');
check('ago null', sandbox.formatAgo(null, Date.now()), '—');
check('ago 30s', sandbox.formatAgo(Date.now() - 30000, Date.now()), '刚刚');
check('ago 5min', sandbox.formatAgo(Date.now() - 300000, Date.now()), '5 分钟前');
check('bytes null', sandbox.formatBytes(null), '—');
check('bytes 244100', sandbox.formatBytes(244100), '238.4 KB');
check('safeText null', sandbox.safeText(null), '');
check('safeText obj', sandbox.safeText({ a: 1 }), '{"a":1}');
check('truncate empty', sandbox.truncateText('', 10), '');
check('truncate long', sandbox.truncateText('abcdefghij', 5), 'abcd…');
check('labels', sandbox.KIND_LABELS.toolResult, '工具结果');

/* kind label — a compaction is its own kind, so it can never be called 系统 */
check('kindLabel compaction', sandbox.kindLabel({ kind: 'compaction', title: 'compaction' }), '压缩');
check('kindLabel plain system', sandbox.kindLabel({ kind: 'system', title: 'context' }), '系统');
check('kindLabel reply', sandbox.kindLabel({ kind: 'reply' }), '答复');
check('kindLabel narration', sandbox.kindLabel({ kind: 'narration' }), '过程');
check('kindLabel unknown falls back to kind', sandbox.kindLabel({ kind: 'weird' }), 'weird');
check('kindLabel null record is dash', sandbox.kindLabel(null), '—');
check('kindLabel null record is dash string', sandbox.kindLabel('x'), '—');
// 问答 already means something else here: the server classifies *turns* that way — the
// exchange where the agent asked the reader something and the reply came back through the
// tool result. That turn is a composite, not a record. A record kind wearing the same
// name once shipped as `qa` and was really 答复 (stopReason === 'stop'), so this asserts
// no record kind may claim the word. If a future kind genuinely is a Q&A exchange, it
// belongs at turn level, and this line is the one to argue with first.
check('no record kind is labelled 问答',
  sandbox.KIND_ORDER.some((k) => sandbox.KIND_LABELS[k] === '问答'), false);
// The label follows the kind and nothing else. A title that used to mean "compaction"
// now means what it says: the filter decides what a record is, so the name has to as well.
check('kindLabel ignores title', sandbox.kindLabel({ kind: 'system', title: 'compaction' }), '系统');
check('every kind has a label', sandbox.KIND_ORDER.every((k) => typeof sandbox.KIND_LABELS[k] === 'string' && sandbox.KIND_LABELS[k].length > 0), true);
check('every label has a kind', Object.keys(sandbox.KIND_LABELS).every((k) => sandbox.KIND_ORDER.indexOf(k) >= 0), true);

/* generation selector — one generation is not a choice, and the newest comes first */
const gens = [
  { generation: 0, kind: 'snapshot', messageCount: 676, active: false },
  { generation: 1, kind: 'snapshot', messageCount: 548, active: false },
  { generation: 2, kind: 'active', messageCount: 186, active: true }
];
check('generationOptions empty for one', sandbox.generationOptions([{ generation: 0 }], 0), []);
check('generationOptions empty for none', sandbox.generationOptions([], null), []);
check('generationOptions empty for junk', sandbox.generationOptions(null, 0), []);
const opts = sandbox.generationOptions(gens, 2);
check('generationOptions count includes the all option', opts.length, 4);
check('generationOptions leads with the whole lineage', opts[0].generation, 'all');
check('generationOptions all label', opts[0].label, '全部（默认）');
check('generationOptions all is never marked active', opts[0].active, false);
check('generationOptions newest generation first', opts[1].generation, 2);
check('generationOptions active marked', opts[1].active, true);
check('generationOptions active label', opts[1].label, '第 2 代（当前）');
check('generationOptions archived label carries count', opts[2].label, '第 1 代（548 条）');
check('generationOptions last option', opts[3].generation, 0);
check(
  'generationOptions drops entries without a generation',
  sandbox.generationOptions([{ generation: 1 }, null, { kind: 'x' }, { generation: 2, active: true }], 2).length,
  3
);
check('generationOptions falls back to the active flag', sandbox.generationOptions(gens, null)[1].active, true);
check(
  'generationOptions missing count drops the suffix',
  sandbox.generationOptions([{ generation: 0, messageCount: null }, { generation: 1, messageCount: 5, active: true }], 1)[2].label,
  '第 0 代'
);

/* escaping / hostile text */
const XSS = '</pre><script>alert("xss")</script>&`${danger}';
const escaped = sandbox.escapeHtml(XSS);
assert('escapeHtml has no raw <', !escaped.includes('<'));
assert('escapeHtml has no raw >', !escaped.includes('>'));
assert('escapeHtml has no raw quote', !escaped.includes('"'));
assert('escapeHtml escapes amp', escaped.includes('&amp;'));
check('safeText keeps hostile text verbatim', sandbox.safeText(XSS), XSS);

const colored = sandbox.jsonColorize({ evil: XSS, n: 42, b: true, z: null, s: 'a$&b' });
assert('jsonColorize emits no injected tag', !colored.includes('<script') && !colored.includes('</pre>'));
assert('jsonColorize keeps literal $&', colored.includes('$&'));
const stripped = colored.replace(/<[^>]+>/g, '');
check('jsonColorize round-trips to escaped json', stripped, sandbox.escapeHtml(JSON.stringify({ evil: XSS, n: 42, b: true, z: null, s: 'a$&b' }, null, 2)));
assert('jsonColorize colors numbers', colored.includes('tok-num'));
check('jsonColorize undefined', sandbox.jsonColorize(undefined), '');
check('jsonColorize null', sandbox.jsonColorize(null), '<span class="tok-null">null</span>');

/* search: case-insensitive over summary + text + result + thinking, hostile content */
const hostile = {
  kind: 'reply',
  summary: 'Ask about <script>alert(1)</script>',
  text: 'Answering now',
  result: null,
  thinking: null
};
check('match lowercase', sandbox.matchesQuery(hostile, 'script'), true);
check('match uppercase', sandbox.matchesQuery(hostile, 'ALERT'), true);
check('match miss', sandbox.matchesQuery(hostile, 'zzz'), false);
check('match empty query', sandbox.matchesQuery(hostile, ''), true);
check('match result field', sandbox.matchesQuery({ kind: 'toolResult', result: { code: 'ENOENT' } }, 'enoent'), true);
check('match thinking object', sandbox.matchesQuery({ kind: 'thinking', thinking: { text: 'chain of thought' } }, 'thought'), true);
check('match null thinking safe', sandbox.matchesQuery({ kind: 'thinking', thinking: null }, 'thought'), false);
check('no kinds match', sandbox.hasKind({ kind: 'system' }, ['user']), false);

/* flatten + signature */
check('flatten empty', sandbox.flattenTurns(undefined), []);
check('flatten junk', sandbox.flattenTurns([{ id: 'a' }, null, { id: 'b', records: [null, { id: 'r' }] }]).length, 1);
check('signature empty', sandbox.signatureOf(null), 'empty');
const payload = {
  session: { id: 'mvs_1' },
  stats: { messages: 5, toolCalls: 2, errors: 0, durationMs: 100, tokens: { totalTokens: 9 } },
  turns: [{ id: 't1', index: 1, records: [{ id: 'r1', kind: 'user' }, { id: 'r2', kind: 'narration' }] }]
};
const sigA = sandbox.signatureOf(payload);
check('signature stable', sigA, sandbox.signatureOf(JSON.parse(JSON.stringify(payload))));
payload.stats.messages = 6;
assert('signature changes with counts', sigA !== sandbox.signatureOf(payload));

/* handoff markdown */
const turn = { id: 't1', index: 3 };
const failing = {
  kind: 'toolCall', index: 42, toolName: 'read', toolCallId: 'call_bb89',
  timestamp: 1791603931971, relativeMs: 887, durationMs: null, isError: true,
  error: 'boom <b>x</b>', model: 'MiniMax-M3.1-Flash-Preview', provider: 'minimax',
  api: 'anthropic-messages', stopReason: 'toolUse', textTruncated: true,
  tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15 },
  arguments: { path: 'a.txt' }
};
const raw = sandbox.truncateJson({ blob: 'x'.repeat(20000) }, sandbox.HANDOFF_RAW_LIMIT);
check('truncateJson caps at 8000', raw.text.length, 8000);
check('truncateJson flags', raw.truncated, true);
check('truncateJson small', sandbox.truncateJson({ a: 1 }, 8000).truncated, false);
// 「原文过大」 is not a field on the record any more: it arrives with the /raw answer, because
// deciding it meant serializing every message in the session on every poll (see
// tests/verify-raw-lazy.mjs).
// The markdown therefore takes the verdict as its own argument, and this asserts that a
// caller who passes it still gets the line — and that one who does not, gets silence.
const md = sandbox.buildHandoffMarkdown({ id: 'mvs_1', label: '测试会话' }, turn, failing, raw.text, raw.truncated, true);
const mdWithoutVerdict = sandbox.buildHandoffMarkdown({ id: 'mvs_1', label: '测试会话' }, turn, failing, raw.text, raw.truncated);
assert('md omits the flag when no verdict was passed', !mdWithoutVerdict.includes('原文过大已被省略'));
assert('md locates turn', md.includes('第 3 轮'));
assert('md locates record', md.includes('#42'));
assert('md names kind', md.includes('工具调用'));
assert('md marks failure', md.includes('状态：失败') && md.includes('boom <b>x</b>'));
assert('md renders null duration as dash', md.includes('耗时：—'));
assert('md notes truncation', md.includes('已截断到 8000 字符'));
assert('md notes flags', md.includes('原文过大已被省略') && md.includes('正文已被上游截断'));
assert('md reports limit constant', sandbox.HANDOFF_RAW_LIMIT === 8000);

/* a compaction must read as 压缩 in the handoff text too, not 系统 */
const compaction = {
  kind: 'compaction', title: 'compaction', index: 1, role: 'compactionSummary',
  tokensBefore: 367401, summary: '## Goal ...'
};
const mdCompaction = sandbox.buildHandoffMarkdown(
  { id: 'mvs_1', label: '测试会话' },
  { id: 't0', index: 1 },
  compaction,
  '{"kind":"compactionSummary"}',
  false
);
assert('md names a compaction 压缩', mdCompaction.includes('· 压缩'));
assert('md never calls a compaction 系统', !mdCompaction.includes('· 系统'));

/* large-session fixture: 3,000 records / 40 turns, plus null-heavy rows */
const turns = [];
let n = 0;
for (let t = 0; t < 40; t += 1) {
  const records = [];
  for (let r = 0; r < 75; r += 1) {
    n += 1;
    records.push({
      index: n, id: 'msg-' + n, turnId: 't' + t,
      kind: sandbox.KIND_ORDER[n % 6],
      timestamp: 1791603931971 + n, relativeMs: n * 37,
      title: 'read', summary: n % 11 === 0 ? XSS : '第 ' + n + ' 条 ' + 'x'.repeat(80),
      text: n % 7 === 0 ? YAMLED() : null,
      thinking: n % 5 === 0 ? { text: 'thinking ' + n } : null,
      arguments: n % 3 === 0 ? { path: 'p' + n } : null,
      result: n % 4 === 0 ? null : { ok: true, out: 'y'.repeat(400) },
      error: n % 13 === 0 ? 'boom' : null,
      isError: n % 13 === 0,
      durationMs: n % 17 === 0 ? null : n % 900,
      tokens: n % 6 === 0 ? null : { input: n, output: n, cacheRead: 0, cacheWrite: 0, totalTokens: n * 2 },
      raw: n % 8 === 0 ? { big: 'z'.repeat(2000) } : null,
      rawOmitted: n % 9 === 0, textTruncated: n % 12 === 0
    });
  }
  turns.push({ id: 't' + t, index: t + 1, toolCalls: 12, errors: t % 4 === 0 ? 1 : 0, durationMs: t % 6 === 0 ? null : 12000, tokens: { input: 10, output: 5, cacheRead: 2, cacheWrite: 0, totalTokens: 17 }, records });
}
function YAMLED() { return XSS; }
const big = { session: { id: 'mvs_big', truncated: true }, stats: { messages: n, turns: 40, durationMs: 900000, tokens: { totalTokens: 30000 } }, turns };

const t0 = process.hrtime.bigint();
const flat = sandbox.flattenTurns(big.turns);
let matched = 0;
for (const entry of flat) if (sandbox.matchesQuery(entry.record, 'x')) matched += 1;
for (const entry of flat) sandbox.escapeHtml(sandbox.safeText(entry.record.summary));
const t1 = process.hrtime.bigint();
const elapsedMs = Number(t1 - t0) / 1e6;

check('large fixture record count', flat.length, 3000);
assert('large fixture search matches', matched > 0);
assert('large fixture pipeline under 800ms (' + elapsedMs.toFixed(1) + 'ms)', elapsedMs < 800);
assert('page window stays at 200 of 3000', Math.min(200, flat.length) === 200);
check('window slicing keeps newest', flat.slice(flat.length - 200)[0].record.id, flat[flat.length - 200].record.id);
assert('signature on large fixture stable', sandbox.signatureOf(big) === sandbox.signatureOf(big));

/* ---------- 3) static policy checks on the delivered file ---------- */
// An unterminated CSS comment silently swallows every rule after it, and the page
// still renders — just unstyled. Compare the rule set with comments stripped so a
// swallowed block fails here instead of showing up as a strange-looking button.
const styleBlock = (html.match(/<style>([\s\S]*?)<\/style>/) || ['', ''])[1];
const styleNoComments = styleBlock.replace(/\/\*[\s\S]*?\*\//g, '');
const opensBeforeCloses = (styleBlock.match(/\/\*/g) || []).length - (styleBlock.match(/\*\//g) || []).length;
assert('style block has balanced /* */ comments', opensBeforeCloses === 0);
for (const selector of ['.tbtn', '.tbtn-icon', '.overview-plot', '.ov-span', '.window-bar', '.turn-head']) {
  assert('css rule survives comment stripping: ' + selector, styleNoComments.includes(selector + ' {') || styleNoComments.includes(selector + ','));
}

// turnContext builds its string from turnContextParts, and turnContextSuffix calls
// turnContext, so a check that wants to RUN any of them has to lift all three, in dependency
// order. Lifting by regex is acceptable here because these are leaf functions ending in a
// single `}` at a fixed indent; the alternative — moving them into the PURE block — would put
// UI string helpers in the unit-tested core for no unit test's benefit.
function fnSource(signature) {
  const m = html.match(new RegExp(signature.replace(/[()]/g, '\\$&') + ' \\{[\\s\\S]*?\\n {6}\\}'));
  return m ? m[0] : null;
}
function liftTurnFns() {
  for (const name of [
    'function turnContextParts(stats)',
    'function turnContext(stats)',
    'function turnContextSuffix(stats)',
  ]) {
    const src = fnSource(name);
    if (!src) return false;
    vm.runInContext(src, sandbox);
  }
  return true;
}

// The viewport checks read the code, not the prose around it. Stripping comments first is not
// leniency — it is the difference between a rule about CSS and a rule about text: a comment that
// explains *why* 100vh is banned used to fail this check, so documenting the reason was the one
// way guaranteed to break it, and the incentive was to leave the reason unwritten.
//
// Line comments are removed by whole line rather than by scanning for `//`, because `//` inside
// a string literal is a URL in this page and a naive scan would delete the rest of the line with
// it — turning a pass into a fail for an unrelated rule.
const codeOnly = html
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');

const checks = [
  ['no remote http(s) resource', !/<(script|link|img|iframe)[^>]+(src|href)=["']https?:/i.test(html)],
  ['no @import', !/@import/.test(html)],
  ['no emoji', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(html)],
  ['no gradient', !/gradient\(/i.test(codeOnly)],
  ['no backdrop-filter glass', !/backdrop-filter/.test(codeOnly)],
  // 100vh is not the reader's viewport inside a host iframe, which is why every offset on this
  // page is measured instead. Checked against the CSS, and the fallback side of that: the dock
  // heights are allowed to be vh only as fallbacks, because the shipped values are written from
  // window.innerHeight by applyInspectorDock().
  ['no fixed h-screen', !/h-screen|100vh/.test(codeOnly)],
  ['has --mcode-* tokens', (html.match(/--mcode-/g) || []).length > 40],
  ['no --dsw-* leakage', !/--dsw-/.test(html)],
  ['no remote font family names', !/JetBrains|Inter['"]?\s*,|@font-face/.test(html)],
  ['innerHTML only on pre via jsonColorize', (html.match(/\.innerHTML/g) || []).length === 2],
  ['lang zh-CN', /<html lang="zh-CN">/.test(html)],
  ['title 会话轨迹', /<title>会话轨迹<\/title>/.test(html)],
  ['AbortController used', /new AbortController\(\)/.test(html)],
  ['no alert/confirm', !/\b(alert|confirm|prompt)\s*\(/.test(html)],
  // The rule is "no session data in browser storage", not "never touch the storage
  // API". The Duration button persists one boolean view preference, exactly as the
  // reference implementation does, so the check looks at what is actually written
  // rather than at whether the word localStorage appears anywhere.
  ['no localStorage of domain data', (() => {
    const allowed = /window\.localStorage\.(?:get|set)Item\(\s*DURATION_PREF_KEY\s*,?\s*(?:'true'\s*\|\s*'false'|value\s*\?\s*'true'\s*:\s*'false')?\s*\)/g;
    const stripped = html.replace(allowed, '');
    return !/localStorage|sessionStorage/.test(stripped);
  })()],
  ['duration preference stores only true/false', /DURATION_PREF_KEY = 'mmc-trajectory\.duration'/.test(html) && !/localStorage\.setItem\([^)]*state\./.test(html)],
  ['reduced motion honored', /prefers-reduced-motion: reduce/.test(html)],
  ['role=alert present', /role="alert"/.test(html)],
  ['role=status present', (html.match(/role="status"/g) || []).length >= 3],
  ['semantic header/main/section/footer/nav/form', ['<header', '<main', '<section', '<footer', '<nav', '<form'].every((tag) => html.includes(tag))],
  ['semantic table rendered (static or via createElement)', html.includes('<table') || html.includes("el('table'")],
  ['session poll interval 2500ms, declared as the list\'s own cadence', /\bSESSION_POLL_INTERVAL = 2500\b/.test(html) && !/\bPOLL_INTERVAL = /.test(html)],
  ['trajectory poll interval 8000ms, slower than the list\'s', /\bTRAJECTORY_POLL_INTERVAL = 8000\b/.test(html)],
  // Two ticks, not one. The single `POLL_INTERVAL` this replaced cannot come back as a substring
  // of either name — `SESSION_POLL_INTERVAL` contains `POLL_INTERVAL`, so an assertion written
  // against the old bare name passes against either constant and means nothing.
  ['no single shared poll interval is left behind', !/\bPOLL_INTERVAL\b/.test(html.replace(/SESSION_POLL_INTERVAL|TRAJECTORY_POLL_INTERVAL/g, ''))],
  ['handoff raw limit 8000', /HANDOFF_RAW_LIMIT = 8000/.test(html)],
  ['all 6 append error codes handled', ['user_cancelled', 'invalid_request', 'text_too_large', 'not_allowed', 'target_unavailable', 'result_unknown'].every((c) => html.includes(c))],
  // The type chips are the one filter. A second row of layer buttons was removed because a
  // preset the reader can outgrow ends up contradicting the chips it was meant to summarise;
  // these assertions are here so a future "simplify" or "restore" does not quietly bring
  // it back, and so nobody re-adds a parallel copy of state.kinds.
  ['no layer buttons in the markup', !/turns-btn|thinking-btn|calls-btn/.test(html)],
  ['no layer machinery in the script', !/LAYER_KINDS|LAYER_ORDER|layerSelected|layerPartial|applyLayerToKinds|setLayerButton|dom\.turnsBtn|dom\.thinkingBtn|dom\.callsBtn/.test(html)],
  // Every kind the server can emit has to be reachable as a control. A kind with no control
// is a kind the reader cannot keep or drop on its own — which is exactly what compaction
// was while it sat inside `system`. The list is written out rather than derived from the
// markup so that adding a kind without one fails here instead of quietly shipping.
// Derived from KIND_ORDER rather than written out, so adding a kind cannot leave this list
// behind. It was hardcoded once and went stale the moment `steer` landed — the guard fired
// correctly, but only because a human had to notice.
['every kind has a control',
  sandbox.KIND_ORDER.every((k) => html.includes('data-kind="' + k + '"'))],
['every kind has exactly one control', (() => {
  // A count alone is not enough: renaming one control to another kind keeps the count at
  // 9 while leaving a kind unreachable and another listed twice. Compare the multiset.
  // Written out on purpose rather than derived from KIND_ORDER — deriving it would make
  // this compare the markup against itself and pass for any set of controls at all.
  const found = [...html.matchAll(/class="tbtn tbtn-action" data-kind="([^"]+)"/g)].map((m) => m[1]);
  const expected = ['user', 'steer', 'reply', 'narration', 'thinking', 'toolCall', 'toolResult', 'system', 'compaction'];
  return found.length === expected.length
    && expected.every((k) => found.filter((f) => f === k).length === 1);
})()],
['compaction is not filed under system', !/kind:\s*'system',\s*\n\s*title:\s*'compaction'/.test(readFileSync(SERVER, 'utf8'))],
// Every kind button's visible word has to be the one in KIND_LABELS. The two used to be
// written independently — the label in the markup, the accessible name in applyKindButton —
// so renaming a kind half-applied: the button showed 问答 while announcing 答复. Neither
// copy was wrong on its own and no other assertion could see the disagreement.
['kind button labels match KIND_LABELS', (() => {
  const buttons = [...html.matchAll(
    /data-kind="(\w+)"[\s\S]{0,200}?class="tbtn-label">([^<]*)</g)];
  if (buttons.length !== sandbox.KIND_ORDER.length) return false;
  return sandbox.KIND_ORDER.every((k) => {
    const hit = buttons.filter((b) => b[1] === k);
    return hit.length === 1 && hit[0][2] === sandbox.KIND_LABELS[k];
  });
})()],
['every kind button has a label span', (html.match(/class="tbtn-label"/g) || []).length === sandbox.KIND_ORDER.length],
  // The window bar used to be rebuilt on every render, and a render happens every poll, so
  // a click landing between the clear and the re-append went to a button that was no
  // longer in the document. It is built once into its own container now; a rebuild is a
  // regression of that, not a stylistic choice.
  ['window bar is updated, not rebuilt', /windowBarParts = buildWindowBarParts\(\)/.test(html) && !/ledger\.appendChild\(buildWindowBar/.test(html)],
  ['window bar container is static markup', /<div class="window-bar" id="window-bar"/.test(html)],
  ['the axis button is built with the window bar, not hardcoded in the page', !/id="duration-btn"/.test(html) && /var axis = el\('button', 'tbtn tbtn-toggle window-bar-axis'\)/.test(html)],
  ['the axis button is applied by a helper, not by two callers', /function applyAxisButton\(button\)/.test(html) && !/function renderViewControls/.test(html)],
  // One filter means one writer per control and no parallel copy. Four controls assign
  // state.kinds — the per-kind buttons, 全部, 清除筛选, and 异常's own reset, which has to put
  // the axis back because in that mode the axis filters nothing and must not go on displaying a
  // condition that is not in force. A fifth would be another path deciding what is on screen,
  // which is what this check exists to catch; if one is ever genuinely wanted, change the check
  // in the same commit that adds the control rather than loosening it silently.
  //
  // 清除筛选 reaches the field by *delegating* to resetBaseFilters() rather than through a
  // fourth assignment, so counting assignments alone would report a control gone missing the
  // moment two paths share one writer. The delegation is counted in its place. Both halves are
  // checked because either alone is satisfiable by the wrong thing: three assignments with no
  // delegation is three controls, and a delegation that never happens is one.
  ['state.kinds is written from exactly four controls', (() => {
    const direct = (html.match(/state\.kinds\s*=[^=]/g) || []).length;
    const delegated = /function clearFilters\(\)\s*\{\s*resetBaseFilters\(\);/.test(html);
    return direct === 3 && delegated;
  })()],
  // That the fourth writer also updates the buttons is checked by verify-anomaly.mjs, not here:
  // it is a property of 异常, and it needs a mutation control that mutate-anomaly.py can run.
  // The breakdown is the only place the turn count explains itself, and its whole job is that
  // the parts add up to the headline and that the first two add up to the reply count. Those
  // were comments until a probe showed them wrong: the line used to read 已收尾 54 · 提问待答 5
  // · 中断 4 while the comment claimed 已收尾 and the reply count were the same number. They
  // were 54 and 59, because a turn that stops to ask gets its answer in the NEXT turn. The
  // function is lifted out of the page and run against synthetic stats so the arithmetic is
  // checked, not assumed.
  ['turn breakdown parts sum to the headline', (() => {
  const src = html.match(/function turnBreakdown\(stats\) \{[\s\S]*?\n {6}\}/);
  if (!src) return false;
  vm.runInContext(src[0], sandbox);
  const cases = [
    { turnsWithPrompt: 63, qaTurns: 5, openTurns: 9 },
    { turnsWithPrompt: 0, qaTurns: 0, openTurns: 0 },
    { turnsWithPrompt: 10, qaTurns: 0, openTurns: 0 },
    { turnsWithPrompt: 10, qaTurns: 3, openTurns: 3 },
    { turnsWithPrompt: 1, qaTurns: 1, openTurns: 1 },
  ];
  return cases.every((stats) => {
    const line = sandbox.turnBreakdown(stats);
    const nums = [...line.matchAll(/(\d[\d,]*)/g)].map((m) => Number(m[1].replace(/,/g, '')));
    // Every number printed must be one of the three parts, and the parts must total the headline.
    const sum = nums.reduce((a, n) => a + n, 0);
    return sum === stats.turnsWithPrompt;
  });
})()],
  // Scoped to the rendered label, not the whole file: the doc comment above turnContext
  // explains why 续作答答 was renamed and has to be able to say so.
  ['turn breakdown renders 提问轮, not 提问待答',
    /'提问轮 ' \+ formatInt\(asked\)/.test(html) && !/'提问待答 ' \+ formatInt/.test(html) && !/'续作答答 ' \+ formatInt/.test(html)],
  // The line under 对话轮次 is one string of `·`-separated parts, and a reader adds up what
  // they see. The breakdown group sums to the headline; the context group does not belong to
  // it. Shipping them unmarked is what made two disjoint fives (the turns that asked, and the
  // prompt-less turns that answered) read as one number counted twice. The boundary word is
  // the fix, so assert it is there rather than asserting the reader will notice.
['context group is marked as a separate population', (() => {
  if (!liftTurnFns()) return false;
  const suffix = sandbox.turnContextSuffix({ steers: 15, compactionTurns: 10, continuationTurns: 5 });
  // The boundary is the separator FOLLOWED by 另有. The leading `·` is what joins this group
  // to the breakdown and must stay — an earlier version of this guard asserted it was absent,
  // which was wrong: without it the two groups run together, which is the original defect.
  return /·\s*另有\s/.test(suffix);
})()],
  // And the whole rendered line, as the reader receives it, still partitions correctly once
  // the context group is set aside: the numbers before 另有 sum to the headline.
  ['numbers before 另有 sum to the headline', (() => {
  const line = sandbox.turnBreakdown({ turnsWithPrompt: 63, qaTurns: 5, openTurns: 9 })
    + sandbox.turnContextSuffix({ steers: 15, compactionTurns: 10, continuationTurns: 5 });
  const before = line.split('另有')[0];
  const nums = [...before.matchAll(/(\d[\d,]*)/g)].map((m) => Number(m[1].replace(/,/g, '')));
  return nums.reduce((a, n) => a + n, 0) === 63;
})()],
  // The two record-counting terms on the KPI line are the kind chips spelled inline. If they
  // grew their own writer, state.kinds would have a fourth opinion and the number on the card
  // could stop matching what the chip below it is actually showing — the same class of bug as
  // the layer buttons that were deleted earlier. Scoped to this function's own source: an
  // unbounded `[\s\S]*?` also reaches onKindToggle's legitimate assignment further down and
  // reports a violation that is not there.
  ['KPI kind links go through onKindToggle, not a second writer', (() => {
  const src = fnSource('function turnSubNode(stats)');
  if (!src) return false;
  return /onKindToggle\(kind, state\.kinds\.indexOf\(kind\) < 0\)/.test(src)
    && !/state\.kinds\s*=[^=]/.test(src);
})()],
  // ...and they read state at click time. A captured flag goes stale between the poll that
  // re-rendered the card and the click, which shows up as a link whose look and its effect
  // disagree — the exact failure the layer-button era had.
  ['KPI kind links do not close over a rendered flag', (() => {
  const src = fnSource('function turnSubNode(stats)');
  return Boolean(src) && !/onKindToggle\([^)]*,\s*(?:on|true|false)\s*\)/.test(src);
})()],
  // Exactly the two terms that count records become controls. 续作轮 counts turns, as do the
  // three breakdown terms, and a turn outcome is not a record kind — a 收尾 turn holds eight
  // kinds at once, so no kind set can select it. Wiring those up would be a second axis
  // wearing a kind's name.
  ['exactly the record-counting context terms are links', (() => {
  if (!liftTurnFns()) return false;
  const parts = sandbox.turnContextParts({ steers: 15, compactions: 10, compactionTurns: 0, continuationTurns: 5 });
  const linked = parts.filter((p) => p.kind).map((p) => p.kind).sort();
  const unlinked = parts.filter((p) => !p.kind).map((p) => p.label);
  return linked.length === 2
    && linked[0] === 'compaction' && linked[1] === 'steer'
    && unlinked.length === 1 && unlinked[0] === '续作轮'
    // and each linked kind is a real kind with a chip behind it
    && linked.every((k) => sandbox.KIND_ORDER.includes(k));
})()],
  // The fixture above carries `compactionTurns: 0` next to `compactions: 10` on purpose. A
  // checkpoint is filed inside the turn it interrupted, so counting turns reports zero for every
  // session that was ever compacted — which is the one thing the reader most wants to know. This
  // guard fails the moment the term goes back to reading the turn count.
  ['the compaction term counts checkpoints, not checkpoint-turns', (() => {
  if (!liftTurnFns()) return false;
  const parts = sandbox.turnContextParts({ steers: 0, compactions: 12, compactionTurns: 0, continuationTurns: 0 });
  return parts.length === 1
    && parts[0].label === '压缩'
    && parts[0].value === '12'
    && parts[0].kind === 'compaction';
})()],
  // The explanation has to exist on the card, be reachable without a mouse, and be named by
  // aria-describedby rather than only by a `title` (which is invisible to touch and to most
  // assistive tech once the hover is gone).
  ['turn card carries an accessible explanation', (() => {
  if (!/function turnTipLines\(stats\)/.test(html)) return false;
  if (!/turnSubNode\(stats\),\s*\n\s*false,\s*\n\s*'kpi-tip-turns',\s*\n\s*turnTipLines\(stats\)/.test(html)) return false;
  return /card\.setAttribute\('aria-describedby', tipId\)/.test(html)
    && /tipNode\.setAttribute\('role', 'tooltip'\)/.test(html)
    && /card\.classList\.add\('has-tip'\)/.test(html)
    && /card\.setAttribute\('tabindex', '0'\)/.test(html);
})()],
  // Every term on the line has to be explained, or the tooltip is decoration. The breakdown's
  // three terms, both linked context terms, and the unlinked one.
  ['the tip explains every term on the line', (() => {
  const src = fnSource('function turnTipLines(stats)');
  if (!src) return false;
  return ['收尾 ', '提问轮 ', '中断 ', '追加与压缩', '续作轮'].every((term) => src.includes(term));
})()],
  // 总数与序号不能共用一个词，而且总数旁边必须说出窗口实际覆盖的范围。The panel title printed
  // stats.turns (every turn in the file) as 「轮次 82」 and a turn header printed turn.index as
  // 「轮次 78」 — same two characters, two different quantities, which coincided while the
  // newest turn had a row. That left a second, steadier trap: with a 200-record window the
  // table can start at 第 81 轮 under a title saying 共 83 轮, because the window begins
  // mid-session. Both numbers were right and nothing said so, so it read as a wrong total.
  // 「共 N 轮」 can only be a total; 「第 N 轮」 can only be an ordinal; and the title must
  // carry the visible range whenever the window does not cover the whole session.
  ['panel title reads a total, turn headers read an ordinal', (() => {
  const head = /var title = '第 ' \+ \(isCount\(turn\.index\) \? turn\.index : DASH\) \+ ' 轮';/;
  if (!head.test(html)) return false;
  return !/'轮次 ' \+ \(isCount\((?:turn|group\.turn)\.index\)/.test(html)
    && !/'轮次 ' \+ turnIndex/.test(html)
    && !/\? '轮次 ' \+ turn\.index : DASH/.test(html);
})()],
  // The panel title must describe the table and nothing else. It used to lead with
  // 「共 84 轮」 — the session total — above a table whose first header read 第 82 轮, because
  // the default window holds only the newest 200 records and turn 82 alone holds 183 of them.
  // Both numbers were true and nothing said so, so the pair read as a contradiction, and the
  // natural expectation ("these should be equal, equal to 84") could not be satisfied by any
  // wording. The fix is not a better word: it is to stop putting two different scopes in the
  // same spot. The title is now the rendered range; the session total moved to the window bar,
  // next to the record counts it explains.
  ['panel title states only the rendered turn range', (() => {
  const src = fnSource('function turnRangeLabel(firstTurn, lastTurn)');
  if (!src) return false;
  if (/共 /.test(src)) return false;                       // no session total in the title
  if (!/'第 ' \+ formatInt\(firstTurn\) \+ '–' \+ formatInt\(lastTurn\) \+ ' 轮'/.test(src)) return false;
  return /'第 ' \+ formatInt\(firstTurn\) \+ ' 轮'/.test(src);
})()],
  ['the session total lives on the window bar instead', (() => {
  const src = fnSource('function updateWindowBar(shown, hiddenAbove, total)');
  if (!src) return false;
  if (!/var sessionTurns = state\.payload && state\.payload\.stats \? state\.payload\.stats\.turns : null;/.test(src)) return false;
  // Both readings of the count have to name it, not one of them. The bar shows 已显示 … once a
  // window is settled and 正在显示 N / M … while a batched build is still running, and the two are
  // separate statements rather than one text with a suffix. A mid-build line that quietly dropped
  // the session total would leave the reader, mid-scroll through 18,924 rows, without the one
  // number saying how much of the session is left — so each branch is pinned on its own, with its
  // own indentation, rather than "the string appears somewhere in this function".
  // The anchor carries `matchedLabel` because the settled line inserts the filter result between
  // 共 N 条 and 已显示 — the two pairs a reader can add. Both branches still have to name the
  // session total on their own; pinning each with its own indentation is what keeps "the string
  // appears somewhere in this function" from passing when only one of them has it.
  const branches = [
    "          (isCount(sessionTurns) ? '全场 ' + formatInt(sessionTurns) + ' 轮 · ' : '') +\n"
      + "          '共 ' + formatInt(total) + ' 条' + matchedLabel + ' · 已显示 '",
    "            (isCount(sessionTurns) ? '全场 ' + formatInt(sessionTurns) + ' 轮 · ' : '') +\n"
      + "            '共 ' + formatInt(total) + ' 条 · 正在显示 '"
  ];
  return branches.every((branch) => src.indexOf(branch) >= 0);
})()],
  ['the title is written after the groups are built', (() => {
  // If it is set before `visibleTurns`, the range is not knowable and the label silently
  // degrades — the exact defect, back again.
  const at = html.indexOf('dom.ledgerMeta.textContent = turnRangeLabel');
  const groupsAt = html.indexOf('var groups = visibleTurns(windowed)');
  return at > 0 && groupsAt > 0 && at > groupsAt;
})()],
  // The window opens on the newest page, and the button names the ACTION rather than the state.
  //
  // It briefly opened on 全部, on the theory that a page hiding 8,000 records behind a click
  // makes a poor first impression. Measured on this session that froze the page: ~9,900 rows
  // and ~57,000 real DOM elements with no virtual scrolling, rebuilt every 2.5s poll — a
  // single inspect took 13.7s. So 全部 is opt-in.
  //
  // The label went the other way twice and is now settled: it names what pressing the button
  // will do. The count beside it already reports the current state, so a label restating the
  // state spends its width saying nothing — at the default it read 只看最新 200 条 directly
  // above 已显示 200 条. Action and report answer different questions and cannot contradict.
  ['the window opens on the newest page, and the button names the action', (() => {
  if (!/allRecords: false,/.test(html)) return false;
  if (!/limit: PAGE_STEP,/.test(html)) return false;
  if (!/var DEFAULT_WINDOW_MODE = 'latest';/.test(html)) return false;
  const src = fnSource('function applyWindowMode(parts, hiddenAbove)');
  if (!src) return false;
  // Arms opposite to the count: allRecords true -> offer the page, false -> offer everything.
  if (!/state\.allRecords \? '显示最新 ' \+ formatInt\(PAGE_STEP\) \+ ' 条' : '显示全部'/.test(src)) return false;
  // aria-pressed stays on the state, which is why the accessible name repeats it.
  if (!/'aria-pressed', state\.allRecords \? 'true' : 'false'/.test(src)) return false;
  if (!/classList\.toggle\('btn-quiet', state\.allRecords\)/.test(src)) return false;
  return /state\.allRecords \? '正在显示全部记录 · 点击改为只显示最新 ' \+ formatInt\(PAGE_STEP\) \+ ' 条'/.test(src);
})()],
  // One definition of the default, quoted by every reset. Eight call sites used to hard-code
  // 'latest', so changing the default left all eight resetting to a window that may no longer
  // be the default — a reader whose view was reset by any filter click would land somewhere
  // nobody chose. The constant's value is checked by the guard above; this one checks only
  // that the resets quote it rather than repeating it.
  ['every window reset quotes the default, not a literal', (() => {
  if (!/var DEFAULT_WINDOW_MODE = '(?:latest|all)'/.test(html)) return false;
  const reset = fnSource('function resetWindowMode()');
  if (!reset || !/setWindowMode\(DEFAULT_WINDOW_MODE\)/.test(reset)) return false;
  // A reset must not read the window it is resetting; that preserves the value being discarded.
  if (/state\.allRecords/.test(reset)) return false;
  // No reset may name a mode literally. The only legitimate caller that reads state is the
  // mode button, which *toggles* rather than resets — so the test is "does any call pass
  // a literal", not "does any call avoid DEFAULT".
  const resets = html.match(/setWindowMode\('(latest|all)'\);/g) || [];
  if (resets.length) return false;
  // One direct setWindowMode call: the toggle in buildWindowBarParts. Everything else goes
  // through the helper. The \b matters — resetWindowMode contains the substring setWindowMode,
  // and without it every reset counts as a direct call and the guard can never pass.
  //
  // The reset count is an inventory, not a rule: eight when every filter reset the window,
  // ten since the time range gained resets on both sides of its own lifecycle, eleven once
  // 异常 became a filter of its own and had to reset the window like the others do, and twelve
  // once 异常 grew a way back — 全部数据 — which is a filter change like any other and would
  // otherwise leave the reader on a stale window after leaving anomaly mode. It used to force
  // 「全部」 instead of resetting, which would have shown up here as a second direct call — and
  // measured, that cost a 414,000px document on a range covering the session.
  const direct = (html.match(/\bsetWindowMode\((?!mode\)|DEFAULT_WINDOW_MODE)/g) || []).length;
  return direct === 1 && (html.match(/resetWindowMode\(\);/g) || []).length === 12;
})()],
  // Clicking the window button must not move the page. It scrolled to the document tail
  // whenever it narrowed the window, on the theory that "back to the tail" should land on the
  // newest record. The reader clicked a control they were already looking at, so the jump threw
  // away whatever they had been reading; renderLedger's row anchor is the correct behaviour.
  ['the window button does not scroll the page', (() => {
  const src = fnSource('function buildWindowBarParts()');
  if (!src) return false;
  const click = src.slice(src.indexOf('var mode = el('));
  if (!click) return false;
  // No scroll call inside the mode button's own handler.
  return !/window\.scroll(To|By)/.test(click)
    && /setWindowMode\(state\.allRecords \? 'latest' : 'all'\);\s*\n\s*renderLedger\(\);/.test(click);
})()],
  // `.btn` sets display:inline-flex, which outranks the user-agent [hidden] rule. So a `.btn`
  // toggled off with .hidden stayed on screen — and 「向上加载更早的 N 条」 only wrote its label
  // when it was showing, so on load it rendered as a bordered empty box between the axis toggle
  // and the window button. Six other classes in this file already carry the patch; `.btn` was
  // the one that was missed, and it is patched on the class rather than on the instance.
  ['a .btn toggled with hidden is actually hidden', (() => {
  // No space before the attribute selector: the rule reads `.btn[hidden]`, not `.btn [hidden]`.
  // The brackets are escaped — unescaped, [hidden] is a character class and this can never
  // match anything.
  if (!/\n      \.btn\[hidden\] \{\n        display: none;\n      \}/.test(html)) return false;
  // And the button that exposed it must not be blank even when hidden.
  const mode = fnSource('function applyWindowMode(parts, hiddenAbove)');
  if (!mode) return false;
  return /parts\.more\.textContent = '向上加载更早的 ' \+ formatInt\(Math\.min\(PAGE_STEP, Math\.max\(hiddenAbove, 0\)\)\) \+ ' 条';/.test(mode)
    && !/if \(hiddenAbove > 0\) \{\s*\n\s*parts\.more\.textContent/.test(mode);
})()],
  // 「向上加载更早的 N 条」 is meaningless in 全部: state.limit is Infinity, and Infinity + 200
  // is still Infinity, so the click would re-render and change nothing. Hidden in that mode, but
  // the guard keeps "it is hidden" from being the only thing standing between a reader and a
  // dead button.
  ['the load-more button does nothing in 全部 instead of pretending to', (() => {
  const src = fnSource('function buildWindowBarParts()');
  if (!src) return false;
  const more = src.slice(src.indexOf('var more = el('), src.indexOf('var mode = el('));
  if (!more) return false;
  return /if \(state\.allRecords\) return;/.test(more)
    && /state\.limit \+= PAGE_STEP;/.test(more);
})()],
  // `limit` above PAGE_STEP means the reader pressed 向上加载更早的 N 条. A poll that resets it
  // takes that back silently, so the button re-renders and appears to do nothing — which is
  // what it did: this session grows fast enough that the count looked unchanged either way.
  // Only a limit that is still exactly PAGE_STEP is tail-following, and only that re-pins.
  ['a poll does not undo a window the reader widened', (() => {
  const src = fnSource('function rePinWindow()');
  if (!src) return false;
  if (!/if \(state\.allRecords\) return state\.limit;/.test(src)) return false;
  return /if \(state\.limit > PAGE_STEP\) return state\.limit;/.test(src);
})()],
  // A checkpoint is drawn as a band, not as a row. It has to be routed there in the one place
  // the ledger builds its list — routing it anywhere else would leave the row grid laying it out
  // like ordinary work while the CSS sits unused.
  ['a compaction record renders as a band, not as a row', (() => {
  if (!/function buildCompactionBand\(entry\)/.test(html)) return false;
  const render = fnSource('function renderLedger()');
  if (!render) return false;
  const loop = render.slice(render.indexOf('var rails = railStates('));
  if (!loop) return false;
  return /group\.entries\[j\]\.record\.kind === 'compaction'/.test(loop)
    && /item\.className = 'compaction-cell'/.test(loop)
    && /item\.appendChild\(buildCompactionBand\(group\.entries\[j\]\)\)/.test(loop);
})()],
  // The band is a real control: it carries the same data-row-id the inspector looks up, so
  // clicking it opens the checkpoint's details rather than doing nothing.
  ['the compaction band is selectable and states what it is', (() => {
  const src = fnSource('function buildCompactionBand(entry)');
  if (!src) return false;
  return /setAttribute\('data-row-id', record\.id \|\| String\(record\.index\)\)/.test(src)
    && /selectRecord\(record\.id\)/.test(src)
    // The point of the band is that it says what changed, so the generation and the moment both
    // have to be in it. Neither is decoration. The condition is matched whole: a mutation that
    // hard-codes `opened` still leaves `record.generation` sitting in the branch it no longer
    // reaches, and this has to fail on that.
    && /var opened = isCount\(record\.generation\)/.test(src)
    && /formatOffset\(record\.relativeMs\)/.test(src)
    && /record\.index/.test(src);
})()],
  // `display: inline-flex` on the pills beat the UA `[hidden]` rule once already in this file, so a
  // band that can be hidden needs its own rule rather than trusting the user-agent sheet.
  ['the compaction band has its own styles, using defined tokens only', (() => {
  if (!/\n      \.compaction-band \{/.test(html)) return false;
  const block = html.slice(html.indexOf('\n      .compaction-band {'));
  if (!block) return false;
  const rule = block.slice(0, block.indexOf('\n      }'));
  // Every custom property it names has to be one this file actually defines for both themes.
  const used = [...rule.matchAll(/var\((--mcode-[a-z-]+)\)/g)].map((m) => m[1]);
  const defined = new Set(
    [...html.matchAll(/^\s*(--mcode-[a-z-]+):/gm)].map((m) => m[1])
  );
  return used.length > 0 && used.every((token) => defined.has(token));
})()],
  // ---- the 记录序号 column -------------------------------------------------
  // The first grid track was 42px, which holds `#` plus four digits. A session that
  // passed 10,000 records pushed the fifth digit out of the track, and a grid item is
  // `overflow: visible` by default, so the digit spilled into the kind column and was
  // painted over by the opaque pill: `#10950`..`#10959` all read `#1095`. Ten rows in a
  // row showed the reader one number, and unlike a wrong number that one cannot be
  // checked — it looks exactly like a real index.
  //
  // The requirement below is derived rather than asserted. The old track held five
  // characters and would not hold six, so one character is at most 42 / 5 = 8.4px. A
  // label is `#` plus at most seven digits, so 8 characters need at most 67.2px.
  ['the 序号 column is wide enough for the label it must show', (() => {
    const labelChars = 8;
    const maxCharPx = 42 / 5;
    const required = Math.ceil(labelChars * maxCharPx);
    const hits = [...html.matchAll(/--traj-index-col:\s*(\d+)px/g)];
    // Exactly one declaration: a second one would be a value some of these tracks use
    // and the rest do not, which is the drift this constant exists to prevent.
    if (hits.length !== 1) return false;
    return Number(hits[0][1]) >= required;
  })()],
  ['every grid that renders a 序号 uses the shared column', (() => {
    const rules = [
      ['.row', /\n {6}\.row \{[^}]*?grid-template-columns:\s*([^;]+);/s],
      ['.compaction-band', /\n {6}\.compaction-band \{[^}]*?grid-template-columns:\s*([^;]+);/s],
      ['.skeleton-row', /\n {6}\.skeleton-row \{[^}]*?grid-template-columns:\s*([^;]+);/s],
      // The narrow-screen override is the one that used to shrink this track to 28px.
      ['narrow override', /\n {8}\.row,\n {8}\.skeleton-row \{[^}]*?grid-template-columns:\s*([^;]+);/s]
    ];
    return rules.every(([, pattern]) => {
      const match = pattern.exec(html);
      return !!match && match[1].trim().startsWith('var(--traj-index-col)');
    });
  })()],
  // The 时间区间 pickers must be sized by their own content. A `datetime-local` is laid out by
  // the browser from the localized date it has to draw, so a width in the stylesheet is a guess
  // about something the user agent already knows — and the guess was made twice and wrong both
  // times: 18ch clipped the year off the text box that preceded it, and 20ch clipped the minutes
  // behind the calendar icon on the picker itself. What must not come back is a fixed width, or
  // a flex context that lets the toolbar squeeze the control, which is the same clipping by
  // another route.
  ['the 时间区间 pickers are sized by their content, not by a fixed width', (() => {
    const rule = /\n {6}\.range-input \{([^}]*)\}/.exec(html);
    if (!rule) return false;
    if (/^\s*(min-)?width\s*:/m.test(rule[1])) return false;
    return /flex:\s*none;/.test(rule[1]);
  })()],
  // Exactly one rule: a second one could carry the width this is here to prevent.
  ['and no later rule gives the 时间区间 pickers a width', (() => {
    const rules = [...html.matchAll(/\.range-input[^{]*\{([^}]*)\}/g)];
    return rules.length === 1 && !/^\s*(min-)?width\s*:/m.test(rules[0][1]);
  })()],
  // Containment is what turns a future width regression from a lie into a visible
  // ellipsis. The digit spilling onto the pill is the whole defect: both the missing
  // digit and the number it was hiding are invisible, and the row reads as a
  // different, entirely valid index.
  ['a 序号 that still does not fit is ellipsised, never spilled onto the pill', (() => {
    const start = html.indexOf('\n      .row-index {');
    if (start < 0) return false;
    const rule = html.slice(start, html.indexOf('\n      }', start));
    return /overflow:\s*hidden/.test(rule)
      && /text-overflow:\s*ellipsis/.test(rule)
      && /white-space:\s*nowrap/.test(rule);
  })()],
];
for (const [name, ok] of checks) {
  if (ok) pass += 1;
  else failures.push('policy: ' + name);
}

console.log('[2] pure helpers: ' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('[3] static policy checks: PASS');
console.log('OK  (large-fixture pipeline ' + elapsedMs.toFixed(1) + 'ms for 3000 records)');
