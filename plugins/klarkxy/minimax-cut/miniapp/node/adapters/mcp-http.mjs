// @ts-check
// The Streamable HTTP MCP endpoint for the FableCut tools.
//
// The Host's MCP client posts JSON-RPC to this path; the dispatcher is the
// upstream one (vendor/fablecut/mcp-server.js), so the 19 tools and their
// names are the upstream ones. Only the product name inside their
// descriptions differs - see PATCHES.md.
//
// Transport notes:
//   • POST carries one JSON-RPC message or a batch; the reply is JSON.
//   • `initialize` opens a session and answers with an `mcp-session-id` header.
//     A later request with an unknown session id is a 404, as the spec says.
//   • DELETE ends a session.
//   • GET (the server→client notification stream) is not offered: this server
//     never sends a notification, so the spec's 405 applies.
//
// The Host guards the port with a per-run credential and strips the credential
// header before the request reaches this code, so nothing here reads, forwards
// or logs one.

import { randomUUID } from 'node:crypto';

const MAX_BODY = 4 * 1024 * 1024;

/**
 * @param {import('node:http').IncomingMessage} request
 * @returns {Promise<unknown>}
 */
function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('request body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) return resolve(undefined);
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error('request body is not valid JSON'));
      }
    });
    request.on('error', reject);
  });
}

/**
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {unknown} body
 */
function sendJson(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(body === undefined ? '' : JSON.stringify(body));
}

/**
 * A JSON-RPC request or notification: an object with jsonrpc "2.0" and a
 * method. Anything else — null, a scalar, an array that is not a batch — is
 * an invalid request and never reaches the dispatcher.
 *
 * @param {unknown} message
 * @returns {boolean}
 */
function isJsonRpcMessage(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
  const candidate = /** @type {any} */ (message);
  if (candidate.jsonrpc !== '2.0') return false;
  return typeof candidate.method === 'string' && candidate.method.length > 0;
}

/**
 * @param {{
 *   handleMessage: (message: any) => Promise<any>,
 *   serverInfo?: { name: string, version: string },
 * }} options
 */
export function createMcpHttpHandler({ handleMessage, serverInfo }) {
  /** @type {Map<string, { createdAt: number, protocolVersion: string }>} */
  const sessions = new Map();

  /**
   * @param {import('node:http').IncomingMessage} request
   * @param {import('node:http').ServerResponse} response
   */
  return async function handleMcpRequest(request, response) {
    const method = request.method ?? 'GET';

    // Only the Host's non-browser MCP client uses this endpoint. Browser
    // requests carry an Origin or Fetch Metadata (including same-origin
    // requests); these headers cannot be removed by page JavaScript. The
    // Host still owns authentication; this is a separate capability boundary.
    if (request.headers.origin !== undefined || request.headers['sec-fetch-site'] !== undefined) {
      sendJson(response, 403, {
        jsonrpc: '2.0', id: null,
        error: { code: -32003, message: 'MCP tools are available through the Host Agent, not browser requests.' },
      });
      return;
    }

    if (method === 'DELETE') {
      const sessionId = request.headers['mcp-session-id'];
      if (sessionId) sessions.delete(String(sessionId));
      response.writeHead(204).end();
      return;
    }

    if (method !== 'POST') {
      response.writeHead(405, {
        allow: 'POST, DELETE',
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32600, message: 'This endpoint accepts POST (JSON-RPC) and DELETE (end session).' },
        }),
      );
      return;
    }

    const sessionHeader = request.headers['mcp-session-id'];
    if (sessionHeader && !sessions.has(String(sessionHeader))) {
      sendJson(response, 404, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32001, message: 'Unknown MCP session. Send initialize again.' },
      });
      return;
    }

    /** @type {unknown} */
    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      sendJson(response, 400, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: error instanceof Error ? error.message : 'bad request' },
      });
      return;
    }
    if (body === undefined) {
      sendJson(response, 400, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Empty request body.' },
      });
      return;
    }

    const batch = Array.isArray(body);
    const messages = batch ? body : [body];

    /* JSON-RPC: a request is an object with a method, a batch is a non-empty
       array of requests. null, a scalar, or an empty batch is an invalid
       request — it never reaches the dispatcher. */
    if (batch && messages.length === 0) {
      sendJson(response, 400, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'A JSON-RPC batch must not be empty.' },
      });
      return;
    }
    const invalid = messages.findIndex((message) => !isJsonRpcMessage(message));
    if (invalid !== -1) {
      sendJson(response, 400, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: `Invalid Request${batch ? ` at index ${invalid}` : ''}.` },
      });
      return;
    }

    // A request that opens a session gets its id back in the reply header.
    const opensSession = messages.some(
      (message) => /** @type {any} */ (message)?.method === 'initialize',
    );
    if (opensSession) {
      // Bound retained sessions without expiring clients or interrupting long
      // jobs. DELETE frees a slot; stopping the runtime releases the map.
      if (sessions.size >= 256) {
        sendJson(response, 503, {
          jsonrpc: '2.0', id: messages[0]?.id ?? null,
          error: { code: -32000, message: 'MCP session limit reached; close an unused session before initializing another.' },
        });
        return;
      }
      const sessionId = `fablecut_${randomUUID()}`;
      sessions.set(sessionId, {
        createdAt: Date.now(),
        protocolVersion: String(request.headers['mcp-protocol-version'] ?? ''),
      });
      response.setHeader('mcp-session-id', sessionId);
    }

    /* One at a time, in order: a batch may carry mutating tool calls, and two
       of them must not write the project at the same time. */
    /** @type {any[]} */
    const replies = [];
    for (const message of messages) {
      const reply = await handleMessage(message);
      if (reply !== undefined && reply !== null) replies.push(reply);
    }

    if (!replies.length) {
      response.writeHead(202).end();
      return;
    }
    sendJson(response, 200, batch ? replies : replies[0]);
  };
}
