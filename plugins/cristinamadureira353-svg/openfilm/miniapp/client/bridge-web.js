/**
 * 网页版的 openfilmNative：把桌面版 preload 的那套接口，搬到 HTTP 上。
 *
 * 桌面 app 的 preload（apps/desktop/src/preload.cjs）给页面 `window.openfilmNative`，
 * 里面每个方法都是 `ipcRenderer.invoke(channel, payload)`。这里换成
 * `POST /ipc/<channel>`（同源，面板自己的服务），推送走 `GET /ipc/events`（SSE）。
 *
 * 只有三样是 Electron 独有的，网页里各有替身：
 *   · pickFolder —— 浏览器没有原生目录选择框（showDirectoryPicker），这里退成 null
 *   · revealPath —— 用 `open -R` 让访达显示它（走服务端）
 *   · capture —— 截自己的窗口在网页里没有意义，退成 null
 */
(function () {
  /* 鉴权由 Host 做（MiniMax Code 3.1.2+ 的 loopback credential），页面不带任何密钥。 */

  /** 一次调用：POST /ipc/<channel>，body 就是 preload 传给 invoke 的那个 payload。 */
  async function invoke(channel, payload) {
    const r = await fetch('/ipc/' + encodeURIComponent(channel), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(enc(payload)),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error(t || ('channel ' + channel + ': ' + r.status));
    }
    return dec(await r.json());
  }

  /** 二进制（ArrayBuffer / Uint8Array）在 JSON 里走 base64，不然会变成 {} */
  function enc(value) {
    if (value === undefined) return null;
    if (value instanceof ArrayBuffer) return { __b64: bytesToB64(new Uint8Array(value)) };
    if (ArrayBuffer.isView(value)) return { __b64: bytesToB64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
    if (Array.isArray(value)) return value.map(enc);
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = enc(v);
      return out;
    }
    return value;
  }
  function dec(value) {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map(dec);
    if (typeof value === 'object') {
      if (typeof value.__b64 === 'string') return b64ToBytes(value.__b64);
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = dec(v);
      return out;
    }
    return value;
  }
  function bytesToB64(bytes) {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  }
  function b64ToBytes(b64) {
    const s = atob(b64);
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return bytes.buffer;
  }

  /** 订阅服务端的推送（desktop:local-agents:event 等）。 */
  const streams = new Map();
  function on(channel) {
    return (listener) => {
      if (typeof listener !== 'function') return () => {};
      let list = streams.get(channel);
      if (!list) { list = new Set(); streams.set(channel, list); }
      list.add(listener);
      return () => list.delete(listener);
    };
  }
  /* 一条 SSE 连着所有频道：省得开几条 */
  const source = new EventSource('/ipc/events');
  source.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    const list = streams.get(msg.channel);
    if (!list) return;
    for (const listener of list) { try { listener(dec(msg.value)); } catch { /* 一个听众坏了不影响别的 */ } }
  };

  const noop = () => Promise.resolve({});
  const listeners = () => () => {};

  window.openfilmNative = {
    platform: 'darwin',
    hello: () => invoke('desktop:hello'),
    pathForFile: () => '',
    revealPath: (path) => invoke('desktop:reveal', String(path)),
    pickFolder: (options) => invoke('desktop:pick-folder', options ?? null),
    capture: (rect) => invoke('desktop:capture', rect),

    tabs: {
      list: () => invoke('desktop:tabs:list'),
      onChange: on('desktop:tabs'),
      show: (id) => invoke('desktop:tabs:show', { id }),
      close: (id) => invoke('desktop:tabs:close', { id }),
      open: (projectId) => invoke('desktop:tabs:new', { projectId }),
      move: (id, index) => invoke('desktop:tabs:move', { id, index }),
      report: (state) => invoke('desktop:tabs:report', state ?? {}),
      gone: (projectIds) => invoke('desktop:tabs:gone', { projectIds }),
      retitle: (id, title) => invoke('desktop:tabs:retitle', { id, title }),
      openRequest: (to) => invoke('desktop:tabs:open', { to }),
      onPick: on('desktop:tabs:pick'),
      onCovered: on('desktop:tabs:covered'),
    },

    agents: {
      list: () => invoke('desktop:agents:list'),
      connect: (id) => invoke('desktop:agents:connect', { id }),
      disconnect: (id) => invoke('desktop:agents:disconnect', { id }),
      usage: (id, fresh) => invoke('desktop:agents:usage', { id, fresh: fresh === true }),
      setShown: (id, shown) => invoke('desktop:agents:shown', { id, shown: shown === true }),
      locate: (id, words) => invoke('desktop:agents:locate', { id, words }),
      useAutomatic: (id) => invoke('desktop:agents:automatic', { id }),
      install: (id) => invoke('desktop:agents:install', { id }),
      diagnose: (id) => invoke('desktop:agents:diagnose', { id }),
      report: () => invoke('desktop:agents:report'),
      copyReport: () => invoke('desktop:diagnostics:copy'),
      saveOwnModel: (config) => invoke('desktop:agents:own-model', { config }),
      removeOwnModel: (id) => invoke('desktop:agents:own-model-remove', { id }),
      mcp: (id) => invoke('desktop:agents:mcp', { id }),
      skills: (id) => invoke('desktop:agents:skills', { id }),
      allowSkill: (id, name, allowed) => invoke('desktop:skills:allow', { agent: id, name, allowed: allowed === true }),
      allowMcp: (id, name, allowed) => invoke('desktop:agents:mcp-allow', { id, name, allowed: allowed === true }),
      onChange: on('desktop:agents'),
    },

    localAgents: {
      list: () => invoke('desktop:local-agents:list'),
      signIn: (agent) => invoke('desktop:local-agents:sign-in', { agent }),
      disconnect: (agent) => invoke('desktop:local-agents:disconnect', { agent }),
      probe: (agent) => invoke('desktop:local-agents:probe', { agent }),
      start: (agent, cwd, resume, meta) => invoke('desktop:local-agents:start', { agent, cwd, resume, meta }),
      prompt: (key, text, meta, images) => invoke('desktop:local-agents:prompt', { key, text, meta, images }),
      running: () => invoke('desktop:local-agents:running'),
      ack: (key, turnId) => invoke('desktop:local-agents:ack', { key, turnId }),
      steer: (key, text, images) => invoke('desktop:local-agents:steer', { key, text, images }),
      adopt: (key, turnId, meta) => invoke('desktop:local-agents:adopt', { key, turnId, meta }),
      cancel: (key) => invoke('desktop:local-agents:cancel', { key }),
      setOption: (key, configId, value) => invoke('desktop:local-agents:set-option', { key, configId, value }),
      answerPermission: (key, requestId, optionId) => invoke('desktop:local-agents:permission', { key, requestId, optionId }),
      answerQuestion: (key, requestId, answers) => invoke('desktop:local-agents:answer', { key, requestId, answers }),
      close: (key) => invoke('desktop:local-agents:close', { key }),
      onEvent: on('desktop:local-agents:event'),
    },

    chat: {
      load: (project) => invoke('desktop:chat:load', { project }),
      saveSessions: (project, sessions, last) => invoke('desktop:chat:sessions', { project, sessions, last }),
      saveTurn: (project, turn, items) => invoke('desktop:chat:turn', { project, turn, items }),
      log: (project, turnId, unless) => invoke('desktop:chat:log', { project, turnId, unless }),
      reveal: (project, turnId) => invoke('desktop:chat:reveal', { project, turnId }),
      saveRefImage: (project, turnId, n, bytes) => invoke('desktop:chat:ref-image', { project, turnId, n, bytes }),
      saveAttachment: (project, name, bytes) => invoke('desktop:chat:attachment', { project, name, bytes }),
      describePaths: (paths) => invoke('desktop:chat:paths', { paths }),
      unsaved: (project, except) => invoke('desktop:chat:unsaved', { project, except }),
      snapshot: (project, turnId) => invoke('desktop:chat:snapshot', { project, turnId }),
      changes: (project, turnId) => invoke('desktop:chat:changes', { project, turnId }),
    },

    skills: {
      list: (project, agent) => invoke('desktop:skills:list', { project, agent }),
      texts: (project, agent, names) => invoke('desktop:skills:texts', { project, agent, names }),
      allow: (agent, name, allowed) => invoke('desktop:skills:allow', { agent, name, allowed }),
      changed: () => invoke('desktop:skills:changed'),
      preview: (url) => invoke('desktop:skills:preview', { url }),
      previewFolder: (path, words) => invoke('desktop:skills:preview', { folder: typeof path === 'string' ? path : null, words }),
      commit: (id, covers) => invoke('desktop:skills:commit', { id, covers }),
      discard: (id) => invoke('desktop:skills:discard', { id }),
      reveal: () => invoke('desktop:skills:reveal'),
    },

    prefs: {
      get: () => invoke('desktop:prefs'),
      set: (next) => invoke('desktop:prefs:set', next),
      onChange: on('desktop:prefs'),
    },

    saveLayout: (layout) => invoke('desktop:layout', { chatOpen: layout?.chatOpen === true, chatWidth: Number(layout?.chatWidth) }),
    setTheme: (theme) => invoke('desktop:theme', theme === 'dark' ? 'dark' : 'light'),
    setLanguage: (language) => invoke('desktop:language', String(language)),
    onFullScreen: on('desktop:full-screen'),
    onToggleChat: on('desktop:toggle-chat'),
    onOpenSettings: on('desktop:open-settings'),
    onStudioBrowser: on('desktop:studio-browser'),
    onFfmpeg: on('desktop:ffmpeg'),
    onUpdate: on('desktop:update'),
    restartToUpdate: () => invoke('desktop:update-restart'),
    updateState: () => invoke('desktop:update-state'),
    checkForUpdate: () => invoke('desktop:update-check'),
  };
})();
