// @ts-check

/**
 * Mini App 托管的 Streamable HTTP MCP 端点。
 *
 * 这是「MCode 的 Agent → 章鱼娘」这条正路的入口：Agent 调这些工具，
 * 章鱼娘就在桌面浮窗里说话、换表情、挪位置。
 *
 * 协议要点：
 *  - initialize 交换协议版本，客户端要哪个支持版本就回哪个。
 *  - 通知（没有 id 的请求）只回 202，不带 JSON-RPC 响应体。
 *  - 客户端 Accept 带 text/event-stream 时用 SSE 回，否则回 application/json。
 *  - 工具执行失败用 isError + 文本表达；协议层错误才用 JSON-RPC error。
 */

import { MOODS, MOOD_KEYS, ANCHORS, SCOPES } from './state.mjs';

const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const DEFAULT_PROTOCOL = '2025-06-18';

const TOOLS = [
  {
    name: 'mmx_say',
    description:
      '让桌面上的 MMX 章鱼娘说一句话。她会弹出气泡，让用户看到你刚做了什么。适合任务完成通知、进度汇报、结果口述。',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要让章鱼娘说的话，一到两句，不超过 120 字。' },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'mmx_mood',
    description:
      '切换章鱼娘的表情。idle=待机，thinking=思考中，working=工作中，celebrate=这一轮结束。',
    inputSchema: {
      type: 'object',
      properties: {
        mood: { type: 'string', enum: MOOD_KEYS, description: '目标表情。' },
      },
      required: ['mood'],
      additionalProperties: false,
    },
  },
  {
    name: 'mmx_move',
    description:
      '把章鱼娘的浮窗挪到屏幕某个位置。bottom-right=右下角，bottom-left=左下角，top-right=右上角，center=屏幕中间。',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', enum: Object.keys(ANCHORS), description: '停靠位置。' },
      },
      required: ['target'],
      additionalProperties: false,
    },
  },
  {
    name: 'mmx_status',
    description:
      '读取章鱼娘当前状态：表情、正在说的气泡、MMX Agent 此刻在干什么、最近的动作记录。',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
];

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<any>}
 */
async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return undefined;
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {unknown} payload
 */
function sendJson(res, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {unknown} payload
 */
function sendSse(res, payload) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  res.end(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function describeError(value) {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  return 'unknown_error';
}

/**
 * @param {{state: import('./state.mjs').PetState, chat?: import('./chat.mjs').ChatStore, logger: {error: (code: string, fields?: Record<string, unknown>) => void}}} deps
 */
export function createMcpHandler({ state, chat, logger }) {
  /**
   * @param {string} name
   * @param {Record<string, unknown>} args
   */
  async function runTool(name, args) {
    switch (name) {
      case 'mmx_say': {
        const text = String(args.text ?? '');
        await state.say(text, 'Agent');
        return { text: `章鱼娘已经说了：「${text.trim()}」` };
      }
      case 'mmx_mood': {
        const mood = String(args.mood ?? '');
        const result = await state.setMood(mood, 'Agent');
        return { text: `章鱼娘切到「${result.label}」` };
      }
      case 'mmx_move': {
        const target = String(args.target ?? '');
        await state.requestMove(target);
        return { text: `章鱼娘正在挪到${ANCHORS[target].label}` };
      }
      case 'mmx_status': {
        const snapshot = state.snapshot();
        const agent = snapshot.agent;
        // 只报条数和忙闲，不报聊天正文：正文是用户和她的私事。
        const chatCount = chat ? chat.list().length : 0;
        const lines = [
          `表情：${snapshot.moodLabel}`,
          `气泡：${snapshot.bubble ? snapshot.bubble.text : '（没有）'}`,
          `待播：${snapshot.bubbleQueue.length} 条`,
          `浮窗位置：${snapshot.position ? `(${snapshot.position.x}, ${snapshot.position.y})` : '未知'}`,
          `MMX Agent：${agent ? agent.state + (agent.title ? ` · ${agent.title}` : '') : '空闲'}`,
          `观察范围：${SCOPES[snapshot.scope] ? SCOPES[snapshot.scope].label : SCOPES.global.label}`,
          `对话：${snapshot.chatBusy ? '正在回话' : chatCount ? `${chatCount} 条` : '空闲'}`,
          `最近动作：${snapshot.log.length ? snapshot.log.map((item) => item.kind + '·' + item.text).join('；') : '无'}`,
        ];
        return { text: lines.join('\n') };
      }
      default:
        throw new Error(`未知工具：${name}`);
    }
  }

  /**
   * @param {any} message
   * @returns {Promise<any | undefined>}
   */
  async function dispatch(message) {
    if (!message || typeof message !== 'object') return undefined;
    const { method, id, params } = message;
    const isNotification = id === undefined || id === null;

    switch (method) {
      case 'initialize': {
        const requested = String(params?.protocolVersion ?? '');
        const protocolVersion = SUPPORTED_PROTOCOLS.includes(requested) ? requested : DEFAULT_PROTOCOL;
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'mmx', version: '1.0.0' },
            instructions:
              '这些工具控制用户桌面上的 MMX 章鱼娘浮窗。mmx_say 让她弹气泡说话，mmx_mood 换表情，mmx_move 把浮窗挪到屏幕角落，mmx_status 读状态。适合在完成任务后用 mmx_say 把结果口述给用户。',
          },
        };
      }
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return undefined;
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };
      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
      case 'tools/call': {
        const name = String(params?.name ?? '');
        const args = params?.arguments && typeof params.arguments === 'object' ? params.arguments : {};
        try {
          const result = await runTool(name, args);
          return {
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text: result.text }], isError: false },
          };
        } catch (error) {
          const reason = describeError(error);
          logger.error('mcp.tool.failed', { tool: name, reason });
          return {
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text: reason }], isError: true },
          };
        }
      }
      default:
        if (isNotification) return undefined;
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
    }
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  return async function handleMcp(req, res) {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'application/json; charset=utf-8', allow: 'POST' });
      res.end(JSON.stringify({ error: 'method_not_allowed' }));
      return;
    }

    const body = await readJsonBody(req);
    if (body === undefined) {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'invalid_json' }));
      return;
    }

    const accept = String(req.headers.accept ?? '');
    const wantsSse = accept.includes('text/event-stream');
    const batch = Array.isArray(body);
    const messages = batch ? body : [body];
    const responses = [];
    for (const message of messages) {
      const response = await dispatch(message);
      if (response) responses.push(response);
    }

    if (!responses.length) {
      res.writeHead(202);
      res.end();
      return;
    }
    const payload = batch ? responses : responses[0];
    if (wantsSse) sendSse(res, payload);
    else sendJson(res, payload);
  };
}
