// @ts-check

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_OUTPUT = 64 * 1024;
const MAX_LINE = 1024 * 1024;
/** Sessions per write transaction; each batch commit is one progress step in the UI. */
export const BATCH_SIZE = 10;

/** The importer ships inside this Mini App; no other plugin is needed. */
export const IMPORTER_SCRIPT = fileURLToPath(new URL('../python/import_deepseek.py', import.meta.url));
export const TARGET_AGENT = 'mavis';

export function defaultTargetDataDir(home = homedir()) {
  return join(home, '.minimax');
}

export function defaultWorkspace(home = homedir()) {
  return join(home, 'DeepSeek');
}

export function defaultPython(platform = process.platform) {
  return platform === 'win32' ? 'python' : 'python3';
}

export function buildMigrationArgs({
  scriptPath = IMPORTER_SCRIPT,
  action,
  sourcePath,
  sessionIds,
  reportPath,
  targetDataDir,
  agentName = TARGET_AGENT,
  workspace,
  batchSize = BATCH_SIZE,
}) {
  if (action !== 'plan' && action !== 'apply') throw migrationError('invalid_action');
  if (!Array.isArray(sessionIds) || !sessionIds.length || sessionIds.length > 1000) {
    throw migrationError('invalid_sessions');
  }
  for (const [name, value] of [['sourcePath', sourcePath], ['reportPath', reportPath], ['targetDataDir', targetDataDir], ['workspace', workspace]]) {
    if (typeof value !== 'string' || !value) throw migrationError('invalid_arguments', { message: `${name} is required` });
  }
  return [
    scriptPath,
    action,
    '--source', sourcePath,
    ...sessionIds.map(validateSessionId).flatMap((id) => ['--session', id]),
    '--report', reportPath,
    '--data-dir', targetDataDir,
    '--agent', validateAgentName(agentName),
    '--workspace', workspace,
    '--batch-size', String(validateBatchSize(batchSize)),
    // Imports go to the DeepSeek project; if it was removed from the sidebar,
    // importing selected chats into it brings it back.
    '--restore-projects',
  ];
}

/**
 * Runs the bundled importer. `plan` writes a fresh report; `apply` must be given the
 * same report path, which binds it to the previewed sessions and options.
 */
export async function runMigrationCommand({
  python = defaultPython(),
  scriptPath = IMPORTER_SCRIPT,
  action,
  sourcePath,
  sessionIds,
  reportPath,
  targetDataDir = defaultTargetDataDir(),
  agentName = TARGET_AGENT,
  workspace = defaultWorkspace(),
  batchSize = BATCH_SIZE,
  signal,
  onProgress,
}) {
  const args = buildMigrationArgs({ scriptPath, action, sourcePath, sessionIds, reportPath, targetDataDir, agentName, workspace, batchSize });
  const onLine = typeof onProgress === 'function'
    ? (line) => {
      const event = parseProgressLine(line);
      if (event) onProgress(event);
    }
    : null;
  const processResult = await spawnAndWait(python, args, signal, onLine);
  let report;
  try {
    report = JSON.parse(await readFile(reportPath, 'utf8'));
  } catch (error) {
    const detail = importerError(processResult.stderr);
    if (error?.code === 'ENOENT') {
      throw migrationError('migration_failed', {
        message: detail || `导入脚本没有生成报告（exit ${processResult.exitCode}）。`,
        exitCode: processResult.exitCode,
        stderr: processResult.stderr,
      });
    }
    throw migrationError('migration_report_invalid', { message: detail || undefined });
  }
  const parsed = parseMigrationReport(report, sessionIds);
  const failedRun = processResult.exitCode !== 0 && processResult.exitCode !== 2;
  return {
    ...parsed,
    exitCode: processResult.exitCode,
    error: failedRun ? importerError(processResult.stderr) || `exit ${processResult.exitCode}` : '',
    ok: processResult.exitCode === 0 && parsed.summary.failed === 0,
  };
}

const STATUS = {
  ready: 'planned',
  imported: 'success',
  'already-imported': 'skipped',
  incompatible: 'failed',
  failed: 'failed',
  running: 'failed',
};

/** Maps the importer's report entries onto the UI's planned/success/skipped/failed. */
export function parseMigrationReport(report, requestedIds = []) {
  const byId = new Map();
  for (const entry of Array.isArray(report?.sessions) ? report.sessions : []) {
    if (!entry || typeof entry.sourceId !== 'string') continue;
    const status = STATUS[entry.status] || 'failed';
    byId.set(entry.sourceId, {
      sessionId: entry.sourceId,
      status,
      rawStatus: String(entry.status ?? ''),
      message: entry.error ? String(entry.error)
        : status === 'skipped' ? '已导入过，跳过'
          : entry.status === 'running' ? '上次导入被中断，重新导入即可继续' : '',
      targetSessionId: typeof entry.plan?.targetId === 'string' ? entry.plan.targetId : null,
      title: typeof entry.plan?.title === 'string' ? entry.plan.title : null,
      messageCount: Number.isInteger(entry.plan?.messageCount) ? entry.plan.messageCount : null,
      warnings: Array.isArray(entry.plan?.warnings) ? entry.plan.warnings.length : 0,
    });
  }
  const sessions = requestedIds.map((id) => byId.get(String(id)) || {
    sessionId: String(id),
    status: 'failed',
    rawStatus: 'missing',
    message: '报告里没有这个会话',
    targetSessionId: null,
    title: null,
    messageCount: null,
    warnings: 0,
  });
  const count = (status) => sessions.filter((item) => item.status === status).length;
  return {
    sessions,
    summary: {
      total: sessions.length,
      planned: count('planned'),
      succeeded: count('success'),
      skipped: count('skipped'),
      failed: count('failed'),
    },
    state: typeof report?.state === 'string' ? report.state : '',
    // No database copy: one small undo journal per apply run.
    undo: typeof report?.undo === 'string' && report.undo ? report.undo : null,
  };
}

/**
 * One stderr line from `apply`: `{"event":"start"|"progress", ...}`.
 * Anything else (summaries, tracebacks) is not progress and yields null.
 */
export function parseProgressLine(line) {
  let value;
  try {
    value = JSON.parse(String(line).trim());
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const count = (n) => Number.isInteger(n) && n >= 0 ? n : 0;
  if (value.event === 'start') return { event: 'start', total: count(value.total) };
  if (value.event !== 'progress') return null;
  const sessions = (Array.isArray(value.sessions) ? value.sessions : [])
    .filter((item) => item && typeof item.sourceId === 'string')
    .map((item) => ({ sessionId: item.sourceId, status: STATUS[item.status] || 'failed' }));
  return { event: 'progress', done: count(value.done), total: count(value.total), sessions };
}

/** Folds progress events into what the page polls: phase, done/total, landed rows. */
export function createProgress(total = 0) {
  return { phase: 'starting', done: 0, total, sessions: {} };
}

export function applyProgressEvent(progress, event) {
  if (!event) return progress;
  if (event.event === 'start') {
    progress.phase = 'starting';
    progress.total = event.total;
  } else if (event.event === 'progress') {
    progress.phase = 'importing';
    progress.done = Math.min(event.done, event.total);
    progress.total = event.total;
    for (const item of event.sessions) progress.sessions[item.sessionId] = item.status;
  }
  return progress;
}

/** The importer prints `{"error": ...}` as JSON on stderr for contract errors. */
export function importerError(stderr = '') {
  const lines = String(stderr).trim().split('\n').filter(Boolean);
  for (const line of lines.reverse()) {
    try {
      const value = JSON.parse(line);
      if (value && typeof value.error === 'string') return value.error;
    } catch {
      // Progress or interpreter output; fall through to the raw last line.
    }
  }
  return lines[0] || '';
}

function validateSessionId(value) {
  if (typeof value !== 'string' || !value || value.startsWith('-') || value.length > 256
    || /[\u0000-\u001f\u007f]/.test(value)) {
    throw migrationError('invalid_session_id');
  }
  return value;
}

function validateBatchSize(value) {
  if (!Number.isInteger(value) || value < 1 || value > 100) throw migrationError('invalid_arguments', { message: 'batchSize must be 1-100' });
  return value;
}

function validateAgentName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().startsWith('-') || value.length > 128
    || /[\u0000-\u001f\u007f/\\]/.test(value)) {
    throw migrationError('invalid_agent');
  }
  return value.trim();
}

/**
 * Undoes one apply run from its journal. Resolves with the importer's summary; rejects
 * with `undo_refused` (and the changed sessions) when sessions were used since import.
 */
export async function runUndoCommand({
  python = defaultPython(),
  scriptPath = IMPORTER_SCRIPT,
  journalPath,
  targetDataDir = defaultTargetDataDir(),
  force = false,
  signal,
}) {
  if (typeof journalPath !== 'string' || !journalPath || journalPath.startsWith('-')) throw migrationError('invalid_arguments', { message: 'journalPath is required' });
  const args = [scriptPath, 'undo', '--run', journalPath, '--data-dir', targetDataDir, ...(force ? ['--force'] : [])];
  const result = await spawnAndWait(python, args, signal, null, true);
  if (result.exitCode === 3) {
    const detail = lastJson(result.stderr);
    const modified = Array.isArray(detail?.modified) ? detail.modified : [];
    throw migrationError('undo_refused', {
      message: `有 ${modified.length} 个导入的会话在导入后又用过（比如继续聊了），这次没有撤销任何内容。`,
      modified: modified.map((item) => ({ targetSessionId: String(item?.targetId ?? ''), sessionId: String(item?.sourceId ?? ''), changed: Array.isArray(item?.changed) ? item.changed.map(String) : [] })),
    });
  }
  if (result.exitCode !== 0) {
    throw migrationError('undo_failed', { message: importerError(result.stderr) || `撤销失败（exit ${result.exitCode}）。` });
  }
  const summary = lastJson(result.stdout);
  if (!summary || summary.status !== 'undone') throw migrationError('undo_failed', { message: '撤销脚本没有返回结果。' });
  return {
    removed: Number.isInteger(summary.removed) ? summary.removed : 0,
    alreadyAbsent: Number.isInteger(summary.alreadyAbsent) ? summary.alreadyAbsent : 0,
    forced: Number.isInteger(summary.forced) ? summary.forced : 0,
    keptDirectories: Array.isArray(summary.keptDirectories) ? summary.keptDirectories.map(String) : [],
    warnings: Array.isArray(summary.warnings) ? summary.warnings.map(String) : [],
    sessions: (Array.isArray(summary.sessions) ? summary.sessions : []).map((item) => ({ sessionId: String(item?.sourceId ?? ''), targetSessionId: String(item?.targetId ?? '') })),
  };
}

/**
 * The DeepSeek project as the runtime DB sees it: how many sessions it holds and the
 * most recently active one, so the page can open it before any upload.
 */
export async function readProject({
  python = defaultPython(),
  scriptPath = IMPORTER_SCRIPT,
  targetDataDir = defaultTargetDataDir(),
  workspace = defaultWorkspace(),
  signal,
} = {}) {
  const result = await spawnAndWait(python, [scriptPath, 'project', '--data-dir', targetDataDir, '--workspace', workspace], signal, null, true);
  const summary = lastJson(result.stdout);
  if (result.exitCode !== 0 || !summary) throw migrationError('project_unavailable', { message: importerError(result.stderr) || 'project lookup failed' });
  return {
    sessionCount: Number.isInteger(summary.sessionCount) ? summary.sessionCount : 0,
    latestSessionId: typeof summary.latestSessionId === 'string' ? summary.latestSessionId : null,
  };
}

function lastJson(text = '') {
  const lines = String(text).trim().split('\n').filter(Boolean).reverse();
  for (const line of lines) {
    try {
      const value = JSON.parse(line);
      if (value && typeof value === 'object') return value;
    } catch {
      // not JSON
    }
  }
  return null;
}

function spawnAndWait(command, args, signal, onLine, captureStdout = false) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ['ignore', captureStdout ? 'pipe' : 'ignore', 'pipe'],
      windowsHide: true,
      signal,
    });
    let stderr = '';
    let stdout = '';
    let pending = '';
    if (captureStdout) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        if (stdout.length < MAX_OUTPUT) stdout += chunk.slice(0, MAX_OUTPUT - stdout.length);
      });
    }
    const deliver = (line) => {
      if (!onLine || !line) return;
      try {
        onLine(line);
      } catch {
        // A broken listener must not break the import it is watching.
      }
    };
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      if (stderr.length < MAX_OUTPUT) stderr += chunk.slice(0, MAX_OUTPUT - stderr.length);
      if (!onLine) return;
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      if (pending.length > MAX_LINE) pending = '';
      for (const line of lines) deliver(line);
    });
    child.once('error', (error) => {
      if (error?.code === 'ENOENT') {
        reject(migrationError('python3_not_found', {
          message: `没有找到 ${command}。导入需要 Python 3.9 或更新版本，安装后重新打开这个 Mini App。`,
        }));
        return;
      }
      reject(migrationError(error?.name === 'AbortError' ? 'migration_cancelled' : 'migration_spawn_failed'));
    });
    child.once('close', (exitCode) => {
      deliver(pending);
      resolvePromise({ exitCode: exitCode ?? -1, stderr: stderr.trim(), stdout: stdout.trim() });
    });
  });
}

function migrationError(code, details = {}) {
  const { message, ...rest } = details;
  const error = new Error(message || code);
  error.code = code;
  Object.assign(error, rest);
  return error;
}
