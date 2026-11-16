/**
 * 托管 MCP（Streamable HTTP）：把练习存档的业务能力交给 Agent。
 *
 * 挂在 Mini App 自己的 Node 服务上，路径见 miniapp/miniapp.json 的 mcpEndpoints。
 * 全部读写都走 store（数据目录里的存档文件），浏览器页面与 Agent 共用同一份数据。
 */
import { randomUUID } from 'node:crypto';

const PREFIX = 'gml-practice-log-v2:';
const SERVER_INFO = { name: 'gml-practice-notes', version: '1.1.0' };

/* ------------------------------ 工具定义 ------------------------------ */
const TOOLS = [
  {
    name: 'list_projects',
    description:
      '列出这台机器上的所有 GML 练习存档项目（每本互不干扰的学习笔记）。返回项目名、记录数、API 数、打卡天数、存档文件名与更新时间。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_project',
    description:
      '读取一本练习存档的完整内容：练习记录（名称、题目要求、提示、代码载体）、API 库、打卡日历与设置。project 可填项目 ID 或项目名。',
    inputSchema: {
      type: 'object',
      properties: { project: { type: 'string', description: '项目 ID 或项目名' } },
      required: ['project'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_notes',
    description:
      '跨所有练习存档搜索：匹配练习记录名称、题目要求、提示、代码文本，以及 API 名称与介绍。返回命中片段与出处。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '要搜索的关键词' },
        limit: { type: 'number', description: '最多返回多少条（默认 20）' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_api_library',
    description:
      '汇总 API 库：每个 GML 函数/内置变量的代码名、介绍与参数列表。可按项目过滤。不指定项目时汇总所有项目。',
    inputSchema: {
      type: 'object',
      properties: { project: { type: 'string', description: '可选：只查某个项目' } },
      additionalProperties: false,
    },
  },
  {
    name: 'create_project',
    description: '新建一本空白练习存档（学习笔记），用于换一个主题单独记录。',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: '项目名称' } },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'export_backup',
    description:
      '把全部练习存档（含回收站）导出成一个 JSON 备份文件，落在 Mini App 数据目录的 exports 文件夹里。换设备或清缓存前用得上。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

/* ------------------------------ 数据读取 ------------------------------ */
/** 存档里的每一段都是 localStorage key → JSON 字符串 */
function part(data, key) {
  const raw = data && data[PREFIX + key];
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function apiListOf(data) {
  const apis = part(data, 'api');
  if (!apis || typeof apis !== 'object') return [];
  return Object.keys(apis).map((id) => {
    const a = apis[id] || {};
    return { id, code: a.code || '', desc: a.desc || '', params: a.params || [] };
  });
}

function recordListOf(data) {
  const records = part(data, 'records');
  if (!records || typeof records !== 'object') return [];
  return Object.keys(records).map((id) => {
    const r = records[id] || {};
    const modules = Array.isArray(r.modules) ? r.modules : [];
    return {
      id,
      ts: r.ts || 0,
      name: r.name || '',
      requirement: r.requirement || '',
      hint: r.hint || '',
      modules: modules.map((m) => ({
        type: m && m.type ? m.type : '',
        value: m && typeof m.value === 'string' ? m.value : '',
        fields: m && Array.isArray(m.fields) ? m.fields : undefined,
        events: m && Array.isArray(m.events) ? m.events : undefined,
      })),
      apiIds: Array.isArray(r.apis) ? r.apis : [],
    };
  });
}

function daysOf(data) {
  const days = part(data, 'days');
  return days && typeof days === 'object' ? days : {};
}

function findSlot(slots, key) {
  const q = String(key || '').trim();
  if (!q) return null;
  return (
    slots.find((s) => s.id === q) ||
    slots.find((s) => s.name === q) ||
    slots.find((s) => s.name.toLowerCase() === q.toLowerCase()) ||
    slots.find((s) => s.name.includes(q)) ||
    null
  );
}

function clip(text, n) {
  const s = String(text == null ? '' : text);
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/* ------------------------------ 工具实现 ------------------------------ */
function makeHandlers(store) {
  return {
    async list_projects() {
      const scan = await store.scanProjects();
      const projects = scan.slots.map((s) => {
        const records = part(s.data, 'records') || {};
        const apis = part(s.data, 'api') || {};
        const days = daysOf(s.data);
        return {
          id: s.id,
          name: s.name,
          file: s.file,
          recordCount: Object.keys(records).length,
          apiCount: Object.keys(apis).length,
          checkinDays: Object.keys(days).length,
          saveCount: s.saveCount || 0,
          sizeBytes: s.fileSize || 0,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          lastModified: s.fileModified,
        };
      });
      return { total: projects.length, projects, skippedFiles: scan.skipped };
    },

    async get_project(args) {
      const scan = await store.scanProjects();
      const slot = findSlot(scan.slots, args && args.project);
      if (!slot) {
        const names = scan.slots.map((s) => s.name).join('、') || '无';
        throw new Error(`找不到项目：${args && args.project}（可用项目：${names}）`);
      }
      const apis = apiListOf(slot.data);
      const byId = new Map(apis.map((a) => [a.id, a]));
      const records = recordListOf(slot.data).map((r) => ({
        ...r,
        apis: r.apiIds.map((id) => byId.get(id)).filter(Boolean).map((a) => ({ code: a.code, desc: a.desc })),
      }));
      return {
        id: slot.id,
        name: slot.name,
        note: slot.note || '',
        file: slot.file,
        createdAt: slot.createdAt,
        updatedAt: slot.updatedAt,
        saveCount: slot.saveCount || 0,
        user: part(slot.data, 'user') || null,
        settings: part(slot.data, 'settings') || null,
        days: daysOf(slot.data),
        records,
        apiLibrary: apis.map((a) => ({ code: a.code, desc: a.desc, params: a.params })),
      };
    },

    async search_notes(args) {
      const q = String((args && args.query) || '').trim().toLowerCase();
      if (!q) throw new Error('请给出搜索关键词');
      const limit = Math.max(1, Math.min(100, Number((args && args.limit) || 20)));
      const scan = await store.scanProjects();
      const hits = [];
      for (const slot of scan.slots) {
        for (const r of recordListOf(slot.data)) {
          const fields = [
            ['名称', r.name],
            ['题目要求', r.requirement],
            ['提示', r.hint],
          ];
          for (const m of r.modules) fields.push([`载体·${m.type}`, m.value]);
          for (const [label, text] of fields) {
            const hay = String(text || '').toLowerCase();
            const at = hay.indexOf(q);
            if (at >= 0) {
              hits.push({
                project: slot.name,
                projectId: slot.id,
                recordId: r.id,
                recordName: r.name,
                field: label,
                snippet: clip(String(text), 240),
                matchedAt: at,
              });
            }
          }
        }
        for (const a of apiListOf(slot.data)) {
          const hay = `${a.code}\n${a.desc}`.toLowerCase();
          if (hay.includes(q)) {
            hits.push({
              project: slot.name,
              projectId: slot.id,
              apiCode: a.code,
              field: 'API',
              snippet: clip(`${a.code} — ${a.desc}`, 240),
            });
          }
        }
      }
      return { query: args && args.query, total: hits.length, hits: hits.slice(0, limit) };
    },

    async list_api_library(args) {
      const scan = await store.scanProjects();
      const slots = args && args.project ? [findSlot(scan.slots, args.project)].filter(Boolean) : scan.slots;
      if (!slots.length) throw new Error(`找不到项目：${args && args.project}`);
      const merged = new Map();
      for (const slot of slots) {
        for (const a of apiListOf(slot.data)) {
          const key = a.code || a.id;
          if (!merged.has(key)) merged.set(key, { code: a.code, desc: a.desc, params: a.params, projects: [] });
          merged.get(key).projects.push(slot.name);
        }
      }
      return {
        total: merged.size,
        apis: Array.from(merged.values()).map((a) => ({
          code: a.code,
          desc: a.desc,
          params: a.params,
          usedIn: a.projects,
        })),
      };
    },

    async create_project(args) {
      const name = String((args && args.name) || '').trim();
      if (!name) throw new Error('项目名称不能为空');
      const scan = await store.scanProjects();
      const slot = {
        id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        name: await store.uniqueName(name, scan.slots),
        note: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        saveCount: 0,
        data: {},
      };
      await store.writeSlot(slot);
      await store.writeIndex([...scan.slots, slot], (await store.readIndex())?.uiLang);
      return { ok: true, id: slot.id, name: slot.name };
    },

    async export_backup() {
      const scan = await store.scanProjects();
      const trash = await store.readTrash();
      const payload = {
        format: 'gml-pm-vault',
        version: 2,
        exportedAt: new Date().toISOString(),
        saves: scan.slots,
        trash,
      };
      const filename = `gml存档库-${new Date().toISOString().slice(0, 10)}.json`;
      const path = await store.saveExport(filename, JSON.stringify(payload));
      return { ok: true, filename, path, projects: scan.slots.length };
    },
  };
}

/* ------------------------------ MCP 协议 ------------------------------ */
function jsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } };
}

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id: id === undefined ? null : id, result };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return null;
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function sendJson(res, status, body, headers) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    ...(headers || {}),
  });
  res.end(text);
}

/**
 * @param {object} store createStore() 返回的数据服务
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>}
 */
export function createMcpHandler(store) {
  const handlers = makeHandlers(store);
  const sessionId = randomUUID();

  async function callTool(name, args) {
    const fn = handlers[name];
    if (!fn) throw new Error(`未知工具：${name}`);
    const data = await fn(args || {});
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }

  async function handleOne(msg) {
    const { id, method, params } = msg || {};
    if (!method) return jsonRpcError(id, -32600, '缺少 method');

    if (method === 'initialize') {
      return {
        __headers: { 'mcp-session-id': sessionId },
        body: jsonRpcResult(id, {
          protocolVersion: (params && params.protocolVersion) || '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
        }),
      };
    }
    if (method === 'notifications/initialized' || method === 'notifications/cancelled') return null;
    if (method === 'ping') return jsonRpcResult(id, {});
    if (method === 'tools/list') return jsonRpcResult(id, { tools: TOOLS });
    if (method === 'tools/call') {
      const name = params && params.name;
      try {
        return jsonRpcResult(id, await callTool(name, params && params.arguments));
      } catch (error) {
        const message = String((error && error.message) || error);
        return jsonRpcResult(id, { content: [{ type: 'text', text: `执行失败：${message}` }], isError: true });
      }
    }
    return jsonRpcError(id, -32601, `不支持的方法：${method}`);
  }

  return async function handleMcp(req, res) {
    const method = (req.method || 'GET').toUpperCase();

    if (method === 'GET') {
      /* 本服务不主动推送事件，客户端不需要 SSE 通道 */
      res.writeHead(405, {
        'content-type': 'application/json; charset=utf-8',
        allow: 'POST, DELETE',
      });
      res.end(JSON.stringify(jsonRpcError(null, -32000, '该服务不提供服务器端事件流')));
      return;
    }
    if (method === 'DELETE') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (method !== 'POST') {
      sendJson(res, 405, jsonRpcError(null, -32000, '仅支持 POST'));
      return;
    }

    const body = await readBody(req);
    if (body === null) {
      sendJson(res, 400, jsonRpcError(null, -32700, 'JSON 解析失败'));
      return;
    }

    const list = Array.isArray(body) ? body : [body];
    const out = [];
    let headers = null;
    for (const msg of list) {
      const r = await handleOne(msg);
      if (!r) continue;
      if (r.__headers) {
        headers = { ...(headers || {}), ...r.__headers };
        delete r.__headers;
      }
      out.push(r);
    }
    if (!out.length) {
      res.writeHead(202, headers || {});
      res.end();
      return;
    }
    sendJson(res, 200, Array.isArray(body) ? out : out[0], headers);
  };
}
