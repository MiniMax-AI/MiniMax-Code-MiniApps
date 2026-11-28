// Deployment command runner. Commands come from the saved configuration, never from a
// free-text field on a single request.

import { spawn } from 'node:child_process';

const OUTPUT_LIMIT = 200000;
const activeChildren = new Set();

function killTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      return;
    } catch {
      /* fall through to the plain kill */
    }
  }
  try {
    child.kill('SIGKILL');
  } catch {
    /* the process already exited */
  }
}

/**
 * @param {{ command:string, cwd:string, timeoutMs?:number, signal?:AbortSignal }} input
 */
export function runDeploy(input) {
  const { command, cwd, timeoutMs = 120000, signal } = input;
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let cancelled = false;
    let settled = false;

    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
      env: process.env,
    });
    activeChildren.add(child);

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      activeChildren.delete(child);
      resolve({ ...result, stdout, stderr, durationMs: Date.now() - startedAt });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);

    const onAbort = () => {
      cancelled = true;
      killTree(child);
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (data) => {
      if (stdout.length < OUTPUT_LIMIT) stdout += data.toString();
    });
    child.stderr?.on('data', (data) => {
      if (stderr.length < OUTPUT_LIMIT) stderr += data.toString();
    });
    child.on('error', (error) => {
      finish({ ok: false, code: null, timedOut, cancelled, error: error.message });
    });
    child.on('close', (code) => {
      finish({ ok: code === 0 && !timedOut && !cancelled, code, timedOut, cancelled, error: null });
    });
  });
}

export function stopActiveDeploys() {
  for (const child of [...activeChildren]) {
    killTree(child);
  }
  activeChildren.clear();
}
