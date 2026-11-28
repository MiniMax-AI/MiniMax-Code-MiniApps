// Backup before writing, manifest recording, and rollback.
// The backup location follows the established workflow: <backupRoot>\<timestamp>\.

import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { ensureDir, readJson, writeFileAtomic, writeJsonAtomic } from './store.mjs';
import { assertWritable, findWriteRoot } from './paths.mjs';

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function stamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function flattenName(targetPath, root) {
  const relative = path.relative(root, targetPath) || path.basename(targetPath);
  const flat = relative.split(path.sep).join('__').replace(/[^\w.\-]/g, '_');
  return flat.length > 120 ? `${flat.slice(0, 100)}_${sha256(targetPath).slice(0,  8)}` : flat;
}

/**
 * Writes the original file into the backup directory and records the operation.
 * @param {{ backupRoot:string, targetPath:string, root:string, originalBuffer:Buffer, patch:Array, diff:string }} input
 */
export async function createBackup(input) {
  const { backupRoot, targetPath, root, originalBuffer, patch, diff } = input;
  const operationId = randomUUID();
  const directory = path.join(backupRoot, `${stamp()}_${operationId.slice(0, 8)}`);
  await ensureDir(directory);

  const backupFile = flattenName(targetPath, root);
  await writeFileAtomic(path.join(directory, backupFile), originalBuffer);

  // manifest.json keeps the established shape: backup file name -> original absolute path.
  const manifest = { [backupFile]: targetPath };
  await writeJsonAtomic(path.join(directory, 'manifest.json'), manifest);

  const record = {
    id: operationId,
    createdAt: new Date().toISOString(),
    targetPath,
    root,
    backupFile,
    backupDirectory: directory,
    originalSha256: sha256(originalBuffer),
    originalBytes: originalBuffer.length,
    patch,
    diff,
    status: 'applied',
    rolledBackAt: null,
    rollbackResult: null,
  };
  await writeJsonAtomic(path.join(directory, 'record.json'), record);
  return record;
}

/**
 * Lists every recorded operation, newest first. Backups written by the earlier
 * desktop tool are listed too when they only carry a manifest.json.
 * @param {string} backupRoot
 */
export async function listBackups(backupRoot) {
  const { readdir } = await import('node:fs/promises');
  let entries = [];
  try {
    entries = await readdir(backupRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const results = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(backupRoot, entry.name);
    const record = await readJson(path.join(directory, 'record.json'), null);
    if (record) {
      results.push(record);
      continue;
    }
    const manifest = await readJson(path.join(directory, 'manifest.json'), null);
    if (!manifest || typeof manifest !== 'object') continue;
    for (const [backupFile, targetPath] of Object.entries(manifest)) {
      if (typeof targetPath !== 'string' || !path.isAbsolute(targetPath)) continue;
      results.push({
        id: `legacy-${entry.name}-${backupFile}`,
        createdAt: legacyTimestamp(entry.name),
        targetPath,
        root: findWriteRoot(targetPath) || path.dirname(targetPath),
        backupFile,
        backupDirectory: directory,
        originalSha256: null,
        originalBytes: null,
        patch: [],
        diff: '',
        status: 'applied',
        legacy: true,
        rolledBackAt: null,
        rollbackResult: null,
      });
    }
  }
  return results.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
}

function legacyTimestamp(name) {
  const matched = /(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/.exec(name);
  if (!matched) return new Date(0).toISOString();
  return new Date(
    Number(matched[1]),
    Number(matched[2]) - 1,
    Number(matched[3]),
    Number(matched[4]),
    Number(matched[5]),
    Number(matched[6]),
  ).toISOString();
}

/**
 * Restores a file from its backup.
 * @param {{ backupRoot:string, operationId:string }} input
 */
export async function rollback(input) {
  const { backupRoot, operationId } = input;
  const records = await listBackups(backupRoot);
  const record = records.find((item) => item.id === operationId);
  if (!record) throw new Error('backup_operation_not_found');

  const { readFile } = await import('node:fs/promises');
  const backupPath = path.join(record.backupDirectory, record.backupFile);
  const originalBuffer = await readFile(backupPath);
  const digest = sha256(originalBuffer);
  if (record.originalSha256 && digest !== record.originalSha256) {
    throw new Error('backup_file_integrity_mismatch');
  }

  const target = await assertWritable(record.targetPath);
  await writeFileAtomic(target.path, originalBuffer);

  const restored = sha256(await readFile(target.path));
  const ok = record.originalSha256 ? restored === record.originalSha256 : true;
  record.status = ok ? 'rolled_back' : 'rollback_failed';
  record.rolledBackAt = new Date().toISOString();
  record.rollbackResult = { ok, sha256: restored, restoredBytes: originalBuffer.length };
  await writeJsonAtomic(path.join(record.backupDirectory, 'record.json'), record);

  return {
    ok,
    targetPath: record.targetPath,
    backupDirectory: record.backupDirectory,
    backupFile: record.backupFile,
    restoredSha256: restored,
    expectedSha256: record.originalSha256 || restored,
    rolledBackAt: record.rolledBackAt,
  };
}
