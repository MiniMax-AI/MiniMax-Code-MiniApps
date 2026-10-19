import { editorTools, callEditorTool } from './editor-mcp.mjs';
import { readJSON } from './agent-service.mjs';
const idSchema = { type: 'string', description: '工作台给出的任务编号' };
const tools = [
  {
    name: 'get_image_request',
    description:
      '读取修图工作台任务。改图任务返回已由用户保存的参考 PNG 本机路径；用图片工具读取该路径。',
    inputSchema: {
      type: 'object',
      properties: { requestId: idSchema },
      required: ['requestId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'submit_image_result',
    description:
      '将生成好的本机 PNG 交回修图工作台，用户可点击打开。不会改写原工程。相同结果重复提交安全；不同结果须新建任务。',
    inputSchema: {
      type: 'object',
      properties: {
        requestId: idSchema,
        imagePath: {
          type: 'string',
          description: '生成 PNG 的本机绝对路径，最大 16 MB、3200 万像素',
        },
      },
      required: ['requestId', 'imagePath'],
      additionalProperties: false,
    },
    annotations: { destructiveHint: false, idempotentHint: true },
  },
];
// Stateless Streamable HTTP, JSON responses; no server-initiated RPC or session IDs.
export async function handleAgentMCP(req, res, service, json, editor, serverInfo) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'Use POST' });
  }
  if (!req.headers['content-type']?.startsWith('application/json'))
    return json(res, 415, { error: 'JSON required' });
  const accept = req.headers.accept || '';
  if (!accept.includes('application/json') || !accept.includes('text/event-stream'))
    return json(res, 406, { error: 'Accept JSON and SSE' });
  let body;
  try {
    body = await readJSON(req, 64 * 1024);
  } catch {
    return json(res, 400, {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Invalid JSON' },
    });
  }
  const dispatch = async (message) => {
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string')
      return {
        jsonrpc: '2.0',
        id: message?.id ?? null,
        error: { code: -32600, message: 'Invalid request' },
      };
    if (message.id === undefined) return null;
    const reply = (result) => ({ jsonrpc: '2.0', id: message.id, result });
    if (message.method === 'initialize')
      return reply({
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo,
      });
    if (message.method === 'ping') return reply({});
    if (message.method === 'tools/list') return reply({ tools: [...tools, ...editorTools] });
    if (message.method === 'tools/call') {
      try {
        const { name, arguments: args = {} } = message.params || {};
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error('工具参数无效');
        if (editorTools.some((t) => t.name === name))
          return reply(await callEditorTool(name, args, editor));
        const allowed = name === 'get_image_request' ? ['requestId'] : ['requestId', 'imagePath'];
        if (Object.keys(args).some((key) => !allowed.includes(key))) throw Error('包含未知参数');
        let result;
        if (name === 'get_image_request') {
          result = await service.get(args.requestId);
          if (result.mode === 'edit') result = await service.reference(args.requestId);
        } else if (name === 'submit_image_result')
          result = await service.submit(args.requestId, args.imagePath);
        else throw Error('未知工具');
        return reply({ content: [{ type: 'text', text: JSON.stringify(result) }] });
      } catch (error) {
        const text =
          error.code === 'ENOENT'
            ? '任务或图片不存在'
            : error.code
              ? '读取或保存图片失败'
              : error.message;
        return reply({ isError: true, content: [{ type: 'text', text }] });
      }
    }
    return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } };
  };
  const messages = Array.isArray(body) ? body : [body];
  if (!messages.length || messages.length > 20) return json(res, 400, { error: 'Invalid batch' });
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
