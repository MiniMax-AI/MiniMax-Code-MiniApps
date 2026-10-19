// @ts-check
// CadQuery Viewer — MCP endpoint (Streamable HTTP, JSON responses only, no server-initiated stream).
//
// The Host's MCP client POSTs JSON-RPC to MCP_PATH on this Mini App's own listener. The tools only
// call the services the Node entry passes in; they never touch the file system directly.

export const MCP_PATH = '/mcp/cq-viewer';

const SERVER_INFO = { name: 'cq-viewer', version: '1.2.1' }; // keep equal to plugin.json (tests check)

const INSTRUCTIONS = [
  'CadQuery Viewer 是本机的 STL / STEP 查看器，页面在 MiniMax Code 的 Mini App 面板里打开。',
  '导出模型后用 add_model_file 在查看器里打开它：默认原地打开，脚本重新导出同一个文件时查看器会自动刷新，所以每个文件调用一次即可。',
  '用 add_model_folder 登记项目文件夹，用 list_model_folders 查看已登记的文件夹和模型。',
  '查看器没打开时请求会保留 24 小时，用户打开查看器后自动执行；结果里 viewer_connected 为 false 时，提醒用户打开 CadQuery Viewer。',
  '用户在查看器里标注的位置会作为消息发到对话里，同样的数据也在 ~/.cqview/selection.json。',
].join('\n');

const NAME_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$';
const COLOR_PATTERN = '^#[0-9a-fA-F]{6}$';

const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

/** @typedef {{type?: string|string[], properties?: Record<string, Schema>, required?: string[], additionalProperties?: boolean, minLength?: number, maxLength?: number, pattern?: string, minimum?: number, maximum?: number, description?: string}} Schema */

/** @type {{name: string, title: string, description: string, inputSchema: Schema, annotations: Record<string, boolean>}[]} */
export const TOOLS = [
  {
    name: 'add_model_folder',
    title: '添加模型文件夹',
    description:
      '把本机的一个文件夹登记到 CadQuery Viewer。查看器会递归列出其中的 .stl / .step / .stp，并在文件变化时刷新。' +
      '文件夹必须在用户主目录内，不能是主目录本身、~/Library 或以 . 开头的顶层目录。' +
      '返回文件夹 ID 和其中的模型文件（绝对路径，最多 200 个）。select 为 true（默认）时，查看器会切换到这个文件夹。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1, maxLength: 1024, description: '文件夹的绝对路径，可以用 ~/ 开头' },
        select: { type: 'boolean', description: '是否让查看器切换到这个文件夹，默认 true' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: WRITE,
  },
  {
    name: 'add_model_file',
    title: '添加模型文件',
    description:
      '在 CadQuery Viewer 里打开一个 .stl / .step / .stp 文件。' +
      '默认原地打开：自动登记文件所在的文件夹（已登记的上级文件夹优先），文件之后被重新导出时查看器自动刷新；这种方式要求文件在用户主目录内。' +
      'copy_to_scene 为 true 时，改为把文件复制到查看器的脚本推送目录 ~/.cqview/scene/<name>.<扩展名>，适合主目录以外的文件（例如 /tmp），但源文件之后的修改不会同步；name、color、opacity 只在这种方式下生效。' +
      '查看器没打开时请求会保留 24 小时，打开后自动执行。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1, maxLength: 1024, description: '模型文件的绝对路径，可以用 ~/ 开头' },
        copy_to_scene: { type: 'boolean', description: '复制到脚本推送目录而不是原地打开，默认 false' },
        name: { type: 'string', pattern: NAME_PATTERN, description: '复制后的模型名（字母、数字、. _ -），默认取文件名' },
        color: { type: 'string', pattern: COLOR_PATTERN, description: '显示颜色，例如 #4f8cff' },
        opacity: { type: 'number', minimum: 0.05, maximum: 1, description: '不透明度 0.05–1' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: WRITE,
  },
  {
    name: 'list_model_folders',
    title: '列出模型文件夹',
    description:
      '列出 CadQuery Viewer 已登记的模型文件夹，以及脚本推送目录 ~/.cqview/scene 里的模型。' +
      '传 folder（文件夹 ID 或绝对路径）时，改为返回该文件夹里的模型文件（绝对路径，最多 200 个）。',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', minLength: 1, maxLength: 1024, description: '文件夹 ID 或绝对路径' },
      },
      additionalProperties: false,
    },
    annotations: READ,
  },
];

const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/**
 * @typedef {object} McpServices
 * @property {(args: {path: string, select?: boolean}) => Promise<Record<string, unknown>>} addModelFolder
 * @property {(args: {path: string, copy_to_scene?: boolean, name?: string, color?: string, opacity?: number}) => Promise<Record<string, unknown>>} addModelFile
 * @property {(args: {folder?: string}) => Promise<Record<string, unknown>>} listModelFolders
 * @property {(message: string) => void} [log]
 */

/**
 * @param {McpServices} services
 * @returns {(body: unknown) => Promise<unknown | null>} null means "no response body" (HTTP 202)
 */
export function createMcpHandler(services) {
  /** @param {any} message */
  const handleMessage = async (message) => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return rpcError(null, -32600, 'Invalid Request');
    }
    if (message.id === undefined || message.id === null) return null; // notification or response
    const id = message.id;
    switch (message.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion:
              typeof message.params?.protocolVersion === 'string' ? message.params.protocolVersion : '2025-06-18',
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO,
            instructions: INSTRUCTIONS,
          },
        };
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };
      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
      case 'tools/call': {
        const name = message.params?.name;
        const tool = typeof name === 'string' ? TOOLS_BY_NAME.get(name) : undefined;
        if (!tool) return rpcError(id, -32602, `Unknown tool: ${typeof name === 'string' ? name : '(missing)'}`);
        const args = message.params?.arguments ?? {};
        const issues = validate(tool.inputSchema, args, 'arguments');
        if (issues.length) {
          return {
            jsonrpc: '2.0',
            id,
            result: failure('invalid_arguments', `参数不正确：${issues.join('；')}`),
          };
        }
        services.log?.(`cqviewer.mcp.call ${tool.name}`);
        try {
          const data = await dispatch(services, tool.name, args);
          return { jsonrpc: '2.0', id, result: success(data) };
        } catch (error) {
          const e = /** @type {any} */ (error);
          const known = typeof e?.status === 'number' && typeof e?.code === 'string';
          if (!known) services.log?.(`cqviewer.mcp.failed ${tool.name} ${e?.code ?? 'unknown'}`);
          return {
            jsonrpc: '2.0',
            id,
            result: known ? failure(e.code, e.userMessage || e.code) : failure('internal_error', '查看器内部出错，请重试'),
          };
        }
      }
      default:
        return rpcError(id, -32601, `Method not found: ${String(message.method)}`);
    }
  };

  return async (body) => {
    if (Array.isArray(body)) {
      if (body.length === 0) return rpcError(null, -32600, 'Invalid Request');
      const replies = [];
      for (const m of body) {
        const r = await handleMessage(m);
        if (r) replies.push(r);
      }
      return replies.length ? replies : null;
    }
    return handleMessage(body);
  };
}

/** @param {McpServices} services @param {string} name @param {any} args */
function dispatch(services, name, args) {
  switch (name) {
    case 'add_model_folder':
      return services.addModelFolder(args);
    case 'add_model_file':
      return services.addModelFile(args);
    case 'list_model_folders':
      return services.listModelFolders(args);
    default:
      throw new Error('unreachable');
  }
}

/** @param {Record<string, unknown>} data */
function success(data) {
  const structuredContent = { ok: true, ...data };
  return { content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }], structuredContent };
}

/** @param {string} code @param {string} message */
function failure(code, message) {
  const structuredContent = { ok: false, error: { code, message } };
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }], structuredContent };
}

/** @param {unknown} id @param {number} code @param {string} message */
function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

/**
 * Minimal JSON Schema check for the subset used by TOOLS.
 * @param {Schema} schema @param {unknown} value @param {string} path @returns {string[]}
 */
export function validate(schema, value, path) {
  /** @type {string[]} */
  const issues = [];
  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.length && !types.some((t) => isType(t, value))) {
    issues.push(`${path} 应为 ${types.join(' 或 ')}`);
    return issues;
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) issues.push(`${path} 不能为空`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) issues.push(`${path} 太长`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) issues.push(`${path} 格式不对`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) issues.push(`${path} 不能小于 ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) issues.push(`${path} 不能大于 ${schema.maximum}`);
  }
  if (isType('object', value)) {
    const obj = /** @type {Record<string, unknown>} */ (value);
    const props = schema.properties ?? {};
    for (const req of schema.required ?? []) if (!Object.hasOwn(obj, req)) issues.push(`缺少 ${path}.${req}`);
    for (const [k, v] of Object.entries(obj)) {
      if (props[k]) issues.push(...validate(props[k], v, `${path}.${k}`));
      else if (schema.additionalProperties === false) issues.push(`${path}.${k} 不是可用参数`);
    }
  }
  return issues;
}

/** @param {string} type @param {unknown} value */
function isType(type, value) {
  switch (type) {
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return Number.isInteger(value);
    case 'array':
      return Array.isArray(value);
    default:
      return typeof value === type;
  }
}
