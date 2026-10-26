// Static guard: every identifier used as a call target inside the client
// bundle must be declared somewhere in the module (or be a known global).
//
// Why this exists: a drag regression shipped because `startNodeDrag` called
// `selected()`, a helper that never existed. The unit tests all passed
// because the broken line only runs in a browser, inside a gesture handler.
// A pure-function test suite cannot see that; this scan can.
//
// Run: node tests/scan-undefined.mjs [file ...]

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const DEFAULT_FILES = [
  'miniapp/client/app.js',
  'miniapp/client/tools.mjs',
  'miniapp/client/mention.mjs',
];

const GLOBALS = new Set([
  'console', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean',
  'Date', 'RegExp', 'Error', 'TypeError', 'RangeError', 'SyntaxError',
  'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'BigInt',
  'Proxy', 'Reflect', 'Function', 'Intl', 'URL', 'URLSearchParams',
  'TextDecoder', 'TextEncoder', 'AbortController', 'structuredClone',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent',
  'decodeURIComponent', 'encodeURI', 'decodeURI', 'eval',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
  'fetch', 'Headers', 'Request', 'Response', 'FormData', 'Blob', 'File',
  'window', 'document', 'navigator', 'location', 'history', 'alert', 'confirm',
  'prompt', 'request', 'globalThis', 'self', 'top', 'parent', 'frames',
  'Event', 'CustomEvent', 'MouseEvent', 'PointerEvent', 'KeyboardEvent',
  'WheelEvent', 'InputEvent', 'DragEvent', 'ClipboardEvent', 'CompositionEvent',
  'Element', 'HTMLElement', 'SVGElement', 'Node', 'NodeList', 'DocumentFragment',
  'Image', 'CanvasRenderingContext2D', 'OffscreenCanvas', 'ImageData',
  'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'fetch',
]);

const KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'typeof',
  'new', 'delete', 'in', 'of', 'do', 'else', 'await', 'yield', 'case',
  'void', 'instanceof', 'this', 'super', 'class', 'const', 'let', 'var',
  'try', 'finally', 'throw', 'import', 'export', 'default', 'break',
  'continue', 'with', 'as', 'from', 'async', 'static', 'get', 'set',
]);

/**
 * Strip strings, template text, regex literals and comments — but keep every
 * real line and keep the code inside `${ ... }`.
 *
 * Three properties matter here and none of them is obvious:
 *
 * 1. The line count survives. The first version of this scanner collapsed a
 *    multi-line template literal into `''`, which moved every line number
 *    after it. A guard that points at the wrong line is a guard nobody
 *    trusts, and it is exactly the guard you need when it fires.
 * 2. The code inside `${ ... }` survives. It runs. A helper called only
 *    inside a template expression is exactly as broken as one called
 *    anywhere else, and the first version of this scanner could not see it.
 * 3. A regex literal is a literal. `media-tools.mjs` writes `/'/g` to escape
 *    a quote for ffmpeg, and the scanner used to read that quote as the
 *    start of a string — which swallowed the rest of the file and made it
 *    report nothing at all. A guard that silently stops guarding is worse
 *    than no guard, because it says "no problems".
 */
export function stripLiterals(source) {
  const out = [];
  let i = 0;
  const n = source.length;
  // What we are inside: 'template' for the text of a template literal, or
  // {type:'expr', depth} for a `${ ... }` expression.
  const stack = [];
  // Whether the last thing we read can end an expression. A `/` after an
  // expression is a division; a `/` after an operator starts a regex.
  let lastWasValue = false;
  // The word right before the current position, if it is one.
  let word = '';
  let lastWord = '';

  while (i < n) {
    const top = stack[stack.length - 1];

    if (top === 'template') {
      if (source[i] === '\\') { i += 2; continue; }
      if (source[i] === '$' && source[i + 1] === '{') {
        out.push('${');
        i += 2;
        stack[stack.length - 1] = { type: 'expr', depth: 0 };
        continue;
      }
      if (source[i] === '`') {
        out.push('``');
        i += 1;
        stack.pop();
        lastWasValue = true;
        lastWord = '';
        word = '';
        continue;
      }
      if (source[i] === '\n') out.push('\n');
      i += 1;
      continue;
    }

    if (top && top.type === 'expr') {
      const c = source[i];
      if (c === '}') {
        if (top.depth === 0) {
          // The expression ends here. The template literal is not over yet:
          // its text continues, so this frame becomes the template again
          // instead of being popped off.
          out.push('}');
          stack[stack.length - 1] = 'template';
          lastWasValue = true;
          lastWord = '';
          word = '';
          continue;
        }
        top.depth -= 1;
        out.push(c);
        lastWasValue = true;
        lastWord = word;
        word = '';
        i += 1;
        continue;
      }
      if (c === '{') { top.depth += 1; out.push(c); lastWasValue = false; lastWord = word; word = ''; i += 1; continue; }
      // Anything else inside the expression is ordinary code, handled below.
    }

    const ch = source[i];
    const next = source[i + 1];

    if (ch === '/' && next === '/') {
      while (i < n && source[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      let newlines = 0;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') newlines += 1;
        i += 1;
      }
      i += 2;
      if (newlines) out.push('\n'.repeat(newlines));
      continue;
    }
    if (ch === '/' && isRegexStart(lastWasValue, word || lastWord)) {
      i += 1;
      let inClass = false;
      while (i < n) {
        const c = source[i];
        if (c === '\\') { i += 2; continue; }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) { i += 1; break; }
        else if (c === '\n') break;
        i += 1;
      }
      while (i < n && /[A-Za-z]/.test(source[i])) i += 1;
      out.push('RE');
      lastWasValue = true;
      lastWord = '';
      word = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i += 1;
      let newlines = 0;
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\') {
          i += 1;
          if (i < n && source[i] === '\n') newlines += 1;
        } else if (source[i] === '\n') {
          newlines += 1;
        }
        i += 1;
      }
      i += 1;
      out.push('""');
      if (newlines) out.push('\n'.repeat(newlines));
      lastWasValue = true;
      lastWord = '';
      word = '';
      continue;
    }
    if (ch === '`') {
      out.push('``');
      i += 1;
      stack.push('template');
      lastWasValue = false;
      lastWord = word;
      word = '';
      continue;
    }
    out.push(ch);
    // Whitespace changes nothing about the lexical state.
    if (/\s/.test(ch)) { i += 1; continue; }
    if (/[A-Za-z0-9_$]/.test(ch)) {
      lastWasValue = true;
      word += ch;
    } else {
      // `)` and `]` end an expression; every other punctuation does not.
      // Getting this wrong turns `(a ?? 0) / 1000` into a regex literal.
      lastWasValue = ch === ')' || ch === ']';
      lastWord = word;
      word = '';
    }
    i += 1;
  }
  return out.join('');
}

/** Keywords after which a `/` starts a regex literal, not a division. */
const REGEX_AFTER_WORD = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'case', 'do', 'else', 'yield', 'await', 'throw',
]);

/** Does this `/` open a regex literal? */
function isRegexStart(lastWasValue, prevWord) {
  if (prevWord && REGEX_AFTER_WORD.has(prevWord)) return true;
  return !lastWasValue;
}

/**
 * Is the `(` at `openIndex` the parameter list of a definition?
 *
 * `async connectorTools(options = {}) {` is a method, not a call. Reading it
 * as a call makes the scanner report every method in the codebase as an
 * undefined helper, and a guard that cries wolf is a guard nobody runs.
 *
 * A definition is recognised by what follows its parameter list: a body.
 */
function isDefinition(source, openIndex) {
  let depth = 0;
  let i = openIndex;
  for (; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  if (i >= source.length) return false;
  let j = i + 1;
  while (j < source.length && /\s/.test(source[j])) j += 1;
  return source[j] === '{';
}

/** Names bound anywhere in the module. */
function collectDeclared(source) {
  const declared = new Set();
  const patterns = [
    /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
    /\bclass\s+([A-Za-z_$][\w$]*)/g,
    /\bimport\s+([A-Za-z_$][\w$]*)\s*(?:,|from)/g,
    /\bimport\s*\{([^}]*)\}/g,
    /\bimport\s+\*\s*as\s+([A-Za-z_$][\w$]*)/g,
    // A re-export binds a name in this module too: `export { a, b } from
    // './x.mjs'` makes `a` and `b` available here.
    /\bexport\s*\{([^}]*)\}/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(source))) {
      for (const piece of m[1].split(',')) {
        const name = piece.trim().split(/\s+as\s+/).pop().trim();
        if (/^[A-Za-z_$][\w$]*$/.test(name)) declared.add(name);
      }
    }
  }
  // Destructured assignments: const { a, b } = ... / const [x] = ...
  const destructure = /\b(?:const|let|var)\s*\{([^}]*)\}\s*=/g;
  let d;
  while ((d = destructure.exec(source))) {
    for (const piece of d[1].split(',')) {
      const name = piece.trim().split(':').pop().trim().split('=')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) declared.add(name);
    }
  }
  // Function parameters are local bindings too. Without these the scan
  // reports every callback argument as undefined, and a noisy guard is a
  // guard nobody runs.
  const paramLists = [
    /\bfunction\s*\*?\s*[A-Za-z_$][\w$]*\s*\(([^()]*)\)/g,
    /\(([^()]*)\)\s*=>/g,
  ];
  for (const re of paramLists) {
    let p;
    while ((p = re.exec(source))) {
      for (const name of splitParams(p[1])) declared.add(name);
    }
  }
  // Single-parameter arrow: `value => ...`
  const singleArrow = /(^|[^\w$.])([A-Za-z_$][\w$]*)\s*=>/g;
  let a;
  while ((a = singleArrow.exec(source))) declared.add(a[2]);
  // Destructured parameters: `function f({ a, b })` / `({ a, b }) => ...`
  const destructuredParams = [
    /\bfunction\s*\*?\s*[A-Za-z_$][\w$]*\s*\(\s*\{([^}]*)\}/g,
    /\(\s*\{([^}]*)\}\s*\)\s*=>/g,
  ];
  for (const re of destructuredParams) {
    let dp;
    while ((dp = re.exec(source))) {
      for (const piece of dp[1].split(',')) {
        const name = piece.trim().split(':').pop().trim().split('=')[0].trim();
        if (/^[A-Za-z_$][\w$]*$/.test(name)) declared.add(name);
      }
    }
  }
  // Method shorthand binds a name too: `name(args) {` inside a class or an
  // object literal is a definition of `name`, not a call to it.
  for (const name of collectDefinitions(source)) declared.add(name);
  // Parameter lists bind names, including the destructured ones wherever
  // they sit in the list: `handleMcp(req, res, { store, queue, json })`
  // binds `json`, and the `json(res, 405, ...)` further down is a call to
  // that parameter, not an undefined helper.
  for (const name of collectParamBindings(source)) declared.add(name);
  return declared;
}

/**
 * Names bound by parameter lists.
 *
 * A parameter list is the parenthesis group of a function, an arrow function
 * or a method: after the closing parenthesis comes `=>` or a body. Inside
 * it, a `{ ... }` binds names as well.
 */
function collectParamBindings(source) {
  const names = [];
  const re = /\(/g;
  let m;
  while ((m = re.exec(source))) {
    const open = m.index;
    let depth = 0;
    let i = open;
    for (; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (i >= source.length) break;
    let j = i + 1;
    while (j < source.length && /\s/.test(source[j])) j += 1;
    const isArrow = source[j] === '=' && source[j + 1] === '>';
    const hasBody = source[j] === '{';
    if (!isArrow && !hasBody) continue;
    // `if (x) {` is a condition, not a parameter list.
    const head = /([A-Za-z_$][\w$]*)\s*$/.exec(source.slice(0, open));
    if (hasBody && head && KEYWORDS.has(head[1])) continue;
    for (const name of namesInParams(source.slice(open + 1, i))) names.push(name);
  }
  return names;
}

/** The names a parameter list binds, plain and destructured. */
function namesInParams(text) {
  const names = [];
  const groups = [];
  let rest = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '{' || ch === '[') {
      const close = ch === '{' ? '}' : ']';
      let depth = 0;
      let j = i;
      for (; j < text.length; j += 1) {
        if (text[j] === ch) depth += 1;
        else if (text[j] === close) {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      groups.push(text.slice(i + 1, j));
      rest += ' ';
      i = j + 1;
      continue;
    }
    rest += ch;
    i += 1;
  }
  for (const group of groups) {
    for (const piece of group.split(',')) {
      const name = piece.trim().split(':').pop().trim().split('=')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
    }
  }
  for (const piece of rest.split(',')) {
    const name = piece.trim().split('=')[0].trim().replace(/^\.\.\./, '');
    if (/^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
  }
  return names;
}

/** Method shorthand definitions: `name(args) {`, `async name(args) {`. */
function collectDefinitions(source) {
  const names = [];
  const re = /(^|[^\w$.])([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(source))) {
    const name = m[2];
    if (KEYWORDS.has(name)) continue;
    const open = m.index + m[1].length + name.length;
    if (!isDefinition(source, open)) continue;
    names.push(name);
  }
  return names;
}

function splitParams(text) {
  return text
    .split(',')
    .map((piece) => piece.trim().split('=')[0].trim().replace(/^\.\.\./, ''))
    .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
}

/** Call sites that are not method calls, not keywords and not definitions. */
function collectCalls(source) {
  const calls = [];
  const re = /(^|[^\w$.])([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(source))) {
    const name = m[2];
    if (KEYWORDS.has(name)) continue;
    const before = source[m.index + m[1].length - 1];
    if (before === '.' || before === '?') continue;
    // `name(args) {` defines the name; it does not call it.
    const open = m.index + m[1].length + name.length;
    if (isDefinition(source, open)) continue;
    const line = source.slice(0, m.index).split('\n').length;
    calls.push({ name, line });
  }
  return calls;
}

/**
 * Names that are indexed into: `TABLE[key]`.
 *
 * Why this is a separate rule: a missing call target breaks the line it is on,
 * but a missing table breaks every line that reads it, and the reader of the
 * code sees nothing wrong. The capability list read `RUN_MODE_LABEL[mode]`
 * for months while the table was never defined — the panel showed
 * "this panel did not render" and the docs claimed it worked.
 */
function collectIndexedNames(source) {
  const names = [];
  const re = /(^|[^\w$.])([A-Za-z_$][\w$]*)\s*\[/g;
  let m;
  while ((m = re.exec(source))) {
    const name = m[2];
    if (KEYWORDS.has(name)) continue;
    const before = source[m.index + m[1].length - 1];
    if (before === '.' || before === '?') continue;
    const line = source.slice(0, m.index).split('\n').length;
    names.push({ name, line });
  }
  return names;
}

export function scanFile(file) {
  const abs = file instanceof URL ? fileURLToPath(file) : resolve(String(file));
  const raw = readFileSync(abs, 'utf8');
  const source = stripLiterals(raw);
  const declared = collectDeclared(source);
  const calls = collectCalls(source);
  const unknown = new Map();
  for (const call of calls) {
    if (declared.has(call.name) || GLOBALS.has(call.name)) continue;
    if (!unknown.has(call.name)) unknown.set(call.name, call.line);
  }
  const indexed = collectIndexedNames(source);
  const unknownIndexed = new Map();
  for (const entry of indexed) {
    if (declared.has(entry.name) || GLOBALS.has(entry.name)) continue;
    if (!unknownIndexed.has(entry.name)) unknownIndexed.set(entry.name, entry.line);
  }
  return { file: abs, unknown, unknownIndexed };
}

export function scanFiles(files) {
  const problems = [];
  for (const file of files) {
    const result = scanFile(file);
    for (const [name, line] of result.unknown) {
      problems.push({ file: result.file, name, line, kind: 'call' });
    }
    for (const [name, line] of result.unknownIndexed) {
      problems.push({ file: result.file, name, line, kind: 'index' });
    }
  }
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
      const what = p.kind === 'index' ? 'undefined table' : 'undefined call target';
      const how = p.kind === 'index' ? `${p.name}[...]` : `${p.name}(...)`;
      console.error(`${p.file}:${p.line}  ${what}: ${how}`);
    }
    console.error(`\n${problems.length} undefined reference(s) found.`);
    process.exit(1);
  }
  console.log('no undefined references');
}
