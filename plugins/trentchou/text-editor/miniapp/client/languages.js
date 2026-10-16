// Language detection, syntax support and folding for formats without a syntax tree.
import * as CM from './vendor/codemirror.js';

const { language: L } = CM;

const streamCache = new Map();
function stream(name) {
  let lang = streamCache.get(name);
  if (!lang) {
    lang = L.StreamLanguage.define(CM.legacy[name]);
    streamCache.set(name, lang);
  }
  return lang;
}

function indentWidth(text, tabSize) {
  let width = 0;
  for (const ch of text) {
    if (ch === ' ') width++;
    else if (ch === '\t') width += tabSize - (width % tabSize);
    else break;
  }
  return width;
}

const FOLD_SCAN_LINES = 20000;

/** Fold a line together with the following lines that are indented deeper. */
export const indentFold = L.foldService.of((state, lineStart) => {
  const line = state.doc.lineAt(lineStart);
  if (!line.text.trim()) return null;
  const base = indentWidth(line.text, state.tabSize);
  let end = null;
  const last = Math.min(state.doc.lines, line.number + FOLD_SCAN_LINES);
  for (let n = line.number + 1; n <= last; n++) {
    const next = state.doc.line(n);
    if (!next.text.trim()) continue;
    if (indentWidth(next.text, state.tabSize) <= base) break;
    end = next;
  }
  return end ? { from: line.to, to: end.to } : null;
});

const TOML_HEADER = /^\s*\[\[?\s*[\w\-."' ]+\]\]?\s*(#.*)?$/;

function stripTomlComment(text) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\' && quote === '"') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '#') return text.slice(0, i);
  }
  return text;
}

/** Find the bracket closing the one that ends at `start - 1`, skipping strings and comments. */
function matchTomlBracket(doc, start, open) {
  const close = open === '[' ? ']' : '}';
  const limit = Math.min(doc.length, start + 500_000);
  const text = doc.sliceString(start, limit);
  let depth = 1;
  let quote = null;
  let comment = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (comment) {
      if (ch === '\n') comment = false;
      continue;
    }
    if (quote) {
      if (quote.length === 3) {
        if (text.startsWith(quote, i)) {
          quote = null;
          i += 2;
        } else if (ch === '\\' && quote === '"""') i++;
      } else if (ch === '\\' && quote === '"') i++;
      else if (ch === quote || ch === '\n') quote = null;
      continue;
    }
    if (ch === '#') comment = true;
    else if (text.startsWith('"""', i) || text.startsWith("'''", i)) {
      quote = text.slice(i, i + 3);
      i += 2;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return ch === close ? start + i : null;
    }
  }
  return null;
}

/** TOML folding: tables fold up to the next header; multi-line arrays, inline tables and strings fold to their end. */
export const tomlFold = L.foldService.of((state, lineStart) => {
  const { doc } = state;
  const line = doc.lineAt(lineStart);
  if (TOML_HEADER.test(line.text)) {
    let last = null;
    const end = Math.min(doc.lines, line.number + FOLD_SCAN_LINES);
    for (let n = line.number + 1; n <= end; n++) {
      const next = doc.line(n);
      if (TOML_HEADER.test(next.text)) break;
      if (next.text.trim()) last = next;
    }
    return last ? { from: line.to, to: last.to } : null;
  }
  const code = stripTomlComment(line.text).trimEnd();
  for (const delim of ['"""', "'''"]) {
    if (code.endsWith(delim) && code.split(delim).length === 2) {
      const after = doc.sliceString(line.to, Math.min(doc.length, line.to + 500_000));
      const close = after.indexOf(delim);
      return close > 0 ? { from: line.to, to: line.to + close } : null;
    }
  }
  const open = code.at(-1);
  if (open === '[' || open === '{') {
    const close = matchTomlBracket(doc, line.from + code.length, open);
    if (close !== null && doc.lineAt(close).number > line.number) return { from: line.to, to: close };
  }
  return null;
});

const withIndentFold = (name) => () => [stream(name), indentFold];

export const LANGUAGES = [
  { id: 'plain', label: '纯文本', load: () => [indentFold] },
  { id: 'json', label: 'JSON', load: () => CM.langs.json() },
  { id: 'yaml', label: 'YAML', load: () => CM.langs.yaml() },
  { id: 'toml', label: 'TOML', load: () => [stream('toml'), tomlFold] },
  { id: 'markdown', label: 'Markdown', load: () => CM.langs.markdown({ codeLanguages: fencedLanguage }) },
  { id: 'javascript', label: 'JavaScript', load: () => CM.langs.javascript({ jsx: true }) },
  { id: 'typescript', label: 'TypeScript', load: () => CM.langs.javascript({ typescript: true }) },
  { id: 'tsx', label: 'TSX', load: () => CM.langs.javascript({ typescript: true, jsx: true }) },
  { id: 'python', label: 'Python', load: () => CM.langs.python() },
  { id: 'html', label: 'HTML', load: () => CM.langs.html() },
  { id: 'css', label: 'CSS', load: () => CM.langs.css() },
  { id: 'xml', label: 'XML', load: () => CM.langs.xml() },
  { id: 'sql', label: 'SQL', load: () => CM.langs.sql() },
  { id: 'rust', label: 'Rust', load: () => CM.langs.rust() },
  { id: 'go', label: 'Go', load: () => CM.langs.go() },
  { id: 'java', label: 'Java', load: () => CM.langs.java() },
  { id: 'cpp', label: 'C / C++', load: () => CM.langs.cpp() },
  { id: 'php', label: 'PHP', load: () => CM.langs.php() },
  { id: 'shell', label: 'Shell', load: withIndentFold('shell') },
  { id: 'dockerfile', label: 'Dockerfile', load: withIndentFold('dockerFile') },
  { id: 'ini', label: 'INI / Properties / .env', load: withIndentFold('properties') },
  { id: 'diff', label: 'Diff', load: () => [stream('diff')] },
  { id: 'lua', label: 'Lua', load: withIndentFold('lua') },
  { id: 'ruby', label: 'Ruby', load: withIndentFold('ruby') },
  { id: 'swift', label: 'Swift', load: withIndentFold('swift') },
  { id: 'perl', label: 'Perl', load: withIndentFold('perl') },
  { id: 'r', label: 'R', load: withIndentFold('r') },
  { id: 'nginx', label: 'Nginx', load: withIndentFold('nginx') },
  { id: 'protobuf', label: 'Protocol Buffers', load: withIndentFold('protobuf') },
  { id: 'powershell', label: 'PowerShell', load: withIndentFold('powerShell') },
  { id: 'csharp', label: 'C#', load: withIndentFold('csharp') },
  { id: 'scala', label: 'Scala', load: withIndentFold('scala') },
  { id: 'kotlin', label: 'Kotlin', load: withIndentFold('kotlin') },
  { id: 'dart', label: 'Dart', load: withIndentFold('dart') },
  { id: 'objc', label: 'Objective-C', load: withIndentFold('objectiveC') },
  { id: 'haskell', label: 'Haskell', load: withIndentFold('haskell') },
  { id: 'erlang', label: 'Erlang', load: withIndentFold('erlang') },
  { id: 'groovy', label: 'Groovy / Gradle', load: withIndentFold('groovy') },
  { id: 'julia', label: 'Julia', load: withIndentFold('julia') },
  { id: 'cmake', label: 'CMake', load: withIndentFold('cmake') },
  { id: 'sass', label: 'Sass', load: withIndentFold('sass') },
];

const byId = new Map(LANGUAGES.map((l) => [l.id, l]));
export const languageById = (id) => byId.get(id) ?? byId.get('plain');

const BY_EXT = {
  json: 'json', jsonc: 'json', json5: 'json', jsonl: 'json', ndjson: 'json', geojson: 'json', ipynb: 'json', har: 'json',
  yaml: 'yaml', yml: 'yaml', toml: 'toml',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  py: 'python', pyi: 'python', pyw: 'python',
  html: 'html', htm: 'html', xhtml: 'html', vue: 'html', svelte: 'html',
  css: 'css', scss: 'css', less: 'css', sass: 'sass',
  xml: 'xml', svg: 'xml', xsd: 'xml', xsl: 'xml', plist: 'xml', csproj: 'xml',
  sql: 'sql', rs: 'rust', go: 'go', java: 'java',
  c: 'cpp', h: 'cpp', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp', ino: 'cpp',
  php: 'php', sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', ksh: 'shell',
  ini: 'ini', cfg: 'ini', conf: 'ini', properties: 'ini', env: 'ini',
  diff: 'diff', patch: 'diff', lua: 'lua', rb: 'ruby', rake: 'ruby', gemspec: 'ruby', swift: 'swift',
  pl: 'perl', pm: 'perl', r: 'r', proto: 'protobuf', ps1: 'powershell', psm1: 'powershell',
  cs: 'csharp', scala: 'scala', sc: 'scala', kt: 'kotlin', kts: 'kotlin', dart: 'dart', m: 'objc', mm: 'objc',
  hs: 'haskell', erl: 'erlang', hrl: 'erlang', groovy: 'groovy', gradle: 'groovy', jl: 'julia', cmake: 'cmake',
};
const BY_NAME = {
  'Dockerfile': 'dockerfile', 'Containerfile': 'dockerfile', 'CMakeLists.txt': 'cmake', 'Gemfile': 'ruby',
  'Rakefile': 'ruby', 'Jenkinsfile': 'groovy', '.bashrc': 'shell', '.zshrc': 'shell', '.profile': 'shell',
  '.bash_profile': 'shell', '.zprofile': 'shell', '.gitconfig': 'ini', '.editorconfig': 'ini', '.npmrc': 'ini',
  'nginx.conf': 'nginx', 'Cargo.lock': 'toml', 'poetry.lock': 'toml', 'uv.lock': 'toml', 'Pipfile': 'toml',
};

export function detectLanguage(path, head = '') {
  const name = path.split(/[\\/]/).pop() ?? '';
  if (BY_NAME[name]) return BY_NAME[name];
  if (name.startsWith('Dockerfile')) return 'dockerfile';
  if (name.startsWith('.env')) return 'ini';
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  if (BY_EXT[ext]) return BY_EXT[ext];
  const shebang = /^#!.*\b(bash|sh|zsh|python[0-9.]*|node|ruby|perl)\b/.exec(head);
  if (shebang) {
    const exe = shebang[1];
    if (exe.startsWith('python')) return 'python';
    if (exe === 'node') return 'javascript';
    if (exe === 'ruby') return 'ruby';
    if (exe === 'perl') return 'perl';
    return 'shell';
  }
  return 'plain';
}

const FENCE_ALIASES = { js: 'javascript', ts: 'typescript', py: 'python', sh: 'shell', bash: 'shell', zsh: 'shell', yml: 'yaml', rs: 'rust', c: 'cpp', 'c++': 'cpp', golang: 'go', jsonc: 'json', dockerfile: 'dockerfile' };

function fencedLanguage(info) {
  const key = info.trim().toLowerCase().split(/\s/)[0];
  const id = FENCE_ALIASES[key] ?? key;
  if (!id || id === 'markdown' || !byId.has(id)) return null;
  const ext = byId.get(id).load();
  if (ext?.language instanceof L.Language) return ext.language;
  if (Array.isArray(ext) && ext[0] instanceof L.Language) return ext[0];
  return null;
}

/** Detect the indentation style used by a document. */
export function detectIndent(text) {
  const lines = text.split('\n', 2000);
  let tabs = 0;
  let spaces = 0;
  const deltas = new Map();
  let previous = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (line[0] === '\t') {
      tabs++;
      continue;
    }
    const width = line.length - line.trimStart().length;
    if (width > 0) spaces++;
    const delta = Math.abs(width - previous);
    if (delta >= 2 && delta <= 8) deltas.set(delta, (deltas.get(delta) ?? 0) + 1);
    previous = width;
  }
  if (tabs > spaces && tabs > 0) return { insertSpaces: false, size: null };
  if (!spaces) return null;
  let best = null;
  for (const [delta, count] of deltas) if (!best || count > best[1]) best = [delta, count];
  return best ? { insertSpaces: true, size: best[0] } : null;
}
