// Host bridge for the CadQuery Viewer page.
//
// Standard MCP Apps (SEP-1865) view side: JSON-RPC 2.0 over window.postMessage.
//   view -> host  ui/initialize {appInfo, appCapabilities, protocolVersion}
//   host -> view  {protocolVersion, hostInfo, hostCapabilities, hostContext}
//   view -> host  ui/notifications/initialized
//   view -> host  ui/message {role:"user", content:[{type:"text", text}]}  (only if hostCapabilities.message)
// A top-level page has window.parent === window, so our own outgoing traffic is also
// delivered to our listener; it is recognised by the "cqv-" id prefix and ignored.

const PROTOCOL_VERSION = '2026-01-26';
const APP_INFO = { name: 'cq-viewer', version: '1.2.1' }; // keep equal to plugin.json (tests check)
const OWN_NOTIFICATIONS = new Set(['ui/notifications/initialized', 'ui/notifications/size-changed']);

/**
 * @typedef {{
 *   status: 'connecting' | 'connected' | 'unavailable',
 *   protocolVersion: string | null,
 *   hostInfo: unknown,
 *   hostCapabilities: Record<string, any> | null,
 *   hostContext: Record<string, any> | null,
 *   error: string | null,
 * }} BridgeState
 */

export function createHostBridge() {
  const target = window.parent;
  let seq = 0;
  /** @type {Map<string, {resolve:(v:any)=>void, reject:(e:Error)=>void, timer:ReturnType<typeof setTimeout>}>} */
  const pending = new Map();
  /** @type {Set<(ctx: Record<string, any>) => void>} */
  const contextListeners = new Set();
  /** @type {BridgeState} */
  const state = {
    status: 'connecting',
    protocolVersion: null,
    hostInfo: null,
    hostCapabilities: null,
    hostContext: null,
    error: null,
  };

  const post = (msg) => {
    try {
      target.postMessage(msg, '*');
    } catch {
      /* detached or cross-origin without a listener: treated as unavailable by timeouts */
    }
  };

  const respond = (id, result) => post({ jsonrpc: '2.0', id, result });
  const respondError = (id, code, message) => post({ jsonrpc: '2.0', id, error: { code, message } });

  function onMessage(event) {
    if (event.source !== target) return;
    const msg = event.data;
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return;

    if (typeof msg.method === 'string') {
      if (typeof msg.id === 'string' && msg.id.startsWith('cqv-')) return; // our own request echoed back
      if (msg.id === undefined && OWN_NOTIFICATIONS.has(msg.method)) return; // our own notification
      handleHostMessage(msg);
      return;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) {
        p.reject(Object.assign(new Error(msg.error.message || '宿主返回错误'), { code: msg.error.code }));
      } else {
        p.resolve(msg.result ?? {});
      }
    }
  }

  function handleHostMessage(msg) {
    if (msg.method === 'ui/notifications/host-context-changed') {
      state.hostContext = { ...(state.hostContext || {}), ...(msg.params || {}) };
      for (const fn of contextListeners) fn(state.hostContext);
      return;
    }
    if (msg.id === undefined) return; // other notifications are informational
    if (msg.method === 'ui/resource-teardown' || msg.method === 'ping') {
      respond(msg.id, {});
      return;
    }
    respondError(msg.id, -32601, `Method not supported by view: ${msg.method}`);
  }

  function request(method, params, timeoutMs) {
    const id = `cqv-${++seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Object.assign(new Error('宿主没有响应'), { code: 'timeout' }));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      post({ jsonrpc: '2.0', id, method, params });
    });
  }

  window.addEventListener('message', onMessage);

  /** Handshake; resolves with the final state (never rejects). */
  async function connect(timeoutMs = 1500) {
    try {
      const result = await request(
        'ui/initialize',
        { appInfo: APP_INFO, appCapabilities: {}, protocolVersion: PROTOCOL_VERSION },
        timeoutMs,
      );
      state.status = 'connected';
      state.protocolVersion = typeof result.protocolVersion === 'string' ? result.protocolVersion : null;
      state.hostInfo = result.hostInfo ?? null;
      state.hostCapabilities = result.hostCapabilities && typeof result.hostCapabilities === 'object' ? result.hostCapabilities : {};
      state.hostContext = result.hostContext && typeof result.hostContext === 'object' ? result.hostContext : null;
      post({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} });
      if (state.hostContext) for (const fn of contextListeners) fn(state.hostContext);
    } catch (error) {
      state.status = 'unavailable';
      state.error = error instanceof Error ? error.message : String(error);
    }
    return state;
  }

  /** Host accepts text messages: presence-only `message: {}` or an explicit `text` modality. */
  function canSendMessage() {
    const m = state.hostCapabilities?.message;
    return state.status === 'connected' && !!m && (Object.keys(m).length === 0 || !!m.text);
  }

  /** Legacy MiniMax Code Mini App API: fills the conversation input without sending. */
  function legacyAppend() {
    const fn = /** @type {any} */ (window).mcode?.miniapp?.message?.append;
    return typeof fn === 'function' ? fn.bind(/** @type {any} */ (window).mcode.miniapp.message) : null;
  }

  /**
   * Deliver `text` to the bound conversation as a user message via ui/message.
   * The host may ask the user to confirm, so the timeout is generous.
   */
  async function sendMessage(text) {
    if (!canSendMessage()) throw new Error('当前会话不支持从 Viewer 直接发送');
    const result = await request(
      'ui/message',
      { role: 'user', content: [{ type: 'text', text }] },
      5 * 60 * 1000,
    );
    if (result && result.isError) throw new Error('会话没有接收这条消息');
    return result;
  }

  /**
   * Deliver `text` to the conversation this viewer belongs to.
   *   1. Standard MCP Apps `ui/message` when the host granted the `message` capability → 'sent'.
   *   2. MiniMax Code's injected Mini App message bridge (draft delivery) → 'drafted'.
   *      Its promise may settle late, so we only wait briefly for an early rejection.
   * @returns {Promise<{mode: 'sent' | 'drafted'}>}
   */
  async function deliver(text) {
    if (state.status === 'connecting' && connecting) await connecting;
    if (canSendMessage()) {
      await sendMessage(text);
      return { mode: 'sent' };
    }
    const append = legacyAppend();
    if (append) {
      await Promise.race([
        Promise.resolve().then(() => append(text)),
        new Promise((resolve) => setTimeout(resolve, 2500)),
      ]);
      return { mode: 'drafted' };
    }
    throw Object.assign(new Error('当前窗口没有连接到 MiniMax Code 对话'), { code: 'no_bridge' });
  }

  /** Whether any delivery path exists (decided after the handshake). */
  function canDeliver() {
    return canSendMessage() || !!legacyAppend();
  }

  let connecting = null;
  return {
    state,
    connect: (timeoutMs) => (connecting ??= connect(timeoutMs)),
    canSendMessage,
    canDeliver,
    deliver,
    legacyAppend,
    onContextChanged: (fn) => {
      contextListeners.add(fn);
      return () => contextListeners.delete(fn);
    },
  };
}
