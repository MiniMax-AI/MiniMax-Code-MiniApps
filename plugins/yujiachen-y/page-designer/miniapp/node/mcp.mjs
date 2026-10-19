// @ts-check
// A small Streamable HTTP MCP endpoint: JSON-RPC over POST with JSON responses, no
// server-initiated stream. The Host's MCP client is the only caller.
import { StudioError } from './store.mjs';

/**
 * @typedef {{ name: string, description: string, inputSchema: object,
 *   handler: (args: Record<string, unknown>) => Promise<unknown> }} McpTool
 */

/** @param {{ name: string, version: string, instructions: string, tools: McpTool[], onError?: (error: unknown) => void }} options */
export function createMcpEndpoint({ name, version, instructions, tools, onError }) {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  /** @param {any} message */
  async function handleMessage(message) {
    if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      return { jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32600, message: 'Invalid Request' } };
    }
    if (!('id' in message)) return null; // notifications need no reply
    const { id, method, params } = message;
    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name, version },
            instructions,
          },
        };
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };
      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id,
          result: { tools: tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })) },
        };
      case 'tools/call': {
        const tool = byName.get(params?.name);
        if (!tool) return { jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${String(params?.name)}` } };
        const args = params?.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments) ? params.arguments : {};
        try {
          const value = await tool.handler(args);
          const text = typeof value === 'string' ? value : JSON.stringify(value);
          return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: false } };
        } catch (error) {
          if (!(error instanceof StudioError)) onError?.(error);
          const text = error instanceof StudioError ? error.message : 'Page Designer could not complete this call.';
          return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: true } };
        }
      }
      default:
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
    }
  }

  /**
   * @param {import('node:http').IncomingMessage} request
   * @param {import('node:http').ServerResponse} response
   * @param {string} body
   */
  async function handle(request, response, body) {
    if (request.method !== 'POST') {
      response.writeHead(405, { allow: 'POST', 'content-type': 'application/json' });
      response.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Method not allowed' } }));
      return;
    }
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
      return;
    }
    const batch = Array.isArray(payload);
    const replies = (await Promise.all((batch ? payload : [payload]).map(handleMessage))).filter(Boolean);
    if (replies.length === 0) {
      response.writeHead(202);
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(batch ? replies : replies[0]));
  }

  return { handle, handleMessage };
}
