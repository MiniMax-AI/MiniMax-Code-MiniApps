// The hosted MCP endpoint.
//
// The Host rewrites the address of the server declared in `servers.mcp.json`,
// so this file only has to speak Streamable HTTP on the path the manifest
// mounts. It is stateless: a request carries everything, the answer carries
// everything back, and there is no session to keep alive.
//
// The reading tools are read-only. The writing tools do not write the stored
// document behind the page's back: the page is the only writer of a canvas,
// so a change is handed to the page when the page holds the canvas, and the
// runtime applies it itself when nobody is looking at it.
//
// The rules about a node — its role, what it holds, what it hands on, which
// kinds it can take — are the same pure functions the page renders from, so
// what the Agent reads is what the user sees on the card.
import { batchCount, effectiveOption, inputSlotState, kindOf, modeOf, modeRecordOf, roleOf, slotsOf } from '../client/tools.mjs';
import { NODE_MODES, stripInputs } from '../client/forms.mjs';
import { limitsForNodeType, PROMPT_TEMPLATES } from './capabilities.mjs';

// Keep in sync with `mcpEndpoints` in miniapp/miniapp.json.
export const MCP_PATH = '/mcp/canvas';

const PROTOCOL_VERSION = '2025-03-26';
const MAX_BODY_BYTES = 256 * 1024;
const MAX_BATCH = 20;
const PROMPT_LIMIT = 240;

// The templates the prompt node can expand a sentence with, named so the
// Agent can pick one without reading the whole table.
const PROMPT_TEMPLATE_IDS = PROMPT_TEMPLATES.map((item) => item.id);
const PROMPT_TEMPLATE_HINT = PROMPT_TEMPLATES
  .map((item) => `${item.id}（${item.label}）`)
  .join('、');

// The modes the Agent may set, and what they are called. The list comes from
// the mode table, so a mode that is added, renamed or taken away is in this
// tool's description the moment it is — there is no second copy to forget.
const MODE_IDS = Object.values(NODE_MODES).flat().map((mode) => mode.id);
const MODE_HINT = [
  ['text', 'text 节点'],
  ['image', 'image 节点'],
  ['video', 'video 节点'],
  ['audio', 'audio 节点'],
]
  .map(([type, name]) => {
    const list = (NODE_MODES[type] ?? []).map((mode) => `${mode.id}（${mode.label}）`).join('、');
    return `${name}可用 ${list}`;
  })
  .join('，');

export const MCP_TOOLS = [
  {
    name: 'canvas_list',
    description:
      '列出节点画布里的全部画布：id、标题、节点数、最后修改时间。只读，不改任何画布。',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'canvas_read',
    description:
      '读取一张画布的结构：每个节点的类型、标题、状态、模型与参数，它声明的输入/输出插槽及哪些已经接入，以及节点之间的连线。只读，不改任何画布。不给 id 时读最近修改的那一张。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '画布 id；省略时读最近修改的一张' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'canvas_add_node',
    description:
      '在画布上加一个节点。type 取 input（输入）、text（生成·文本）、image（生成·图片）、video（生成·视频）、audio（生成·音频）、group（分组）。可以写标题、提示词和位置；input 节点还可以用 kind 指定它装的是 text / image / video / audio，text 节点可以用 mode 指定 prompt（提示词增强），audio 节点可以用 mode 指定 music（文生音乐）。不给 id 时加到最后修改的那张画布。改的是画布上用户看得见的东西。'
      + ` 用 mode=prompt 建的提示词增强节点，可以用 templateId 指定扩写要遵守的模板：${PROMPT_TEMPLATE_HINT}；`
      + '写 H3 视频的提示词就用 h3- 开头的模板，手写一遍那个结构很容易漏掉分段、镜头时间码和声音层。'
      + ` 可选：${PROMPT_TEMPLATE_IDS.join('、')}。`,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '画布 id；省略时用最近修改的一张' },
        type: {
          type: 'string',
          enum: ['input', 'text', 'image', 'video', 'audio', 'group'],
          description: '节点的形态',
        },
        title: { type: 'string', description: '卡片上的标题' },
        prompt: { type: 'string', description: '节点自己的提示词' },
        kind: {
          type: 'string',
          enum: ['text', 'image', 'video', 'audio'],
          description: '只有 input 节点用得上：它装的是什么',
        },
        mode: {
          type: 'string',
          enum: MODE_IDS,
          description: `节点做什么：模式决定它接什么（左侧的端点）。${MODE_HINT}。参考生视频（image2video）可以接图、视频和音频当参考，provider 一次最多收 12 项；音频不能单独来，要配一张图或一条视频。`,
        },
        x: { type: 'number', description: '画布上的横坐标' },
        y: { type: 'number', description: '画布上的纵坐标' },
        templateId: {
          type: 'string',
          enum: PROMPT_TEMPLATE_IDS,
          description: `只有 mode=prompt 的节点用得上：扩写要遵守的模板。${PROMPT_TEMPLATE_HINT}`,
        },
        templateText: {
          type: 'string',
          description: '只有 mode=prompt 的节点用得上：自己写的模板要求；不给就按 templateId 那个模板的文本',
        },
      },
      required: ['type'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, idempotentHint: true },
  },
  {
    name: 'canvas_connect',
    description:
      '把两个节点连起来：from 是上游节点 id，to 是下游节点 id。连线带走的是上游产出的那种数据（文本 / 图片 / 视频 / 音频）。下游的端口由它的模式决定：模式接不下这种数据时，会自动切到接得住的模式；没有模式接得下就连不上。图生视频·首尾帧有两个图片口，用 role 指明是首帧还是尾帧。改的是画布上用户看得见的东西。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '画布 id；省略时用最近修改的一张' },
        from: { type: 'string', description: '上游节点 id' },
        to: { type: 'string', description: '下游节点 id' },
        role: {
          type: 'string',
          enum: ['first', 'last'],
          description: '接在哪个口上：图生视频·首尾帧 的首帧（first）或尾帧（last）；别的模式不用给',
        },
      },
      required: ['from', 'to'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, idempotentHint: true },
  },
  {
    name: 'canvas_update_node',
    description:
      '改一个节点：标题、提示词、模型、画幅、分辨率、时长、数量、音色、情绪、模式、扩写模板。不给的字段就不动。改模式时，下游端口跟着变，这个模式接不住的连线会被去掉。改的是画布上用户看得见的东西。'
      + ` 提示词增强节点还可以用 templateId 换扩写模板：${PROMPT_TEMPLATE_HINT}。`,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '画布 id；省略时用最近修改的一张' },
        nodeId: { type: 'string', description: '要改的节点 id' },
        title: { type: 'string', description: '卡片上的标题' },
        prompt: { type: 'string', description: '节点自己的提示词' },
        model: { type: 'string', description: '模型 id' },
        ratio: { type: 'string', description: '画幅' },
        resolution: { type: 'string', description: '分辨率' },
        duration: { type: 'number', description: '时长（秒）' },
        count: { type: 'number', description: '一次生成几张（图片 / 音频 / 音乐可用）' },
        voice: { type: 'string', description: '音色 id' },
        emotion: { type: 'string', description: '情绪' },
        mode: {
          type: 'string',
          enum: MODE_IDS,
          description: `节点做什么：模式决定它接什么（左侧的端点）。${MODE_HINT}。参考生视频（image2video）可以接图、视频和音频当参考，provider 一次最多收 12 项；音频不能单独来，要配一张图或一条视频。`,
        },
        templateId: {
          type: 'string',
          enum: PROMPT_TEMPLATE_IDS,
          description: `只有提示词增强节点用得上：换掉扩写要遵守的模板。${PROMPT_TEMPLATE_HINT}`,
        },
        templateText: {
          type: 'string',
          description: '只有提示词增强节点用得上：自己写的模板要求；不给就按 templateId 那个模板的文本',
        },
      },
      required: ['nodeId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, idempotentHint: true },
  },
  {
    name: 'canvas_list_templates',
    description:
      '列出这个画布上可以用的工作流模板：一条链的骨架（节点、连线、提示词、参数），不含任何已经跑出来的结果。内置的模板有图片复刻、视频模仿（把素材先读回成一段提示词，再拿提示词去生成），以及 H3 的五种形状：文字、首帧、首尾帧、末帧、全参考。想少从零搭一条链的时候，先读这里。',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'canvas_apply_template',
    description:
      '把一个工作流模板铺到画布上：按模板的骨架建出节点、连好线、填好提示词和参数。铺完不会自己跑 —— 要跑就再调 canvas_run，跑了才花钱。模板名用 canvas_list_templates 给的 id。不给画布 id 时用最近修改的那张。改的是画布上用户看得见的东西。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '画布 id；省略时用最近修改的一张' },
        template: { type: 'string', description: '模板 id，来自 canvas_list_templates' },
      },
      required: ['template'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, idempotentHint: false },
  },
  {
    name: 'canvas_remove_node',
    description:
      '删掉一个节点，连在它上面的线也一起去掉。删掉的东西没法恢复。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '画布 id；省略时用最近修改的一张' },
        nodeId: { type: 'string', description: '要删的节点 id' },
      },
      required: ['nodeId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
  {
    name: 'canvas_run',
    description:
      '跑一次某个节点。只跑这一个节点，不会自动补上游：上游还没出结果的话，要先自己跑上游。生成要花钱，视频可能跑十几分钟，返回的是「已经开始」，结果用 canvas_read 看。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '画布 id；省略时用最近修改的一张' },
        nodeId: { type: 'string', description: '要跑的节点 id' },
      },
      required: ['nodeId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
];

/**
 * The slots of one node, as the card shows them.
 *
 * Whether an input is filled is decided by the whole chain above the node,
 * because that is what a run takes with it. The states are the same three the
 * card uses: filled, ready and open.
 *
 * The slots read the same rule the card's strip reads: the text goes into the
 * card's text box, and a kind the model cannot take is not an input.
 */
export function slotsOfNode(canvas, node, caps = capsOf(node)) {
  return {
    inputs: stripInputs(node, caps).map((slot) => ({
      kind: slot.kind,
      state: inputSlotState(canvas, node, slot.kind),
    })),
    outputs: slotsOf(node).outputs.map((slot) => ({ kind: slot.kind, state: 'out' })),
  };
}

/**
 * The limits of a node, the way the page reads them.
 *
 * A model may only offer a resolution for some durations, and the page
 * narrows the list to the duration the node carries.
 */
export function capsOf(node) {
  const caps = limitsForNodeType(node.type, node.metadata?.model) ?? {};
  const allowed = caps.resolutionByDuration?.[String(node.metadata?.duration)];
  return allowed ? { ...caps, resolutions: allowed } : caps;
}

/**
 * The parameters the card shows.
 *
 * A node that was never touched keeps an empty parameter, and the drop-down
 * then shows the first value the model offers. A reader has to see that value,
 * not the empty one.
 */
export function effectiveParams(node, caps) {
  return {
    ratio: effectiveOption(caps.ratios, node.metadata?.ratio)?.value ?? '',
    resolution: effectiveOption(caps.resolutions, node.metadata?.resolution)?.value ?? '',
    duration: effectiveOption(caps.durations, node.metadata?.duration)?.value ?? '',
    // How many assets one run of this node produces.
    count: batchCount(node.type, node.metadata?.count),
  };
}

/** The canvas as the Agent should read it. */
export function describeCanvas(canvas) {
  const nodes = canvas?.nodes ?? [];
  const connections = canvas?.connections ?? [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return {
    id: canvas?.id ?? '',
    title: canvas?.title ?? '',
    updatedAt: canvas?.updatedAt ?? '',
    nodeCount: nodes.length,
    connectionCount: connections.length,
    nodes: nodes.map((node) => {
      const caps = capsOf(node);
      return {
        id: node.id,
        type: node.type,
        role: roleOf(node),
        title: node.title ?? '',
        status: node.metadata?.output?.status ?? 'idle',
        contentKind: kindOf(node),
        // The mode says what the node takes, and the slots are its inputs.
        mode: modeOf(node),
        modeLabel: modeRecordOf(node)?.label ?? '',
        slots: slotsOfNode(canvas, node, caps),
        model: node.metadata?.model ?? '',
        prompt: String(node.metadata?.prompt ?? '').slice(0, PROMPT_LIMIT),
        params: effectiveParams(node, caps),
      };
    }),
    connections: connections.map((conn) => ({
      from: conn.fromNodeId,
      to: conn.toNodeId,
      // The kind the line is drawn with: the live kind of the source, and the
      // stored one only as a fallback for an old canvas.
      kind: kindOf(byId.get(conn.fromNodeId)) || conn.kind || '',
    })),
  };
}

/** The canvas a tool works on: the one that was named, or the last one touched. */
async function resolveCanvas(store, args) {
  const id = args?.id ?? (await store.list())[0]?.id;
  if (!id) throw Object.assign(new Error('还没有画布'), { code: 'NOT_FOUND' });
  const canvas = await store.get(id);
  if (!canvas) throw Object.assign(new Error('画布不存在'), { code: 'NOT_FOUND' });
  return canvas;
}

/** Only the fields that were actually given. */
function definedArgs(source, keys) {
  const out = {};
  for (const key of keys) {
    if (source?.[key] !== undefined && source[key] !== null) out[key] = source[key];
  }
  return out;
}

/**
 * Hand a change to the canvas and report what happened.
 *
 * The page is the only writer of a canvas, so the change is applied by the
 * page when the page holds the canvas, and by the runtime when nobody is
 * looking at it. Either way the rule is the same one.
 */
async function deliver(queue, canvas, action) {
  const result = await queue.deliver(canvas.id, action);
  if (!result?.ok) {
    throw Object.assign(new Error(result?.error || '这个改动没有生效'), { code: 'ACTION_FAILED' });
  }
  return {
    ...(result.info ?? {}),
    // Who applied it, so the Agent can tell the user where to look.
    appliedBy: result.appliedBy === 'page' ? '画布页面' : '运行时',
  };
}

/** Run one tool and return its result. */
export async function callCanvasTool(name, args, { store, queue, templates }) {
  if (name === 'canvas_list') {
    return { canvases: await store.list() };
  }
  if (name === 'canvas_read') {
    const list = await store.list();
    const id = args.id ?? list[0]?.id;
    if (!id) throw Object.assign(new Error('还没有画布'), { code: 'NOT_FOUND' });
    const canvas = await store.get(id);
    if (!canvas) throw Object.assign(new Error('画布不存在'), { code: 'NOT_FOUND' });
    return describeCanvas(canvas);
  }
  if (name === 'canvas_add_node') {
    const canvas = await resolveCanvas(store, args);
    return deliver(queue, canvas, {
      type: 'add_node',
      args: definedArgs(args, ['type', 'title', 'prompt', 'kind', 'mode', 'x', 'y', 'templateId', 'templateText']),
    });
  }
  if (name === 'canvas_connect') {
    const canvas = await resolveCanvas(store, args);
    return deliver(queue, canvas, {
      type: 'connect',
      args: { from: args.from, to: args.to, role: args.role },
    });
  }
  if (name === 'canvas_update_node') {
    const canvas = await resolveCanvas(store, args);
    return deliver(queue, canvas, {
      type: 'update_node',
      args: { id: args.nodeId, ...definedArgs(args, ['title', 'prompt', 'model', 'ratio', 'resolution', 'duration', 'count', 'voice', 'emotion', 'mode', 'templateId', 'templateText']) },
    });
  }
  if (name === 'canvas_list_templates') {
    const list = templates ? await templates() : [];
    return {
      templates: list.map((item) => ({
        id: item.id,
        title: item.title,
        description: item.description ?? '',
        own: Boolean(item.own),
      })),
    };
  }
  if (name === 'canvas_apply_template') {
    const list = templates ? await templates() : [];
    const template = list.find((item) => item.id === args.template);
    if (!template) throw Object.assign(new Error('没有这个模板'), { code: 'NOT_FOUND' });
    const canvas = await resolveCanvas(store, args);
    return deliver(queue, canvas, {
      type: 'apply_template',
      args: { template },
    });
  }
  if (name === 'canvas_remove_node') {
    const canvas = await resolveCanvas(store, args);
    return deliver(queue, canvas, {
      type: 'remove_node',
      args: { id: args.nodeId },
    });
  }
  if (name === 'canvas_run') {
    const canvas = await resolveCanvas(store, args);
    return deliver(queue, canvas, {
      type: 'run',
      args: { nodeId: args.nodeId },
    });
  }
  throw Object.assign(new Error('未知工具'), { code: 'UNKNOWN_TOOL' });
}

/**
 * Handle one MCP request.
 *
 * The transport is stateless Streamable HTTP with JSON answers: a request
 * carries everything it needs and the answer carries everything back.
 */
export async function handleMcp(req, res, { store, queue, serverInfo, json, templates }) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'Use POST' });
  }
  if (!req.headers['content-type']?.startsWith('application/json')) {
    return json(res, 415, { error: 'JSON required' });
  }
  const accept = req.headers.accept || '';
  if (!accept.includes('application/json') || !accept.includes('text/event-stream')) {
    return json(res, 406, { error: 'Accept JSON and SSE' });
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Invalid JSON' },
    });
  }

  const dispatch = async (message) => {
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      return {
        jsonrpc: '2.0',
        id: message?.id ?? null,
        error: { code: -32600, message: 'Invalid request' },
      };
    }
    // A notification carries no id and is answered with nothing.
    if (message.id === undefined) return null;
    const reply = (result) => ({ jsonrpc: '2.0', id: message.id, result });
    if (message.method === 'initialize') {
      return reply({
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo,
      });
    }
    if (message.method === 'ping') return reply({});
    if (message.method === 'tools/list') return reply({ tools: MCP_TOOLS });
    if (message.method === 'tools/call') {
      try {
        const { name, arguments: args = {} } = message.params || {};
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error('工具参数无效');
        if (!MCP_TOOLS.some((tool) => tool.name === name)) throw Error('未知工具');
        const result = await callCanvasTool(name, args, { store, queue, templates });
        return reply({ content: [{ type: 'text', text: JSON.stringify(result) }] });
      } catch (error) {
        const text = error?.message || '这个操作没有成功';
        return reply({ isError: true, content: [{ type: 'text', text }] });
      }
    }
    return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } };
  };

  const messages = Array.isArray(body) ? body : [body];
  if (!messages.length || messages.length > MAX_BATCH) return json(res, 400, { error: 'Invalid batch' });
  const replies = [];
  for (const message of messages) {
    const reply = await dispatch(message);
    if (reply) replies.push(reply);
  }
  if (!replies.length) {
    res.writeHead(202);
    return res.end();
  }
  return json(res, 200, Array.isArray(body) ? replies : replies[0]);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('请求体过大'), { code: 'INVALID_ARGUMENTS' });
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
