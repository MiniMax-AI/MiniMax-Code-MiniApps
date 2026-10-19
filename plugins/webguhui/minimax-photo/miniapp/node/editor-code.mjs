import { Worker } from 'node:worker_threads';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { editorCapabilities } from '../client/editor-commands.js';

const validId = (v) => typeof v === 'string' && /^[a-f0-9-]{36}$/.test(v);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function createCodeService(dataDir, editor) {
  const root = join(dataDir, 'editor-code');
  await mkdir(root, { recursive: true });
  const active = new Map();
  let submissions = Promise.resolve();
  const read = async (id) => {
    if (!validId(id)) throw Error('运行编号无效');
    return JSON.parse(await readFile(join(root, id + '.json'), 'utf8'));
  };
  const write = async (run) => {
    const path = join(root, run.runId + '.json'),
      tmp = path + '.' + randomUUID() + '.tmp';
    await writeFile(tmp, JSON.stringify(run), { mode: 0o600 });
    await rename(tmp, path);
  };
  const visible = ({ fingerprint, code, ...run }) => run;
  function launch(run) {
    const deadline = Date.now() + 120000;
    const worker = new Worker(new URL('./ptc-worker.mjs', import.meta.url), {
      workerData: { code: run.code, deadline },
      stdout: true,
      stderr: true,
      resourceLimits: { maxOldGenerationSizeMb: 96, stackSizeMb: 4 },
    });
    // Keep vendored VM diagnostics away from the Host-owned process streams.
    // Structured failures are reported through worker messages below.
    worker.stdout.resume();
    worker.stderr.resume();
    const state = { run, worker, stopped: false, busy: false, inflight: Promise.resolve() };
    active.set(run.runId, state);
    let version = run.expectedVersion;
    const finish = async (error, result) => {
      if (state.stopped) return;
      state.stopped = true;
      clearTimeout(timer);
      await worker.terminate();
      await state.inflight.catch(() => {});
      run.status = error ? 'failed' : 'succeeded';
      run.error = error;
      run.result = result;
      run.finishedAt = Date.now();
      try {
        await write(run);
      } finally {
        active.delete(run.runId);
      }
    };
    const timer = setTimeout(
      () => void finish('执行超过 120 秒；已提交任务见 trace，请查询其最终结果'),
      120000,
    );
    state.timer = timer;
    worker.on('error', (error) => void finish(error.message));
    worker.on('exit', (code) => {
      if (!state.stopped) void finish('执行器意外退出：' + code);
    });
    worker.on('message', (message) => {
      if (state.stopped) return;
      if (message.type === 'done') {
        void finish(message.error, message.result);
        return;
      }
      if (message.type !== 'call') return;
      if (state.busy) {
        worker.postMessage({
          id: message.id,
          error: '工具调用必须逐个 await，不能并行或遗漏 await',
        });
        return;
      }
      state.busy = true;
      state.inflight = (async () => {
        const step = { index: run.trace.length + 1, method: message.method, startedAt: Date.now() };
        try {
          if (run.trace.length >= 64) throw Error('每次脚本最多调用 64 次工具');
          if (
            ![
              'inspect',
              'capabilities',
              'preview',
              'edit',
              'create',
              'export',
              'commands',
              'execute',
              'draw',
            ].includes(message.method)
          )
            throw Error('未知脚本工具');
          run.trace.push(step);
          const current = editor.inspect(run.editorId);
          if (current.version !== version)
            throw Error('用户或其他任务已修改工程，脚本停止，请重新读取');
          let result;
          if (message.method === 'inspect') result = current;
          else if (message.method === 'capabilities' && current.engine !== 'photocraft')
            result = editorCapabilities;
          else {
            const craft = current.engine === 'photocraft';
            const kind = craft ? 'craft' : message.method === 'edit' ? 'batch' : message.method;
            const args = message.args;
            if (
              kind === 'create' &&
              (!args || Object.keys(args).some((k) => !['width', 'height', 'name'].includes(k)))
            )
              throw Error('create 只接受 width、height、name');
            step.jobId = randomUUID();
            // Record the task identity before submitting: an interrupted script never retries it.
            await write(run);
            if (state.stopped) throw Error('脚本已停止');
            await editor.submit({
              ...(kind === 'create' ? args : {}),
              requestId: step.jobId,
              editorId: run.editorId,
              expectedVersion: version,
              kind,
              ...(kind === 'batch' ? { operations: args } : {}),
              ...(kind === 'preview' ? { options: args || {} } : {}),
              ...(craft
                ? {
                    options: {
                      method:
                        message.method === 'edit'
                          ? 'batch'
                          : ['commands', 'capabilities'].includes(message.method)
                            ? 'commands'
                            : message.method === 'create'
                              ? 'execute'
                              : message.method,
                      args:
                        message.method === 'create'
                          ? { command: 'file.new', params: args }
                          : args || {},
                    },
                  }
                : {}),
            });
            do {
              if (state.stopped || Date.now() > deadline)
                throw Error('脚本已停止；已提交任务仍需查询');
              await sleep(100);
              result = await editor.result(step.jobId);
            } while (['queued', 'running', 'prepared'].includes(result.status));
            if (result.status !== 'succeeded') throw Error(result.error || result.status);
            version = result.appliedVersion;
            if (!version) throw Error('编辑任务缺少已应用版本');
          }
          step.status = 'succeeded';
          step.finishedAt = Date.now();
          await write(run);
          if (!state.stopped) worker.postMessage({ id: message.id, result });
        } catch (error) {
          step.status = 'failed';
          step.error = error.message;
          step.finishedAt = Date.now();
          await write(run);
          if (!state.stopped) worker.postMessage({ id: message.id, error: error.message });
        } finally {
          state.busy = false;
        }
      })();
      state.inflight.catch((error) => void finish(error.message));
    });
  }
  return {
    async submit(input) {
      const next = submissions
        .catch(() => {})
        .then(async () => {
          if (
            !validId(input.requestId) ||
            !validId(input.editorId) ||
            typeof input.expectedVersion !== 'string' ||
            typeof input.code !== 'string' ||
            !input.code.trim() ||
            Buffer.byteLength(input.code) > 32768
          )
            throw Error('需要有效 requestId、editorId、expectedVersion 和不超过 32 KB 的 code');
          const fingerprint = createHash('sha256')
            .update(JSON.stringify([input.editorId, input.expectedVersion, input.code]))
            .digest('hex');
          try {
            const old = await read(input.requestId);
            if (old.fingerprint !== fingerprint) throw Error('requestId 已用于不同脚本');
            return this.result(old.runId);
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }
          if (
            active.size >= 2 ||
            [...active.values()].some((s) => s.run.editorId === input.editorId)
          )
            throw Error('已有脚本正在执行，请等待并查询结果');
          const current = editor.inspect(input.editorId);
          if (current.busy) throw Error('编辑任务尚未完成，请查询原任务结果后继续');
          if (current.version !== input.expectedVersion)
            throw Error('画布版本已变化，请重新 editor_inspect 后使用最新 version');
          const run = {
            runId: input.requestId,
            editorId: input.editorId,
            expectedVersion: input.expectedVersion,
            code: input.code,
            fingerprint,
            status: 'running',
            createdAt: Date.now(),
            trace: [],
          };
          await write(run);
          launch(run);
          return visible(run);
        });
      submissions = next;
      return next;
    },
    async result(runId) {
      const run = await read(runId);
      if (run.status === 'running' && !active.has(runId)) {
        run.status = 'interrupted';
        run.error = '服务已重启；不会重放脚本。请查询 trace 中的任务并检查工程';
      }
      return visible(run);
    },
    close() {
      for (const state of active.values()) {
        state.stopped = true;
        clearTimeout(state.timer);
        void state.worker.terminate();
      }
      active.clear();
    },
  };
}
