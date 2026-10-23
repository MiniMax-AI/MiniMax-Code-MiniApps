import path from 'node:path';
import vm from 'node:vm';
import { transformEsm } from './esm.mjs';
import { analyzeModuleRequests } from './vendor/js-transform.mjs';

export const DYNAMIC_LIMITS = { modules: 256, sourceBytes: 8 * 1024 * 1024 };

function candidates(from, spec) {
  const relative = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  const bases = spec.startsWith('/') ? [path.posix.normalize(spec.slice(1))]
    : spec.startsWith('.') ? [relative] : [relative, path.posix.normalize(spec), `miniprogram_npm/${spec}`];
  return bases.flatMap((base) => [base, `${base}.js`, `${base}.wxs`, `${base}.json`, `${base}/index.js`]);
}

export function compileModuleGraph({ files, entries, inlineModules, readJson, addError, warnings }) {
  const available = new Map(Object.entries(inlineModules));
  for (const [file, source] of files) {
    if (file.endsWith('.d.ts')) continue;
    const kind = path.posix.extname(file).slice(1);
    if (!['js', 'ts', 'wxs', 'json'].includes(kind)) continue;
    available.set(file, { code: source, kind });
    if (kind === 'ts') {
      const alias = `${file.slice(0, -3)}.js`;
      if (!files.has(alias)) available.set(alias, {
        code: `module.exports = require(${JSON.stringify(`./${path.posix.basename(file)}`)});`, kind: 'alias',
      });
    }
  }
  const modules = {};
  const dependencies = new Set();
  const pending = [...new Set(entries)];
  const visited = new Set();
  let expandedDynamic = false;
  for (let index = 0; index < pending.length; index++) {
    const file = pending[index];
    if (visited.has(file)) continue;
    visited.add(file);
    const mod = available.get(file);
    if (!mod) {
      addError(file, 'module entry is missing', undefined, undefined, 'MISSING_MODULE');
      continue;
    }
    if (files.has(file)) dependencies.add(file);
    let code = mod.code;
    try {
      if (mod.kind === 'json') {
        const value = readJson(file, true);
        // A failed JSON parse is already a build error; never ship a deferred
        // runtime throw disguised as a successful JSON module.
        if (value === undefined) continue;
        code = `module.exports = JSON.parse(${JSON.stringify(JSON.stringify(value))});`;
      } else if (mod.kind === 'js' || mod.kind === 'ts') {
        code = transformEsm(code, { fileName: file });
      }
      new vm.Script(`(function (require, module, exports) {\n${code}\n})`, { filename: file });
      modules[file] = code;
      const requests = analyzeModuleRequests(code);
      let dynamicWarning = false;
      for (const request of requests) {
        if (request.spec !== null) {
          const target = candidates(file, request.spec).find((candidate) => available.has(candidate));
          if (target) pending.push(target);
          else addError(file, `dependency "${request.spec}" was not found in the preview source root`,
            request.line, request.column, 'MISSING_MODULE');
          continue;
        }
        if (!dynamicWarning) warnings.push({
          file, code: 'DYNAMIC_DEPENDENCY', line: request.line, column: request.column,
          message: `Computed or aliased require uses conservative collection (up to ${DYNAMIC_LIMITS.modules} source modules / ${DYNAMIC_LIMITS.sourceBytes} bytes); dependencies cannot be determined precisely.`,
        });
        dynamicWarning = true;
        if (expandedDynamic) continue;
        expandedDynamic = true;
        const selected = [...available].filter(([id]) => !['project.config.json', 'project.private.config.json', 'sitemap.json'].includes(id));
        const sources = selected.filter(([, item]) => item.kind !== 'alias');
        const sourceBytes = sources.reduce((sum, [, item]) => sum + Buffer.byteLength(item.code), 0);
        if (sources.length > DYNAMIC_LIMITS.modules || sourceBytes > DYNAMIC_LIMITS.sourceBytes) {
          addError(file, 'Dynamic dependency collection exceeds the preview limit. Use explicit static imports or require paths.',
            request.line, request.column, 'DYNAMIC_DEPENDENCY_LIMIT');
        } else pending.push(...selected.map(([id]) => id));
      }
    } catch (error) {
      const wrappedLine = Number(/:(\d+)\s*$/m.exec(String(error.stack).split('\n')[0])?.[1] ?? 0) - 1;
      const line = error.loc?.line ?? (wrappedLine > 0 ? wrappedLine : undefined);
      const prefix = `Error transforming ${file}: `;
      const message = error.message.startsWith(prefix) ? error.message.slice(prefix.length) : error.message;
      addError(file.includes('#wxs:') ? file.split('#')[0] : file,
        `${mod.kind === 'ts' ? 'TypeScript' : 'JavaScript'} syntax error: ${message}`,
        line, error.loc?.column, 'MODULE_SYNTAX_ERROR');
    }
  }
  return { modules, dependencies };
}
