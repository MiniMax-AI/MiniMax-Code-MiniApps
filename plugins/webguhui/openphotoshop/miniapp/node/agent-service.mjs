import { validatePNG } from './png-validation.mjs';
import { mkdir, readFile, writeFile, rename, readdir, open } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
const MAX_IMAGE = 16 * 1024 * 1024;
const validId = (id) => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);
export async function readJSON(req, limit = 24 * 1024 * 1024) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > limit) throw Error('请求过大');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function createAgentService(dataDir) {
  const root = join(dataDir, 'agent-requests');
  await mkdir(root, { recursive: true });
  const streams = new Set(),
    locks = new Map();
  const path = (id, name) => {
    if (!validId(id)) throw Error('任务编号无效');
    return join(root, id, name);
  };
  async function atomic(file, data) {
    const tmp = file + '.' + randomUUID() + '.tmp';
    await writeFile(tmp, data, { mode: 0o600 });
    await rename(tmp, file);
  }
  async function get(id) {
    return JSON.parse(await readFile(path(id, 'request.json'), 'utf8'));
  }
  async function list() {
    const results = [];
    for (const id of await readdir(root))
      if (validId(id)) {
        try {
          const p = await get(id);
          results.push(p);
        } catch {}
      }
    return results.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async function create(input) {
    if (
      !['generate', 'edit'].includes(input.mode) ||
      typeof input.prompt !== 'string' ||
      !input.prompt.trim() ||
      input.prompt.length > 8000
    )
      throw Error('图片需求无效');
    let reference;
    if (input.mode === 'edit') {
      if (
        typeof input.reference !== 'string' ||
        !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(input.reference)
      )
        throw Error('缺少 PNG 参考图');
      reference = Buffer.from(input.reference.split(',')[1], 'base64');
      await validatePNG(reference);
    }
    const id = randomUUID(),
      now = Date.now();
    const record = {
      id,
      mode: input.mode,
      prompt: input.prompt.trim(),
      name: typeof input.name === 'string' ? input.name.slice(0, 200) : 'Agent 图片',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    await mkdir(join(root, id));
    if (reference) await atomic(path(id, 'reference.png'), reference);
    await atomic(path(id, 'request.json'), JSON.stringify(record));
    return record;
  }
  async function submit(id, imagePath) {
    if (typeof imagePath !== 'string' || !isAbsolute(imagePath) || imagePath.length > 4096)
      throw Error('请提供生成图片的本机绝对路径');
    const previous = locks.get(id) || Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => {
        const record = await get(id);
        const handle = await open(imagePath, 'r');
        let bytes;
        try {
          const info = await handle.stat();
          if (!info.isFile() || info.size > MAX_IMAGE) throw Error('图片不是普通文件或超过 16 MB');
          // Read a bounded buffer even if the file changes after stat.
          bytes = Buffer.alloc(Math.min(MAX_IMAGE + 1, info.size + 1));
          let offset = 0;
          while (offset < bytes.length) {
            const read = await handle.read(bytes, offset, bytes.length - offset, offset);
            if (!read.bytesRead) break;
            offset += read.bytesRead;
          }
          bytes = bytes.subarray(0, offset);
        } finally {
          await handle.close();
        }
        const dimensions = await validatePNG(bytes),
          digest = createHash('sha256').update(bytes).digest('hex');
        if (record.status === 'ready') {
          if (record.digest === digest) return record;
          throw Error('此任务已有结果；请新建任务以免覆盖');
        }
        await atomic(path(id, 'result.png'), bytes);
        const ready = { ...record, ...dimensions, status: 'ready', digest, updatedAt: Date.now() };
        await atomic(path(id, 'request.json'), JSON.stringify(ready));
        for (const res of streams)
          res.write('event: result\ndata: ' + JSON.stringify({ id }) + '\n\n');
        return ready;
      });
    locks.set(id, next);
    try {
      return await next;
    } finally {
      if (locks.get(id) === next) locks.delete(id);
    }
  }
  return {
    create,
    get,
    list,
    submit,
    async reference(id) {
      const record = await get(id);
      if (record.mode !== 'edit') throw Error('此任务不需要参考图');
      return { path: path(id, 'reference.png'), ...record };
    },
    async result(id) {
      if ((await get(id)).status !== 'ready') throw Error('图片尚未生成');
      return readFile(path(id, 'result.png'));
    },
    subscribe(req, res) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write(': connected\n\n');
      streams.add(res);
      req.on('close', () => streams.delete(res));
    },
    close() {
      for (const res of streams) res.end();
      streams.clear();
    },
  };
}
