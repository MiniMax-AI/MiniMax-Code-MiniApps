import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import { capsuleMarkup } from '../../miniapp/node/preview-chrome.mjs';

const runtime = await readFile(new URL('../../miniapp/client/game-runtime.js', import.meta.url), 'utf8');
const devices = await readFile(new URL('../../miniapp/client/device-config.js', import.meta.url), 'utf8');

// The scheduler is deterministic; graphics/audio doubles only prove API/lifecycle
// admission. Pixel decode/WebGL/audio playback evidence comes from real Electron.
export function gameEnvironment(t, { modules = { 'game.js': 'GameGlobal.canvas=wx.createCanvas();' }, orientation = 'portrait', showStatusBar = false, assets = {}, beforeRuntime } = {}) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${capsuleMarkup}</body></html>`, { url: 'http://preview.invalid/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  const win = dom.window;
  win.document.querySelector('body'); // Initialize jsdom's selector observer before game listener tracking.
  t.after(() => win.close());
  let now = 0;
  let id = 0;
  const timeouts = new Map(), frames = new Map(), messages = [];
  Object.defineProperty(win.performance, 'now', { value: () => now });
  win.TextEncoder = TextEncoder;
  win.setTimeout = (callback, delay = 0) => { timeouts.set(++id, { callback, at: now + Number(delay) }); return id; };
  win.clearTimeout = (key) => timeouts.delete(key);
  win.requestAnimationFrame = (callback) => { frames.set(++id, callback); return id; };
  win.cancelAnimationFrame = (key) => frames.delete(key);
  Object.defineProperty(win, 'parent', { value: { postMessage: (message) => messages.push(JSON.parse(JSON.stringify(message))) } });
  win.__WX_BUILD__ = { projectKind: 'minigame', runtimeVersion: '2', entryModule: 'game.js', game: { deviceOrientation: orientation, showStatusBar }, modules };
  const identity = { projectId: '123456789abc', instanceId: 'game-instance', previewId: 'game-preview', serverEpoch: 'game-server', buildId: 'game-build', clientId: 'game-client', leaseEpoch: 1 };
  win.__WX_PREVIEW_FRAME__ = { ...identity, assets };
  win.eval(devices);
  if (beforeRuntime) beforeRuntime(win);
  win.eval(runtime);
  const message = (value, source = win.parent) => win.dispatchEvent(new win.MessageEvent('message', { source, data: win.JSON.parse(JSON.stringify({ source: 'wx-shell', ...identity, ...value })) }));
  const advance = (milliseconds) => {
    const end = now + milliseconds;
    let count = 0;
    while (true) {
      const next = [...timeouts.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      if (++count > 10000) throw new Error('Test scheduler exceeded callback bound');
      now = Math.max(now, next[1].at); timeouts.delete(next[0]); next[1].callback();
    }
    now = end;
  };
  const animationFrame = (milliseconds = 1000 / 60) => { advance(milliseconds); const work = [...frames.values()]; frames.clear(); work.forEach((fn) => fn(now)); };
  return { win, messages, timeouts, frames, identity, message, advance, animationFrame,
    init: (options = {}) => message({ type: 'init', storage: {}, device: '390x844', visible: true, ...options }),
    status: () => messages.filter((m) => m.type === 'preview-status').at(-1),
    state: () => messages.filter((m) => m.type === 'game-state').at(-1),
    flush: async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); },
  };
}
