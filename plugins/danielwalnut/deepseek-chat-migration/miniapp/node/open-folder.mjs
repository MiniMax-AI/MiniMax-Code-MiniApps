// @ts-check

import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';

/**
 * The OS file-manager command for a folder: Finder, Explorer, or the desktop's
 * default on Linux. Arguments are an array; no shell is involved.
 */
export function folderOpener(path, platform = process.platform) {
  if (platform === 'darwin') return { command: 'open', args: [path] };
  if (platform === 'win32') return { command: 'explorer.exe', args: [path] };
  return { command: 'xdg-open', args: [path] };
}

/** Opens an existing directory in the file manager. Resolves once the opener started. */
export async function openFolder(path, { platform = process.platform, spawnImpl = spawn } = {}) {
  const info = await stat(path).catch(() => null);
  if (!info?.isDirectory()) throw openError('folder_missing', `没有找到文件夹 ${path}`);
  const { command, args } = folderOpener(path, platform);
  await new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, { shell: false, stdio: 'ignore', detached: true, windowsHide: true });
    child.once('error', (error) => reject(openError('open_failed', `无法打开文件夹：${error?.code || 'unknown error'}`)));
    child.once('spawn', () => {
      child.unref();
      resolve(undefined);
    });
  });
}

function openError(code, message) {
  const error = new Error(message);
  /** @type {any} */ (error).code = code;
  return error;
}
