/**
 * Light-theme token coverage check.
 *
 * The README states the light theme is defined but was not visually verified.
 * We cannot emulate prefers-color-scheme from here, but we can verify the
 * stronger structural property: every --mcode-* token that the stylesheet
 * CONSUMES must be defined in BOTH themes, otherwise light mode silently
 * falls back to an undefined value.
 *
 * Actual stylesheet shape in this page:
 *   :root, :root[data-theme='light'] { ... }        <- light
 *   :root[data-theme='dark']          { ... }        <- dark
 *   @media (prefers-color-scheme: dark) {
 *     :root:not([data-theme])        { ... }        <- pre-JS dark fallback
 *   }
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = await readFile(path.join(here, '..', 'miniapp', 'client', 'index.html'), 'utf8');

const css = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i)?.[1];
if (!css) {
  console.error('FAIL: no <style> block found');
  process.exit(1);
}

function classify(selector) {
  const s = selector.trim();
  if (/@media\s*\(prefers-color-scheme\s*:\s*light\s*\)/i.test(s)) return 'light';
  if (/@media\s*\(prefers-color-scheme\s*:\s*dark\s*\)/i.test(s)) return 'dark';
  if (/:root\[data-theme=['"]?dark/i.test(s)) return 'dark';
  if (/:root\[data-theme=['"]?light/i.test(s)) return 'light';
  if (/^:root\b/i.test(s) && !/\[data-theme/i.test(s)) return 'light'; // bare :root carries light values
  if (/:root:not\(\[data-theme\]\)/i.test(s)) return 'dark'; // pre-JS fallback
  return 'other';
}

// Walk the CSS, tracking the selector of each declaration block.
const defs = new Map(); // token -> Set(theme)
const uses = new Set();
let pending = [];       // selectors of currently open blocks
let depthOfTheme = [];  // theme per open brace
let buf = '';
let media = 'none';

for (let i = 0; i < css.length; i++) {
  const ch = css[i];
  if (ch === '{') {
    const sel = buf.replace(/\s+/g, ' ').trim();
    let theme = classify(sel);
    if (media === 'dark' && theme === 'other') theme = 'dark';
    if (media === 'light' && theme === 'other') theme = 'light';
    pending.push(sel);
    depthOfTheme.push(theme);
    buf = '';
    continue;
  }
  if (ch === '}') {
    // flush any declarations that were pending
    consume(buf);
    buf = '';
    const closed = depthOfTheme.pop();
    pending.pop();
    if (pending.length === 0 && closed === 'dark' && media === 'dark') media = 'none';
    continue;
  }
  if (ch === ';' || ch === '{') consume(buf), (buf = ''); // statement outside a block
  buf += ch;

  function consume(text) {
    const t = text.trim();
    if (!t || !pending.length) return;
    const theme = depthOfTheme[depthOfTheme.length - 1];
    const defRe = /(--mcode-[A-Za-z0-9_-]+)\s*:\s*[^;{}]+/g;
    let m;
    while ((m = defRe.exec(t))) {
      if (!defs.has(m[1])) defs.set(m[1], new Set());
      defs.get(m[1]).add(theme);
    }
    const useRe = /var\(\s*(--mcode-[A-Za-z0-9_-]+)/g;
    while ((m = useRe.exec(t))) uses.add(m[1]);
  }
}

// media query tracking (single level is enough for this sheet)
const mediaRe = /@media\s*\(([^)]*)\)/gi;
let mm;
const mediaRanges = [];
while ((mm = mediaRe.exec(css))) mediaRanges.push({ at: mm.index, len: mm[0].length, text: mm[1] });

// Re-scan with media awareness for declarations inside @media
{
  let cursor = 0;
  const lines = css.split(/\r?\n/);
  let offset = 0;
  let curTheme = 'light';
  for (const line of lines) {
    const at = offset;
    offset += line.length + 1;
    for (const r of mediaRanges) {
      if (r.at === at) curTheme = /light/i.test(r.text) ? 'light' : 'dark';
    }
    const selMatch = /^\s*(:root[^{]*|\[data-theme[^{]*)\{\s*$/.exec(line);
    if (selMatch) {
      const theme = classify(selMatch[1]);
      if (theme !== 'other') curTheme = theme;
      else if (curTheme === 'none') curTheme = 'other';
    }
    const defRe = /(--mcode-[A-Za-z0-9_-]+)\s*:\s*[^;]+;/g;
    let m;
    while ((m = defRe.exec(line))) {
      if (!defs.has(m[1])) defs.set(m[1], new Set());
      defs.get(m[1]).add(curTheme);
    }
    const useRe = /var\(\s*(--mcode-[A-Za-z0-9_-]+)/g;
    while ((m = useRe.exec(line))) uses.add(m[1]);
  }
}

const problems = [];
for (const token of [...uses].sort()) {
  const where = defs.get(token);
  if (!where) problems.push(`UNDEFINED  ${token} (used but never defined)`);
  else if (!where.has('light')) problems.push(`LIGHT_GAP  ${token} (no light-theme definition)`);
  else if (!where.has('dark')) problems.push(`DARK_GAP   ${token} (no dark-theme definition)`);
}

console.log(`tokens defined : ${defs.size}`);
console.log(`tokens used    : ${uses.size}`);
console.log(`theme map      : ${[...defs].map(([t, s]) => `${t}{${[...s].join(',')}}`).slice(0, 3).join(' ')} ...`);

if (problems.length === 0) {
  console.log('\nOK  every consumed --mcode-* token is defined in BOTH light and dark');
  process.exit(0);
}
console.log('\n' + problems.map((p) => 'FAIL ' + p).join('\n'));
process.exit(1);
