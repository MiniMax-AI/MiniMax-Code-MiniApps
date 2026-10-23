import { transform } from 'sucrase';
import { parse } from 'sucrase/dist/parser/index.js';
import { IdentifierRole, isDeclaration, isFunctionScopedDeclaration, isTopLevelDeclaration } from 'sucrase/dist/parser/tokenizer/index.js';
import { TokenType } from 'sucrase/dist/parser/tokenizer/types.js';

function normalizeVariableExports(source, typescript) {
  const { tokens } = parse(source, false, typescript, false);
  const edits = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type !== TokenType._export || token.isType || token.scopeDepth !== 0) continue;
    if (![TokenType._var, TokenType._let, TokenType._const].includes(tokens[index + 1]?.type)) continue;
    const end = token.rhsEndIndex;
    const names = tokens.slice(index + 2, end)
      .filter((item) => !item.isType && item.scopeDepth === token.scopeDepth && isTopLevelDeclaration(item))
      .map((item) => source.slice(item.start, item.end));
    if (!names.length) continue;
    // Sucrase 3.35.1 loses declarations after the first comma in `export const`.
    // Its named-export path preserves all bindings, including destructuring and
    // uninitialized let/var. Parser spans leave comments and line numbers intact.
    edits.push({ start: token.start, end: token.end, text: ' '.repeat(token.end - token.start) });
    edits.push({ start: tokens[end - 1].end, end: tokens[end - 1].end, text: `;export {${names.join(',')}};` });
    index = end - 1;
  }
  let result = source;
  for (const edit of edits.reverse()) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return result;
}

// Bundled at build time: installed previews do not resolve packages from the project.
export function transformJavaScript(source, { fileName = 'module.js' } = {}) {
  const typescript = fileName.endsWith('.ts');
  return transform(normalizeVariableExports(source, typescript), {
    filePath: fileName,
    transforms: typescript ? ['typescript', 'imports'] : ['imports'],
    disableESTransforms: true,
    preserveDynamicImport: false,
  }).code;
}

function decodeStringLiteral(raw) {
  const body = raw.slice(1, -1);
  return body.replace(/\\(?:\r\n|\n|\r|u\{([\da-f]+)\}|u([\da-f]{4})|x([\da-f]{2})|([0-3][0-7]{0,2}|[4-7][0-7]?)|([\s\S]))/gi,
    (_match, point, unicode, hex, octal, escaped) => {
      if (point) return String.fromCodePoint(Number.parseInt(point, 16));
      if (unicode || hex) return String.fromCharCode(Number.parseInt(unicode ?? hex, 16));
      if (octal) return String.fromCharCode(Number.parseInt(octal, 8));
      if (escaped === undefined) return '';
      return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' })[escaped] ?? escaped;
    });
}

// Analyze already-transformed code: erased type imports cannot become runtime
// edges, and parser tokens distinguish nested expressions from comments/regex.
export function analyzeModuleRequests(source) {
  const { tokens, scopes } = parse(source, false, false, false);
  const names = tokens.map((token) => {
    const raw = source.slice(token.start, token.end);
    return token.type === TokenType.name ? raw.replace(/\\u(?:\{([\da-f]+)\}|([\da-f]{4}))/gi,
      (_match, point, unicode) => String.fromCodePoint(Number.parseInt(point ?? unicode, 16))) : raw;
  });
  const shadowed = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (names[index] !== 'require' || !isDeclaration(token)) continue;
    const scope = scopes.find((item) => item.startTokenIndex <= index && item.endTokenIndex > index
      && (!isFunctionScopedDeclaration(token) || item.isFunctionScope));
    if (scope) shadowed.push(scope);
  }
  const requests = [];
  let line = 1;
  let lineStart = 0;
  let scanned = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (names[index] !== 'require' || ![IdentifierRole.Access, IdentifierRole.ObjectShorthand].includes(token.identifierRole)
      || shadowed.some((scope) => scope.startTokenIndex <= index && scope.endTokenIndex > index)) continue;
    for (; scanned < token.start; scanned++) {
      if (source[scanned] === '\n') { line++; lineStart = scanned + 1; }
    }
    const position = { line, column: token.start - lineStart + 1 };
    const next = tokens[index + 1];
    const argument = tokens[index + 2];
    if (next?.type === TokenType.parenL && argument?.type === TokenType.string
      && tokens[index + 3]?.type === TokenType.parenR) {
      requests.push({ spec: decodeStringLiteral(names[index + 2]), ...position });
    } else if (next?.type === TokenType.parenL && argument?.type === TokenType.backQuote
      && tokens[index + 3]?.type === TokenType.template && tokens[index + 4]?.type === TokenType.backQuote
      && tokens[index + 5]?.type === TokenType.parenR) {
      requests.push({ spec: decodeStringLiteral(`\`${names[index + 3]}\``), ...position });
    } else {
      // Passing/aliasing require is also an unbounded dependency expression.
      requests.push({ spec: null, ...position });
    }
  }
  return requests;
}
