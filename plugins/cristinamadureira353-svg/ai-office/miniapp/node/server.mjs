import { createServer } from 'node:http';
import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises';
import { join, basename, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const ROUTES = new Map([['/api/state','GET'], ['/api/saves','GET'], ['/api/command','POST'],
  ['/api/chat','POST'], ['/api/save','POST'], ['/api/load','POST'], ['/api/newday','POST'], ['/api/accept','POST']]);

export async function start(context) {
  const clientRoot = join(context.pluginRoot, 'miniapp/client');
  const assets = JSON.parse(await readFile(join(context.pluginRoot, 'miniapp/node/assets.json'), 'utf8'));
  const setupGuide = (await readFile(join(context.pluginRoot, 'SETUP_PROMPT.md'), 'utf8')).trim();
  const settingsPath = join(context.dataDir, 'settings.json');
  await mkdir(context.dataDir, { recursive: true });
  let settings = null;
  try { settings = JSON.parse(await readFile(settingsPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') context.logger.warn('ai-office.settings.unreadable'); }
  let child = null, lines = null, starting = null, disposed = false, sequence = 0, savingSettings = false, checkingPython = null;
  const pending = new Map();
  const sockets = new Set();

  function json(response, status, data) {
    response.writeHead(status, { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' });
    response.end(JSON.stringify(data));
  }
  function rejectPending() {
    for (const response of pending.values()) {
      if (!response.headersSent) json(response, 503, { ok:false, msg:'游戏服务已停止，重新打开游戏即可继续。' });
      else response.end();
    }
    pending.clear();
  }
  async function backend() {
    if (disposed) throw new Error('disposed');
    if (starting) return starting;
    if (child && child.exitCode === null) return child;
    if (!settings) throw new Error('not_configured');
    starting = new Promise((resolve, reject) => {
      const args = ['-u', join(context.pluginRoot, 'miniapp/node/backend/server/miniapp_bridge.py'),
        '--data-dir', context.dataDir, '--env-file', settings.envFile];
      if (settings.initialSave) args.push('--initial-save', settings.initialSave);
      const process = spawn(settings.pythonPath, args, {
        cwd:join(context.pluginRoot, 'miniapp/node/backend'), shell:false, windowsHide:true,
        stdio:['pipe','pipe','pipe'], env:{ ...globalThis.process.env, PYTHONDONTWRITEBYTECODE:'1' }
      });
      child = process;
      let ready = false;
      const timer = setTimeout(() => { process.kill(); reject(new Error('backend_timeout')); }, 12000);
      process.stderr.on('data', () => {}); // 不把可能包含路径或凭据的依赖诊断发给页面或 Host。
      lines = createInterface({ input:process.stdout });
      lines.on('line', raw => {
        let frame;
        try { frame = JSON.parse(raw); } catch { return; }
        if (frame.type === 'ready') {
          ready = true; clearTimeout(timer); resolve(process); return;
        }
        const response = pending.get(frame.id);
        if (!response || response.destroyed) return;
        if (frame.type === 'head') response.writeHead(frame.status, {
          'content-type':frame.contentType, 'cache-control':'no-store', 'x-accel-buffering':'no'
        });
        else if (frame.type === 'data') response.write(frame.body);
        else if (frame.type === 'end') { pending.delete(frame.id); response.end(); }
        else if (frame.type === 'error') {
          pending.delete(frame.id);
          if (!response.headersSent) json(response, 503, { ok:false, msg:frame.message });
          else response.end();
        }
      });
      process.once('error', () => { clearTimeout(timer); reject(new Error('backend_start_failed')); });
      process.once('exit', () => {
        clearTimeout(timer); lines?.close();
        if (child === process) child = null;
        rejectPending();
        if (!ready) reject(new Error('backend_start_failed'));
      });
    }).finally(() => { starting = null; });
    return starting;
  }

  async function bodyOf(request) {
    const chunks = []; let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 65536) throw new Error('body_too_large');
      chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    const body = text ? JSON.parse(text) : {};
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error('invalid_body');
    return body;
  }
  async function validateSettings(body) {
    const result = {};
    for (const key of ['pythonPath', 'envFile', 'initialSave']) {
      const value = body[key] || '';
      if (typeof value !== 'string' || value.includes('\0') || (!value && key !== 'initialSave') || (value && !isAbsolute(value)))
        throw new Error('invalid_settings');
      if (value && !(await stat(value)).isFile()) throw new Error('invalid_settings');
      result[key] = value;
    }
    if (!/^python(?:3(?:\.\d+)?)?(?:\.exe)?$/i.test(basename(result.pythonPath))) throw new Error('invalid_python');
    if (child) throw new Error('backend_already_running');
    await new Promise((resolve, reject) => {
      const probe = spawn(result.pythonPath, ['-c', 'import flask, requests, dotenv'], {
        shell:false, windowsHide:true, stdio:'ignore',
        env:{ ...globalThis.process.env, PYTHONDONTWRITEBYTECODE:'1' }
      });
      checkingPython = probe;
      const timer = setTimeout(() => { probe.kill('SIGKILL'); }, 8000);
      function finish(error) {
        clearTimeout(timer);
        if (checkingPython === probe) checkingPython = null;
        if (error) reject(new Error('python_not_ready')); else resolve();
      }
      probe.once('error', () => finish(true));
      probe.once('exit', code => finish(code !== 0));
      if (disposed) probe.kill('SIGKILL');
    });
    if (disposed) throw new Error('disposed');
    return result;
  }

  function setupPrompt() {
    const runtime = { configurationEndpoint:`http://${context.listen.host}:${context.listen.port}/api/settings`,
      pluginRoot:context.pluginRoot, dataDir:context.dataDir };
    return setupGuide + '\n\n本次运行信息（由 MiniApp 自动提供，供 AI 执行配置；保持页面打开直到配置完成）：\n'
      + JSON.stringify(runtime, null, 2);
  }

  const server = createServer(async (request, response) => {
    try {
      const host = request.headers.host || '';
      if (![`${context.listen.host}:${context.listen.port}`, `localhost:${context.listen.port}`].includes(host))
        return json(response, 403, { ok:false, msg:'无效的本地请求' });
      const origin = request.headers.origin;
      if (origin && ![`http://${context.listen.host}:${context.listen.port}`, `http://localhost:${context.listen.port}`].includes(origin))
        return json(response, 403, { ok:false, msg:'无效的请求来源' });
      const url = new URL(request.url || '/', 'http://miniapp.local');
      if (request.method === 'GET' && url.pathname === '/api/settings')
        return json(response, 200, { ok:true, configured:!!settings, settings, backendRunning:!!child });
      if (request.method === 'GET' && url.pathname === '/api/setup')
        return json(response, 200, { ok:true, prompt:setupPrompt() });
      if (request.method === 'POST' && url.pathname === '/api/settings') {
        if (savingSettings) return json(response, 409, { ok:false, msg:'正在保存配置，请稍后再试' });
        savingSettings = true;
        try {
          const next = await validateSettings(await bodyOf(request));
          const temporary = settingsPath + '.tmp';
          await writeFile(temporary, JSON.stringify(next), { mode:0o600 });
          await rename(temporary, settingsPath); settings = next;
          return json(response, 200, { ok:true });
        } finally { savingSettings = false; }
      }
      if (ROUTES.get(url.pathname) === request.method) {
        if (pending.size >= 32) return json(response, 429, { ok:false, msg:'操作较多，请稍后再试' });
        const body = request.method === 'POST' ? await bodyOf(request) : {};
        const process = await backend();
        if (disposed || response.destroyed) return;
        const id = ++sequence;
        pending.set(id, response);
        response.on('close', () => {
          if (pending.delete(id) && !process.killed && process.stdin.writable)
            process.stdin.write(JSON.stringify({ type:'cancel', id }) + '\n');
        });
        process.stdin.write(JSON.stringify({ id, method:request.method, path:url.pathname, body }) + '\n');
        return;
      }
      const key = url.pathname === '/ai-office' ? '/index.html' : url.pathname;
      const asset = assets[key];
      if (asset && ['GET','HEAD'].includes(request.method)) {
        response.writeHead(200, { 'content-type':asset.type, 'cache-control':'no-cache',
          'content-length':asset.bytes, ...(asset.gzip ? { 'content-encoding':'gzip' } : {}) });
        if (request.method === 'GET') {
          for (const file of asset.parts || [asset.file]) {
            if (response.destroyed) break;
            const bytes = await readFile(join(clientRoot, file));
            if (!response.write(bytes)) await new Promise(resolve => {
              response.once('drain', resolve); response.once('close', resolve);
            });
          }
        }
        response.end(); return;
      }
      json(response, 404, { ok:false, msg:'找不到这个页面' });
    } catch (error) {
      if (!response.headersSent) json(response, 503, { ok:false, msg:error.message === 'python_not_ready'
        ? 'Python 依赖尚未准备好，请让 AI 安装 Flask、requests、python-dotenv 后重新保存配置。'
        : '请检查本地 Python 和 API 配置，重新打开后再试。' });
      else response.end();
    }
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(context.listen.port, context.listen.host, resolve);
  });
  context.logger.info('ai-office.ready');
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    context.signal.removeEventListener('abort', onAbort);
    if (checkingPython && checkingPython.exitCode === null) {
      const probe = checkingPython;
      await new Promise(resolve => {
        probe.once('exit', resolve); probe.once('error', resolve); probe.kill('SIGKILL');
      });
    }
    const process = child;
    if (process && process.exitCode === null) {
      await new Promise(resolve => {
        const timer = setTimeout(() => process.kill('SIGTERM'), 5000);
        const force = setTimeout(() => process.kill('SIGKILL'), 7000);
        process.once('exit', () => { clearTimeout(timer); clearTimeout(force); resolve(); });
        if (process.stdin.writable) process.stdin.write('{"type":"shutdown"}\n');
      });
    }
    rejectPending(); lines?.close();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  };
  const onAbort = () => { void dispose(); };
  context.signal.addEventListener('abort', onAbort, { once:true });
  if (context.signal.aborted) await dispose();
  return { dispose };
}
