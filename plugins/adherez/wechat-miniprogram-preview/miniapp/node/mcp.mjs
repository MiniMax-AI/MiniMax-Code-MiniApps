// Minimal stateless Streamable HTTP MCP server (JSON responses only).

const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_BATCH = 16;
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);

export function invalidArguments(message = '请求参数无效。') {
  return Object.assign(new Error(message), { code: 'INVALID_ARGUMENTS' });
}

// Validates the deliberately small JSON Schema subset advertised by this plugin.
export function validateArguments(value, schema, at = 'arguments', depth = 0) {
  if (depth > 16) throw invalidArguments('请求参数嵌套过深。');
  const kinds = Array.isArray(schema.type) ? schema.type : [schema.type];
  const matches = (type) => type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
    : type === 'array' ? Array.isArray(value)
      : type === 'integer' ? Number.isSafeInteger(value)
        : type === 'number' ? typeof value === 'number' && Number.isFinite(value)
          : type === 'null' ? value === null : typeof value === type;
  if (schema.type && !kinds.some(matches)) throw invalidArguments(`${at} 类型无效。`);
  if (schema.enum && !schema.enum.includes(value)) throw invalidArguments(`${at} 不属于允许的值。`);
  if (typeof value === 'string') {
    if (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? 8192)
      || (schema.pattern && !new RegExp(schema.pattern).test(value))) throw invalidArguments(`${at} 格式或长度无效。`);
  }
  if (typeof value === 'number' && (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) throw invalidArguments(`${at} 超出允许范围。`);
  if (Array.isArray(value)) {
    if (value.length > (schema.maxItems ?? 1000)) throw invalidArguments(`${at} 项目过多。`);
    if (schema.items) value.forEach((item, i) => validateArguments(item, schema.items, `${at}[${i}]`, depth + 1));
  } else if (value && typeof value === 'object') {
    if (Object.keys(value).length > (schema.maxProperties ?? 256)) throw invalidArguments(`${at} 字段过多。`);
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) throw invalidArguments(`${at}.${key} 为必填字段。`);
    for (const [key, item] of Object.entries(value)) {
      if (unsafeKeys.has(key)) throw invalidArguments(`${at} 包含不安全字段。`);
      const child = Object.hasOwn(schema.properties ?? {}, key) ? schema.properties[key] : schema.additionalProperties;
      if (child === false) throw invalidArguments(`${at} 包含未支持的字段。`);
      if (child && typeof child === 'object') validateArguments(item, child, `${at}.${key}`, depth + 1);
    }
  }
  return value;
}

export function errorPayload(error) {
  const known = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(error.code) && !/^E[A-Z]+$/.test(error.code);
  const value = { ok: false, code: known ? error.code : 'INTERNAL_ERROR', message: known ? String(error.message).slice(0, 2000) : '预览服务处理失败，请查看诊断后重试。' };
  if (known) {
    const details = {};
    const source = { ...error.details, file: error.file ?? error.details?.file, line: error.line ?? error.details?.line,
      column: error.column ?? error.details?.column, candidates: error.candidates ?? error.details?.candidates,
      candidateCount: error.candidateCount ?? error.details?.candidateCount, truncated: error.truncated ?? error.details?.truncated,
      choices: error.choices ?? error.details?.choices, requestedKind: error.requestedKind ?? error.details?.requestedKind,
      configuredKind: error.configuredKind ?? error.details?.configuredKind };
    for (const key of ['file', 'line', 'column', 'candidates', 'candidateCount', 'truncated', 'currentRevision', 'committedRevision', 'committed', 'operationId', 'previewId', 'leaseEpoch', 'pages', 'expectedLeaseEpoch', 'choices', 'requestedKind', 'configuredKind', 'resource', 'limit', 'current', 'activeCount', 'nextStep']) {
      if (source[key] !== undefined) details[key] = source[key];
    }
    if (Array.isArray(source.previews)) details.previews = source.previews.slice(0, 8).map((item) => ({
      previewId: item.previewId, name: String(item.name || '').slice(0, 200), connected: item.connected === true,
      surfacePath: `/preview?previewId=${encodeURIComponent(String(item.previewId || ''))}`,
    }));
    if (Object.keys(details).length) value.details = details;
  }
  return value;
}

/**
 * @param {{ name: string, version: string, tools: Array<{ name: string, description: string,
 *   inputSchema: object, handler: (args: Record<string, unknown>) => Promise<unknown> }> }} options
 */
export function createMcpHandler(options) {
  const byName = new Map(options.tools.map((tool) => [tool.name, tool]));

  const dispatch = async (message) => {
    if (!message || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string'
      || (message.id !== undefined && message.id !== null && typeof message.id !== 'string' && !Number.isSafeInteger(message.id))) {
      return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
    }
    const isNotification = message.id === undefined;
    if (isNotification) return undefined;
    const reply = (result) => ({ jsonrpc: '2.0', id: message.id, result });
    const fail = (code, text) => ({ jsonrpc: '2.0', id: message.id, error: { code, message: text } });
    switch (message.method) {
      case 'initialize': {
        const requested = message.params?.protocolVersion;
        return reply({
          protocolVersion: SUPPORTED_PROTOCOLS.includes(requested) ? requested : SUPPORTED_PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: options.name, version: options.version },
        });
      }
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({
          tools: options.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
        });
      case 'tools/call': {
        const tool = byName.get(message.params?.name);
        if (!tool) return fail(-32602, `Unknown tool: ${message.params?.name}`);
        const args = message.params?.arguments === undefined ? {} : message.params.arguments;
        try {
          validateArguments(args, tool.inputSchema);
          const result = await tool.handler(args);
          return reply({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result });
        } catch (error) {
          const result = errorPayload(error);
          return reply({ content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: true });
        }
      }
      default:
        return fail(-32601, `Method not found: ${message.method}`);
    }
  };

  return async function handle(request, response, readJsonBody) {
    if (request.method === 'GET' || request.method === 'DELETE') {
      response.writeHead(405, { allow: 'POST' }).end();
      return;
    }
    if (request.method !== 'POST') {
      response.writeHead(405, { allow: 'POST' }).end();
      return;
    }
    let body;
    try {
      body = await readJsonBody(request);
    } catch {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
      return;
    }
    const batch = Array.isArray(body);
    if (batch && (body.length === 0 || body.length > MAX_BATCH)) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: `Batch must contain 1-${MAX_BATCH} requests` } }));
      return;
    }
    const replies = (await Promise.all((batch ? body : [body]).map(dispatch))).filter(Boolean);
    if (replies.length === 0) {
      response.writeHead(202).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(batch ? replies : replies[0]));
  };
}
