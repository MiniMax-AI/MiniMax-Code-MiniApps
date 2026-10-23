// @ts-check
/**
 * 蹬王之王 local MCP 端点。
 *
 * # 为什么需要它（2026-10-20 实测踩到的坑）
 *
 * MiniApp 的 manifest 可以声明 `mcpEndpoints`，让**别的**插件在它们的回合里
 * 用到本插件的 MCP 工具。而 Host 在发布时会检查「声明的端点是否真的就绪」
 * （探活方式 = MCP 的 `initialize` + `tools/list`）。
 *
 * ⚠️ 而且 Host 的「已发布快照」是**粘的**：一旦某个版本的 manifest 声明过
 * 端点，后续版本**必须继续声明同样的端点**，否则发布会被
 * `MCP_PUBLICATION_INVALID` 挡下（`used.size !== expected.size`）。
 * ⇒ 声明了就得**真的实现**，否则端点探活失败，同样发布不了。
 *
 * # 这个端点提供什么
 *
 * | 工具 | 作用 |
 * | --- | --- |
 * | `watchdog_status` | 查本地账本里的额度用量、可用重置卡与当前判定结论（含最早到期的卡与积分） |
 * | `watchdog_decide` | 立即判定一次：现在该不该用卡、用哪张、为什么（**只判定不扣卡**） |
 *
 * 这样别的插件可以在自己的回合里直接问蹬王之王
 * 「额度还剩多少」「现在该用卡还是留积分」，而不必自己读账本文件。
 * 两个工具都**只读**：不扣卡、不改账本，也不改配置。
 */

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

/** 工具定义（模型可见，所以用中文）。 */
function toolDefs() {
  return [
    {
      name: 'watchdog_status',
      description:
        '查蹬王之王的当前状态（数据来自用户维护的本地账本，只读）：' +
        '5 小时与每周额度用量、未过期的重置卡及其到期时间、账本最后更新时间，' +
        '以及当前的用卡判定（建议动作、理由、最早到期的重置卡与积分）。' +
        '账本读不到时额度与判定为 null，原因写在 quotaError 里。',
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    },
    {
      name: 'watchdog_decide',
      description:
        '基于本地账本立即判定一次：按「先过期先用」比较最早到期的重置卡与积分，' +
        '返回建议动作（use-card / use-credit / wait / idle）、理由，以及建议使用的那张卡（没有则为 null）。' +
        '**只给建议，不扣卡、不改账本** —— 本插件只读，是否用卡由用户自行决定。',
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    },
  ];
}

/**
 * 创建 MCP 处理器。
 *
 * @param {{
 *   status: () => any,
 *   decide: () => Promise<any>,
 * }} deps
 */
export function createMcpHandler(deps) {
  /** @param {any} message */
  async function handleRpc(message) {
    if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') {
      return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
    }
    const { id, method, params } = message;
    const isNotification = id === undefined || id === null;
    try {
      let result;
      switch (method) {
        case 'initialize': {
          const requested = params?.protocolVersion;
          result = {
            protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'expiry-guardian', version: '2.0.0' },
            instructions:
              '蹬王之王：基于本地账本追踪积分与重置卡的到期时间，' +
              '并给出「先过期先用」的用卡/留积分建议。' +
              '用 watchdog_status 查状态，watchdog_decide 立即判定一次（**只判定不扣卡**）。',
          };
          break;
        }
        case 'ping':
          result = {};
          break;
        case 'tools/list':
          result = { tools: toolDefs() };
          break;
        case 'tools/call': {
          const name = params?.name;
          const args = params?.arguments ?? {};
          if (name === 'watchdog_status') {
            // ⚠️ **必须 await**（2026-10-20 实测发现）：
            // `deps.status()` 是 async ⇒ 不 await 拿到的是 **Promise**，
            // 而 `JSON.stringify(Promise)` 得到的是字符串 `"{}"`
            // ⇒ 工具永远返回空对象，调用方什么也看不到。
            result = { content: [{ type: 'text', text: JSON.stringify(await deps.status(), null, 2) }] };
          } else if (name === 'watchdog_decide') {
            const r = await deps.decide();
            result = { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
          } else {
            return { jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${name}` } };
          }
          break;
        }
        default:
          if (isNotification) return undefined;
          return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
      }
      return isNotification ? undefined : { jsonrpc: '2.0', id, result };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
      };
    }
  }

  /**
   * 处理一次 MCP HTTP 请求。
   *
   * @param {any} request
   * @param {any} response
   * @param {any} body 已解析的请求体（POST 时）
   */
  return async function handleMcp(request, response, body) {
    const messages = Array.isArray(body) ? body : body ? [body] : [];
    if (messages.length === 0) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'empty request' }));
      return;
    }
    const out = [];
    for (const message of messages) {
      const r = await handleRpc(message);
      if (r !== undefined) out.push(r);
    }
    response.writeHead(200, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    });
    response.end(JSON.stringify(out.length === 1 ? out[0] : out));
  };
}
