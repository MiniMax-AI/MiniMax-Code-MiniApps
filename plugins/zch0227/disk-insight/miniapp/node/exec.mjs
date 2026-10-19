// @ts-check
// 子进程：一律 spawn + 参数数组，不经过 shell；每次调用都有超时，dispose 时结束全部子进程。

/**
 * @param {{ spawn: typeof import('node:child_process').spawn, execFile?: typeof import('node:child_process').execFile, logger: { warn(m: string, f?: any): void } }} o
 */
export function createRunner(o) {
  const { spawn, logger } = o;
  /** @type {Set<import('node:child_process').ChildProcess>} */
  const children = new Set();
  /** @type {Set<ReturnType<typeof setTimeout>>} */
  const timers = new Set();

  /**
   * 运行并收集输出。不抛异常，失败信息放在返回值里。
   * @param {string} cmd @param {string[]} args
   * @param {{ timeoutMs?: number, input?: string, verbatim?: boolean, maxBytes?: number, code?: string, cwd?: string, env?: Record<string, string | undefined> }} [opts]
   * @returns {Promise<{ ok: boolean, exitCode: number | null, error: string | null, stdout: string, stderr: string }>}
   */
  function run(cmd, args, opts = {}) {
    const timeoutMs = opts.timeoutMs || 10000;
    const maxBytes = opts.maxBytes || 4 * 1024 * 1024;
    return new Promise((resolve) => {
      /** @type {import('node:child_process').ChildProcess} */
      let child;
      try {
        child = spawn(cmd, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
          windowsVerbatimArguments: !!opts.verbatim,
          cwd: opts.cwd,
          env: /** @type {any} */ (opts.env),
        });
      } catch (e) {
        resolve({ ok: false, exitCode: null, error: /** @type {any} */ (e).code || 'spawn_failed', stdout: '', stderr: '' });
        return;
      }
      children.add(child);
      /** @type {Buffer[]} */
      const out = [];
      /** @type {Buffer[]} */
      const err = [];
      let outLen = 0;
      let errLen = 0;
      let timedOut = false;
      let done = false;
      const timer = setTimeout(() => {
        timedOut = true;
        logger.warn('exec.timeout', { program: opts.code || 'exec' });
        try {
          child.kill();
        } catch {
          // 已退出
        }
      }, timeoutMs);
      timers.add(timer);
      const finish = (/** @type {number | null} */ exitCode, /** @type {string | null} */ errCode) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        timers.delete(timer);
        children.delete(child);
        resolve({
          ok: !timedOut && !errCode && exitCode === 0,
          exitCode,
          error: timedOut ? 'timeout' : errCode,
          stdout: Buffer.concat(out).toString('utf8'),
          stderr: Buffer.concat(err).toString('utf8'),
        });
      };
      child.stdout?.on('data', (d) => {
        if (outLen < maxBytes) {
          out.push(d);
          outLen += d.length;
        }
      });
      child.stderr?.on('data', (d) => {
        if (errLen < 64 * 1024) {
          err.push(d);
          errLen += d.length;
        }
      });
      child.on('error', (e) => finish(null, /** @type {any} */ (e).code || 'spawn_failed'));
      child.on('close', (code) => finish(code, null));
      child.stdin?.on('error', () => undefined);
      if (opts.input !== undefined) child.stdin?.end(opts.input);
      else child.stdin?.end();
    });
  }

  /**
   * 启动图形界面程序（访达、资源管理器、磁盘清理、快速预览）。不等它退出：
   * 默认 holdMs 内仍记为本服务的子进程，dispose 时会结束；之后交给用户，不再跟踪。
   * 给了 killAfterMs 时一直跟踪，到时间就结束它（快速预览最多开 10 分钟）。
   * @param {string} cmd @param {string[]} args @param {{ verbatim?: boolean, holdMs?: number, killAfterMs?: number }} [opts]
   * @returns {Promise<boolean>}
   */
  function launch(cmd, args, opts = {}) {
    return new Promise((resolve) => {
      /** @type {import('node:child_process').ChildProcess} */
      let child;
      try {
        child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false, windowsVerbatimArguments: !!opts.verbatim });
      } catch {
        resolve(false);
        return;
      }
      children.add(child);
      const release = () => {
        clearTimeout(timer);
        timers.delete(timer);
        children.delete(child);
      };
      const timer = setTimeout(() => {
        if (opts.killAfterMs) {
          try {
            child.kill();
          } catch {
            // 已退出
          }
        } else child.unref();
        release();
      }, opts.killAfterMs || opts.holdMs || 10000);
      timers.add(timer);
      child.on('exit', release);
      child.once('error', () => {
        release();
        resolve(false);
      });
      child.once('spawn', () => resolve(true));
    });
  }

  /**
   * 用 child_process.execFile 运行（参数数组、不经过 shell、带超时），git 一律走这里。返回值和 run 相同。
   * @param {string} cmd @param {string[]} args
   * @param {{ timeoutMs?: number, maxBytes?: number, code?: string, cwd?: string, env?: Record<string, string | undefined> }} [opts]
   * @returns {Promise<{ ok: boolean, exitCode: number | null, error: string | null, stdout: string, stderr: string }>}
   */
  function execFileRun(cmd, args, opts = {}) {
    if (!o.execFile) return run(cmd, args, opts);
    const exec = o.execFile;
    return new Promise((resolve) => {
      /** @type {import('node:child_process').ChildProcess | null} */
      let child = null;
      try {
        child = exec(
          cmd,
          args,
          { timeout: opts.timeoutMs || 10000, maxBuffer: opts.maxBytes || 4 * 1024 * 1024, windowsHide: true, cwd: opts.cwd, env: /** @type {any} */ (opts.env), encoding: 'utf8' },
          (err, stdout, stderr) => {
            if (child) children.delete(child);
            const e = /** @type {any} */ (err);
            const timedOut = !!(e && e.killed && e.signal);
            if (timedOut) logger.warn('exec.timeout', { program: opts.code || 'exec' });
            resolve({
              ok: !e,
              exitCode: e ? (typeof e.code === 'number' ? e.code : null) : 0,
              error: !e ? null : timedOut ? 'timeout' : typeof e.code === 'string' ? e.code : null,
              stdout: String(stdout || ''),
              stderr: String(stderr || ''),
            });
          },
        );
        children.add(child);
      } catch (e) {
        resolve({ ok: false, exitCode: null, error: /** @type {any} */ (e).code || 'spawn_failed', stdout: '', stderr: '' });
      }
    });
  }

  function killAll() {
    for (const t of timers) clearTimeout(t);
    timers.clear();
    for (const c of children) {
      try {
        c.kill();
      } catch {
        // 已退出
      }
    }
    children.clear();
  }

  return { run, execFile: execFileRun, launch, killAll, get size() { return children.size; } };
}

/** @typedef {ReturnType<typeof createRunner>} Runner */
