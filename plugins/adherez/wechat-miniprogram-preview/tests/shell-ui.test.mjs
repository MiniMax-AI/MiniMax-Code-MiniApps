import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const client = (file) => readFile(new URL('../miniapp/client/' + file, import.meta.url), 'utf8');
const [html, devices, shell] = await Promise.all(['index.html', 'device-config.js', 'shell.js'].map(client));
async function loadShell(t, selected = false) {
  const dom = new JSDOM(html, { url: 'http://preview.test/preview' + (selected ? '?previewId=pv_ui' : ''), runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const win = dom.window, streams = [], requests = [];
  win.matchMedia = () => ({ matches: false, addEventListener() {} }); win.ResizeObserver = class { observe() {} }; win.TextEncoder = TextEncoder;
  win.EventSource = class { constructor(url) { this.url = url; this.events = new Map(); streams.push(this); } addEventListener(name, callback) { this.events.set(name, callback); } close() {} };
  win.fetch = async (url) => { requests.push(url); return { ok: true, json: async () => url === '/api/shells' ? { channelId: 'shell_ui' } : url.includes('/shells/') ? { ok: true } : { previewId: 'pv_ui', projectId: 'aaaaaaaaaaaa', serverEpoch: 'epoch-ui', leaseEpoch: 0, lease: null, route: '', projects: [], build: { status: 'idle' } } }; };
  win.eval(devices); win.eval(shell);
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
  return { win, streams, requests, get: (id) => win.document.getElementById(id) };
}
test('the shell has exactly one named refresh action and no forms, menus, dialogs or hidden alternate controls', async (t) => {
  const e = await loadShell(t);
  const actions = [...e.win.document.querySelectorAll('button,select,input,a,[role=button],[tabindex]')];
  assert.equal(actions.length, 1);
  assert.equal(actions[0].id, 'refresh-preview');
  assert.equal(actions[0].textContent.trim(), '刷新预览');
  assert.equal(actions[0].disabled, true);
  assert.equal(e.win.document.querySelectorAll('dialog,form,details').length, 0);
  assert.equal(e.get('simulator').getAttribute('sandbox'), 'allow-scripts');
  assert.match(e.get('empty').textContent, /聊天.*Agent/);
  assert.equal(e.requests.length, 0);
});
test('connection or build state is accessible noninteractive text, never a diagnostics action', async (t) => {
  const e = await loadShell(t, true);
  const stream = e.streams.find((entry) => entry.url.includes('/api/shells/'));
  stream.events.get('error')();
  assert.equal(e.get('preview-status').getAttribute('role'), 'status');
  assert.match(e.get('preview-status').textContent, /连接中断/);
  assert.equal(e.get('refresh-preview').disabled, true);
  assert.equal(e.win.document.querySelectorAll('button').length, 1);
  assert.equal(e.get('show-diagnostics'), null);
  assert.equal(e.get('open-project'), null);
});
