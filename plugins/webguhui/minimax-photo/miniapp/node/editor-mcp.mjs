import { editorCapabilities } from '../client/editor-commands.js';
const uuid = { type: 'string', pattern: '^[a-f0-9-]{36}$' };
const schema = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
export const editorTools = [
  {
    name: 'photo_call',
    description:
      '调用 PhotoCraft WASM 编辑器。先 commands({filter}) 查询真实命令与参数，再 execute({command,params})；batch 接受 [{command,params}]，在独立文档上执行并整体提交/撤销。draw({strokes:[paint.stroke参数],intervalMs:550}) 支持 points 或 SVG 风格绝对 path 命令数组 M/L/Q/C/Z（工具自动采样曲线）。实际逐笔绘制，每笔可见且单独撤销，1..96笔，间隔100..600ms；中断保留已画笔触。preview 返回画面；export 支持 png/jpg/webp/pcraft/psd/ora/tif。使用 editor_job 查询结果，禁止盲目重放。',
    inputSchema: schema({
      editorId: uuid,
      expectedVersion: { type: 'string' },
      requestId: uuid,
      method: { type: 'string', enum: ['commands', 'execute', 'batch', 'draw', 'preview', 'export'] },
      args: {},
    }),
    annotations: { destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'editor_run_code',
    description:
      '执行 JavaScript PTC 脚本。PhotoCraft 支持 draw({strokes:[paint.stroke参数],intervalMs:550}) 逐笔显示绘画过程（1..96笔，100..600ms），commands({filter})、execute({command,params})、edit([{command,params}])、preview()、create()、export({format})，参数以 commands 查询为准。支持变量、循环、条件和 await。提供 editor.inspect()、capabilities()、preview(options)、edit(operations)、create({width,height,name})、export()，均须逐个 await；返回真实任务结果。preview 返回 result.pixels 及 previewPath，可按像素分支。32KB代码、32MB内存、120秒、64次调用。无文件、网络或 Node API。每批 edit 原子执行；脚本整体不回滚。返回 runId，用 editor_code_result 查询；相同 requestId 不重放。',
    inputSchema: schema({
      editorId: uuid,
      expectedVersion: { type: 'string' },
      requestId: uuid,
      code: { type: 'string', maxLength: 32768 },
    }),
    annotations: { destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'editor_code_result',
    description:
      '读取 PTC 执行状态、返回值和每一步任务编号。错误或中断不代表之前的操作回滚；用 editor_job 检查 trace 中已提交任务。',
    inputSchema: schema({ runId: uuid }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'editor_capabilities',
    description:
      '仅用于旧版 canvas 引擎；photocraft 请用 photo_call(method:commands) 或 PTC editor.commands()。读取编辑操作目录、参数范围、混合模式和批量组合规则。旧版编辑前调用。支持命名图层引用，最多64步的事务；不是任意 JavaScript 执行环境。',
    inputSchema: schema({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'editor_list',
    description: '列出连接的工作台、文档、版本和页面可见状态。先在当前聊天打开 minimax-photo；多个实例时，通过当前页面 html 的 data-photo-editor-id 属性匹配 editorId。page.visibility/focused 仅为浏览器状态提示，不证明聊天归属；不自动选择首项或最新窗口。',
    inputSchema: schema({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'editor_inspect',
    description:
      '读取当前工程结构、图层、选区、版本。返回页面最后报告的状态；修改前使用 expectedVersion 防止覆盖用户的新操作。',
    inputSchema: schema({ editorId: uuid }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'editor_preview',
    description:
      '仅用于旧版 canvas 引擎；photocraft 请用 photo_call(method:preview) 或 PTC editor.preview()。请求合并画面、单图层或局部区域 PNG 预览，并可取样像素 RGBA。返回任务编号；随后用 editor_job 查询，完成后得到 image 内容。需要页面打开。',
    inputSchema: {
      ...schema({ editorId: uuid, expectedVersion: { type: 'string' }, requestId: uuid }),
      properties: {
        editorId: uuid,
        expectedVersion: { type: 'string' },
        requestId: uuid,
        options: {
          type: 'object',
          properties: {
            layerId: { type: 'string' },
            maxEdge: { type: 'integer', minimum: 64, maximum: 4096 },
            region: {
              type: 'object',
              properties: {
                x: { type: 'integer' },
                y: { type: 'integer' },
                width: { type: 'integer' },
                height: { type: 'integer' },
              },
              required: ['x', 'y', 'width', 'height'],
              additionalProperties: false,
            },
            points: {
              type: 'array',
              maxItems: 256,
              items: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2 },
            },
          },
          additionalProperties: false,
        },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'editor_batch',
    description:
      '仅用于旧版 canvas 引擎；photocraft 请用 photo_call(method:batch) 或 PTC editor.edit()。按顺序执行编辑计划，支持读到的图层ID及 $命名引用。整批失败不修改工程，成功可一次撤销。每次新计划用新 requestId；不确定结果时查询原任务，不重新提交不同编号。完成后生成持久化工程检查点和预览。',
    inputSchema: schema({
      editorId: uuid,
      expectedVersion: { type: 'string' },
      requestId: uuid,
      operations: {
        type: 'array',
        minItems: 1,
        maxItems: 64,
        items: {
          type: 'object',
          required: ['op'],
          properties: { op: { type: 'string', enum: Object.keys(editorCapabilities.operations) } },
        },
      },
    }),
    annotations: { destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'editor_create',
    description:
      '仅用于旧版 canvas 引擎；photocraft 请用 PTC editor.create()。创建新的空白工程并显示，保留当前已打开工程。宽高为整数，最多3200万像素。创建后读取新文档再批量绘制。',
    inputSchema: schema({
      editorId: uuid,
      expectedVersion: { type: 'string' },
      requestId: uuid,
      name: { type: 'string', maxLength: 200 },
      width: { type: 'integer', minimum: 1 },
      height: { type: 'integer', minimum: 1 },
    }),
    annotations: { destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'editor_export',
    description:
      '仅用于旧版 canvas 引擎；photocraft 请用 photo_call(method:export) 或 PTC editor.export()。导出当前完整尺寸 PNG 和可编辑工程检查点到本机，返回任务编号。不会更改画布。用 editor_job 查询导出路径；PNG 最大16MB。',
    inputSchema: schema({ editorId: uuid, expectedVersion: { type: 'string' }, requestId: uuid }),
    annotations: { destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'editor_job',
    description:
      '查询编辑或预览任务。成功时返回预览图及本机 PNG、工程检查点路径。中断状态不会自动重放；检查当前工程后处理。',
    inputSchema: schema({ jobId: uuid }),
    annotations: { readOnlyHint: true },
  },
];
export async function callEditorTool(name, args, editor) {
  const spec = editorTools.find((t) => t.name === name);
  if (!spec) throw Error('未知编辑工具');
  if (
    !args ||
    typeof args !== 'object' ||
    Array.isArray(args) ||
    Object.keys(args).some((k) => !Object.hasOwn(spec.inputSchema.properties, k)) ||
    spec.inputSchema.required.some((k) => args[k] === undefined)
  )
    throw Error('编辑工具参数无效');
  let result;
  if (name === 'photo_call')
    result = await editor.submit({
      ...args,
      kind: 'craft',
      options: { method: args.method, args: args.args },
    });
  else if (name === 'editor_run_code') result = await editor.code.submit(args);
  else if (name === 'editor_code_result') result = await editor.code.result(args.runId);
  else if (name === 'editor_capabilities') result = editorCapabilities;
  else if (name === 'editor_list') result = { editors: editor.list() };
  else if (name === 'editor_inspect') result = editor.inspect(args.editorId);
  else if (['editor_preview', 'editor_batch', 'editor_export', 'editor_create'].includes(name))
    result = await editor.submit({
      ...args,
      kind:
        name === 'editor_create'
          ? 'create'
          : name === 'editor_preview'
            ? 'preview'
            : name === 'editor_export'
              ? 'export'
              : 'batch',
    });
  else result = await editor.result(args.jobId);
  const content = [{ type: 'text', text: JSON.stringify(result) }];
  if (name === 'editor_job' && result.status === 'succeeded')
    content.push({ type: 'image', mimeType: 'image/png', data: await editor.preview(args.jobId) });
  if (
    name === 'editor_code_result' &&
    ['succeeded', 'failed', 'interrupted'].includes(result.status)
  ) {
    const last = result.trace.findLast((step) => step.jobId && step.status === 'succeeded');
    if (last)
      content.push({
        type: 'image',
        mimeType: 'image/png',
        data: await editor.preview(last.jobId),
      });
  }
  return { content };
}
