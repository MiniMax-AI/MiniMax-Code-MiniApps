// 验证 local MCP 端点的行为。
//
// 2026-10-20 实测踩到的坑：
//   `deps.status()` 是 async ⇒ 不 await 拿到的是 **Promise**，
//   而 `JSON.stringify(Promise)` 得到的是字符串 `"{}"`
//   ⇒ `watchdog_status` 工具**永远返回空对象**，调用方什么也看不到。
//   ⇒ 这个 bug 零测试覆盖，所以能悄悄活很久。
import { createMcpHandler } from '../miniapp/node/mcp.mjs';

let pass = 0;
let total = 0;
const check = (name, ok, extra = '') => {
  total += 1;
  if (ok) pass += 1;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${extra ? `  ${extra}` : ''}`);
};

/** 造一个假的 MCP HTTP 收发器，拿到 handler 返回的 JSON。 */
function makeTransport(handler) {
  return async (body) => {
    let payload = '';
    let status = 0;
    const response = {
      writeHead(code) {
        status = code;
        return response;
      },
      end(chunk) {
        payload = String(chunk ?? '');
        return response;
      },
    };
    await handler({ url: '/mcp/expiry-guardian', method: 'POST', headers: {} }, response, body);
    return { status, body: payload ? JSON.parse(payload) : null };
  };
}

console.log('=== initialize 要能协商协议版本 ===');
{
  const handler = createMcpHandler({
    status: async () => ({ ok: true }),
    decide: async () => ({ action: 'wait' }),
  });
  const send = makeTransport(handler);
  const r = await send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18' },
  });
  check('返回 ok', r.status === 200, `status=${r.status}`);
  check('协议版本协商一致', r.body?.result?.protocolVersion === '2025-06-18');
  check('serverInfo 名字对', r.body?.result?.serverInfo?.name === 'expiry-guardian');
  check('serverInfo 版本是 2.0.0', r.body?.result?.serverInfo?.version === '2.0.0');
}

console.log('\n=== tools/list 要列出两个工具 ===');
{
  const handler = createMcpHandler({
    status: async () => ({}),
    decide: async () => ({}),
  });
  const send = makeTransport(handler);
  const r = await send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const names = (r.body?.result?.tools ?? []).map((t) => t.name).sort();
  check('两个工具都在', names.length === 2, names.join(','));
  check('包含 watchdog_status', names.includes('watchdog_status'));
  check('包含 watchdog_decide', names.includes('watchdog_decide'));
  check('**不含**扣卡工具', !names.includes('watchdog_use_card'), names.join(','));
}

console.log('\n=== tools/call：async 的 status 也要真的 await（否则返回 "{}"）===');
{
  const handler = createMcpHandler({
    // ⚠️ 故意用 async —— 这正是踩坑的形态。
    status: async () => ({ quota: { used: 3 }, pendingWakes: [{ id: 'x', attempts: 2 }] }),
    decide: async () => ({ action: 'wait', reason: '额度充足' }),
  });
  const send = makeTransport(handler);

  const st = await send({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'watchdog_status', arguments: {} },
  });
  const text = st.body?.result?.content?.[0]?.text;
  check('content 有文本', typeof text === 'string', `type=${typeof text}`);
  check('**不是** "{}"', text !== '{}', String(text).slice(0, 60));
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* 下面断言会失败 */
  }
  check('能解析成 JSON', parsed !== null);
  check('quota 字段在里面', parsed?.quota?.used === 3, JSON.stringify(parsed?.quota));
  check('pendingWakes 在里面', Array.isArray(parsed?.pendingWakes) && parsed.pendingWakes.length === 1);

  const dc = await send({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: { name: 'watchdog_decide', arguments: {} },
  });
  const dtext = dc.body?.result?.content?.[0]?.text;
  check('watchdog_decide 也有真内容', typeof dtext === 'string' && dtext !== '{}', String(dtext).slice(0, 40));
}

console.log('\n=== 未知工具要报明确的错（不能静默） ===');
{
  const handler = createMcpHandler({
    status: async () => ({}),
    decide: async () => ({}),
  });
  const send = makeTransport(handler);
  const r = await send({
    jsonrpc: '2.0',
    id: 6,
    method: 'tools/call',
    params: { name: 'watchdog_use_card', arguments: {} },
  });
  check('返回 -32602', r.body?.error?.code === -32602, JSON.stringify(r.body?.error));
  check('错误文案点名了工具', String(r.body?.error?.message ?? '').includes('watchdog_use_card'));
}

console.log(`\n${pass}/${total} passed`);
if (pass !== total) process.exitCode = 1;
