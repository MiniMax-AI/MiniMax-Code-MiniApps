/**
 * The ledger's two-ends control: one round button, an arrow that turns with the reader, and two
 * ends that are the ledger's rather than the page's.
 *
 * It exists because D37 killed the selection a poll could not see, and the fix — judge the
 * selection against the filter result instead of against the window — left the reader with 200
 * loaded records spread over 7,800 px and no way to cross that distance except the scrollbar.
 *
 * Five things about it are easy to get wrong in ways no comment prevents, so each is a rule here:
 *
 *   1. The offset is measured. `bottom` is `calc(12px + var(--inspector-bottom-reserve))` because
 *      the thing it clears is a panel the reader drags, in three states, on a screen where the two
 *      share one column. A flat 12px measured a 35px overlap at 12 of 18 scroll positions on a real
 *      22,527-message session — and a single spot check said there was none, because that one spot
 *      was the last one, where the ledger's own edge had already passed above the panel.
 *   2. The sentinel is outside `#ledger`, which is cleared and rebuilt on every poll. Inside it,
 *      the observer would have to be rebuilt with the table; outside it, one observer, created
 *      once, and its position follows the panel.
 *   3. 「还能往下跳」 is not 「不在视口里」. Those are one boolean and two questions, and the old
 *      code asked the second while meaning the first: it read `!ledgerEndInView()`, which is true
 *      both before the reader reaches the end and after they have scrolled past it, and only the
 *      first of those means a downward jump is still available. `ledgerEndBelow()` asks the question
 *      the branch actually needs. The shipped layout never reaches the second state — the inspector
 *      column is capped against the viewport so the ledger always outgrows it — which is exactly why
 *      the wrong question survived: the layout hid it, and a hidden wrong answer is still wrong.
 *   4. The direction is a position delta, not a counter. `ledgerScrollDir` holds which way the reader
 *      last moved, the ends get a veto, and the four named branches in `ledgerJumpGoesUp()` say so
 *      in that order. It cannot be written as two terms joined by `&&`/`||`: the order of those terms
 *      decides the case where both ends are off screen, and it would decide it silently.
 *   5. 「最上」 is the ledger's top. It was `window.scrollTo(0, 0)`, which lands above the filter
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
// The arrow names where a click would take you, so the control is never a 「go to where you already
// are」 button. That is why the arrow and the press read one function rather than each consulting
// the position: two readers of one fact is how they come to disagree.
const goesUpSrc = functionSource('ledgerJumpGoesUp');
assert('the reading that picks the arrow exists and is the one the label reads',
  !!goesUpSrc && !!labelSrc && /var up = ledgerJumpGoesUp\(\);/.test(labelSrc)
  && /var name = up \? 'arrowUp' : 'arrowDown'/.test(labelSrc));
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

/* ---------- which way the reader is going ---------- */

// The direction starts as nothing rather than as a default. `null` is the third value on purpose:
// with only two, the first paint has to pick one and the picker becomes the rule. The flag this
// replaced remembered whether a press had happened, which the new rule never asks.
assert('the direction has a third, unset value rather than a default one',
  /var ledgerScrollDir = null;/.test(html));
assert('the unset direction resolves to down, so the first screen points somewhere',
  !!goesUpSrc && /return ledgerScrollDir === 'up';/.test(goesUpSrc));
// The flag encoded 「have we jumped yet」 and nothing now depends on it. Its rule was withdrawn with
// the rule itself, so an assignment coming back is a partial revert rather than a new use.
assert('the withdrawn first-press flag is gone and stays gone',
  !/ledgerJumpUsed\s*=/.test(html));

/* ---------- the reading ---------- */

const belowSrc = functionSource('ledgerEndBelow');
const verdict = belowSrc ? /return r\.top[^;]*;/.exec(belowSrc) : null;
// Scoped to the read for the same reason the old one was: the function's own `typeof …
// getBoundingClientRect` guard is a typeof check, and a search for the name anywhere would be
// satisfied by that alone.
assert('whether the end is still below the fold is re-measured rather than remembered',
  !!verdict && /var r = sentinel\.getBoundingClientRect\(\);/.test(belowSrc)
  && /r\.top >= viewH/.test(verdict[0]));
// 「Not on screen」 is one boolean for two opposite states — not reached yet, and already gone past —
// and only the first means a downward jump is available. A version that negates an in-view test
// passes every reachable state in the shipped layout, because the inspector column is capped
// against the viewport and the ledger therefore always outgrows it. That is why this is pinned as
// a question rather than as an outcome.
assert('the end is asked about by position below the fold, not by being absent from the viewport',
  !!goesUpSrc && /var canDown = ledgerEndBelow\(\);/.test(goesUpSrc)
  && !/!ledgerEndInView\(\)/.test(goesUpSrc)
  && !/var canDown = !\w+\(\);/.test(goesUpSrc));
// The first version of the predicate tested both edges with `||` against a one-pixel sentinel: the
// left term is true at every scroll position, so the branch answered 「still below」 everywhere. A
// trivially-true term inside an `||` is the same defect as a tautology in an assertion.
assert('both edges are required, so a one-pixel sentinel cannot read as always below',
  !!verdict && /&&/.test(verdict[0]) && !/\|\|/.test(verdict[0]));
// The observer used to carry a flag that only `ledgerEndInView()`'s fallback ever read. The
// predicate re-measures, so the flag had no reader and a writer; the callback is now the trigger it
// always wanted to be — 「the end moved, re-read it」 — and a poll that adds rows under a parked
// reader is exactly the change no scroll event reports.
assert('the observer triggers a re-read instead of carrying a flag nothing else reads',
  !!belowSrc && !/atLedgerEnd/.test(html)
  && (functionSource('buildLedgerJump') ?? '').includes('setLedgerJumpLabel();'));

/* ---------- the four named branches ---------- */

// Order is load-bearing and is asserted as order. The degenerate case comes first because it is the
// only one with no veto to apply, and the single-end cases follow so that each answers 「is the
// other end still available」.
assert('the degenerate case comes first: a ledger that fits on screen has nothing to jump to',
  !!goesUpSrc && /if \(!canUp && !canDown\) return false;/.test(goesUpSrc)
  && goesUpSrc.indexOf('!canUp && !canDown') < goesUpSrc.indexOf('if (!canDown)'));
assert('an end that is in view or already passed leaves up as the only move',
  !!goesUpSrc && /if \(!canDown\) return true;/.test(goesUpSrc)
  && goesUpSrc.indexOf('if (!canDown) return true;') < goesUpSrc.indexOf('if (!canUp)'));
assert('a top that is in view leaves down as the only move',
  !!goesUpSrc && /if \(!canUp\) return false;/.test(goesUpSrc));
assert('the direction decides only the case neither end has already vetoed',
  !!goesUpSrc && /var canUp = y > ledgerTopOffset\(\);/.test(goesUpSrc)
  && goesUpSrc.indexOf('if (!canUp) return false;') < goesUpSrc.indexOf('return ledgerScrollDir'));
// 「Follows the reader, unless an end is on screen」 cannot be written as two terms joined by `&&` or
// `||`: the order of those terms decides the both-ends-off-screen case, and it would decide it
// silently. This pins the shape, not the truth table — a two-term rewrite reads correctly at every
// position the shipped layout can produce.
assert('the rule is not collapsed into two terms whose order would decide a case silently',
  !!goesUpSrc && !/ledgerScrollDir[^\n]*(&&|\|\|)/.test(goesUpSrc)
  && !/(&&|\|\|)[^\n]*ledgerScrollDir/.test(goesUpSrc));

/* ---------- the scroll listener ---------- */

const buildSrc = functionSource('buildLedgerJump');
const scrollSrc = functionSource('ledgerJumpOnScroll');
// Named, not inline. verify-generation-pin requires every scroll handler to name a function that
// exists, because the D19 mutation re-adds the registration while the handler behind it is gone —
// and an inline handler is invisible to that rule by construction.
assert('a scroll listener supplies the direction, since nothing else says which way the reader went',
  !!buildSrc && !!scrollSrc
  && /window\.addEventListener\('scroll', ledgerJumpOnScroll, \{ passive: true \}\);/.test(buildSrc));
// The sign of the difference is the whole of it. A remembered position that the code compares
// against `window.scrollY` is not a direction until it is subtracted.
assert('the direction is the sign of the scroll delta, and the last position is remembered',
  !!scrollSrc && /ledgerScrollDir = y < ledgerLastY \? 'up' : 'down';/.test(scrollSrc)
  && /ledgerLastY = y;/.test(scrollSrc));
// Without the seed the first scroll after load compares against `null`, which is not a position.
assert('the last position is seeded at build time so the first scroll has something to compare',
  !!buildSrc && /ledgerLastY = window\.scrollY \|\| window\.pageYOffset \|\| 0;/.test(buildSrc));
// Passive because the only thing on this page that writes scroll is the press handler, which is not
// inside the listener. Reading `window.scrollY` does not force layout, so the expensive part is
// what the label does with the answer — and that goes through a frame.
assert('the listener is passive, because nothing inside it writes scroll',
  !!buildSrc && /window\.addEventListener\('scroll', ledgerJumpOnScroll, \{ passive: true \}\);/.test(buildSrc));

const batchSrc = functionSource('scheduleLedgerJumpLabel');
assert('the label is relabelled through a frame, so a scroll costs one layout read rather than one per event',
  !!batchSrc && /requestAnimationFrame/.test(batchSrc) && /setLedgerJumpLabel\(\);/.test(batchSrc)
  && !!scrollSrc && /scheduleLedgerJumpLabel\(\);/.test(scrollSrc));

/* ---------- the two targets ---------- */

const topSrc = functionSource('ledgerTopOffset');
const bottomSrc = functionSource('ledgerBottomOffset');
const bandSrc = functionSource('pinnedBandBottom');

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
  !!buildSrc && /var up = ledgerJumpGoesUp\(\);/.test(buildSrc)
  && /window\.scrollTo\(0, up \? ledgerTopOffset\(\) : ledgerBottomOffset\(\)\)/.test(buildSrc));
// A jump IS a movement, and the reader did not scroll themselves — so the press writes the
// direction rather than waiting for a scroll event that `scrollTo()` does not fire synchronously,
// and that fires not at all when the press targets the end the reader is already at. Waiting there
// leaves the glyph answering for a position the page has already left.
assert('the press records the direction it just jumped, because the reader did not scroll themselves',
  !!buildSrc && /ledgerScrollDir = up \? 'up' : 'down';/.test(buildSrc));
// …written AFTER the destination is chosen, for the same reason the old flag had to be armed after
// it: the press asks the reading and then changes what it read. Written first, the very first press
// answers for a direction it just made up, which on a ledger that already fits on screen sends the
// reader the wrong way — the bug the old flag existed to remove, re-created by writing two lines in
// the wrong order.
//
// Scoped to the click handler rather than to the whole of buildLedgerJump(): the scroll listener
// above it also writes `ledgerScrollDir`, and that write is the one this rule is not about. A
// comparison against the first occurrence in the function would be satisfied by the listener's.
const clickAt = buildSrc ? buildSrc.indexOf("button.addEventListener('click'") : -1;
const clickTail = clickAt >= 0 ? buildSrc.slice(clickAt) : '';
assert('the destination is chosen before the direction is written',
  !!clickTail && /var up = ledgerJumpGoesUp\(\);/.test(clickTail)
  && clickTail.indexOf('ledgerScrollDir =') >= 0
  && clickTail.indexOf('var up = ledgerJumpGoesUp();') < clickTail.indexOf('ledgerScrollDir ='));
assert('the press relabels the arrow itself instead of waiting for a scroll event',
  !!buildSrc && /ledgerScrollDir = up \? 'up' : 'down';\s*setLedgerJumpLabel\(\);/.test(buildSrc));
// Two writers, both in this function, and neither of them writes the other's field. A direction
// published on <body> was withdrawn once already — a control's visibility decided from outside its
// layer — and the reason that does not carry here is the use, not the signal: this is the
// orientation of a navigation affordance, and nothing else reads it.
assert('the direction stays inside this control instead of being published on <body>',
  !/classList[^\n]*is-reading-down/.test(html) && !/document\.body\.dataset[^\n]*(?:dir|direction)/i.test(html));
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
