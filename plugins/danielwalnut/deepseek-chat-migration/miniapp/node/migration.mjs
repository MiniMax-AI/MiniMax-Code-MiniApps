import { spawn } from 'node:child_process';
import { access, readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';

const MAX_OUTPUT = 64 * 1024;

export function defaultTargetDataDir(home = homedir()) {
  return join(home, '.minimax');
}

export function normalizeTargetDataDir(value, home = homedir()) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return defaultTargetDataDir(home);
  const expanded = raw === '~' ? home
    : raw.startsWith(`~${sep}`) || raw.startsWith('~/') || raw.startsWith('~\\')
      ? join(home, raw.slice(2))
      : raw;
  if (!isAbsolute(expanded)) throw migrationError('target_data_dir_must_be_absolute');
  return resolve(expanded);
}

export async function findMigrationPlugin(home = homedir()) {
  const minimaxRoot = join(home, '.minimax');
  const directCandidates = [
    join(minimaxRoot, 'plugins', 'agent-session-migration'),
    join(minimaxRoot, 'marketplace', 'agent-session-migration'),
    join(minimaxRoot, 'marketplace', 'plugins', 'agent-session-migration'),
    join(minimaxRoot, 'marketplace-cache', 'agent-session-migration'),
    join(minimaxRoot, 'cache', 'marketplace', 'agent-session-migration'),
    join(minimaxRoot, 'plugins', '.cache', 'agent-session-migration'),
  ];
  for (const candidate of directCandidates) {
    if (await hasMigrationScript(candidate)) return candidate;
  }
  const searchRoots = [
    join(minimaxRoot, 'plugins'),
    join(minimaxRoot, 'marketplace'),
    join(minimaxRoot, 'marketplace-cache'),
    join(minimaxRoot, 'cache'),
  ];
  for (const root of searchRoots) {
    const found = await searchPluginCache(root);
    if (found) return found;
  }
  return null;
}

export function buildMigrationArgs({
  scriptPath,
  action,
  sourcePath,
  sessionIds,
  reportPath,
  targetDataDir,
  agentName,
}) {
  if (action !== 'plan' && action !== 'apply') throw migrationError('invalid_action');
  if (!Array.isArray(sessionIds) || !sessionIds.length || sessionIds.length > 1000) {
    throw migrationError('invalid_sessions');
  }
  const cleanIds = sessionIds.map(validateSessionId);
  const cleanAgent = validateAgentName(agentName);
  return [
    scriptPath,
    action,
    '--source', 'deepseek',
    '--source-db', sourcePath,
    ...cleanIds.flatMap((id) => ['--session', id]),
    '--report', reportPath,
    '--target-data-dir', targetDataDir,
    '--agent', cleanAgent,
  ];
}

export async function runMigrationCommand({
  python = 'python3',
  scriptPath,
  action,
  sourcePath,
  sessionIds,
  reportPath,
  targetDataDir,
  agentName,
  signal,
}) {
  const args = buildMigrationArgs({
    scriptPath,
    action,
    sourcePath,
    sessionIds,
    reportPath,
    targetDataDir,
    agentName,
  });
  const processResult = await spawnAndWait(python, args, signal);
  let report;
  try {
    report = JSON.parse(await readFile(reportPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw migrationError('migration_report_missing', {
        exitCode: processResult.exitCode,
        stderr: processResult.stderr,
      });
    }
    throw migrationError('migration_report_invalid');
  }
  const parsed = parseMigrationReport(report, sessionIds, action);
  return {
    ...parsed,
    exitCode: processResult.exitCode,
    stderr: processResult.stderr,
    ok: processResult.exitCode === 0 && parsed.sessions.every((item) => item.status !== 'failed'),
  };
}

export function parseMigrationReport(report, requestedIds = [], action = 'plan') {
  const candidates = Array.isArray(report) ? report
    : firstArray(
      report?.sessions,
      report?.results,
      report?.items,
      report?.migrations,
      report?.entries,
      report?.plan?.sessions,
      report?.result?.sessions,
      report?.report?.sessions,
    );
  const byId = new Map();
  for (const item of candidates || []) {
    if (!item || typeof item !== 'object') continue;
    const sessionId = String(item.session_id ?? item.sessionId ?? item.source_id ?? item.sourceId ?? item.id ?? '');
    if (!sessionId) continue;
    const failure = item.ok === false || item.success === false || Boolean(item.error)
      || ['failed', 'error', 'invalid'].includes(String(item.status ?? '').toLowerCase());
    const success = item.ok === true || item.success === true
      || ['success', 'succeeded', 'applied', 'imported', 'ready', 'planned'].includes(String(item.status ?? '').toLowerCase());
    byId.set(sessionId, {
      sessionId,
      status: failure ? 'failed' : success ? (action === 'plan' ? 'planned' : 'success') : (action === 'plan' ? 'planned' : 'success'),
      message: String(item.message ?? item.error ?? item.reason ?? ''),
      targetSessionId: item.target_session_id ?? item.targetSessionId ?? null,
    });
  }
  const sessions = requestedIds.map((id) => byId.get(String(id)) || ({
    sessionId: String(id),
    status: report?.ok === false || report?.success === false ? 'failed' : action === 'plan' ? 'planned' : 'success',
    message: String(report?.error ?? report?.message ?? ''),
    targetSessionId: null,
  }));
  return {
    sessions,
    summary: {
      total: sessions.length,
      succeeded: sessions.filter((item) => item.status === 'success').length,
      planned: sessions.filter((item) => item.status === 'planned').length,
      failed: sessions.filter((item) => item.status === 'failed').length,
    },
    report,
  };
}

function validateSessionId(value) {
  if (typeof value !== 'string' || !value || value.startsWith('-') || value.length > 256
    || /[\u0000-\u001f\u007f]/.test(value)) {
    throw migrationError('invalid_session_id');
  }
  return value;
}

function validateAgentName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().startsWith('-') || value.length > 128
    || /[\u0000-\u001f\u007f]/.test(value)) {
    throw migrationError('agent_name_required');
  }
  return value.trim();
}

async function hasMigrationScript(pluginRoot) {
  try {
    await access(join(pluginRoot, 'scripts', 'migrate.py'));
    return true;
  } catch {
    return false;
  }
}

async function searchPluginCache(root) {
  const queue = [{ path: root, depth: 0 }];
  let visited = 0;
  while (queue.length && visited < 5000) {
    const current = queue.shift();
    let entries;
    try {
      entries = await readdir(current.path, { withFileTypes: true });
    } catch {
      continue;
    }
    visited += entries.length;
    if (await hasMigrationScript(current.path)
      && current.path.split(sep).includes('agent-session-migration')) {
      return current.path;
    }
    if (current.depth >= 5) continue;
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        queue.push({ path: join(current.path, entry.name), depth: current.depth + 1 });
      }
    }
  }
  return null;
}

function firstArray(...values) {
  return values.find((value) => Array.isArray(value)) || [];
}

function spawnAndWait(command, args, signal) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
      signal,
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      if (stderr.length < MAX_OUTPUT) stderr += chunk.slice(0, MAX_OUTPUT - stderr.length);
    });
    child.once('error', (error) => {
      reject(migrationError(
        error.code === 'ENOENT' ? 'python3_not_found'
          : error.name === 'AbortError' ? 'migration_cancelled'
            : 'migration_spawn_failed',
      ));
    });
    child.once('close', (exitCode) => {
      resolvePromise({ exitCode: exitCode ?? -1, stderr: stderr.trim() });
    });
  });
}

function migrationError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  return error;
}
