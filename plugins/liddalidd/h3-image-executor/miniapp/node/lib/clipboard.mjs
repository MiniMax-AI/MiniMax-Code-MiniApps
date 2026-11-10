// 系统剪贴板读取。
//
// 为什么在服务端：Mini App 页面被产品层禁止读剪贴板——manifest 的 deviceAccess 只开放
// 麦克风 / 摄像头 / 通知，"clipboard read … denied to Mini App pages"。所以
// navigator.clipboard.readText() 在面板里永远失败，不是 Electron 的偶发问题。
// 剩下的唯一通路是 Node 侧调本机剪贴板命令（package-contract 的 data-access 允许
// spawn/execFile 调本机 CLI，前提是参数数组、超时、输出上限、dispose 清理）。
//
// 三条硬约束：
// 1. 只在用户点「剪贴板」按钮时读一次，绝不在加载 / 轮询 / 保存时顺手读。
// 2. 读到的内容不写日志、不落盘、不进 session.json。
// 3. 只有「像 Key」或「像接口地址」的内容才回给页面，其余一律不回传原文——
//    免得这个接口变成一个通用的「读我剪贴板」后门。
import { spawn } from 'node:child_process';

const TIMEOUT_MS = 2000;
const MAX_BYTES = 8 * 1024;

// 还在跑的子进程。dispose() 要负责收尸：Host 停 Mini App 时只会 SIGTERM 我们这个
// Node 入口，不会自动清理孙进程。
const live = new Set();

// 每个平台一条候选链：前一条命令不存在（ENOENT / 非零退出）就试下一条。
function readers(platform) {
  if (platform === 'darwin') return [{ command: 'pbpaste', args: [] }];
  if (platform === 'win32') {
    return [{ command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', 'Get-Clipboard'] }];
  }
  return [
    { command: 'wl-paste', args: ['--no-newline'] },
    { command: 'xclip', args: ['-selection', 'clipboard', '-o'] },
  ];
}

function run(command, args) {
  return new Promise((resolve) => {
    let child = null;
    try {
      // 固定命令 + 固定参数数组，不拼 shell、不接受任何页面输入。
      child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      resolve({ ok: false, reason: 'unavailable' });
      return;
    }
    live.add(child);
    let settled = false;
    let size = 0;
    const chunks = [];
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      live.delete(child);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* 已经退出 */ }
      finish({ ok: false, reason: 'timeout' });
    }, TIMEOUT_MS);
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) {
        try { child.kill('SIGKILL'); } catch { /* 已经退出 */ }
        finish({ ok: false, reason: 'too_large' });
        return;
      }
      chunks.push(chunk);
    });
    child.on('error', () => finish({ ok: false, reason: 'unavailable' }));
    child.on('close', (code) => {
      if (code !== 0) return finish({ ok: false, reason: 'unavailable' });
      finish({ ok: true, text: Buffer.concat(chunks).toString('utf8') });
    });
  });
}

// —— 写剪贴板 ——
//
// 为什么必须在服务端写：页面侧两条路都被浏览器安全模型堵死。
// navigator.clipboard.writeText 要求文档处于聚焦状态——实测面板里 document.hasFocus() 是 false，
// 直接抛 NotAllowedError: Failed to execute 'writeText' on 'Clipboard': Document is not focused；
// document.execCommand('copy') 同样要求聚焦。而发布完成是在 setInterval 回调里发生的，
// 既没有用户激活，用户在这 1–3 分钟里也早就切走了。服务端 spawn pbcopy 完全绕过这两条限制。
//
// 三条硬约束（和读那边对称）：
// 1. 只写「我们自己刚部署出来的公开地址」，不接受页面传来的任意文本——否则这个接口
//    会变成一个通用的「往用户剪贴板里写东西」的后门。
// 2. 单行、长度上限、必须锚定部署域名。
// 3. 固定命令 + 固定参数数组，不拼 shell、不接受任何页面输入当命令。
const WRITE_MAX_BYTES = 2048;

// 只认 Host 部署出来的地址形状，和 publish.mjs 的 DEPLOY_URL_RE 保持一致。
const DEPLOY_URL_RE = /^https:\/\/[a-z0-9][a-z0-9-]*\.space\.mcode\.cn(?:\/[^\s"'<>`）】，。；、]*)?$/i;

export function validateClipText(text) {
  const value = String(text == null ? '' : text);
  if (!value) return { error: 'clipboard_empty' };
  if (value.length > WRITE_MAX_BYTES) return { error: 'clipboard_too_long' };
  if (/[\r\n]/.test(value)) return { error: 'clipboard_multiline' };
  if (!DEPLOY_URL_RE.test(value)) return { error: 'clipboard_not_deploy_url' };
  return { ok: true, value };
}

// 每个平台一条候选链：前一条命令不存在（ENOENT / 非零退出）就试下一条。
function writers(platform) {
  if (platform === 'darwin') return [{ command: 'pbcopy', args: [] }];
  if (platform === 'win32') {
    return [{ command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', 'Set-Clipboard -Value ([Console]::In.ReadToEnd())'] }];
  }
  return [
    { command: 'wl-copy', args: [] },
    { command: 'xclip', args: ['-selection', 'clipboard'] },
  ];
}

// 写入走 stdin，所以单独一份 spawn：读那边是 ['ignore','pipe','ignore']，不能复用。
function runWrite(command, args, value) {
  return new Promise((resolve) => {
    let child = null;
    try {
      child = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
    } catch {
      resolve({ ok: false, reason: 'unavailable' });
      return;
    }
    live.add(child);
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      live.delete(child);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* 已经退出 */ }
      finish({ ok: false, reason: 'timeout' });
    }, TIMEOUT_MS);
    child.on('error', () => finish({ ok: false, reason: 'unavailable' }));
    child.on('close', (code) => {
      if (code !== 0) return finish({ ok: false, reason: 'unavailable' });
      finish({ ok: true });
    });
    try {
      // pbcopy 可能提前退出，不接 error 会变成 unhandled 'error' 事件把进程带崩。
      child.stdin.on('error', () => { /* 写端已关 */ });
      child.stdin.end(value);
    } catch {
      finish({ ok: false, reason: 'unavailable' });
    }
  });
}

export async function writeClipboard(text, platform) {
  const picked = validateClipText(text);
  if (picked.error) return picked;
  const list = writers(platform || process.platform);
  for (let i = 0; i < list.length; i += 1) {
    const result = await runWrite(list[i].command, list[i].args, picked.value);
    if (result.ok) return { ok: true };
    // 命令在但没写成（超时）就不再试下一条：换命令也不会变好。
    if (result.reason !== 'unavailable') return result;
  }
  return { ok: false, reason: 'unavailable' };
}

export { DEPLOY_URL_RE as CLIP_DEPLOY_URL_RE, WRITE_MAX_BYTES };

export async function readClipboard(platform) {
  const list = readers(platform || process.platform);
  for (let i = 0; i < list.length; i += 1) {
    const result = await run(list[i].command, list[i].args);
    if (result.ok) return result;
    // 命令在但没读成（超时 / 超限）就不再试下一条：换命令也不会变好。
    if (result.reason !== 'unavailable') return result;
  }
  return { ok: false, reason: 'unavailable' };
}

// 剪贴板内容分类。只回传能直接填进输入框的东西，其余只回一个错误码。
export function classifyClipboard(text) {
  const value = String(text == null ? '' : text).replace(/\r\n/g, '\n').trim();
  if (!value) return { error: 'clipboard_empty' };
  if (value.length > 512) return { error: 'clipboard_too_long' };
  if (/\s/.test(value)) return { error: 'clipboard_multiline' };
  if (/^https:\/\//i.test(value)) return { ok: true, field: 'baseUrl', value };
  // 用户复制了 http 地址：直接告诉他为什么不能用，比丢一句「不像 Key」有用。
  if (/^http:\/\//i.test(value)) return { error: 'base_url_must_be_https' };
  if (value.length < 8) return { error: 'clipboard_not_key' };
  return { ok: true, field: 'apiKey', value };
}

export function disposeClipboard() {
  for (const child of live) {
    try { child.kill('SIGKILL'); } catch { /* 已经退出 */ }
  }
  live.clear();
}

export function liveClipboardChildren() {
  return live.size;
}
