import { realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const MAX_PROJECTS = 100;
const SENSITIVE_SEGMENTS = new Set([
  '.ssh', '.aws', '.azure', '.gnupg', '.gcloud', '.kube', '.docker', '.config', '.local',
  '.git', '.hg', '.svn', '.minimax', '.workbuddy',
]);

export class ProjectAccessError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProjectAccessError';
    this.code = code;
  }
}

export function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function requireAbsolute(candidate) {
  if (typeof candidate !== 'string' || !candidate.trim() || candidate.includes('\0') || !path.isAbsolute(candidate)) {
    throw new ProjectAccessError('INVALID_PROJECT_PATH', 'Project path must be an absolute directory path.');
  }
  return path.resolve(candidate);
}

async function directoryIdentity(candidate) {
  let resolved;
  let info;
  try {
    resolved = await realpath(candidate);
    info = await stat(resolved, { bigint: true });
  } catch {
    throw new ProjectAccessError('PROJECT_NOT_FOUND', 'The project directory is unavailable.');
  }
  if (!info.isDirectory()) throw new ProjectAccessError('PROJECT_NOT_DIRECTORY', 'Project path must be a directory.');
  return { path: resolved, dev: String(info.dev), ino: String(info.ino) };
}

function sameDirectory(left, right) {
  return left.path === right.path && left.dev === right.dev && left.ino === right.ino;
}

async function canonicalOrResolved(value) {
  try { return await realpath(value); } catch { return path.resolve(value); }
}

async function createPathPolicy() {
  const home = await canonicalOrResolved(os.homedir());
  const temp = await canonicalOrResolved(os.tmpdir());
  const volume = path.parse(home).root;
  const broad = new Set([volume, home, temp]);
  for (const name of ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Movies', 'Music', 'Public', 'Projects', 'Project', 'workspace', 'workspaces']) {
    broad.add(await canonicalOrResolved(path.join(home, name)));
  }
  for (const name of ['Users', 'home', 'tmp', 'private', 'Volumes', 'mnt', 'media', 'opt', 'var']) {
    broad.add(await canonicalOrResolved(path.join(volume, name)));
  }
  const sensitive = [
    ...['Applications', 'System', 'Library', 'usr', 'bin', 'sbin', 'etc', 'dev', 'proc', 'sys'].map((name) => path.join(volume, name)),
    ...['Library', 'Applications', 'AppData'].map((name) => path.join(home, name)),
    ...['db', 'root', 'log', 'run', 'spool'].map((name) => path.join(volume, 'var', name)),
  ];
  if (process.platform === 'win32') {
    for (const name of ['SystemRoot', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData']) {
      if (process.env[name]) sensitive.push(process.env[name]);
    }
  }
  const forbiddenTrees = await Promise.all(sensitive.map(canonicalOrResolved));
  return (candidate) => {
    const parts = candidate.split(path.sep).map((part) => part.toLowerCase());
    const hasSensitiveSegment = parts.some((part, index) => {
      if (SENSITIVE_SEGMENTS.has(part) || part.endsWith('.app')) return true;
      // Managed checkouts are source projects; the adjacent Codex state is not.
      return part === '.codex' && (parts[index + 1] !== 'worktrees' || parts.length <= index + 3);
    });
    const inTemporaryProject = isWithin(temp, candidate) && candidate !== temp;
    const inSensitiveTree = forbiddenTrees.some((root) => isWithin(root, candidate))
      && !(process.platform === 'win32' && inTemporaryProject);
    if (candidate === path.parse(candidate).root || broad.has(candidate) || isWithin(candidate, home)
      || isWithin(candidate, temp) || hasSensitiveSegment || inSensitiveTree) {
      throw new ProjectAccessError('PROJECT_PATH_FORBIDDEN', 'Select a specific project, not a system, home, application, or private configuration directory.');
    }
  };
}

// The Host admits explicit open calls. This layer validates paths and pins
// directory identity for this process; it never reads or writes legacy grants.
export async function createProjectAccess(pluginRoot, _dataDir) {
  const packageRoot = await directoryIdentity(pluginRoot);
  const demos = [await directoryIdentity(path.join(packageRoot.path, 'miniapp/node/demo'))];
  for (const name of ['demo-game-2d', 'demo-game-webgl']) {
    try { demos.push(await directoryIdentity(path.join(packageRoot.path, 'miniapp/node', name))); }
    catch (error) { if (error.code !== 'PROJECT_NOT_FOUND') throw error; }
  }
  const checkPath = await createPathPolicy();
  const projects = new Map();
  const aliases = new Map();
  let pending = Promise.resolve();

  const inspect = async (candidate) => {
    const requested = requireAbsolute(candidate);
    const current = await directoryIdentity(requested);
    const demo = demos.find((entry) => entry.path === current.path);
    if (demo) {
      if (!sameDirectory(demo, current) || !sameDirectory(packageRoot, await directoryIdentity(packageRoot.path))) {
        throw new ProjectAccessError('PROJECT_ACCESS_CHANGED', 'The bundled example directory changed. Reopen the plugin through its normal Host lifecycle.');
      }
    } else {
      // A copied user project inside a package is not another trusted demo.
      if (isWithin(packageRoot.path, requested) || isWithin(packageRoot.path, current.path)) {
        throw new ProjectAccessError('PROJECT_PATH_FORBIDDEN', 'Select a project outside the plugin package; only exact bundled example roots are supported.');
      }
      checkPath(current.path);
    }
    const alias = aliases.get(requested);
    const previous = projects.get(current.path);
    if ((alias && !sameDirectory(alias, current)) || (previous && !sameDirectory(previous, current))) {
      throw new ProjectAccessError('PROJECT_ACCESS_CHANGED', 'The opened project directory changed. Existing previews cannot follow a replacement directory.');
    }
    return { requested, current, demo: !!demo };
  };
  const assertAccess = async (candidate) => (await inspect(candidate)).current.path;
  assertAccess.identity = async (candidate) => ({ ...(await inspect(candidate)).current });
  assertAccess.remember = (candidate, expected) => {
    const operation = pending.then(async () => {
      const { requested, current, demo } = await inspect(candidate);
      if (expected && !sameDirectory(expected, current)) {
        throw new ProjectAccessError('PROJECT_ACCESS_CHANGED', 'The project directory changed while being selected. Retry with the current project path.');
      }
      if (!demo && !projects.has(current.path) && projects.size >= MAX_PROJECTS) {
        throw new ProjectAccessError('PROJECT_ACCESS_LIMIT', 'Too many project identities are active in this preview process.');
      }
      if (!demo) {
        if (requested !== current.path && !aliases.has(requested) && aliases.size >= MAX_PROJECTS * 2) {
          throw new ProjectAccessError('PROJECT_ACCESS_LIMIT', 'Too many project path aliases are active in this preview process.');
        }
        projects.set(current.path, current);
        // Canonical paths are also remembered so future reads never need the
        // original spelling to detect a directory substitution.
        aliases.set(current.path, current);
        if (requested !== current.path) {
          aliases.set(requested, current);
        }
      }
      return current.path;
    });
    pending = operation.catch(() => undefined);
    return operation;
  };
  assertAccess.list = async () => {
    await pending;
    return [...projects.values()].map((entry) => ({ path: entry.path }));
  };
  return assertAccess;
}
