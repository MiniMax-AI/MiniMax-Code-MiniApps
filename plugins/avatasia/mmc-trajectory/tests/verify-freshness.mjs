// Behavioural checks for the freshness layer: `#error-bar` and `#stale-bar`.
//
// The assertions are scenarios, not a list of symbols, and they are run against the delivered
// script rather than a copy: this layer had no guard at all, which is why a warning could sit on
// screen saying 「正在重试」 for as long as the session stayed quiet. A quiet session revalidates
// into a 304 on every tick, so "cleared only when a body arrived" was enough to strand it.
//
// Load-bearing ones:
//   · a 304 counts as fresh — otherwise the bar outlives the fault;
//   · a 304 does NOT re-render — otherwise the fix trades a stuck bar for a permanent rebuild;
//   · two sources are independent, and the worse one speaks;
//   · a dropped connection and an unreadable answer are told apart.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HTML = fileURLToPath(new URL('../miniapp/client/index.html', import.meta.url));
const html = readFileSync(HTML, 'utf8');

const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])[0];
if (!script) throw new Error('no inline script found');

// Cut the bootstrap: the page must not fetch or mount while under test.
const bootIndex = script.lastIndexOf("if (document.readyState === 'loading')");
const body = bootIndex === -1 ? script : script.slice(0, bootIndex);

const noop = () => {};

/** A bar node: `hidden`, plus the two child nodes `renderBars` writes through querySelector. */
function barNode() {
  const parts = {};
  return {
    hidden: true,
    textContent: '',
    querySelector(sel) {
      if (!parts[sel]) parts[sel] = { textContent: '' };
      return parts[sel];
    }
  };
}

function domNode(tag) {
  const kids = [];
  const attrs = {};
  return {
    tag,
    childNodes: kids,
    get firstChild() { return kids.length ? kids[0] : null; },
    appendChild(n) { kids.push(n); return n; },
    removeChild(n) { const i = kids.indexOf(n); if (i >= 0) kids.splice(i, 1); return n; },
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
    removeAttribute(k) { delete attrs[k]; },
    style: { setProperty: noop },
    className: '',
    textContent: ''
  };
}

/** A response good enough for the two fetches: status, etag, and a body that may be missing. */
function res(status, body, etag) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => (k === 'etag' ? (etag ?? null) : null) },
    json: () => (body === undefined ? Promise.reject(new Error('no body')) : Promise.resolve(body))
  };
}

const LISTS = { sessions: [{ id: 's1', label: 'a', sizeBytes: 10, lastActiveAt: 1 }] };
const TRAJ = { turns: [], stats: {}, session: { id: 's1' }, generation: 1, cursor: 'c1' };

let renders = 0;
let responder = () => Promise.resolve(res(200, LISTS, 'W/"l1"'));

const sandbox = {
  console,
  AbortController,
  window: {
    localStorage: { getItem: () => null, setItem: noop },
    matchMedia: () => ({ addEventListener: noop, addListener: noop }),
    setTimeout: () => 0,
    clearTimeout: noop,
    setInterval: () => 0,
    clearInterval: noop
  },
  document: {
    documentElement: { dataset: {} },
    body: { classList: { add: noop, remove: noop } },
    createElement: (tag) => domNode(tag)
  },
  fetch: (url, opts) => responder(url, opts)
};
vm.createContext(sandbox);
vm.runInContext(body, sandbox);

// Everything expensive is stubbed and counted; everything this layer owns is the delivered code.
// `render` in particular is replaced rather than exercised: the whole point of one assertion below
// is that a 304 must NOT reach it, and running it for real would rebuild a ledger to say so. It
// still draws the bars, because that is what it is on this path for.
const drawBars = sandbox.renderBars;
sandbox.render = () => { renders += 1; drawBars(); };
sandbox.renderLoading = noop;
sandbox.renderSessionSelect = noop;
// The list body feeds two picks now, and the second one is redrawn from the same body.
sandbox.renderChildSelect = noop;
sandbox.rePinWindow = noop;
sandbox.runSearch = noop;

sandbox.dom.errorBar = barNode();
sandbox.dom.errorTitle = barNode();
sandbox.dom.errorText = barNode();
sandbox.dom.staleBar = barNode();

let pass = 0;
const failures = [];
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass += 1;
  else failures.push(`${name}\n      got  ${JSON.stringify(actual)}\n      want ${JSON.stringify(expected)}`);
}
function assert(name, cond) {
  if (cond) pass += 1;
  else failures.push(name);
}

const bar = () => sandbox.dom.staleBar;
const title = () => sandbox.dom.staleBar.querySelector('.bar-title').textContent;
const hint = () => sandbox.dom.staleBar.querySelector('.bar-hint').textContent;
const shown = () => sandbox.dom.staleBar.hidden === false;

/** Start from a healthy page: something on screen, nothing degraded. */
function reset() {
  sandbox.freshness.trajectory.streak = 0;
  sandbox.freshness.trajectory.reason = '';
  sandbox.freshness.sessions.streak = 0;
  sandbox.freshness.sessions.reason = '';
  sandbox.state.payload = null;
  sandbox.state.hardError = null;
  sandbox.state.loading = false;
  sandbox.dom.staleBar.hidden = true;
  sandbox.dom.errorBar.hidden = true;
  sandbox.dom.staleBar.querySelector('.bar-title').textContent = '';
  sandbox.dom.staleBar.querySelector('.bar-hint').textContent = '';
  renders = 0;
}

const DROP = () => Promise.reject(new TypeError('failed to fetch'));
const BAD = (status) => () => Promise.resolve(res(status, undefined, null));
const NOTMOD = () => Promise.resolve(res(304, undefined, 'W/"x"'));

/* ================================================================= the regression */

reset();
sandbox.state.payload = TRAJ;                 // there is something to be out of date
responder = () => Promise.resolve(res(200, TRAJ, 'W/"t1"'));
await sandbox.fetchTrajectory(false);
assert('a good load shows no warning', shown() === false);

responder = DROP;
await sandbox.fetchTrajectory(false);
assert('a dropped connection raises the warning', shown() === true);

responder = NOTMOD;
await sandbox.fetchTrajectory(false);
assert('a 304 takes the warning down — this is the defect the guard exists for', shown() === false);
check('and the streak is back to zero', sandbox.freshness.trajectory.streak, 0);

/* ---------------------------------------------------------------- it must stay down */

responder = NOTMOD;
renders = 0;
for (let i = 0; i < 5; i += 1) await sandbox.fetchTrajectory(false);
check('five more 304s on a quiet session render nothing', renders, 0);
assert('and the warning has not come back', shown() === false);

/* ---------------------------------------------------------------- a 200 also clears */

reset();
sandbox.state.payload = TRAJ;
responder = DROP;
await sandbox.fetchTrajectory(false);
assert('raised again', shown() === true);
responder = () => Promise.resolve(res(200, TRAJ, 'W/"t2"'));
await sandbox.fetchTrajectory(false);
assert('a fresh body takes it down too', shown() === false);

/* ---------------------------------------------------------------- how long it has been up */

reset();
sandbox.state.payload = TRAJ;
responder = DROP;
await sandbox.fetchTrajectory(false);
// A first failure is a blip that clears itself within one poll, and it gets no extra sentence
// saying so — that is what the count is for, and it starts at the second.
assert('the first failure does not claim to be a pattern', hint().includes('连续') === false);
await sandbox.fetchTrajectory(false);
assert('by the second the count is on screen', hint().includes('连续 2 次'));
await sandbox.fetchTrajectory(false);
assert('and by the third it is right', hint().includes('连续 3 次'));
assert('the count names what stopped updating', hint().includes('轨迹'));

/* ---------------------------------------------------------------- which kind of failure */

reset();
sandbox.state.payload = TRAJ;
responder = DROP;
await sandbox.fetchTrajectory(false);
const offlineTitle = title();
assert('a dropped connection says so', offlineTitle === '与本地服务的连接中断，正在重试');
assert('and does not blame the server for it', offlineTitle.includes('更新失败') === false);

reset();
sandbox.state.payload = TRAJ;
responder = BAD(500);
await sandbox.fetchTrajectory(false);
const badTitle = title();
assert('an unreadable answer says something different', badTitle !== offlineTitle);
assert('and names the server as the place to look', badTitle === '服务端返回了无法读取的内容，正在重试');

reset();
sandbox.state.payload = TRAJ;
responder = () => Promise.resolve(res(503, { error: 'trajectory_unreadable', message: 'x' }, null));
await sandbox.fetchTrajectory(false);
assert('a structured code keeps its own wording', title() === '会话数据暂时无法读取，正在重试');
assert('and is not folded into the unreadable-answer wording', title() !== badTitle);

/* ---------------------------------------------------------------- the session list */

reset();
sandbox.state.payload = TRAJ;
responder = () => Promise.resolve(res(200, LISTS, 'W/"l1"'));
await sandbox.fetchSessions();
assert('a healthy list raises nothing', shown() === false);

responder = DROP;
await sandbox.fetchSessions();
assert('a failed list is visible at all — it used to write a flag nothing read', shown() === true);
await sandbox.fetchSessions();
assert('and by the second it says which one stopped', hint().includes('会话列表'));

responder = NOTMOD;
await sandbox.fetchSessions();
assert('a 304 on the list takes its warning down too', shown() === false);

/* ---------------------------------------------------------------- two sources, independently */

reset();
sandbox.state.payload = TRAJ;
responder = () => Promise.resolve(res(200, TRAJ, 'W/"t3"'));
await sandbox.fetchTrajectory(false);
responder = DROP;
await sandbox.fetchSessions();
assert('a healthy trajectory does not hide a failed list', shown() === true);

responder = () => Promise.resolve(res(200, LISTS, 'W/"l2"'));
await sandbox.fetchSessions();
assert('the list recovering is enough when nothing else is wrong', shown() === false);
check('and its streak is cleared', sandbox.freshness.sessions.streak, 0);

/* ---------------------------------------------------------------- nothing on screen */

reset();
sandbox.state.payload = null;
responder = DROP;
await sandbox.fetchTrajectory(false);
assert('with nothing on screen it is a hard error, not a freshness note', shown() === false);
assert('and the hard error is shown', sandbox.dom.errorBar.hidden === false);
sandbox.dom.errorBar.hidden = true;

if (failures.length) {
  console.error(`[freshness] ${pass} passed, ${failures.length} FAILED`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`[freshness] ${pass} passed, 0 failed`);
