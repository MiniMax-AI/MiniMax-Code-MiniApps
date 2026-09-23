import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';

import { EXCLUDED_DIRECTORY, LIMITS } from '../contract.mjs';
import { portablePathIssue } from '../paths.mjs';

export async function checkFiles(report, { packageDir }) {
  const rootInfo = await lstat(packageDir);
  if (rootInfo.isSymbolicLink()) {
    report.error('PACKAGE_ROOT_SYMLINK', 'the package directory must not be a symbolic link');
    return;
  }
  const totals = { files: 0, bytes: 0 };
  await walk(report, packageDir, '', totals);
  if (totals.files > LIMITS.maxFiles) {
    report.error('PACKAGE_TOO_MANY_FILES', `${totals.files} files exceed the limit of ${LIMITS.maxFiles}`);
  }
  if (totals.bytes > LIMITS.maxTotalBytes) {
    report.error('PACKAGE_TOO_LARGE', `${totals.bytes} bytes exceed the limit of ${LIMITS.maxTotalBytes}`);
  }
}

async function walk(report, absoluteDir, relativeDir, totals) {
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  for (const entry of entries) {
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    const absolutePath = path.join(absoluteDir, entry.name);
    if (entry.isDirectory() && entry.name.toLowerCase() === EXCLUDED_DIRECTORY) {
      report.error('PACKAGE_EXCLUDED_DIRECTORY', 'node_modules must not be committed; vendor dependencies inside the payload instead', relativePath);
      continue;
    }
    const issue = portablePathIssue(relativePath);
    if (issue) report.error('PATH_NOT_PORTABLE', `path ${issue}`, relativePath);
    const info = await lstat(absolutePath);
    if (info.isSymbolicLink()) {
      report.error('PACKAGE_SPECIAL_FILE', 'symbolic links are not allowed', relativePath);
      continue;
    }
    if (info.isDirectory()) {
      await walk(report, absolutePath, relativePath, totals);
      continue;
    }
    if (!info.isFile()) {
      report.error('PACKAGE_SPECIAL_FILE', 'only regular files and directories are allowed', relativePath);
      continue;
    }
    if (info.nlink > 1) {
      report.error('PACKAGE_SPECIAL_FILE', 'hard links are not allowed', relativePath);
      continue;
    }
    totals.files += 1;
    totals.bytes += info.size;
    if (info.size > LIMITS.maxFileBytes) {
      report.error('PACKAGE_FILE_TOO_LARGE', `${info.size} bytes exceed the per-file limit of ${LIMITS.maxFileBytes}`, relativePath);
    }
  }
}
