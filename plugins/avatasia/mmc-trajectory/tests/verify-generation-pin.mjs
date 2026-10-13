/**
 * The 上下文代 picker has to be readable from anywhere in the ledger, and it was not.
 *
 * What the reviewer reported on 2026-10-12 was 「上下文代的筛选条件没有了」. It was not gone: the element
 * ships without `hidden`, carries all 29 options and holds 「全部（默认）」. It lived in #toolbar,
 * which is the one block above the band that scrolls away — so a reader 6,000 px into the ledger
 * had to climb back to the top of the page to change generation, and from up there the control
 * that says which slice of the conversation is on screen is not on screen. Nothing was broken;
 * the control was simply somewhere the reader was not. No existing guard asserted where it lived,
 * which is why nothing complained.
 *
 * The invariants, and what each one is for:
 *
 *   1. the picker ships inside #filter-sticky. This is the fix. Everything else is what keeps it
 *      correct once it is there.
 *   2. it is NOT inside #kind-controls. That element is `role="toolbar" aria-label="按类型筛选轨迹"`,
 *      so a control that filters generations inside it makes the label announce something false.
 *   3. it carries no `data-filter-scope`. The 异常 axis dims and disables every control carrying
 *      that attribute, on the grounds that they cannot change what is on screen while a rule is
 *      on. Generation is not such a control — a rule narrows one context, it does not forbid
 *      choosing another — and marking it would disable the one thing a reader most wants to do
 *      while reading a list of failures.
 *   4. the banner ships inside the band too. It is the picker's `aria-describedby` target and it
 *      only exists while a generation is pinned, which is exactly when a reader who has scrolled
 *      deep into a frozen pre-compaction snapshot has forgotten. Left in the ledger panel it
 *      scrolls away while the control that caused it stays pinned.
 *   5. the picker no longer ships in #toolbar. Asserted directly rather than as the absence of
 *      something, so a copy left behind fails instead of quietly serving a second instance.
 *   6. the row wraps. `.traj-controls` is `flex: none`, so without `flex-wrap` a tail that does not
 *      fit pushes the row wider than the page instead of stepping down to a line of its own.
 *   7. the toolbar's own narrow-screen rules are overridden for the band. `.field { flex: 1 1 100% }`
 *      and `select { width: 100% }` under `max-width: 767px` were written for fields that get a
 *      whole line each. In a `flex: none` tail they would size the picker against the tail and grow
 *      the band sideways. Written even though no browser here is narrow enough to exercise it.
 *   8. the picker is sized like the chips around it (20px, not the toolbar's 36px). The band is
 *      pinned over the ledger: its height is reading area the reader does not get.
 *   9. the band is not driven from outside itself. It used to be: a `body.is-reading-down` class,
 *      toggled from a scroll listener by the direction the reader was scrolling, decided whether the
 *      picker was on screen. the reviewer reported on 2026-10-12 that it 「只要滚动就不见」. A filter that
 *      hides itself the moment the reader starts reading is gone exactly when it is wanted, scroll
 *      direction is not a statement about which filters the reader wants, and visibility inside a
 *      band is the band's own business. D19 is withdrawn; these three are what stops it coming back.
 *
 * `mutate-generation-pin.py` breaks each of these in the shipped file and requires this guard to
 * catch it by name, so nothing here can be an assertion nothing could fail.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HTML = fileURLToPath(new URL('../miniapp/client/index.html', import.meta.url));
const html = readFileSync(HTML, 'utf8');

const styleMatch = /<style>([\s\S]*?)<\/style>/.exec(html);
if (!styleMatch) {
  console.log('FAIL: no <style> block in the client');
  process.exit(1);
}
// Comments first, for the same reason verify-sticky.mjs does it: the reasoning about these rules
// lives in comments, and a rule body read out of commented source would let a deleted rule look
// present.
const css = styleMatch[1].replace(/\/\*[\s\S]*?\*\//g, '');

let pass = 0;
const failures = [];
function assert(name, cond) {
  if (cond) pass += 1;
  else failures.push(name);
}

/* ---------- CSS: rules by exact selector, declarations by property ---------- */

/** Every rule whose selector list contains exactly `sel`, in source order, with its media scope. */
function rulesFor(sel) {
  const out = [];
  // Anchored on a line start, not on the previous rule's closing brace: a brace anchor is consumed
  // by the match that uses it, which makes every other rule invisible to the scan.
  const re = /^[ \t]*([^{}@][^{}]*?)\{[^{}]*\}/gm;
  let m;
  while ((m = re.exec(css))) {
    const selectors = m[1].split(',').map((s) => s.trim());
    if (selectors.includes(sel)) {
      out.push({
        body: m[0].slice(m[0].indexOf('{') + 1, m[0].lastIndexOf('}')),
        inMedia: insideMedia(m.index),
      });
    }
  }
  return out;
}

/** The declarations of `sel`, as a property -> last value map, merged across its rules. */
function decls(sel) {
  const map = new Map();
  for (const entry of rulesFor(sel)) {
    for (const part of entry.body.split(';')) {
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

/**
 * Whether some rule for `sel` declares `prop: val`, and whether any such rule sits inside a
 * `@media` block.
 *
 * Used instead of `value()` where the declarations live in different conditions — the band
 * overrides sit in a `@media` block — because `value()` merges by source order and would answer
 * for a rule that only applies at some widths.
 */
function someRuleDeclares(sel, prop, val, where) {
  return rulesFor(sel).some((entry) => {
    if (where === 'media' && !entry.inMedia) return false;
    if (where === 'base' && entry.inMedia) return false;
    for (const part of entry.body.split(';')) {
      const at = part.indexOf(':');
      if (at < 0) continue;
      const p = part.slice(0, at).trim();
      const v = part.slice(at + 1).replace(/\s+/g, ' ').trim();
      if (p === prop && (val === undefined || v === val)) return true;
    }
    return false;
  });
}

/* ---------- where a rule sits: inside a @media block, or unconditionally ---------- */

/** The [start, end) ranges of every @media block, found by matching braces. */
function mediaRanges() {
  const ranges = [];
  const re = /@media[^{]*\{/g;
  let m;
  while ((m = re.exec(css))) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    ranges.push([m.index, i]);
    re.lastIndex = i + 1;
  }
  return ranges;
}

const MEDIA = mediaRanges();
function insideMedia(index) {
  return MEDIA.some(([a, b]) => index > a && index < b);
}

/* ---------- markup: the subtree of an element, by counting tags ---------- */

/**
 * The inner HTML of the first element whose opening tag carries `id="..."`.
 *
 * The tag name is read off the match rather than assumed to be a div: #toolbar is a <form>, and a
 * helper that only counted <div> would silently answer "not found" for it — which reads exactly
 * like the control still being there.
 */
function subtreeOfId(id) {
  const open = new RegExp('<([a-z][a-z0-9]*)([^>]*\\bid="' + id + '"[^>]*)>').exec(html);
  if (!open) return null;
  const name = open[1];
  let i = open.index + open[0].length;
  let depth = 1;
  const tag = new RegExp('</?' + name + '\\b[^>]*>', 'g');
  tag.lastIndex = i;
  let t;
  while ((t = tag.exec(html))) {
    depth += t[0][1] === '/' ? -1 : 1;
    if (depth === 0) return html.slice(i, t.index);
  }
  return null;
}

/** The opening tag of the element carrying `id`, or null. */
function openTagOfId(id) {
  const open = new RegExp('<([a-z][a-z0-9]*)([^>]*\\bid="' + id + '"[^>]*)>').exec(html);
  return open ? open[2] : null;
}

/* ---------- 1 & 4: both the picker and its banner ship inside the band ---------- */

const bandInner = subtreeOfId('filter-sticky');
const toolbarInner = subtreeOfId('toolbar');

assert('the band is on the page to check anything inside it',
  typeof bandInner === 'string');
assert('the 上下文代 picker ships inside the sticky band, not in the toolbar that scrolls away',
  !!bandInner && bandInner.includes('id="generation-field"'));
assert('the banner ships inside the same band as the picker it describes',
  !!bandInner && bandInner.includes('id="generation-hint"'));
assert('the picker is gone from the toolbar rather than copied there',
  !!toolbarInner && !toolbarInner.includes('id="generation-field"'));

/* ---------- 2: not inside the kind toolbar ---------- */

const kindInner = subtreeOfId('kind-controls');
assert('the picker is not inside the kind toolbar, whose label promises type filtering',
  typeof kindInner === 'string' && !kindInner.includes('id="generation-field"'));

/* ---------- 3: unmarked, so the 异常 axis cannot disable it ---------- */

const fieldOpen = openTagOfId('generation-field');
assert('the picker element is on the page at all', !!fieldOpen);
assert('the picker carries no data-filter-scope, so a rule on screen cannot disable it',
  !!fieldOpen && !/\bdata-filter-scope\b/.test(fieldOpen));

// The rule that consumes the attribute has to exist for the assertion above to mean anything: if
// syncAnomalyMode() stopped reading it, "unmarked" would be true and irrelevant. Both halves are
// named because either alone is inert — the CSS greys the control without taking it out of the tab
// order, and the property alone does the reverse.
assert('something still consumes data-filter-scope, so being unmarked means something',
  /body\[data-anomaly-mode='on'\]\s*\[data-filter-scope\]/.test(css)
  && /function syncAnomalyMode\s*\(/.test(html)
  && /querySelectorAll\('\[data-filter-scope\]'\)/.test(html));

/* ---------- 5: the picker keeps an accessible name, without paying for it ---------- */

const labelMatch = /<label([^>]*\bfor="generation-select"[^>]*)>/.exec(html);
assert('the picker keeps a <label for>, so its name does not come from a placeholder that changes',
  !!labelMatch);
const labelClass = labelMatch ? /class="([^"]*)"/.exec(labelMatch[1]) : null;
assert('that label is sr-only: 176px is what the type row leaves and the label would spend 56 of them',
  !!labelClass && labelClass[1].split(/\s+/).includes('sr-only'));

/* ---------- 6: the row wraps instead of overflowing ---------- */

/**
 * The left component of a `padding` shorthand, whatever arity it was written with.
 *
 * `margin-left: auto` is what separates the tail from the type row, so a left padding here is
 * width the row has to find and nothing else buys. Measured on 2026-10-12: with the padding the
 * row needs 759px and has 750px, so the picker drops to a line of its own — the wrap working as
 * designed, but not what was asked for. The arithmetic that predicted otherwise had forgotten
 * that the tail carries padding at all, which is why this is asserted rather than assumed.
 */
function paddingLeft(sel) {
  const v = value(sel, 'padding');
  if (!v) return null;
  const parts = v.split(/\s+/);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2 || parts.length === 3) return parts[1];
  return parts[3];
}

assert('the band row wraps, so a picker that does not fit steps down instead of widening the page',
  value('.filter-row', 'flex-wrap') === 'wrap');
assert('the type row still refuses to shrink, which is why the wrap above is what saves it',
  value('.traj-controls', 'flex') === 'none');
/* The row above is the outer half of the same degradation, and on its own it was
   not enough: .traj-controls is `flex: none`, so the row could only step the
   picker down. It could not step down anything that was itself wider than the
   page — and the inner chip row was, at 574px flat from a 360px viewport up,
   leaving the document 622px wide at every viewport below 640.

   The three properties below are asserted separately because each one alone is
   worth nothing, which is the part that is easy to get wrong: shipped with the
   wrap and nothing else, the chips measured *identical* at every width. The
   reason is spec behaviour rather than a broken declaration — a shrink-to-fit
   flex container is always exactly as wide as its widest line, so it can never
   wrap no matter what it is told. Asserting the wrap on its own would have been
   a guard that could not fail, which is why the cap and the shrink are named. */
assert('the type chips wrap too, so ten buttons cannot widen the page at a narrow width',
  value('.traj-controls-actions', 'flex-wrap') === 'wrap');
assert('the type row is capped at the viewport, which is the only thing that wrap has to wrap into',
  value('.traj-controls', 'max-width') === '100%');
/* `flex: <grow> <shrink> <basis>` — a bare `none` is 0 0, and any other single
   keyword stands for 1 1 0b. Anything else is read as written. */
const chipShrink = (() => {
  const f = value('.traj-controls-actions', 'flex');
  if (!f) return null;
  const parts = f.split(/\s+/);
  if (parts.length === 1) return parts[0] === 'none' ? '0' : '1';
  return parts[1];
})();
assert('the chip row is the part allowed to give way, because a row that cannot shrink cannot wrap',
  chipShrink === '1' && value('.traj-controls-actions', 'min-width') === '0');
assert('the tail is the part that gives way, not the kind toolbar',
  value('.filter-row-tail', 'flex') === 'none');
assert('the tail is pushed right by margin-left, so it carries no left padding to find width with',
  value('.filter-row-tail', 'margin-left') === 'auto' && paddingLeft('.filter-row-tail') === '0');
assert('the tail keeps its right padding, so the picker ends on the same line the toolbar ends on',
  /(^|\s)16px(\s|$)/.test(value('.filter-row-tail', 'padding') ?? ''));

/* ---------- 7: the toolbar's narrow-screen rules do not silently govern the band ---------- */

assert('the toolbar field rule is overridden for the picker, so 100% cannot size it against the tail',
  someRuleDeclares('.filter-row-tail .field', 'flex', 'none', 'media'));
assert('the toolbar select rule is overridden for the picker',
  someRuleDeclares('.filter-row-tail select', 'width', 'auto', 'media'));
assert('the picker still has a width bound, so a very narrow screen wraps instead of overflowing',
  someRuleDeclares('.filter-row-tail select', 'max-width', undefined, 'media'));

// Both of the rules above have to be narrow-screen-only. The same selector sitting outside a
// @media block would satisfy them while applying at every width — undoing the compact sizing
// everywhere, which is the opposite of what the band needs on a wide screen.
assert('the compact sizing is unconditional, so the band is the same size at any width',
  someRuleDeclares('.filter-row-tail select', 'min-height', '20px', 'base')
  && someRuleDeclares('.filter-row-tail select', 'font-size', '12px', 'base'));
assert('the stylesheet actually has narrow-screen blocks for those overrides to live in',
  MEDIA.length > 0);

/* ---------- 8: sized like the chips, because the band's height is reading area ---------- */

assert('the picker is as tall as the chips beside it, not the toolbar 36px',
  value('.filter-row-tail select', 'min-height') === '20px');
assert('the picker matches the band type size, so it does not widen with a bigger font',
  value('.filter-row-tail select', 'font-size') === '12px');

/**
 * No rule may give the picker a fixed width.
 *
 * The width of a <select> is the width of the widest option the browser has to draw. Writing a
 * number in the stylesheet encodes one machine's answer to that question and truncates on any
 * other: a fixed width is how 「第 27 代（566 条）」 lost its last characters on this page once
 * already. `auto` and `min(320px, 70vw)` are bounds, not answers, and are allowed.
 */
const fixedWidth = rulesFor('.filter-row-tail select').some((entry) =>
  /(?:^|;)\s*width\s*:\s*(?:\d|\.|\()/i.test(entry.body) && !/\bauto\b/i.test(entry.body));
assert('no rule gives the picker a fixed width — the browser knows how wide its widest option is',
  !fixedWidth);

/* ---------- 9: the band is not driven from outside itself ---------- */

/**
 * Every selector in the stylesheet, split on commas.
 *
 * The comment strip above already ran, so a rule that only exists inside a comment cannot be seen
 * here — which is the point: the withdrawal note in the stylesheet *names* `body.is-reading-down`
 * in prose, and a scan that read comments would read that sentence as the rule still shipping.
 */
function allSelectors() {
  const out = [];
  const re = /^[ \t]*([^{}@][^{}]*?)\{[^{}]*\}/gm;
  let m;
  while ((m = re.exec(css))) {
    for (const s of m[1].split(',')) out.push(s.trim());
  }
  return out;
}

const BAND_SELECTORS = ['.filter-row-tail', '.filter-sticky', '.traj-controls', '#kind-controls'];

// `body.<class>` only. `body[attr=…]` is excluded on purpose: the 异常 axis drives band controls
// that way, through data-filter-scope, and names itself in its own rule. What is ruled out is a
// class whose meaning is not filtering.
const bodyClassSelectors = allSelectors().filter((s) => /^body\.[A-Za-z_-]/.test(s));

assert('nothing inside the band is shown or hidden by a state class on <body>',
  !bodyClassSelectors.some((s) => BAND_SELECTORS.some((b) => s.includes(b))));

// The scroll listener was the other half: without a reader of scroll direction there was nothing
// left to drive such a class.
//
// This rule was "the page registers no scroll listener at all". The inspector docks on a narrow
// screen and needs to know when its panel leaves the viewport, so that ban is now narrower — and
// the narrowing is the part that matters, because the old wording would have been satisfiable by
// deleting the feature and re-broken by re-introducing D19.
//
// What is actually forbidden is the *shape* of D19: a scroll listener whose handler writes a class
// on <body>, which is what let a signal from outside the band decide what a control inside it did.
// Two assertions replace the one:
//
//   1. no scroll handler writes to <body> — the defect itself;
//   2. every scroll handler names a function that exists — because the D19 mutation re-adds the
//      *call* `addEventListener('scroll', scheduleReadingDown, …)` without the function, since the
//      withdrawal deleted the body. A rule that only checked (1) would let that mutation survive,
//      and a surviving mutation means the guard is what is wrong.
//
// The inspector's own handler passes both: it measures its panel and writes classes on its panel
// and on main.columns. D12 and D15's actual concern — a document that rebuilds itself while the
// reader moves through it — is untouched by any of this, since nothing here re-renders on scroll.
const scrollHandlers = [...html.matchAll(/addEventListener\(\s*'scroll'\s*,\s*([A-Za-z0-9_$]+)/g)].map((m) => m[1]);
const declaredFunctions = new Set([...html.matchAll(/function\s+([A-Za-z0-9_$]+)\s*\(/g)].map((m) => m[1]));
const bodyClassWrites = /document\.body\.classList|document\.body\.className|body\.classList|body\.className\s*=/;

assert('no scroll listener writes a class on <body>, so scroll cannot decide what the band shows',
  scrollHandlers.length === 0 || !scrollHandlers.some((name) => {
    const body = html.slice(html.indexOf('function ' + name + '('));
    const end = body.indexOf('\n      }');
    return bodyClassWrites.test(end > 0 ? body.slice(0, end) : body);
  }));
assert('every scroll listener names a handler that exists, so a withdrawal cannot leave one dangling',
  scrollHandlers.every((name) => declaredFunctions.has(name)));

// Belt and braces on the shown state itself: a rule on the tail that dims or hides it is the same
// defect wearing a plainer hat.
assert('the band shows the picker by default — no rule of its own dims or hides it',
  value('.filter-row-tail', 'visibility') === null
  && value('.filter-row-tail', 'opacity') === null);

console.log('[generation-pin] ' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('[generation-pin] OK');
