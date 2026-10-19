import { createActivity } from './photo-activity.js';
import { createRecovery } from './photo-recovery.js';
import { createCanvasRecording } from './photo-recording.js';
import {
  t,
  initLanguage,
  setLanguage,
  getLanguage,
  getPreference,
  languages,
  subscribeLanguage,
  resolveLanguage,
} from './photo-i18n.js';
initLanguage();
import { mountPhotoAssistant, mountPhotoToolbar, mountPhotoWelcome } from './workbench-ui.js';
const frame = document.querySelector('#craft'),
  statusEl = document.querySelector('#photo-status');
const token = crypto.randomUUID(),
  editorId = crypto.randomUUID(),
  pending = new Map();
// Lets the host's page inspection identify this exact instance, even when
// several conversations have an editor from the same plugin open.
document.documentElement.dataset.photoEditorId = editorId;
const pageState = () => ({ visibility: document.visibilityState, focused: document.hasFocus() });
let current = { version: 'empty', document: null },
  running = false,
  events,
  panel,
  prepared;
let statusTimer,
  lastStatus = ['', {}],
  reporting = false,
  ready = false;
const status = (text, args = {}, persist = false) => {
  lastStatus = [text, args, persist];
  statusEl.textContent = t(text, args);
  statusEl.hidden = !text;
  clearTimeout(statusTimer);
  if (text && !persist)
    statusTimer = setTimeout(() => {
      statusEl.hidden = true;
      lastStatus = ['', {}];
    }, 6000);
};
const languageSelect = document.querySelector('#photo-language');
function translatePage() {
  document.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
  frame.title = 'MiniMax Photo';
  languageSelect.setAttribute('aria-label', t('语言'));
  languageSelect.replaceChildren(
    ...languages.map(([code, label]) => new Option(code === 'auto' ? t(label) : label, code)),
  );
  languageSelect.value = getPreference();
  status(...lastStatus);
  panel?.refresh();
  const summary = document.querySelector('#photo-more summary');
  summary.setAttribute('aria-label', t('更多'));
  summary.title = t('更多');
}
subscribeLanguage(translatePage);
translatePage();
languageSelect.onchange = async () => {
  const choice = languageSelect.value;
  languageSelect.disabled = true;
  try {
    if (ready) await call('language', { code: resolveChoice(choice) });
    setLanguage(choice);
  } catch (error) {
    languageSelect.value = getPreference();
    status(t('切换语言失败') + ': ' + error.message);
  } finally {
    languageSelect.disabled = false;
  }
};
function resolveChoice(choice) {
  return resolveLanguage(choice, navigator.languages || [navigator.language]);
}
window.addEventListener('languagechange', () => {
  if (getPreference() === 'auto') void languageSelect.onchange();
});
function call(method, args = {}, expectedVersion) {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(
        Object.assign(Error(t('引擎响应超时；请检查画面和任务记录，勿重复提交')), {
          unknown: true,
        }),
      );
    }, 110000);
    pending.set(id, { resolve, reject, timeout });
    frame.contentWindow.postMessage(
      { type: 'photo-request', token, id, method, args, expectedVersion },
      '*',
    );
  });
}
async function post(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const v = await r.json();
  if (!r.ok) throw Error(v.error);
  return v;
}
const activity = createActivity({ frame, call });
const recovery = createRecovery({ call, status });
const recordStart = document.querySelector('#photo-record');
const recordStop = document.querySelector('#photo-record-stop');
const recordSave = document.querySelector('#photo-record-save');
const recordDiscard = document.querySelector('#photo-record-discard');
const recording = createCanvasRecording({
  canvas: () => frame.contentDocument?.querySelector('#photocraft_canvas'),
  changed: state => {
    recordStart.hidden = state !== 'idle';
    recordStop.hidden = !['recording', 'stopping'].includes(state);
    recordStop.disabled = state === 'stopping';
    recordSave.hidden = recordDiscard.hidden = state !== 'ready';
    if (state === 'ready') status('录制已结束，可在更多菜单保存视频');
  },
  failed: error => status(t('录制失败') + ': ' + error.message),
});
recordStart.onclick = () => {
  try {
    recording.start();
    document.querySelector('#photo-more').open = false;
    status('正在录制编辑器画布，不会录到其他窗口');
  } catch (error) { status(t('录制失败') + ': ' + error.message); }
};
recordStop.onclick = () => recording.stop();
recordSave.onclick = () => recording.download();
recordDiscard.onclick = () => {
  if (confirm(t('清除尚未保存的录制视频？'))) recording.discard();
};
document.querySelector('#photo-recover').onclick = () => recovery.show();
document.querySelector('#photo-save').onclick = () => exportPhoto('pcraft');
window.addEventListener('beforeunload', (event) => {
  if (recovery.pending || running || recording.pending) { event.preventDefault(); event.returnValue = ''; }
});
async function report() {
  if (reporting) return;
  reporting = true;
  try {
    current = await call('inspect');
    await post('/api/editor/register', { editorId, engine: 'photocraft', ...current, page: pageState() });
    if (!running) await recovery.snapshot(current);
    document.querySelector('#photo-save').hidden = !current.document;
    panel?.refresh();
    welcome.refresh({ ready, hasDocument: !!current.document });
    toolbar.refresh(!!current.document);
    recordStart.disabled = !ready;
    frame.inert = running || !current.document;
  } finally {
    reporting = false;
  }
}
const emptyPNG = () => {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  return c.toDataURL();
};
async function job(jobId) {
  let j,
    applied = false,
    ownsLock = false,
    before;
  try {
    j = await post(`/api/editor/${editorId}/claim`, { jobId });
    if (running) throw Error(t('编辑器忙，请稍后重试'));
    running = true;
    ownsLock = true;
    frame.inert = true;
    document.activeElement?.blur();
    activity.clear();
    before = await call('inspect');
    status(
      j.options.method === 'batch' ? 'AI 正在执行 {count} 步编辑…' : 'AI 正在编辑图片…',
      { count: Array.isArray(j.options.args) ? j.options.args.length : 1 },
      true,
    );
    const value = await call(j.options.method, j.options.args, j.expectedVersion);
    applied = true;
    current = await call('inspect');
    const preview = current.document
      ? 'data:image/png;base64,' + (await call('preview')).data
      : emptyPNG();
    const data = value?.data;
    if (data) delete value.data;
    const result = { value, state: current };
    await post(`/api/editor/${editorId}/finish`, {
      jobId,
      claim: j.claim,
      preview,
      result,
      craftExport:
        j.options.method === 'export'
          ? { format: j.options.args?.format || 'png', data }
          : undefined,
    });
    await post(`/api/editor/${editorId}/ack`, { jobId, claim: j.claim, version: current.version });
    status(
      ['commands', 'preview', 'export'].includes(j.options.method)
        ? 'Agent 已读取画面或导出结果'
        : 'Agent 操作已完成 · 可在编辑器中撤销',
    );
  } catch (error) {
    if (j && !applied && !error.unknown)
      await post(`/api/editor/${editorId}/finish`, {
        jobId,
        claim: j.claim,
        error: error.message,
      }).catch(() => {});
    status(
      applied ? '画面已处理，但任务回执未确认；请检查画面，勿重复执行' : error.message,
      {},
      true,
    );
  } finally {
    if (ownsLock) {
      running = false;
      frame.inert = false;
    }
    await report().catch(() => {});
    if (ownsLock && applied) void activity.completed(j.options.method, j.options.args, before);
  }
}
window.addEventListener('message', async (e) => {
  if (e.source !== frame.contentWindow) return;
  if (e.data?.type === 'photo-response' && e.data.token === token) {
    const p = pending.get(e.data.id);
    if (!p) return;
    clearTimeout(p.timeout);
    pending.delete(e.data.id);
    e.data.error ? p.reject(Error(e.data.error)) : p.resolve(e.data.value);
  }
  if (e.data?.type === 'photo-failed') {
    status(e.data.error, {}, true);
    document.querySelector('#loading').textContent = e.data.error;
  }
  if (e.data?.type === 'photo-ready') {
    try {
      await call('language', { code: getLanguage() });
      ready = true;
      document.querySelector('#loading').hidden = true;
      await report();
      events = new EventSource(`/api/editor/${editorId}/events`);
      events.addEventListener('command', (e) => void job(JSON.parse(e.data).jobId));
      status('');
    } catch (error) {
      status(error.message, {}, true);
    }
  }
});
setInterval(() => {
  if (!document.querySelector('#loading').hidden) return;
  if (running && current) {
    // Keep the connection alive during long, visibly paced drawing jobs.
    // register ignores document/version changes while a job owns this editor.
    post('/api/editor/register', { editorId, engine: 'photocraft', ...current, page: pageState() }).catch(() => {});
  } else report().catch(() => {});
}, 3000);
document.addEventListener('visibilitychange', () => {
  if (ready) post('/api/editor/register', {
    editorId, engine: 'photocraft', ...current, page: pageState(),
  }).catch(() => {});
});
window.addEventListener('pagehide', () => events?.close(), { once: true });
async function action(fn) {
  activity.clear();
  if (running) return;
  running = true;
  try {
    await fn();
    await report();
  } catch (e) {
    status(e.message, {}, true);
  } finally {
    running = false;
  }
}
function download(data, name) {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes]));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
const fileData = (file) =>
  new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(r.result.split(',')[1]);
    r.onerror = no;
    r.readAsDataURL(file);
  });
document.querySelector('#photo-file').onchange = (e) =>
  void action(async () => {
    const f = e.target.files[0];
    if (f) {
      await call('open', { name: f.name, data: await fileData(f) });
      status('已打开 {name}', { name: f.name });
    }
    e.target.value = '';
  });
const exportPhoto = (format) =>
  void action(async () => {
    const v = await call('export', { format });
    download(v.data, (current.document?.name || 'MiniMax Photo').replace(/\.(pcraft|png|jpe?g|webp|psd)$/i, '') + '.' + format);
    status('已导出 {format}', { format: format.toUpperCase() });
  });
panel = mountPhotoAssistant({
  dock: true,
  showResults: () => showResults(),
  context: () => ({
    name: current.document?.name || '',
    supported: typeof window.mcode?.miniapp?.message?.append === 'function',
  }),
  prepare: async (mode, request) => {
    if (!ready) throw Error(t('正在加载图片编辑器…'));
    let text;
    if (mode === 'workbench')
      text = `请在 MiniMax Photo 的 PhotoCraft 编辑器完成：${request}\neditorId: ${editorId}。先 editor_inspect，再 photo_call(method="commands",args={filter:"关键词"}) 查询命令和参数；editor_job 读取结果。可用 editor_run_code：await editor.commands({filter})、execute({command,params})、edit([{command,params}])、preview()、create({width,height,name})、export({format})。每次调用逐个 await；结果在 .result.value，状态在 .result.state。用真实图层 ID；document.pixel 命令可读像素。每批 edit 整体提交，一次撤销；整段脚本不回滚。使用 editor_code_result 查询结果。版本冲突或中断先检查，禁止换编号盲目重试。`;
    else {
      if (mode === 'edit' && !current.document) throw Error(t('请先打开图片'));
      const key = JSON.stringify([mode, request, current.version]);
      if (prepared?.key !== key) {
        const reference =
          mode === 'edit' || (mode === 'auto' && current.document)
            ? 'data:image/png;base64,' + (await call('preview')).data
            : undefined;
        const r = await post('/api/agent/requests', {
          mode: mode === 'auto' ? (current.document ? 'edit' : 'generate') : mode,
          prompt: request,
          name: current.document?.name || t('Agent 图片'),
          reference,
        });
        prepared = { key, id: r.id };
      }
      text = `请用当前 MiniMax Code Agent 提供的生图/改图能力完成图片任务 ${prepared.id}：${request}。先 get_image_request 读取任务与参考图，再用宿主提供的模型生成 PNG，最后 submit_image_result 提交同一 requestId 和 imagePath。没有模型工具时请明确说明，不要假装生成成功。结果在 Mini App 的 AI 助手“生成结果”中打开。`;
    }
    if (getLanguage() !== 'zh-hans') {
      const instructions = {
        en: [
          'Please respond in English. Request:',
          'Inspect the editor, discover exact commands and parameters, then edit. Await each tool call in order. Each edit batch is atomic; the whole script is not. Check the original task after a conflict or unknown result; do not blindly retry.',
          'Read the image task, use the host image model and return a PNG with the same requestId. If no model is available, explain the limitation.',
        ],
        'zh-hant': [
          '請使用繁體中文回覆。需求：',
          '先讀取編輯器狀態並查詢命令參數，再執行編輯。每次工具呼叫必須依序 await。每批 edit 可整體復原；整段腳本不會整體回復。版本衝突或結果不明時請查詢原任務，勿盲目重試。',
          '先讀取圖片任務，使用宿主提供的模型，再以相同 requestId 回傳 PNG。沒有可用模型時請明確說明。',
        ],
        ja: [
          '日本語で回答してください。依頼：',
          '先にエディターの状態と命令の引数を確認してから編集してください。各ツールを順番に await してください。edit の各バッチは一括で反映されますが、スクリプト全体は一括で取り消せません。競合や結果不明の場合は元のタスクを確認し、むやみに再実行しないでください。',
          '画像タスクを読み取り、ホストの画像モデルを使用して、同じ requestId で PNG を返してください。モデルが利用できない場合は、その制限を説明してください。',
        ],
      }[getLanguage()];
      text =
        `${instructions[0]} ${request}\neditorId: ${editorId}\n` +
        (mode === 'workbench'
          ? `${instructions[1]}\neditor_inspect → photo_call(method="commands", args={filter:"…"}) → photo_call / editor_run_code → editor_code_result / editor_job.\nawait editor.commands({filter}); await editor.execute({command,params}); await editor.edit([{command,params}]); await editor.preview(); await editor.create({width,height,name}); await editor.export({format});`
          : `${instructions[2]}\nrequestId: ${prepared.id}\nget_image_request → submit_image_result({requestId,imagePath})`);
    }
    if (mode === 'auto')
      text = `\nAutomatically choose image generation/editing or direct editor tools based on the user's request. For direct editing, first editor_inspect(editorId="${editorId}"), then photo_call commands to discover parameters. Use editor_run_code for loops and atomic edit batches; query editor_code_result and editor_job. Only use get_image_request(requestId="${prepared.id}") and submit_image_result when a generative model is needed. The image request is optional. Preserve original dimensions and content unless the user requests cropping or removal. Never silently crop a generated image. User request: ${request}. If intent is unclear, ask first. Respond in ${getLanguage()}.`;
    return text;
  },
});
const showResults = async () => {
  try {
    const r = await fetch('/api/agent/requests');
    if (!r.ok) throw Error('results');
    const { requests } = await r.json();
    const list = document.querySelector('#result-list');
    if (!list) return;
    list.replaceChildren();
    list.closest('details').hidden = !requests.some((item) => item.status === 'ready');
    for (const item of requests.filter((item) => item.status === 'ready')) {
      const row = document.createElement('div'),
        label = document.createElement('span');
      const thumbnail = document.createElement('img');
      thumbnail.src = `/api/agent/requests/${item.id}/result`;
      thumbnail.alt = item.prompt;
      thumbnail.loading = 'lazy';
      label.textContent = item.prompt;
      row.append(thumbnail, label);
      const b = document.createElement('button');
      b.textContent = item.status === 'ready' ? t('打开图片') : t('等待返回');
      b.disabled = item.status !== 'ready';
      b.onclick = () =>
        void action(async () => {
          const r = await fetch(`/api/agent/requests/${item.id}/result`);
          if (!r.ok) throw Error(t('读取图片失败'));
          await call('open', {
            name: item.name.replace(/\.(png|jpe?g|webp)$/i, '') + '.png',
            data: await fileData(await r.blob()),
          });

          status('Agent 图片已打开');
        });
      row.append(b);
      list.append(row);
    }
    if (!list.childElementCount) list.textContent = t('生成后的图片会显示在这里');
  } catch {
    const list = document.querySelector('#result-list');
    if (list) { list.closest('details').hidden = false; const retry = document.createElement('button'); retry.textContent = t('读取结果失败，请点击重试'); retry.onclick = showResults; list.replaceChildren(retry); }
  }
};

const toolbar = mountPhotoToolbar({
  export: () => exportPhoto('png'),
});

const more = document.querySelector('#photo-more');
more.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    more.open = false;
    more.querySelector('summary').focus();
    event.stopPropagation();
  }
});
document.addEventListener('pointerdown', (event) => {
  if (more.open && !more.contains(event.target)) more.open = false;
});
const imageEvents = new EventSource('/api/agent/events');
imageEvents.addEventListener('result', () => {
  status('Agent 图片已返回');
  if (document.querySelector('#result-list')) void showResults();
});
window.addEventListener('pagehide', () => imageEvents.close(), { once: true });

const welcome = mountPhotoWelcome({
  openShowcase: (id) =>
    void action(async () => {
      if (!['product', 'portrait', 'poster'].includes(id)) return;
      const response = await fetch('/showcase/' + id + '.webp');
      if (!response.ok) throw Error(t('读取图片失败'));
      await call('open', {
        name: 'MiniMax Photo · ' + id + '.webp',
        data: await fileData(await response.blob()),
      });
    }),
  open: () => document.querySelector('#photo-file').click(),
  create: () =>
    void action(async () => {
      await call('execute', {
        command: 'file.new',
        params: { width: 1600, height: 1000, name: t('新建画布'), background: '#ffffff' },
      });
    }),
  choose: (id) =>
    panel.compose(
      t(
        {
          product: '请先让我上传商品图，保留商品主体，把背景换成干净的浅色摄影棚，保持自然阴影。',
          portrait: '请先让我上传照片，调整曝光和白平衡，让光线更温暖，保留自然肤色和细节。',
          poster:
            '帮我制作一张社交海报。请先询问主题、标题和发布平台，再确定尺寸、配图和文字排版。',
        }[id],
      ),
    ),
});
