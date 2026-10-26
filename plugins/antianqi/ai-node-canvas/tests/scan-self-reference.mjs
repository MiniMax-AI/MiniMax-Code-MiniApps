// Static guard: a variable must not read itself while it is being declared.
//
// Why this exists: a card stopped rendering and the whole board showed three
// red cards saying `Cannot access 'state' before initialization`. The line
// was `const state = inputSlotState(state.canvas, node, kind);` — the
// declaration shadows the app state inside its own initializer, so the
// browser throws a temporal dead zone error. The unit suite stayed green,
// because only a browser renders the card.
//
// A declaration that reads itself is always a mistake: the binding is not
// initialized yet. This scan cannot see the runtime, but it can see this.
//
// Run: node tests/scan-self-reference.mjs [file ...]

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

// The literal stripper is shared with the other static guard. It knows about
// regex literals, and that matters here: this scanner counts brackets to find
// the end of a statement, and a `[` inside a regex literal unbalances the
// count. The declaration then swallowed the statements after it, and the
// guard reported a self-reference that was not there — on a file that had
// nothing wrong with it. One stripper, one set of rules.
import { stripLiterals } from './scan-undefined.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const DEFAULT_FILES = [
  'miniapp/client/app.js',
  'miniapp/client/tools.mjs',
  'miniapp/client/mention.mjs',
  'miniapp/node/mcp.mjs',
];

/** The end of the statement that starts at `start`. */
function statementEnd(source, start) {
  let i = start;
  let depth = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ';' && depth <= 0) return i;
    else if (ch === '\n' && depth <= 0) {
      // A statement may continue on the next line when the line ends with an
      // operator; otherwise the newline ends it.
      const line = source.slice(start, i);
      if (!/[+\-*/%?:,(&|=<>!~^]\s*$/.test(line)) return i;
    }
    i += 1;
  }
  return i;
}

/** The end of the block that starts at `start`. */
function matchBrace(code, start) {
  let depth = 0;
  for (let i = start; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return code.length;
}

/** The end of an expression that is the body of an arrow function. */
function expressionEnd(code, start) {
  let depth = 0;
  for (let i = start; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) return i;
      depth -= 1;
    } else if ((ch === ',' || ch === ';') && depth === 0) return i;
  }
  return code.length;
}

/**
 * The parts of an expression that are inside a function body.
 *
 * A recursive arrow function reads its own name, and that is fine: the read
 * happens when the function is called, not while it is being declared. Only a
 * read that happens *now*, while the binding is still uninitialized, is the
 * bug this guard is about.
 */
function functionBodySpans(code) {
  const spans = [];
  let i = 0;
  const n = code.length;
  while (i < n) {
    if (code[i] === '=' && code[i + 1] === '>') {
      let j = i + 2;
      while (j < n && /\s/.test(code[j])) j += 1;
      const end = code[j] === '{' ? matchBrace(code, j) : expressionEnd(code, j);
      spans.push([i, end]);
      i = end;
      continue;
    }
    if (code.startsWith('function', i) && !/[\w$]/.test(code[i + 8] ?? '')) {
      const brace = code.indexOf('{', i);
      if (brace < 0) break;
      const end = matchBrace(code, brace);
      spans.push([i, end]);
      i = end;
      continue;
    }
    i += 1;
  }
  return spans;
}

/** Whether the initializer reads the name it declares. */
function readsItself(initializer, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^\\w$.])${escaped}(?![\\w$])`, 'g');
  const spans = functionBodySpans(initializer);
  let m;
  while ((m = re.exec(initializer))) {
    const at = m.index + m[0].length;
    const after = initializer.slice(at);
    // `name:` is a property key, and `x.name` is a property, not the binding.
    if (/^\s*:/.test(after)) continue;
    // A read inside a function body happens later, not now.
    if (spans.some(([start, end]) => at > start && at < end)) continue;
    return true;
  }
  return false;
}

export function scanFile(file) {
  const abs = file instanceof URL ? fileURLToPath(file) : resolve(String(file));
  const source = stripLiterals(readFileSync(abs, 'utf8'));
  const problems = [];
  const re = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g;
  let m;
  while ((m = re.exec(source))) {
    const name = m[1];
    const start = m.index + m[0].length;
    const initializer = source.slice(start, statementEnd(source, start));
    if (!readsItself(initializer, name)) continue;
    const line = source.slice(0, m.index).split('\n').length;
    problems.push({ file: abs, name, line });
  }
  return problems;
}

export function scanFiles(files) {
  const problems = [];
  for (const file of files) problems.push(...scanFile(file));
  return problems;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  const files = process.argv.length > 2
    ? process.argv.slice(2).map((f) => resolve(f))
    : DEFAULT_FILES.map((f) => join(root, f));
  const problems = scanFiles(files);
  if (problems.length) {
    for (const p of problems) {
      console.error(`${p.file}:${p.line}  ${p.name} reads itself while it is declared`);
    }
    console.error(`\n${problems.length} self-reference(s) found.`);
    process.exit(1);
  }
  console.log('no self-referencing declarations');
}
