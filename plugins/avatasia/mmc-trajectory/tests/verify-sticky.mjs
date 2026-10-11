/**
 * The filter band has to stay pinned while the ledger scrolls under it, and everything pinned
 * below it has to land on the band it actually has rather than on a number written down once.
 *
 * Three things break, and each is checked here:
 *
 *   1. the two filter rows stop being one block. Only the type row ever claimed `position: sticky`
 *      and it did not survive: with the ledger below it and both rows scrolled away, a session
 *      filtered down to a few hundred rows gave no sign that anything was filtered at all.
 *   2. an offset is written down as a constant. The 异常 row wraps at narrow widths and its note
 *      comes and goes, so any number ages into a silent overlap — which is what the old 0–32 and
 *      32–83 comments encoded.
 *   3. the band is measured at the wrong moment, or from a different element than the one that is
 *      pinned.
 *
 * The measurement is checked by *running* syncStickyOffsets() against stub heights chosen to
 * differ from the stylesheet's fallbacks (32 / 51 / 45), so a version that writes a constant, or
 * writes one band's height into another's variable, fails here instead of looking plausible.
 *
 * Everything pinned over the ledger must also paint a background: the ledger rows underneath are
 * `background: transparent`, so a pinned strip that does not cover them lets them show through.
 *
 * mutate-sticky.py breaks each of these in the shipped file and requires this guard to catch it
 * with the right reason, so a rule nothing tests cannot be added here.
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
// Comments first: the reasoning about these rules lives in comments, and a rule body read out of
// commented source would let a deleted rule look present.
const css = styleMatch[1].replace(/\/\*[\s\S]*?\*\//g, '');

let pass = 0;
const failures = [];
function assert(name, cond) {
  if (cond) pass += 1;
  else failures.push(name);
}

/* ---------- CSS: read a declaration out of the rule, not out of the prose ---------- */

/** Every rule whose selector list contains exactly `sel`, joined. */
function rulesFor(sel) {
  const out = [];
  // Anchored on a line start, not on the previous rule's closing brace: a brace anchor is consumed
  // by the match that uses it, which makes every other rule invisible to the scan.
  const re = /^[ \t]*([^{}@][^{}]*?)\{[^{}]*\}/gm;
  let m;
  while ((m = re.exec(css))) {
    const selectors = m[1].split(',').map((s) => s.trim());
    if (selectors.includes(sel)) out.push(m[0].slice(m[0].indexOf('{') + 1, m[0].lastIndexOf('}')));
  }
  return out;
}

/** The declarations of `sel`, as a property -> last value map. */
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

/** The custom properties a declaration reads, e.g. `--sticky-band-h`. */
function varsRead(text) {
  const out = new Set();
  if (!text) return out;
  for (const m of text.matchAll(/var\(\s*(--[\w-]+)/g)) out.add(m[1]);
  return out;
}

function isOpaqueBackground(v) {
  return !!v && v !== 'transparent' && !v.startsWith('rgba') && !v.startsWith('hsla');
}

/* ---------- markup: the subtree of the band, by counting tags ---------- */

function subtreeFrom(start) {
  let i = start;
  let depth = 1;
  const tag = /<\/?div\b[^>]*>/g;
  tag.lastIndex = i;
  let t;
  while ((t = tag.exec(html))) {
    depth += t[0][1] === '/' ? -1 : 1;
    if (depth === 0) return html.slice(i, t.index);
  }
  return null;
}

// The band is located by the id the script looks it up by, and its class is checked on its own:
// those are two names in two different places, and if they drift the rule still parses, the element
// still has an id, and nothing is pinned at all.
const bandOpen = /<div([^>]*\bid="filter-sticky"[^>]*)>/.exec(html);
const bandClass = bandOpen ? /class="([^"]*)"/.exec(bandOpen[1]) : null;
const bandInner = bandOpen ? subtreeFrom(bandOpen.index + bandOpen[0].length) : null;

assert('both filter rows ship inside one sticky band',
  !!bandInner && bandInner.includes('id="kind-controls"') && bandInner.includes('id="anomaly-bar"'));
assert('the band element ships the class the stylesheet pins',
  !!bandClass && bandClass[1].split(/\s+/).includes('filter-sticky')
  && value('.filter-sticky', 'position') === 'sticky');
assert('the band is written before the strip, and the strip before the window bar',
  html.indexOf('id="filter-sticky"') < html.indexOf('<section class="overview"')
  && html.indexOf('<section class="overview"') < html.indexOf('<div class="window-bar" id="window-bar"'));

/* ---------- CSS: one pinned block for the two filter rows ---------- */

assert('the filter band pins to the top of the page',
  value('.filter-sticky', 'position') === 'sticky' && value('.filter-sticky', 'top') === '0');
assert('the band is the only pinned element for the two filter rows',
  value('.traj-controls', 'position') !== 'sticky' && value('.anomaly-bar', 'position') !== 'sticky');

assert('the filter band is opaque', isOpaqueBackground(value('.filter-sticky', 'background')));
// The strip paints through its plot, not through the section: the section is the sticky box and
// the plot is the 50px that fills it. A reader scrolling a 200-row ledger sees the rows pass under.
assert('the overview strip is opaque', isOpaqueBackground(value('.overview-plot', 'background')));
assert('the window bar is opaque', isOpaqueBackground(value('.window-bar', 'background')));
assert('the turn head is opaque', isOpaqueBackground(value('.turn-head', 'background')));

/* ---------- CSS: the offsets come from variables, and chain down the page ---------- */

const overviewTop = value('.overview', 'top');
const windowTop = value('.window-bar', 'top');
const turnTop = value('.turn-head', 'top');

assert('the strip pins below the band it measures, not below a constant',
  varsRead(overviewTop).has('--sticky-band-h'));
assert('the window bar pins below the band and the strip',
  varsRead(windowTop).has('--sticky-band-h') && varsRead(windowTop).has('--sticky-overview-h'));
assert('a turn head pins below the band, the strip and the window bar',
  varsRead(turnTop).has('--sticky-band-h')
  && varsRead(turnTop).has('--sticky-overview-h')
  && varsRead(turnTop).has('--sticky-window-h'));

/* ---------- the measurement itself, run ---------- */

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

/** Run syncStickyOffsets() against stub bands and report what it wrote. */
function measure(dom) {
  const written = {};
  const sandbox = {
    dom,
    document: {
      documentElement: {
        style: { setProperty(name, val) { written[name] = val; } },
      },
    },
  };
  vm.createContext(sandbox);
  const src = functionSource('syncStickyOffsets');
  if (!src) return { written, error: 'syncStickyOffsets is not in the shipped script' };
  try {
    vm.runInContext(src, sandbox);
    sandbox.syncStickyOffsets();
  } catch (error) {
    return { written, error: String(error && error.message) };
  }
  return { written, error: null };
}

// 137 / 65 / 57 against fallbacks of 32 / 51 / 45: no plausible constant can pass for a
// measurement, and the three differ so a height written into the wrong variable is caught too.
const stub = {
  filterSticky: { offsetHeight: 137 },
  overview: { offsetHeight: 65 },
  windowBar: { offsetHeight: 57 },
};
const run = measure(stub);
assert('the measurement runs without throwing on the page it ships with', run.error === null);
assert('the measured band height is the one that gets written',
  run.written['--sticky-band-h'] === '137px');
assert('the measured strip height is the one that gets written',
  run.written['--sticky-overview-h'] === '65px');
assert('the measured window bar height is the one that gets written',
  run.written['--sticky-window-h'] === '57px');

// The set of variables the stylesheet reads has to be exactly the set the measurement writes. One
// side alone is not enough: a variable the stylesheet reads but nothing writes falls back to its
// constant silently, and a variable the measurement writes but nothing reads is a dead measurement
// that means the offsets went back to being constants.
const read = varsRead([overviewTop, windowTop, turnTop].join(' '));
const writtenSet = new Set(Object.keys(run.written));
const orphan = [...read].filter((v) => !writtenSet.has(v));
const dead = [...writtenSet].filter((v) => !read.has(v));
assert('every pinned offset is written by the measurement, not by the stylesheet',
  read.size > 0 && orphan.length === 0);
assert('the measurement writes exactly the offsets the stylesheet reads', dead.length === 0);

// A band that is not on the page must not take the rest of the page down with it.
const missing = measure({ filterSticky: null, overview: { offsetHeight: 65 }, windowBar: { offsetHeight: 57 } });
assert('the measurement stands down when the band is not on the page',
  missing.error === null && Object.keys(missing.written).length === 0);

// A band that is never bound measures nothing: the function stands down, every offset falls back to
// its written-down constant, and the page looks the way it looked before this change. The stub
// below cannot catch that, because a stub hands the function the elements it asked for.
function boundId(prop) {
  const m = new RegExp("dom\\." + prop + "\\s*=\\s*document\\.getElementById\\('([^']+)'\\)").exec(html);
  return m ? m[1] : null;
}
const bands = ['filterSticky', 'overview', 'windowBar'].map(boundId);
assert('every band the measurement reads is bound to an element the markup ships',
  bands.every((id) => !!id && html.includes('id="' + id + '"')));

// The measurement runs last. The 异常 note is written inside syncAnomalyMode, and it is the note
// that adds a line to the band: measuring before it is written pins every band below to the height
// the band had before the reader changed anything.
const renderSrc = functionSource('render');
const renderBody = renderSrc ? renderSrc.slice(renderSrc.indexOf('{') + 1, renderSrc.lastIndexOf('}')) : '';
const renderCalls = renderBody.match(/syncStickyOffsets\(\);/g) ?? [];
const lastCall = renderBody.lastIndexOf('syncStickyOffsets();');
assert('the heights are measured once the rows are drawn, not before',
  renderCalls.length === 1 && lastCall >= 0
  && renderBody.slice(lastCall + 'syncStickyOffsets();'.length).trim() === '');

console.log('[sticky] ' + pass + ' passed, ' + failures.length + ' failed');
if (orphan.length) console.log('  read but never written: ' + orphan.join(', '));
if (dead.length) console.log('  written but never read: ' + dead.join(', '));
if (run.error) console.log('  measurement error: ' + run.error);
if (failures.length) {
  console.log('FAILURES:\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('[sticky] OK');
