/**
 * The 上下文代 picker steps aside while the reader moves down through the ledger, and comes back
 * the moment they move up. It has to do that without costing anything the rest of the page is
 * counting on, and this file is about the "without".
 *
 * The page is not a normal page here, and that is what the invariants are actually for:
 *
 *   1. It has no scroll listener at all — everything pinned works because `position: sticky` does
 *      it. So this is the first listener in the file, and the first thing that can run on every
 *      frame of a reader's scroll. `passive: true` is not tidiness: a handler that may delay the
 *      scroll is the wrong tool next to a document that rebuilds itself mid-read (D12, D15).
 *   2. It scrolls *itself*. restoreRowAnchor() moves the window on every ledger rebuild, so a
 *      700px jump arrives with no reader behind it. Read as a direction it would put the picker
 *      away while nobody was doing anything.
 *   3. The band is measured, not assumed. syncStickyOffsets() reads its offsetHeight and three
 *      pinned strips are positioned from it, so anything that changes the band's height turns a
 *      scroll into a forced re-measure and a re-layout of everything pinned below.
 *   4. It holds a focusable control. Anything that hides one without saying so takes it out of
 *      the tab order and the accessibility tree, which is correct — but it must never do that to
 *      a control the reader's focus is on, and it must never leave focus on something invisible.
 *
 * The behaviour is checked by *running* onScrollFrame() against a stub window through scripted
 * scroll sequences, so a version that keeps the source shape and loses the behaviour fails here
 * rather than looking plausible. The source assertions cover the things a run cannot see: that the
 * hiding is `visibility` and not `display`, that the focus and pinned-generation vetoes are
 * actually consulted, and that nothing in render() can overwrite the state.
 *
 * mutate-reading-away.py breaks each of these in the shipped file and requires this guard to catch
 * it by name.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HTML = fileURLToPath(new URL('../miniapp/client/index.html', import.meta.url));
const html = readFileSync(HTML, 'utf8');

const styleMatch = /<style>([\s\S]*?)<\/style>/.exec(html);
if (!styleMatch) {
  console.log('FAIL: no <style> block in the client');
  process.exit(1);
}
const css = styleMatch[1].replace(/\/\*[\s\S]*?\*\//g, '');

let pass = 0;
const failures = [];
function assert(name, cond) {
  if (cond) pass += 1;
  else failures.push(name);
}

/* ---------- CSS ---------- */

/** Every rule whose selector list contains exactly `sel`, in source order. */
function rulesFor(sel) {
  const out = [];
  const re = /^[ \t]*([^{}@][^{}]*?)\{[^{}]*\}/gm;
  let m;
  while ((m = re.exec(css))) {
    const selectors = m[1].split(',').map((s) => s.trim());
    if (selectors.includes(sel)) out.push(m[0].slice(m[0].indexOf('{') + 1, m[0].lastIndexOf('}')));
  }
  return out;
}

function decls(sel) {
  const map = new Map();
  for (const body of rulesFor(sel)) {
    for (const part of body.split(';')) {
      const at = part.indexOf(':');
      if (at < 0) continue;
      map.set(part.slice(0, at).trim(), part.slice(at + 1).replace(/\s+/g, ' ').trim());
    }
  }
  return map;
}

function value(sel, prop) {
  const d = decls(sel);
  return d.has(prop) ? d.get(prop) : null;
}

const HIDDEN = 'body.is-reading-down .filter-row-tail';
const TAIL = '.filter-row-tail';

// `display: none` here would be the mistake this whole file exists to catch: it takes the control
// out of layout, so the band's height becomes a function of scroll direction and every scroll
// forces syncStickyOffsets() to re-measure and the pinned strips to re-lay-out.
assert('stepping aside uses visibility, not display, so the band height cannot depend on scroll',
  value(HIDDEN, 'visibility') === 'hidden' && value(HIDDEN, 'display') === null);
assert('stepping aside fades as well as hides',
  value(HIDDEN, 'opacity') === '0');
// `opacity: 0` alone leaves the control focusable and announced: invisible but still in the tab
// order is worse than either visible or hidden.
assert('the shown state is the default — nothing hides the picker without a scroll having said so',
  value(TAIL, 'visibility') === null && value(TAIL, 'opacity') === null);

// The hidden state has to keep the control visible for as long as it is fading. The other order
// blanks it first and leaves a keyboard reader focused on nothing for 140ms.
const hideTransition = value(HIDDEN, 'transition') ?? '';
assert('the hidden state delays visibility until the fade is over',
  /visibility\s+0s\s+linear\s+140ms/.test(hideTransition));
assert('the shown state reveals visibility at once, or the fade-in would be invisible',
  /visibility\s+0s\s+linear\s+0s/.test(value(TAIL, 'transition') ?? ''));

// The state lives on <body> so it composes with the anomaly axis, which puts its own
// `data-anomaly-mode` attribute on the same element. A class on the band instead would have made
// two features own one element's identity for no reason.
assert('the stepping-aside state is a body class, alongside the anomaly mode rather than fighting it',
  rulesFor(HIDDEN).length === 1 && /body\.is-reading-down/.test(HIDDEN)
  && /body\[data-anomaly-mode='on'\]/.test(css));

/* ---------- script, extracted ---------- */

function functionSource(name) {
  const at = html.indexOf('function ' + name + '(');
  if (at < 0) return null;
  let i = html.indexOf('{', at);
  let depth = 0;
  for (let j = i; j < html.length; j += 1) {
    if (html[j] === '{') depth += 1;
    else if (html[j] === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(at, j + 1);
    }
  }
  return null;
}

/** The body of a named function, without its wrapper. */
function bodyOf(name) {
  const src = functionSource(name);
  return src ? src.slice(src.indexOf('{') + 1, src.lastIndexOf('}')) : '';
}

/**
 * Build a sandbox holding the shipped 让位 code, and drive it through a scripted scroll sequence.
 *
 * `steps` is a list of what happens between frames: `{y}` for a scroll to that position, `{focus}`
 * to move focus into the tail, `{pin}` to pin or unpin a generation. Returns the sequence of
 * booleans the body class was set to, one per frame.
 */
function drive(steps, startY) {
  const toggled = [];
  const sandbox = {
    state: { generation: null },
    dom: {
      // `contains(null)` is false in the DOM. A stub that answered true made the focus veto fire
      // on every frame, which reads exactly like a handler that never works.
      filterRowTail: {
        contains(node) {
          return node != null && node === sandbox.document.activeElement;
        },
      },
    },
    document: {
      activeElement: null,
      body: { classList: { toggle(name, on) { toggled.push(on); } } },
    },
    window: { scrollY: startY ?? 0, pageYOffset: 0, requestAnimationFrame: null },
  };
  sandbox.window.pageYOffset = sandbox.window.scrollY;
  vm.createContext(sandbox);

  const parts = [];
  for (const constName of ['READ_AWAY_PX', 'SCROLL_JUMP_PX', 'SHOW_EPS_PX']) {
    const m = new RegExp('var\\s+' + constName + '\\s*=\\s*([^;]+);').exec(html);
    if (!m) return { toggled, error: constName + ' is not in the shipped script' };
    parts.push('var ' + constName + ' = ' + m[1] + ';');
  }
  for (const stateName of ['readingDown', 'lastScrollY', 'downRun', 'scrollFrame']) {
    const m = new RegExp('var\\s+' + stateName + '\\s*=\\s*([^;]+);').exec(html);
    if (!m) return { toggled, error: stateName + ' is not in the shipped script' };
    parts.push('var ' + stateName + ' = ' + m[1] + ';');
  }
  for (const fn of ['tailHasFocus', 'mayStepAside', 'setReadingDown', 'onScrollFrame']) {
    const src = functionSource(fn);
    if (!src) return { toggled, error: fn + ' is not in the shipped script' };
    parts.push(src);
  }
  // Start where the page starts, which is what wire() baselines lastScrollY to.
  sandbox.lastScrollY = sandbox.window.scrollY;

  try {
    vm.runInContext(parts.join('\n'), sandbox);
    for (const step of steps) {
      if (step.focus !== undefined) sandbox.document.activeElement = step.focus;
      if (step.pin !== undefined) sandbox.state.generation = step.pin ? 27 : null;
      if (step.y !== undefined) sandbox.window.scrollY = step.y;
      sandbox.onScrollFrame();
    }
  } catch (error) {
    return { toggled, error: String(error && error.message) };
  }
  return { toggled, error: null };
}

/** The state the body class ends up in after a sequence, as the last value toggled to. */
function endsHidden(result) {
  if (result.error || !result.toggled.length) return null;
  return result.toggled[result.toggled.length - 1];
}

const down = (from, by, n) => Array.from({ length: n }, (_, i) => ({ y: from + by * (i + 1) }));

// Three frames of 100px is 300px, past the 240px threshold, and each delta is under the 120px
// jump guard, so this is the sequence that is supposed to put the picker away.
const aLongRead = down(0, 100, 3);
// Two frames is 200px: a reader settling into the ledger, which must not cost them the control.
const aSettle = down(0, 100, 2);

const r1 = drive(aLongRead, 0);
assert('the shipped handler runs on a scripted read', r1.error === null);
assert('a continuous read of 300px puts the picker away', endsHidden(r1) === true);

const r2 = drive(aSettle, 0);
assert('a 200px settle leaves the picker alone — the cost of getting it back has to be worth it',
  endsHidden(r2) === null);

const r3 = drive([...aLongRead, { y: 200 }], 0);
assert('any upward movement brings it straight back', endsHidden(r3) === false);

// Coming back to the top is one large delta, so it has to be decided before the jump guard — and
// the run has to start from a hidden state, because a run that begins shown never has to change it
// and so cannot show that this branch exists at all.
const r4 = drive([...aLongRead, { y: 0 }], 0);
assert('coming back to the top shows it, even though that is one large jump',
  endsHidden(r4) === false);

const r5 = drive([{ y: 900 }], 0);
assert('a 900px jump is not a scroll: nothing was read, so nothing is put away',
  endsHidden(r5) === null);

const r6 = drive(aLongRead.map((s) => ({ ...s, pin: true })), 0);
assert('a pinned generation vetoes stepping aside — its banner points at the control',
  endsHidden(r6) === null);

const r7 = drive(aLongRead.map((s, i) => ({ ...s, focus: i === 0 ? {} : null })), 0);
assert('focus inside the picker vetoes stepping aside', endsHidden(r7) === null);

// Once it is away, more reading keeps it away. A handler that re-decided on every frame would
// flicker it back on the first frame where `downRun` had not yet crossed the threshold.
const r8 = drive([...aLongRead, ...down(300, 100, 4)], 0);
assert('it stays away across a longer read instead of flickering back each frame',
  r8.toggled.filter(Boolean).length === 1 && endsHidden(r8) === true);

// Every one of those had to reach the same code path for the assertion to mean anything.
const frameBody = bodyOf('onScrollFrame');
assert('a downward frame consults the vetoes before putting the picker away',
  /if\s*\(!mayStepAside\(\)\)/.test(frameBody));
assert('a jump resets the run instead of changing the state',
  /Math\.abs\(delta\)\s*>\s*SCROLL_JUMP_PX\)\s*\{\s*downRun\s*=\s*0;\s*return;/.test(frameBody));
assert('the handler coalesces into one frame rather than deciding per event',
  /requestAnimationFrame/.test(bodyOf('scheduleReadingDown'))
  && /scrollFrame\s*!==\s*null/.test(bodyOf('scheduleReadingDown')));

/* ---------- the listener ---------- */

const scrollHook = /window\.addEventListener\(\s*'scroll'\s*,\s*(\w+)\s*,\s*(\{[^}]*\})?\s*\)/.exec(html);
assert('the scroll decision is coalesced into one per frame', scrollHook && scrollHook[1] === 'scheduleReadingDown');
// A scroll listener that can delay the scroll is a layout-thrash source on a page whose scroll path
// is already the subject of D12 and D15.
assert('the scroll listener is passive, so it cannot delay the scroll it is reading',
  !!scrollHook && !!scrollHook[2] && /passive\s*:\s*true/.test(scrollHook[2]));
assert('the scroll listener is registered exactly once',
  (html.match(/addEventListener\(\s*'scroll'/g) || []).length === 1);

// lastScrollY has to be baselined before the listener can fire, or the first event after a reload
// at depth reads as one enormous downward delta.
const wireSrc = functionSource('wire');
assert('the scroll baseline is taken before the listener is attached',
  !!wireSrc
  && /lastScrollY\s*=\s*window\.scrollY/.test(wireSrc)
  && wireSrc.indexOf('lastScrollY') < wireSrc.indexOf("addEventListener('scroll'"));

// Nothing in the render path may own this state. A poll re-renders every 2.5s; if render() wrote
// the class, a reader holding still would have the picker blink back every few seconds.
const renderSrc = functionSource('render');
assert('no render path writes the stepping-aside state, so a poll cannot blink it back',
  !!renderSrc && !/setReadingDown|is-reading-down/.test(renderSrc));
assert('the state is kept beside the band rather than inside the filter state object',
  /var\s+readingDown\s*=/.test(html) && !/state\.readingDown/.test(html));

console.log('[reading-away] ' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('[reading-away] OK');
