/**
 * The ledger's two-ends control: one round button, an arrow that turns, and two ends that are the
 * ledger's rather than the page's.
 *
 * It exists because D37 killed the selection a poll could not see, and the fix — judge the
 * selection against the filter result instead of against the window — left the reader with 200
 * loaded records spread over 7,800 px and no way to cross that distance except the scrollbar.
 *
 * Four things about it are easy to get wrong in ways no comment prevents, so each is a rule here:
 *
 *   1. The offset is measured. `bottom` is `calc(12px + var(--inspector-bottom-reserve))` because
 *      the thing it clears is a panel the reader drags, in three states, on a screen where the two
 *      share one column. A flat 12px measured a 35px overlap at 12 of 18 scroll positions on a real
 *      22,527-message session — and a single spot check said there was none, because that one spot
 *      was the last one, where the ledger's own edge had already passed above the panel.
 *   2. The sentinel is outside `#ledger`, which is cleared and rebuilt on every poll. Inside it,
 *      the observer would have to be rebuilt with the table; outside it, one observer, created
 *      once, and its position follows the panel.
 *   3. 「在不在底部」 is re-read, not remembered. `ledgerEndInView()` re-measures the sentinel
 *      rather than returning the observer's flag, because the flag is right when the callback
 *      fires and silently stale when it does not. Its first version tested both edges with `||`
 *      against a one-pixel sentinel, so `r.height > 0` was always true and the arrow read 「up」
 *      everywhere.
 *   4. 「最上」 is the ledger's top. It was `window.scrollTo(0, 0)`, which lands above the filter
 *      band and the overview strip with the trajectory still off screen — the control claimed to
 *      go up and showed the one screen in the app with no records on it.
 *
 * mutate-ledger-jump.py breaks each of these in the shipped file and requires this guard to catch
 * it by name.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HTML = fileURLToPath(new URL('../miniapp/client/index.html', import.meta.url));
const html = readFileSync(HTML, 'utf8');

let pass = 0;
const failures = [];
function assert(name, cond) {
  if (cond) pass += 1;
  else failures.push(name);
}

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

function cssRule(pattern) {
  const m = new RegExp(pattern + '\\s*\\{([\\s\\S]*?)\\n\\s*\\}', 'm').exec(html);
  return m ? m[1] : null;
}

/* ---------- the shape of the control ---------- */

// No text in the markup, and hidden until it has something to show. The first version shipped the
// literal 「到最低」, which meant the button read one thing for a moment before the script decided
// whether that was true; the second shipped an empty circle, which is a hole in the page.
const jumpTag = /<button[^>]*id="ledger-jump"[^>]*>/.exec(html);
const jumpTagEnd = jumpTag ? html.indexOf('</button>', jumpTag.index) : -1;
assert('the jump button ships', !!jumpTag);
assert('the jump button ships with no text in it',
  !!jumpTag && jumpTagEnd > 0
  && html.slice(jumpTag.index, jumpTagEnd + 9) === jumpTag[0] + '</button>');
assert('the jump button ships hidden, so there is no empty circle on first paint',
  !!jumpTag && /hidden/.test(jumpTag[0]));
assert('the jump button is a button and not a link, so Enter and Space both work',
  !!jumpTag && /type="button"/.test(jumpTag[0]));
assert('the jump button carries a label of its own for anyone not looking at it',
  !!jumpTag && /aria-label="[^"]+"/.test(jumpTag[0]));

/* ---------- the sentinel, and where it lives ---------- */

const atLedgerOpen = html.indexOf('id="ledger"');
const ledgerClose = html.indexOf('</div>', atLedgerOpen);
const atSentinel = html.indexOf('id="ledger-end"');
assert('the sentinel is outside #ledger, which is cleared and rebuilt on every poll',
  atLedgerOpen > 0 && ledgerClose > 0 && atSentinel > ledgerClose);

// The button and the sentinel are siblings at the panel's bottom, in that order: the button's
// sticky box is positioned against the panel's content edge, and the sentinel is what says where
// that edge currently is.
const atJump = html.indexOf('id="ledger-jump"');
const panelClose = html.indexOf('</section>', atSentinel);
assert('the sentinel and the button ship together, sentinel first',
  atJump > atSentinel && atJump < panelClose);
assert('the sentinel is inert to a reader, since it is a measuring mark and not content',
  /class="ledger-end" id="ledger-end" aria-hidden="true"/.test(html));

/* ---------- the two arrows ---------- */

const iconTable = /var ICON_PATHS = \{([\s\S]*?)\n {6}\};/.exec(html);
const arrowDown = iconTable ? /arrowDown:\s*\[([^\]]*)\]/.exec(iconTable[1]) : null;
const arrowUp = iconTable ? /arrowUp:\s*\[([^\]]*)\]/.exec(iconTable[1]) : null;
assert('both directions ship as icons', !!arrowDown && !!arrowUp);
assert('each arrow is a shaft and a head, not a single stroke',
  !!arrowDown && !!arrowUp && arrowDown[1].split(',').length === 2 && arrowUp[1].split(',').length === 2);
assert('the two arrows are different shapes',
  !!arrowDown && !!arrowUp && arrowDown[1].trim() !== arrowUp[1].trim());

/* ---------- what the control shows ---------- */

const labelSrc = functionSource('setLedgerJumpLabel');
assert('the label setter is in the shipped script', !!labelSrc);

// A picture, not a name. `aria-label` still carries the sentence, so this is a change of
// presentation and not of what the control announces to anyone not looking at it.
assert('the control shows an arrow rather than a word',
  !!labelSrc && /icon\(name\)/.test(labelSrc) && !/textContent = atEnd/.test(labelSrc));
assert('which arrow it is comes from the reading, not from a counter',
  !!labelSrc && /var name = atEnd \? 'arrowUp' : 'arrowDown'/.test(labelSrc));
// Scoped to the attribute itself, not to the function: this file's own comment explains what the
// two labels used to be, so a search for the words anywhere in the source is satisfied by prose.
const ariaLine = labelSrc ? /setAttribute\('aria-label',[^\n]*\)/.exec(labelSrc) : null;
assert('the control still says in words where a click would go',
  !!ariaLine && /最上/.test(ariaLine[0]) && /最低/.test(ariaLine[0]));
assert('the control is absent rather than wrong when there is nothing to jump between',
  !!labelSrc && /button\.hidden = empty/.test(labelSrc)
  && /!state\.payload \|\| !state\.flat \|\| state\.flat\.length === 0/.test(labelSrc));
// Scoped to the guard clause, not to the function: `data-arrow` is also written just below, so a
// search for it anywhere in the source is satisfied by a version that rebuilds on every scroll.
assert('the glyph is not rebuilt on every scroll position',
  !!labelSrc && /if \(!current \|\| current\.getAttribute\('data-arrow'\) !== name\) \{/.test(labelSrc));

/* ---------- the reading ---------- */

const inViewSrc = functionSource('ledgerEndInView');
const verdict = inViewSrc ? /atLedgerEnd = [^;]*;/.exec(inViewSrc) : null;
// Scoped to the read for the same reason: the function's own `typeof … getBoundingClientRect` guard
// is a typeof check, and a search for the name anywhere would be satisfied by that alone.
assert('the end of the ledger is re-measured rather than remembered',
  !!verdict && /var r = sentinel\.getBoundingClientRect\(\);/.test(inViewSrc)
  && /r\.top < viewH/.test(verdict[0]));
// The first version read `r.height > 0 || r.top < viewH` against a one-pixel sentinel: the left
// term is true at every scroll position, so the arrow pointed up everywhere. A trivially-true
// term inside an `||` is the same defect as a tautology in an assertion.
assert('both edges are required, so a one-pixel sentinel cannot read as always present',
  !!verdict && /&&/.test(verdict[0]) && !/\|\|/.test(verdict[0]));

/* ---------- the two targets ---------- */

const topSrc = functionSource('ledgerTopOffset');
const bottomSrc = functionSource('ledgerBottomOffset');
const bandSrc = functionSource('pinnedBandBottom');
const buildSrc = functionSource('buildLedgerJump');

assert('up means the ledger panel, not the page',
  !!topSrc && /closest\('\.panel'\)/.test(topSrc) && !/document\.body/.test(topSrc));
assert('up clears the pinned band, measured rather than assumed',
  !!topSrc && /pinnedBandBottom\(\)/.test(topSrc));
assert('the band clearance is measured off the band itself',
  !!bandSrc && /dom\.filterSticky/.test(bandSrc));
// Scoped to the read as well as to the element: a version that reads the sentinel's *last child*
// names the same variable and the same element, and answers with the last row's edge instead.
assert("down means the sentinel at the ledger's own bottom",
  !!bottomSrc && /dom\.ledgerEnd/.test(bottomSrc)
  && /var bottom = sentinel\.getBoundingClientRect\(\)\.bottom/.test(bottomSrc)
  && !/lastElementChild/.test(bottomSrc));

assert('the click chooses between the two ends from the same reading the arrow does',
  !!buildSrc && /window\.scrollTo\(0, ledgerEndInView\(\) \? ledgerTopOffset\(\) : ledgerBottomOffset\(\)\)/.test(buildSrc));
assert('the click never scrolls to the top of the document',
  !!buildSrc && !/scrollTo\(0, 0\)/.test(buildSrc));
assert('the jump is built once, on the wire path',
  (html.match(/buildLedgerJump\(\);/g) ?? []).length === 1
  && (functionSource('wire') ?? '').includes('buildLedgerJump();'));

/* ---------- the offset, and its one writer ---------- */

const jumpCss = cssRule('^\\s*\\.ledger-jump');
assert('the button ships a stylesheet rule', !!jumpCss);
assert('the button is sticky inside the panel rather than fixed on the viewport',
  !!jumpCss && /position:\s*sticky/.test(jumpCss) && !/position:\s*fixed/.test(jumpCss));
// The whole reason the rule reads a variable: a flat offset measured a 35px overlap at 12 of 18
// positions, and a version that drops the variable still looks right at the one spot checked.
assert('the bottom offset is measured, not written down',
  !!jumpCss && /bottom:\s*calc\(\s*12px\s*\+\s*var\(--inspector-bottom-reserve/.test(jumpCss));
assert('the button is a circle, which is what makes an arrow inside it read as a direction',
  !!jumpCss && /border-radius:\s*50%/.test(jumpCss) && /width:\s*40px/.test(jumpCss)
  && /height:\s*40px/.test(jumpCss) && /padding:\s*0/.test(jumpCss));
assert('the button is out-levelled above the panel it has to clear',
  !!jumpCss && Number((/z-index:\s*(\d+)/.exec(jumpCss) ?? [])[1]) > 5);

const hiddenCss = cssRule('^\\s*\\.ledger-jump\\[hidden\\]');
assert("`hidden` still wins over the button's own display",
  !!jumpCss && /display:\s*grid/.test(jumpCss) && !!hiddenCss && /display:\s*none/.test(hiddenCss));
assert('the button is reachable from the keyboard, with a ring that is its own',
  !!cssRule('^\\s*\\.ledger-jump:focus-visible'));

assert('the offset has exactly one writer',
  (html.match(/setProperty\('--inspector-bottom-reserve'/g) ?? []).length === 1);
const reserveSrc = functionSource('scheduleInspectorBottomReserve');
assert("the writer is the function that already owns the panel's height",
  !!reserveSrc && /dom\.inspectorPanel/.test(reserveSrc) && /getBoundingClientRect\(\)\.height/.test(reserveSrc));
// Measured in a later frame, not this one: the dock class is switched and the panel has not been
// laid out yet, so the same code read 177px on a frame where the panel then rendered 360.
assert('the offset is read after layout, in a later frame',
  !!reserveSrc && /requestAnimationFrame/.test(reserveSrc));
assert('the dock is what re-measures it',
  (functionSource('applyInspectorDock') ?? '').includes('scheduleInspectorBottomReserve();'));

/* ---------- the render path, not only the observer ---------- */

// The observer alone is a cheap hint during scrolling; the label has to be right on every render
// too, because a poll rebuilds the ledger under the reader without firing any scroll event.
assert('a render re-labels the control, not only a scroll',
  (functionSource('renderLedger') ?? '').includes('setLedgerJumpLabel();'));

console.log('[ledger-jump] ' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('[ledger-jump] OK');