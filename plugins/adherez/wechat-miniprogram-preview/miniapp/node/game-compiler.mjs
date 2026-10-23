import { createHash } from 'node:crypto';
import { compileModuleGraph } from './module-graph.mjs';
import { parseProjectJson } from './project-json.mjs';

export const GAME_RUNTIME_VERSION = '2';

export function compileGame(snapshot, compilerFingerprint) {
  const { project, files, assets } = snapshot;
  const errors = [];
  const warnings = [...project.warnings];
  const dependencies = new Set();
  const parsed = new Map();
  const addError = (file, message, line, column, code) => errors.push({ file, message, ...(line ? { line } : {}), ...(column ? { column } : {}), ...(code ? { code } : {}) });
  const readJson = (file, required = false) => {
    if (parsed.has(file)) return parsed.get(file);
    const source = files.get(file);
    if (source === undefined) { if (required) addError(file, 'file is missing', undefined, undefined, 'MISSING_CONFIG'); return undefined; }
    dependencies.add(file);
    try {
      const result = parseProjectJson(source, file);
      warnings.push(...result.warnings); parsed.set(file, result.value); return result.value;
    } catch (error) {
      parsed.set(file, undefined); addError(file, error.message, error.line, error.column, error.code); return undefined;
    }
  };
  let config = readJson('game.json', true);
  if (config === undefined) config = {};
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    addError('game.json', 'configuration must contain a JSON object', undefined, undefined, 'INVALID_CONFIG'); config = {};
  }
  const warn = (code, message) => warnings.push({ file: 'game.json', code, message });
  const orientation = config.deviceOrientation ?? 'portrait';
  if (!['portrait', 'landscape'].includes(orientation)) addError('game.json', 'deviceOrientation must be portrait or landscape', undefined, undefined, 'INVALID_CONFIG');
  if (Object.hasOwn(config, 'subpackages') || Object.hasOwn(config, 'subPackages')) warn('MINIGAME_SUBPACKAGES_UNSUPPORTED', 'Mini Game subpackage loading is not implemented in local preview; only the entry module graph is bundled.');
  if (Object.hasOwn(config, 'workers') || Object.hasOwn(config, 'worker')) warn('MINIGAME_WORKERS_UNSUPPORTED', 'Mini Game workers are not started in local preview.');
  if (Object.hasOwn(config, 'openDataContext')) warn('MINIGAME_OPEN_DATA_UNSUPPORTED', 'The Mini Game open data context is not implemented in local preview.');
  if (Object.keys(config).some((key) => /wasm|webassembly/i.test(key))) warn('MINIGAME_WASM_UNSUPPORTED', 'WebAssembly configuration and local .wasm payloads are not supported in this preview version.');
  if (Object.hasOwn(config, 'plugins')) warn('MINIGAME_PLUGINS_UNSUPPORTED', 'Mini Game plugin packages are not loaded or installed by local preview.');
  const supported = new Set(['deviceOrientation', 'showStatusBar', 'subpackages', 'subPackages', 'workers', 'worker', 'openDataContext', 'plugins']);
  const unknown = Object.keys(config).filter((key) => !supported.has(key) && !/wasm|webassembly/i.test(key));
  if (unknown.length) warn('MINIGAME_CONFIG_LIMITED', 'Additional game.json configuration is not emulated: ' + unknown.slice(0, 20).map((key) => key.slice(0, 100)).join(', ') + (unknown.length > 20 ? ', ...' : ''));
  if (Object.hasOwn(config, 'showStatusBar')) warn('MINIGAME_STATUS_BAR_LIMITED', 'showStatusBar affects capsule placement only; native status-bar rendering is not emulated.');
  const graph = compileModuleGraph({ files, entries: ['game.js'], inlineModules: {}, readJson, addError, warnings });
  for (const file of graph.dependencies) dependencies.add(file);
  if (!files.has('game.js') && !files.has('game.ts')) {
    const missing = errors.find((error) => error.file === 'game.js' && error.code === 'MISSING_MODULE');
    if (missing) missing.message = 'Mini Game entry is missing (game.js or game.ts)';
  }
  const game = { deviceOrientation: ['portrait', 'landscape'].includes(orientation) ? orientation : 'portrait' };
  if (config.showStatusBar === true) game.showStatusBar = true;
  const hash = createHash('sha256').update(compilerFingerprint).update('\0').update(`kind:minigame\0runtime:${GAME_RUNTIME_VERSION}\0`);
  for (const [file, source] of project.configuration) hash.update(`config:${file}\0${source}\0`);
  for (const file of [...dependencies].sort()) hash.update(`source:${file}\0${files.get(file)}\0`);
  for (const asset of assets) hash.update(`asset:${asset.path}\0${asset.bytes}\0${asset.sha256}\0`);
  const buildId = hash.digest('hex').slice(0, 16);
  return {
    project, buildId, compilerFingerprint, dependencyFiles: [...dependencies].sort(), assets, errors, warnings,
    manifest: { projectKind: 'minigame', projectName: project.projectName, pages: [], entryPage: null, game, componentCount: 0 },
    payload: { projectKind: 'minigame', runtimeVersion: GAME_RUNTIME_VERSION, buildId, entryModule: 'game.js', game, modules: graph.modules },
    css: '',
  };
}
