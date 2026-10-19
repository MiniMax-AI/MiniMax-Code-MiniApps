import { readEditorImage } from './editor-read.js';
import { executeEditorBatch, describeDocument } from './editor-commands.js';
import { serialize, documentModel } from './model.js';

export function installEditorBridge(state, { refresh, status, runFilter, addDoc }) {
  const editorId = crypto.randomUUID();
  let version = crypto.randomUUID(),
    events,
    timer,
    closed = false,
    running = false,
    reportTimer;
  const post = async (path, body) => {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || 'Agent 编辑连接失败');
    return result;
  };
  async function report() {
    if (closed) return;
    await post('/api/editor/register', {
      editorId,
      version,
      document: state.doc ? describeDocument(state.doc) : null,
    });
  }
  const changed = () => {
    version = crypto.randomUUID();
    clearTimeout(reportTimer);
    reportTimer = setTimeout(() => {
      report().catch(() => {});
    }, 100);
  };
  async function handle(jobId) {
    let job,
      committed = false;
    try {
      job = await post(`/api/editor/${editorId}/claim`, { jobId });
      if (
        running ||
        state.busy ||
        state.drag ||
        state.polygonDraft ||
        document.querySelector('#dialog').open
      )
        throw Error('用户正在编辑或有弹窗，请结束当前操作再试');
      if (job.expectedVersion !== version) throw Error('工程已变化，请重新读取状态');
      if (!state.doc && job.kind !== 'create') throw Error('没有打开工程');
      running = true;
      state.busy = true;
      document.body.inert = true;
      status(job.kind === 'preview' ? 'Agent 正在读取画面…' : 'Agent 正在编辑，完成后可整体撤销…');
      const original =
        job.kind === 'create'
          ? documentModel(job.newDocument.width, job.newDocument.height, job.newDocument.name)
          : state.doc;
      const result =
        job.kind === 'batch'
          ? await executeEditorBatch(original, job.operations, { runFilter })
          : { document: original, results: [], description: describeDocument(original) };
      const { preview, full, scale, region, pixels } = readEditorImage(
        result.document,
        job.options,
      );
      const checkpoint = ['batch', 'export', 'create'].includes(job.kind)
        ? await serialize(result.document)
        : undefined;
      const finish = {
        jobId,
        claim: job.claim,
        preview: preview.toDataURL('image/png'),
        checkpoint,
        exportImage: job.kind === 'export' ? full.toDataURL('image/png') : undefined,
        result: {
          ...result.description,
          steps: result.results,
          previewScale: scale,
          region,
          pixels,
        },
      };
      // Durable checkpoint first. A lost response must not cause a new plan to run.
      await post(`/api/editor/${editorId}/finish`, finish);
      if (job.kind === 'batch') {
        const index = state.docs.indexOf(original);
        state.docs[index] = result.document;
        state.doc = result.document;
        state.maskEditing = false;
        refresh();
      }
      if (job.kind === 'create') addDoc(result.document);
      committed = true;
      await post(`/api/editor/${editorId}/ack`, { jobId, claim: job.claim, version });
      status(
        job.kind === 'create'
          ? 'Agent 已新建工程 · 原工程保留'
          : ['batch'].includes(job.kind)
            ? 'Agent 编辑完成 · 可撤销整批操作 · 检查点已保存'
            : 'Agent 已读取画面',
      );
    } catch (error) {
      if (job && !committed)
        await post(`/api/editor/${editorId}/finish`, {
          jobId,
          claim: job.claim,
          error: error.message,
        }).catch(() => {});
      status(
        committed ? '编辑已应用，但回执未确认；请检查当前工程，不要重复执行' : error.message,
        true,
      );
    } finally {
      if (running) {
        state.busy = false;
        running = false;
        document.body.inert = false;
      }
      await report().catch(() => {});
    }
  }
  report()
    .then(() => {
      if (closed) return;
      events = new EventSource(`/api/editor/${editorId}/events`);
      events.addEventListener('command', (event) => {
        const { jobId } = JSON.parse(event.data);
        void handle(jobId);
      });
    })
    .catch(() => status('Agent 编辑连接未建立；手动修图仍可使用', true));
  timer = setInterval(() => {
    report().catch(() => {});
  }, 15000);
  window.addEventListener(
    'pagehide',
    () => {
      closed = true;
      events?.close();
      clearInterval(timer);
      clearTimeout(reportTimer);
    },
    { once: true },
  );
  changed.context = () => ({ editorId, version });
  return changed;
}
