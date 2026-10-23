// Compiles a native WeChat Mini Program project into one preview build that the
// browser runtime (client/sim-runtime.js) can execute. This is an approximation for
// layout and basic interaction checks; it does not replace the WeChat DevTools compiler.

import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { compileModuleGraph } from './module-graph.mjs';
import { compileGame, GAME_RUNTIME_VERSION } from './game-compiler.mjs';
import { parseProjectJson } from './project-json.mjs';
import { collectReferences, parseWxml } from './wxml.mjs';
import { compileWxss } from './wxss.mjs';

export const COMPILER_VERSION = '8';
export { GAME_RUNTIME_VERSION };
export const MINIPROGRAM_RUNTIME_VERSION = '2';
export const COMPONENT_ENGINE_VERSION = 'glass-easel@1.2.0+adapter@1.2.0';
export const COMPONENT_BRIDGE_VERSION = '1';
export const COMPILER_FINGERPRINT = `${COMPILER_VERSION}:${COMPONENT_ENGINE_VERSION}:bridge@${COMPONENT_BRIDGE_VERSION}:miniprogram-runtime@${MINIPROGRAM_RUNTIME_VERSION}:game-runtime@${GAME_RUNTIME_VERSION}`;
const IGNORED_DIRS = new Set(['node_modules', '.git', '.svn', '.idea', '.vscode', 'dist', 'unpackage', '.minimax']);
const TEXT_EXTENSIONS = new Set(['.js', '.json', '.wxml', '.wxss', '.wxs', '.ts']);
const LIMITS = {
  maxFiles: 3000, maxTextFiles: 1500, maxFileBytes: 4 * 1024 * 1024, maxTotalBytes: 40 * 1024 * 1024,
  maxAssetBytes: 20 * 1024 * 1024, maxAssetTotalBytes: 80 * 1024 * 1024, maxRootCandidates: 20,
};
const SENSITIVE_DIRS = new Set(['.ssh', '.aws', '.azure', '.gnupg', '.gcloud', '.kube', '.docker', '.config', '.local', '.git', '.hg', '.svn', '.minimax', '.workbuddy', '.codex']);
export const ASSET_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.mp3', '.mp4', '.m4a', '.wav',
  '.ttf', '.otf', '.woff', '.woff2',
]);

export class ProjectError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ProjectError';
    this.code = code;
    Object.assign(this, details);
  }
}

const toPosix = (value) => value.split(path.sep).join('/');
const stripExt = (value) => value.replace(/\.[^./]+$/, '');

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function safeChildPath(root, target) {
  if (!isInside(root, target)) throw new ProjectError('INVALID_PROJECT', 'miniprogramRoot escapes the project');
  const segments = path.relative(root, target).split(path.sep).map((part) => part.toLowerCase());
  if (segments.some((segment) => SENSITIVE_DIRS.has(segment) || segment.endsWith('.app'))) {
    throw new ProjectError('PROJECT_PATH_FORBIDDEN', 'Mini Program source root cannot be a private configuration or application directory.');
  }
}

async function rootIdentity(directory) {
  const canonical = await realpath(directory);
  const info = await stat(canonical, { bigint: true });
  if (!info.isDirectory()) throw new ProjectError('PROJECT_CHANGED', 'Project source directory is no longer available.');
  return { path: canonical, dev: String(info.dev), ino: String(info.ino) };
}

export async function assertSnapshotIdentity(snapshot) {
  for (const expected of snapshot.identities ?? []) {
    try {
      const current = await rootIdentity(expected.path);
      if (current.path !== expected.path || current.dev !== expected.dev || current.ino !== expected.ino) throw new Error('changed');
    } catch {
      throw new ProjectError('PROJECT_CHANGED', 'Project or source root changed during this build. Retry with a fresh source snapshot.');
    }
  }
}

async function readBounded(file, root, maximum) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new ProjectError('INVALID_PROJECT', 'Source files must be regular files, not symbolic links.');
  const actual = await realpath(file);
  if (!isInside(root, actual)) throw new ProjectError('INVALID_PROJECT', 'Source file escapes the project');
  if (info.size > maximum) throw new ProjectError('TOO_LARGE', 'Source file exceeds the preview size limit');
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino) {
      throw new ProjectError('PROJECT_CHANGED', 'Source file changed while opening it. Retry the build.');
    }
    const buffer = Buffer.alloc(Math.min(opened.size, maximum) + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
      if (!bytesRead) break;
      total += bytesRead;
    }
    const final = await handle.stat();
    if (total > maximum) throw new ProjectError('TOO_LARGE', 'Source file exceeds the preview size limit');
    if (total !== final.size || opened.size !== final.size || opened.mtimeMs !== final.mtimeMs) {
      throw new ProjectError('PROJECT_CHANGED', 'Source file changed while reading it. Retry the build.');
    }
    return buffer.subarray(0, total);
  } finally {
    await handle.close();
  }
}

const PROJECT_MARKERS = { miniprogram: 'app.json', minigame: 'game.json' };
function validateProjectKind(kind) {
  if (kind !== undefined && (typeof kind !== 'string' || !Object.hasOwn(PROJECT_MARKERS, kind))) {
    throw new ProjectError('INVALID_PROJECT_KIND', 'projectKind must be miniprogram or minigame', { choices: Object.keys(PROJECT_MARKERS) });
  }
}
async function markerKinds(root) {
  const kinds = [];
  for (const [kind, marker] of Object.entries(PROJECT_MARKERS)) {
    try {
      const info = await lstat(path.join(root, marker));
      if (info.isFile() && !info.isSymbolicLink()) kinds.push(kind);
    } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
  }
  return kinds;
}
function selectProjectKind(kinds, requested, fromConfig) {
  if (requested && fromConfig && requested !== fromConfig) {
    throw new ProjectError('PROJECT_KIND_MISMATCH', 'projectKind conflicts with project.config.json compileType', { requestedKind: requested, configuredKind: fromConfig, choices: kinds });
  }
  const kind = requested ?? fromConfig;
  if (kind && !kinds.includes(kind)) {
    throw new ProjectError('PROJECT_KIND_MISMATCH', `The selected ${kind} project requires ${PROJECT_MARKERS[kind]}; another project kind was found`, { requestedKind: kind, choices: kinds });
  }
  if (kind) return kind;
  if (kinds.length > 1) throw new ProjectError('AMBIGUOUS_PROJECT_KIND', 'Both app.json and game.json exist. Select miniprogram or minigame explicitly.', { choices: kinds });
  return kinds[0];
}
async function sourceCandidate(root, candidate) {
  safeChildPath(root, candidate);
  try {
    const resolved = await realpath(candidate);
    safeChildPath(root, resolved);
    if (!(await stat(resolved)).isDirectory()) return null;
    return (await markerKinds(resolved)).length ? resolved : null;
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) return null;
    throw error;
  }
}

/** Resolves and validates a project directory. Throws ProjectError for anything unusable. */
export async function resolveProject(projectPath, { projectKind } = {}) {
  validateProjectKind(projectKind);
  if (typeof projectPath !== 'string' || projectPath.includes('\0') || !path.isAbsolute(projectPath)) {
    throw new ProjectError('INVALID_PATH', 'project_path must be an absolute path');
  }
  let projectDir;
  try {
    projectDir = await realpath(projectPath);
  } catch {
    throw new ProjectError('NOT_FOUND', `project directory does not exist: ${projectPath}`);
  }
  if (!(await stat(projectDir)).isDirectory()) throw new ProjectError('INVALID_PATH', 'project_path is not a directory');

  let sourceRoot;
  let projectName = path.basename(projectDir);
  let cloudRoot;
  let explicitRoot;
  let hasExplicitRoot = false;
  let configuredKind;
  const warnings = [];
  const configuration = new Map();
  const configPath = path.join(projectDir, 'project.config.json');
  try {
    const source = (await readBounded(configPath, projectDir, LIMITS.maxFileBytes)).toString('utf8');
    const parsed = parseProjectJson(source, 'project.config.json');
    const config = parsed.value;
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new ProjectError('INVALID_PROJECT', 'project.config.json must contain an object');
    }
    configuration.set('project.config.json', source);
    warnings.push(...parsed.warnings);
    if (Object.hasOwn(config, 'compileType')) {
      if (config.compileType === 'game') configuredKind = 'minigame';
      else if (config.compileType === 'miniprogram') configuredKind = 'miniprogram';
      else throw new ProjectError('UNSUPPORTED_PROJECT_KIND', 'Only compileType game or miniprogram is supported for local preview.', { file: 'project.config.json', choices: Object.keys(PROJECT_MARKERS) });
    }
    if (typeof config.projectname === 'string' && config.projectname.trim()) projectName = config.projectname.trim();
    if (Object.hasOwn(config, 'miniprogramRoot')) {
      hasExplicitRoot = true;
      explicitRoot = config.miniprogramRoot;
      if (typeof explicitRoot === 'string') sourceRoot = await sourceCandidate(projectDir, path.resolve(projectDir, explicitRoot));
    }
    if (typeof config.cloudfunctionRoot === 'string' && config.cloudfunctionRoot.trim()) {
      cloudRoot = path.resolve(projectDir, config.cloudfunctionRoot);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      if (error instanceof ProjectError) throw error;
      throw new ProjectError('INVALID_PROJECT', error.message, { file: 'project.config.json', line: error.line, column: error.column });
    }
  }
  if (!sourceRoot && hasExplicitRoot) warnings.push({
    code: 'PROJECT_ROOT_FALLBACK', file: 'project.config.json',
    message: 'Configured miniprogramRoot is not a usable source root. Preview uses a discovered root without editing the project configuration.',
  });
  sourceRoot ??= await sourceCandidate(projectDir, projectDir);
  if (!sourceRoot) {
    const children = await readdir(projectDir, { withFileTypes: true });
    if (children.length > LIMITS.maxFiles) throw new ProjectError('TOO_LARGE', 'Too many entries for bounded project root discovery.');
    const candidates = new Set();
    for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!child.isDirectory() || child.isSymbolicLink() || child.name.startsWith('.') || IGNORED_DIRS.has(child.name) || child.name.toLowerCase().endsWith('.app')) continue;
      const candidate = await sourceCandidate(projectDir, path.join(projectDir, child.name));
      if (candidate) candidates.add(candidate);
    }
    if (candidates.size > 1) throw new ProjectError('AMBIGUOUS_PROJECT_ROOT', 'Multiple Mini Program source roots were found. Select one explicitly.', {
      candidates: [...candidates].slice(0, LIMITS.maxRootCandidates), candidateCount: candidates.size, truncated: candidates.size > LIMITS.maxRootCandidates,
    });
    sourceRoot = [...candidates][0];
  }
  if (!sourceRoot) throw new ProjectError('INVALID_PROJECT', 'app.json or game.json was not found in the source root or a unique direct child');
  const kind = selectProjectKind(await markerKinds(sourceRoot), projectKind, configuredKind);
  return { projectDir, projectRoot: projectDir, sourceRoot, projectName, projectKind: kind, cloudRoot, warnings, configuration };
}

async function collectFiles(sourceRoot, cloudRoot, knownSources = new Map()) {
  const files = new Map();
  const assets = [];
  let fileCount = 0;
  let textCount = 0;
  let totalBytes = 0;
  let assetBytes = 0;
  const visit = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.') || entry.name.toLowerCase().endsWith('.app')) continue;
        if (cloudRoot && full === cloudRoot) continue;
        if (!isInside(sourceRoot, await realpath(full))) continue;
        await visit(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (++fileCount > LIMITS.maxFiles) throw new ProjectError('TOO_LARGE', `more than ${LIMITS.maxFiles} files in source root`);
      const ext = path.extname(entry.name).toLowerCase();
      if (!TEXT_EXTENSIONS.has(ext)) {
        if (ASSET_EXTENSIONS.has(ext)) {
          const bytes = await readBounded(full, sourceRoot, LIMITS.maxAssetBytes);
          assetBytes += bytes.length;
          if (assetBytes > LIMITS.maxAssetTotalBytes) throw new ProjectError('TOO_LARGE', 'Assets exceed the preview size limit');
          assets.push({ path: toPosix(path.relative(sourceRoot, full)), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
        }
        continue;
      }
      const info = await lstat(full);
      if (!info.isFile() || info.isSymbolicLink() || !isInside(sourceRoot, await realpath(full))) continue;
      if (info.size > LIMITS.maxFileBytes) continue;
      totalBytes += info.size;
      if (++textCount > LIMITS.maxTextFiles || totalBytes > LIMITS.maxTotalBytes) {
        throw new ProjectError('TOO_LARGE', 'source root is too large for preview');
      }
      const relative = toPosix(path.relative(sourceRoot, full));
      files.set(relative, knownSources.get(relative) ?? (await readBounded(full, sourceRoot, LIMITS.maxFileBytes)).toString('utf8'));
    }
  };
  await visit(sourceRoot);
  return { files, assets };
}

function resolveRelative(fromFile, spec) {
  if (spec.startsWith('/')) return path.posix.normalize(spec.slice(1));
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
}

export async function collectProjectSnapshot(projectPath, { projectKind } = {}) {
  validateProjectKind(projectKind);
  const projectIdentity = await rootIdentity(projectPath);
  const project = await resolveProject(projectPath, { projectKind });
  const identities = [projectIdentity, await rootIdentity(project.sourceRoot)];
  await assertSnapshotIdentity({ identities });
  const { files, assets } = await collectFiles(project.sourceRoot, project.cloudRoot,
    project.sourceRoot === project.projectDir ? project.configuration : undefined);
  const hash = createHash('sha256').update(COMPILER_FINGERPRINT).update('\0');
  hash.update(`kind:${project.projectKind}\0runtime:${project.projectKind === 'minigame' ? GAME_RUNTIME_VERSION : MINIPROGRAM_RUNTIME_VERSION}\0`);
  hash.update(`root:${toPosix(path.relative(project.projectDir, project.sourceRoot))}\0`);
  for (const [file, source] of project.configuration) hash.update(`config:${file}\0${source}\0`);
  // Cache lookup is deliberately broader than the runtime build identity. Even
  // unused sources invalidate this snapshot, but they are never transformed.
  for (const [file, source] of [...files].sort(([a], [b]) => a.localeCompare(b))) hash.update(`source:${file}\0${source}\0`);
  assets.sort((a, b) => a.path.localeCompare(b.path));
  for (const asset of assets) hash.update(`asset:${asset.path}\0${asset.bytes}\0${asset.sha256}\0`);
  await assertSnapshotIdentity({ identities });
  return { project, files, assets, identities, sourceHash: hash.digest('hex'), compilerFingerprint: COMPILER_FINGERPRINT };
}

export async function compileProject(projectPath, { snapshot, projectKind } = {}) {
  validateProjectKind(projectKind);
  const captured = snapshot ?? await collectProjectSnapshot(projectPath, { projectKind });
  if (projectKind && captured.project.projectKind !== projectKind) throw new ProjectError('PROJECT_KIND_MISMATCH', 'Captured source snapshot belongs to a different project kind', { requestedKind: projectKind, choices: [captured.project.projectKind] });
  await assertSnapshotIdentity(captured);
  if (captured.project.projectKind === 'minigame') {
    const game = compileGame(captured, COMPILER_FINGERPRINT);
    await assertSnapshotIdentity(captured);
    return game;
  }
  const { project, files, assets } = captured;
  const errors = [];
  const warnings = [...project.warnings];
  const dependencyFiles = new Set();
  const scriptEntries = new Set(['app.js']);
  const parsedJson = new Map();
  const addError = (file, message, line, column, code) => errors.push({ file, message, ...(line ? { line } : {}), ...(column ? { column } : {}), ...(code ? { code } : {}) });

  const readJson = (file, required = false) => {
    const source = files.get(file);
    if (source === undefined) {
      if (required) addError(file, 'file is missing');
      return undefined;
    }
    dependencyFiles.add(file);
    if (parsedJson.has(file)) return parsedJson.get(file);
    try {
      const result = parseProjectJson(source, file);
      warnings.push(...result.warnings);
      parsedJson.set(file, result.value);
      return result.value;
    } catch (error) {
      addError(file, error.message, error.line, error.column, error.code);
      parsedJson.set(file, undefined);
      return undefined;
    }
  };

  const readConfig = (file, required = false) => {
    const value = readJson(file, required);
    if (value === undefined) return {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      addError(file, 'configuration must contain a JSON object', undefined, undefined, 'INVALID_CONFIG');
      return {};
    }
    return value;
  };
  const genericConfig = (value, file) => {
    if (value === undefined) return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 100
      || Object.entries(value).some(([name, item]) => !/^[a-zA-Z][\w-]{0,99}$/.test(name)
        || ['constructor', 'prototype'].includes(name) || (item !== true && (!item || typeof item !== 'object' || Array.isArray(item)
          || Object.keys(item).length !== 1 || typeof item.default !== 'string' || !item.default.trim() || item.default.length > 2048)))) {
      addError(file, 'componentGenerics must contain at most 100 named true or default-component entries', undefined, undefined, 'INVALID_CONFIG');
      return undefined;
    }
    return value;
  };
  const app = readConfig('app.json', true);
  const pages = [];
  const pushPage = (page) => {
    if (typeof page === 'string' && page.trim() && !pages.includes(page.trim())) pages.push(page.trim().replace(/^\//, ''));
  };
  if (!Array.isArray(app.pages) || app.pages.length === 0) addError('app.json', '"pages" must be a non-empty array');
  for (const page of Array.isArray(app.pages) ? app.pages : []) pushPage(page);
  for (const pkg of [...(Array.isArray(app.subPackages) ? app.subPackages : []), ...(Array.isArray(app.subpackages) ? app.subpackages : [])]) {
    if (!pkg || typeof pkg.root !== 'string') continue;
    for (const page of Array.isArray(pkg.pages) ? pkg.pages : []) {
      if (typeof page === 'string') pushPage(path.posix.join(pkg.root, page));
    }
  }
  const entryPage = typeof app.entryPagePath === 'string' && pages.includes(app.entryPagePath) ? app.entryPagePath : pages[0];

  // --- components -------------------------------------------------------------------------
  const resolveComponent = (spec, fromJson) => {
    if (typeof spec !== 'string' || spec.startsWith('plugin://')) return null;
    const candidates = [];
    if (spec.startsWith('/') || spec.startsWith('.')) candidates.push(resolveRelative(fromJson, spec));
    else {
      candidates.push(resolveRelative(fromJson, spec), path.posix.normalize(spec));
      candidates.push(`miniprogram_npm/${spec}`);
    }
    for (const base of candidates) {
      const clean = stripExt(base);
      if (files.has(`${clean}.json`) || files.has(`${clean}.wxml`)) return clean;
      if (files.has(`${clean}/index.json`) || files.has(`${clean}/index.wxml`)) return `${clean}/index`;
    }
    return null;
  };
  const globalUsing = {};
  const units = {};
  const queue = [];
  const describeUsing = (using, fromJson) => {
    const result = {};
    if (using !== undefined && (!using || typeof using !== 'object' || Array.isArray(using))) {
      addError(fromJson, 'usingComponents must contain a JSON object', undefined, undefined, 'INVALID_CONFIG');
      return result;
    }
    for (const [tag, spec] of Object.entries(using ?? {})) {
      const resolved = resolveComponent(spec, fromJson);
      if (!resolved) {
        if (typeof spec === 'string' && spec.startsWith('plugin://')) warnings.push({ file: fromJson, message: `plugin component <${tag}> is not supported in preview` });
        else addError(fromJson, `usingComponents "${tag}": component "${spec}" was not found`);
        continue;
      }
      result[tag.toLowerCase()] = resolved;
      if (!units[resolved] && !queue.includes(resolved)) queue.push(resolved);
    }
    return result;
  };
  Object.assign(globalUsing, describeUsing(app.usingComponents, 'app.json'));

  const templates = {};
  const inlineModules = {};
  const componentStyles = {};
  const styles = [];
  const parseTemplate = (id) => {
    if (templates[id] !== undefined) return;
    const file = `${id}.wxml`;
    const source = files.get(file);
    templates[id] = null;
    if (source === undefined) return;
    dependencyFiles.add(file);
    try {
      const ast = parseWxml(source, file);
      const refs = collectReferences(ast);
      rewriteTemplateRefs(ast, file);
      templates[id] = { ast };
      for (const spec of [...refs.imports, ...refs.includes]) parseTemplate(stripExt(resolveRelative(file, spec)));
    } catch (error) {
      addError(file, error.message.replace(`${file}:`, '').trim(), error.line, error.column);
    }
  };
  const rewriteTemplateRefs = (nodes, file) => {
    for (const node of nodes) {
      if (node.t !== 'e') continue;
      if ((node.n === 'import' || node.n === 'include') && typeof node.a.src === 'string') {
        const target = stripExt(resolveRelative(file, node.a.src));
        if (!files.has(`${target}.wxml`)) addError(file, `<${node.n} src="${node.a.src}"> was not found`);
        node.a.src = target;
      }
      if (node.n === 'wxs' && typeof node.a.module === 'string') {
        if (typeof node.a.src === 'string') {
          const target = resolveRelative(file, node.a.src.endsWith('.wxs') ? node.a.src : `${node.a.src}.wxs`);
          if (!files.has(target)) addError(file, `<wxs src="${node.a.src}"> was not found`);
          else scriptEntries.add(target);
          node.a.src = target;
        } else {
          const id = `${file}#wxs:${node.a.module}`;
          inlineModules[id] = { code: node.code ?? '', kind: 'wxs' };
          scriptEntries.add(id);
          node.a.src = id;
          delete node.code;
        }
      }
      rewriteTemplateRefs(node.c, file);
    }
  };

  const rewriteUrl = (raw, fromFile) => {
    if (!raw || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(raw) || raw.includes('{{')) return raw;
    const target = resolveRelative(fromFile, raw.split(/[?#]/)[0]);
    return `asset/${target}`;
  };
  const resolveImport = (spec, fromFile) => {
    const target = resolveRelative(fromFile, spec.endsWith('.wxss') ? spec : `${spec}.wxss`);
    const source = files.get(target);
    if (source === undefined) addError(fromFile, `@import "${spec}" was not found`, undefined, undefined, 'MISSING_STYLE');
    else dependencyFiles.add(target);
    return source === undefined ? null : { file: target, source };
  };
  const addStyle = (file, scope) => {
    const source = files.get(file);
    if (source === undefined) return '';
    dependencyFiles.add(file);
    try {
      const result = compileWxss({ source, file, scope, resolveImport, rewriteUrl });
      styles.push(`/* ${file} */\n${result.css}`);
      warnings.push(...result.warnings);
      return result.css;
    } catch (error) {
      addError(file, `WXSS: ${error.message}`);
      return '';
    }
  };
  addStyle('app.wxss', { kind: 'app' });

  const describeUnit = (id, kind) => {
    const jsonFile = `${id}.json`;
    const json = readConfig(jsonFile);
    if (!files.has(`${id}.wxml`)) addError(`${id}.wxml`, `${kind} template is missing`);
    const js = files.has(`${id}.js`) ? `${id}.js` : files.has(`${id}.ts`) ? `${id}.ts` : null;
    if (!js) addError(`${id}.js`, `${kind} script is missing (.js or .ts)`);
    else scriptEntries.add(js);
    if (kind === 'component' && json.component !== true) warnings.push({ file: jsonFile, message: '"component": true is missing' });
    parseTemplate(id);
    const css = addStyle(`${id}.wxss`, kind === 'page' ? { kind: 'page', id } : { kind: 'component', id });
    if (kind === 'component') componentStyles[id] = css;
    units[id] = {
      kind,
      json: {
        navigationBarTitleText: json.navigationBarTitleText,
        navigationBarBackgroundColor: json.navigationBarBackgroundColor,
        navigationBarTextStyle: json.navigationBarTextStyle,
        navigationStyle: json.navigationStyle,
        backgroundColor: json.backgroundColor,
        enablePullDownRefresh: json.enablePullDownRefresh,
        styleIsolation: json.styleIsolation,
        addGlobalClass: json.addGlobalClass,
        componentGenerics: genericConfig(json.componentGenerics, jsonFile),
      },
      js,
      using: { ...globalUsing, ...describeUsing(json.usingComponents, jsonFile) },
    };
  };
  for (const page of pages) describeUnit(page, 'page');
  while (queue.length) {
    const id = queue.shift();
    if (!units[id]) describeUnit(id, 'component');
  }

  // --- tabBar ------------------------------------------------------------------------------
  let tabBar;
  if (app.tabBar && Array.isArray(app.tabBar.list)) {
    const list = app.tabBar.list.filter((item) => item && typeof item.pagePath === 'string');
    if (list.length < 2 || list.length > 5) addError('app.json', 'tabBar.list must contain 2-5 items');
    for (const item of list) {
      if (!pages.includes(item.pagePath.replace(/^\//, ''))) addError('app.json', `tabBar pagePath "${item.pagePath}" is not listed in pages`);
      for (const key of ['iconPath', 'selectedIconPath']) {
        if (typeof item[key] === 'string' && item[key] && !/^https?:/.test(item[key])) {
          const target = path.posix.normalize(item[key].replace(/^\//, ''));
          const exists = assets.some((asset) => asset.path === target);
          if (!exists) warnings.push({ file: 'app.json', message: `tabBar ${key} "${item[key]}" does not exist` });
        }
      }
    }
    tabBar = {
      color: app.tabBar.color ?? '#7A7E83',
      selectedColor: app.tabBar.selectedColor ?? '#07c160',
      backgroundColor: app.tabBar.backgroundColor ?? '#ffffff',
      borderStyle: app.tabBar.borderStyle ?? 'black',
      position: app.tabBar.position ?? 'bottom',
      custom: app.tabBar.custom === true,
      list: list.map((item) => ({
        pagePath: item.pagePath.replace(/^\//, ''),
        text: item.text ?? '',
        iconPath: typeof item.iconPath === 'string' && item.iconPath ? rewriteUrl(`/${item.iconPath.replace(/^\//, '')}`, 'app.json') : '',
        selectedIconPath: typeof item.selectedIconPath === 'string' && item.selectedIconPath ? rewriteUrl(`/${item.selectedIconPath.replace(/^\//, '')}`, 'app.json') : '',
      })),
    };
    if (tabBar.custom) warnings.push({ file: 'app.json', message: 'custom tabBar is rendered with the default tabBar in preview' });
  }
  if (app.lazyCodeLoading !== 'requiredComponents') {
    warnings.push({ file: 'app.json', message: 'lazyCodeLoading "requiredComponents" is not set; real devices may white-screen' });
  }

  // --- modules -----------------------------------------------------------------------------
  const graph = compileModuleGraph({ files, entries: scriptEntries, inlineModules, readJson, addError, warnings });
  for (const file of graph.dependencies) dependencyFiles.add(file);
  const modules = graph.modules;

  const window = {
    navigationBarTitleText: app.window?.navigationBarTitleText ?? '',
    navigationBarBackgroundColor: app.window?.navigationBarBackgroundColor ?? '#000000',
    navigationBarTextStyle: app.window?.navigationBarTextStyle ?? 'white',
    navigationStyle: app.window?.navigationStyle ?? 'default',
    backgroundColor: app.window?.backgroundColor ?? '#ffffff',
  };
  const styleV2 = app.style === 'v2';

  const hash = createHash('sha256').update(COMPILER_FINGERPRINT).update('\0');
  hash.update(`kind:miniprogram\0runtime:${MINIPROGRAM_RUNTIME_VERSION}\0`);
  for (const [file, source] of project.configuration) hash.update(`config:${file}\0${source}\0`);
  for (const file of [...dependencyFiles].sort()) hash.update(`source:${file}\0${files.get(file)}\0`);
  for (const asset of assets) hash.update(`asset:${asset.path}\0${asset.bytes}\0${asset.sha256}\0`);
  const buildId = hash.digest('hex').slice(0, 16);

  const warningKeys = new Set();
  const buildWarnings = warnings.filter((warning) => {
    if (!warning.code?.startsWith('WXSS_')) return true;
    const key = warning.file + ':' + warning.code;
    if (warningKeys.has(key)) return false;
    warningKeys.add(key); return true;
  });
  const payload = { buildId, projectKind: 'miniprogram', runtimeVersion: MINIPROGRAM_RUNTIME_VERSION, entryPage, pages, window, tabBar: tabBar ?? null, styleV2, units, templates, componentStyles, modules };
  await assertSnapshotIdentity(captured);
  return {
    project,
    buildId,
    compilerFingerprint: COMPILER_FINGERPRINT,
    dependencyFiles: [...dependencyFiles].sort(),
    assets,
    errors,
    warnings: buildWarnings,
    manifest: { projectKind: 'miniprogram', projectName: project.projectName, pages, entryPage, tabBar: tabBar ?? null, window, componentCount: Object.values(units).filter((u) => u.kind === 'component').length },
    payload,
    css: styles.join('\n'),
  };
}

/** Resolves a requested asset path under the source root, refusing escapes and non-assets. */
export async function resolveAsset(sourceRoot, relativePath) {
  const clean = path.posix.normalize(relativePath).replace(/^\/+/, '');
  if (!clean || clean.startsWith('..') || clean.includes('\0')) return null;
  if (!ASSET_EXTENSIONS.has(path.posix.extname(clean).toLowerCase())) return null;
  const candidate = path.resolve(sourceRoot, ...clean.split('/'));
  if (!isInside(sourceRoot, candidate)) return null;
  try {
    const real = await realpath(candidate);
    if (!isInside(sourceRoot, real)) return null;
    const info = await stat(real);
    return info.isFile() && info.size <= 20 * 1024 * 1024 ? real : null;
  } catch {
    return null;
  }
}
