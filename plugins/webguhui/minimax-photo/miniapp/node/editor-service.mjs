import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { validatePNG } from './png-validation.mjs';
const id = (v) => typeof v === 'string' && /^[a-f0-9-]{36}$/.test(v);
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const visible = (job) => {
  const { checkpoint, preview, exportImage, craftExport, claim, fingerprint, ...summary } = job;
  return summary;
};
export async function createEditorService(dataDir) {
  const root = join(dataDir, 'editor-jobs');
  await mkdir(root, { recursive: true });
  const editors = new Map(),
    locks = new Map();
  async function serial(key, fn) {
    const next = (locks.get(key) || Promise.resolve()).catch(() => {}).then(fn);
    locks.set(key, next);
    try {
      return await next;
    } finally {
      if (locks.get(key) === next) locks.delete(key);
    }
  }
  async function write(job) {
    const file = join(root, job.jobId + '.json'),
      tmp = file + '.' + randomUUID() + '.tmp';
    await writeFile(tmp, JSON.stringify(job), { mode: 0o600 });
    await rename(tmp, file);
  }
  async function read(jobId) {
    if (!id(jobId)) throw Error('任务编号无效');
    return JSON.parse(await readFile(join(root, jobId + '.json'), 'utf8'));
  }
  function live(editorId) {
    const e = editors.get(editorId);
    if (!e?.res || Date.now() - e.updatedAt > 45000)
      throw Error('编辑器未连接，请打开 Mini App 后重新读取列表');
    return e;
  }
  return {
    list() {
      return [...editors.values()]
        .filter((e) => e.res && Date.now() - e.updatedAt <= 45000)
        .map((e) => ({
          editorId: e.id,
          version: e.version,
          engine: e.engine,
          page: e.page,
          updatedAt: e.updatedAt,
          document: e.document,
          busy: !!e.jobId,
        }));
    },
    inspect(editorId) {
      const e = live(editorId);
      return {
        editorId,
        version: e.version,
        engine: e.engine,
        page: e.page,
        updatedAt: e.updatedAt,
        document: e.document,
        busy: !!e.jobId,
      };
    },
    register(input) {
      if (!id(input.editorId) || typeof input.version !== 'string' || input.version.length > 100)
        throw Error('编辑器信息无效');
      const existing = editors.get(input.editorId);
      const page = {
        visibility: ['visible', 'hidden'].includes(input.page?.visibility) ? input.page.visibility : 'unknown',
        focused: typeof input.page?.focused === 'boolean' ? input.page.focused : null,
      };
      if (existing?.jobId) {
        existing.page = page;
        existing.updatedAt = Date.now();
        return { editorId: existing.id };
      }
      const e = existing || { id: input.editorId };
      Object.assign(e, {
        version: input.version,
        engine: input.engine === 'photocraft' ? 'photocraft' : 'canvas',
        page,
        document: input.document,
        updatedAt: Date.now(),
      });
      editors.set(e.id, e);
      return { editorId: e.id };
    },
    subscribe(editorId, req, res) {
      const e = editors.get(editorId);
      if (!e) throw Error('编辑器未注册');
      if (e.res) throw Error('编辑器连接重复');
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      e.res = res;
      const timer = setInterval(() => {
        res.write(': heartbeat\n\n');
      }, 15000);
      req.on('close', () => {
        clearInterval(timer);
        if (e.res === res) e.res = null;
      });
    },
    async submit(input) {
      if (!id(input.requestId) || !id(input.editorId) || typeof input.expectedVersion !== 'string')
        throw Error('需要 requestId、editorId、expectedVersion');
      if (!['preview', 'batch', 'export', 'create', 'craft'].includes(input.kind))
        throw Error('未知编辑任务');
      if (
        input.kind === 'batch' &&
        (!Array.isArray(input.operations) ||
          input.operations.length < 1 ||
          input.operations.length > 64)
      )
        throw Error('每批需要 1–64 个操作');
      if (
        input.kind === 'create' &&
        (!Number.isInteger(input.width) ||
          !Number.isInteger(input.height) ||
          input.width < 1 ||
          input.height < 1 ||
          input.width * input.height > 32e6 ||
          typeof input.name !== 'string' ||
          !input.name.trim() ||
          input.name.length > 200)
      )
        throw Error('新建工程参数无效');
      const fingerprint = createHash('sha256')
        .update(JSON.stringify(canonical(input)))
        .digest('hex');
      return serial('submit', async () => {
        try {
          const old = await read(input.requestId);
          if (old.fingerprint !== fingerprint) throw Error('requestId 已用于不同请求');
          return visible(old);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        const e = live(input.editorId);
        if (e.jobId) throw Error('编辑器正在执行另一任务');
        if (e.version !== input.expectedVersion) throw Error('工程版本已变化，请重新 inspect');
        if (input.kind === 'craft' && e.engine !== 'photocraft')
          throw Error('需要 PhotoCraft 工作台');
        if (
          input.kind === 'craft' &&
          !['commands', 'execute', 'batch', 'draw', 'preview', 'export', 'open'].includes(
            input.options?.method,
          )
        )
          throw Error('未知 PhotoCraft 方法');
        if (e.engine === 'photocraft' && input.kind !== 'craft')
          throw Error('PhotoCraft 请使用 photo_call 或 PTC');
        if (!e.document && !['create', 'craft'].includes(input.kind))
          throw Error('编辑器没有打开文档');
        const job = {
          jobId: input.requestId,
          editorId: e.id,
          expectedVersion: input.expectedVersion,
          kind: input.kind,
          operations: input.operations || [],
          options: input.options,
          newDocument:
            input.kind === 'create'
              ? { width: input.width, height: input.height, name: input.name }
              : undefined,
          fingerprint,
          status: 'queued',
          createdAt: Date.now(),
        };
        await write(job);
        e.jobId = job.jobId;
        e.res.write('event: command\ndata: ' + JSON.stringify({ jobId: job.jobId }) + '\n\n');
        return visible(job);
      });
    },
    async claim(editorId, jobId) {
      return serial(jobId, async () => {
        const e = live(editorId),
          j = await read(jobId);
        if (e.jobId !== jobId || j.editorId !== editorId || j.status !== 'queued')
          throw Error('任务不能重复领取');
        j.status = 'running';
        j.startedAt = Date.now();
        j.claim = randomUUID();
        await write(j);
        return j;
      });
    },
    async finish(editorId, jobId, input) {
      return serial(jobId, async () => {
        const j = await read(jobId);
        if (j.editorId !== editorId || input.claim !== j.claim) throw Error('任务归属不匹配');
        if (['prepared', 'succeeded', 'failed'].includes(j.status)) return visible(j);
        if (j.status !== 'running') throw Error('任务状态无效');
        if (input.error) {
          j.status = 'failed';
          j.error = String(input.error).slice(0, 1000);
        } else {
          if (
            typeof input.preview !== 'string' ||
            !input.preview.startsWith('data:image/png;base64,')
          )
            throw Error('缺少预览');
          const bytes = Buffer.from(input.preview.slice(22), 'base64');
          await validatePNG(bytes);
          if (
            ['batch', 'export', 'create'].includes(j.kind) &&
            (input.checkpoint?.format !== 'retouch-lab' ||
              (j.kind === 'create'
                ? !id(input.checkpoint?.id)
                : input.checkpoint?.id !== editors.get(editorId)?.document?.id))
          )
            throw Error('缺少同一工程的检查点');
          if (j.kind === 'craft' && input.craftExport) {
            const format = input.craftExport.format;
            if (!['png', 'jpg', 'webp', 'pcraft', 'psd', 'ora', 'tif'].includes(format))
              throw Error('导出格式无效');
            const bytes = Buffer.from(input.craftExport.data, 'base64');
            if (!bytes.length || bytes.length > 64 * 1024 * 1024) throw Error('导出大小无效');
            j.craftExport = { format, data: input.craftExport.data };
            j.exportPath = join(root, jobId + '.' + format);
          }
          j.status = 'prepared';
          j.preview = input.preview;
          if (j.kind === 'export') {
            if (
              typeof input.exportImage !== 'string' ||
              !input.exportImage.startsWith('data:image/png;base64,')
            )
              throw Error('导出图片无效');
            await validatePNG(Buffer.from(input.exportImage.slice(22), 'base64'));
            j.exportImage = input.exportImage;
            j.exportPath = join(root, jobId + '.full.png');
          }
          j.checkpoint = input.checkpoint;
          j.result = input.result;
          j.previewPath = join(root, jobId + '.png');
          if (input.checkpoint) j.checkpointPath = join(root, jobId + '.retouch.json');
        }
        j.finishedAt = Date.now();
        await write(j);
        const e = editors.get(editorId);
        if (e?.jobId === jobId && j.status === 'failed') e.jobId = null;
        // The job JSON is the durable source of truth; artifacts can be regenerated after a crash.
        return visible(j);
      });
    },
    async acknowledge(editorId, jobId, input) {
      return serial(jobId, async () => {
        const j = await read(jobId);
        if (j.editorId !== editorId || j.claim !== input.claim) throw Error('任务归属不匹配');
        if (j.status === 'succeeded') return visible(j);
        if (j.status !== 'prepared') throw Error('任务尚未准备好');
        if (typeof input.version !== 'string' || input.version.length > 100)
          throw Error('缺少编辑版本');
        j.status = 'succeeded';
        j.appliedVersion = input.version;
        j.appliedAt = Date.now();
        await write(j);
        const e = editors.get(editorId);
        if (e?.jobId === jobId) {
          e.jobId = null;
          e.version = input.version;
          e.updatedAt = Date.now();
          const { steps, previewScale, region, pixels, ...document } = j.result;
          e.document = j.kind === 'craft' ? (j.result.state?.document ?? null) : document;
        }
        return visible(j);
      });
    },
    async result(jobId) {
      const j = await read(jobId);
      if (['prepared', 'succeeded'].includes(j.status)) {
        await writeFile(join(root, jobId + '.png'), Buffer.from(j.preview.slice(22), 'base64'), {
          mode: 0o600,
        });
        if (j.craftExport)
          await writeFile(j.exportPath, Buffer.from(j.craftExport.data, 'base64'), { mode: 0o600 });
        if (j.exportImage)
          await writeFile(
            join(root, jobId + '.full.png'),
            Buffer.from(j.exportImage.slice(22), 'base64'),
            { mode: 0o600 },
          );
        if (j.checkpoint)
          await writeFile(join(root, jobId + '.retouch.json'), JSON.stringify(j.checkpoint), {
            mode: 0o600,
          });
      }
      const result = visible(j);
      const e = editors.get(j.editorId);
      if (['queued', 'running'].includes(j.status) && (!e?.res || e.jobId !== jobId))
        return {
          ...result,
          status: 'interrupted',
          error: '页面或服务连接已断开；不自动重放。读取工程和已保存检查点后再决定下一步。',
        };
      return result;
    },
    async preview(jobId) {
      const j = await read(jobId);
      if (!['prepared', 'succeeded'].includes(j.status)) throw Error('预览尚不可用');
      return j.preview.slice(22);
    },
    close() {
      for (const e of editors.values()) e.res?.end();
      editors.clear();
    },
  };
}
