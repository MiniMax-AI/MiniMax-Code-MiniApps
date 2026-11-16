// 压缩台账：每压一次记一笔，回答「我到底省了多少」「都花在哪些平台上了」。
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatBytes, formatDuration } from './format.js';

export function ledgerDir(env = process.env) {
  return env.EXPRESS_HOME || path.join(env.USERPROFILE || os.homedir(), '.express');
}

export function ledgerPath(env = process.env) {
  return path.join(ledgerDir(env), 'ledger.jsonl');
}

export function appendEntry(entry, { env = process.env } = {}) {
  const dir = ledgerDir(env);
  mkdirSync(dir, { recursive: true });
  const record = { ts: new Date().toISOString(), ...entry };
  appendFileSync(ledgerPath(env), JSON.stringify(record) + '\n', 'utf8');
  return record;
}

export function readEntries({ env = process.env } = {}) {
  const p = ledgerPath(env);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

export function summarize(entries) {
  const valid = entries.filter((e) => Number.isFinite(e.beforeBytes) && Number.isFinite(e.afterBytes));
  const before = valid.reduce((s, e) => s + e.beforeBytes, 0);
  const after = valid.reduce((s, e) => s + e.afterBytes, 0);
  const seconds = valid.reduce((s, e) => s + (e.encodeSeconds || 0), 0);
  const byTarget = new Map();
  for (const e of valid) {
    const key = e.targetLabel || '未知';
    const cur = byTarget.get(key) || { count: 0, before: 0, after: 0 };
    cur.count += 1; cur.before += e.beforeBytes; cur.after += e.afterBytes;
    byTarget.set(key, cur);
  }
  return {
    count: valid.length,
    beforeBytes: before,
    afterBytes: after,
    savedBytes: Math.max(0, before - after),
    savedRatio: before > 0 ? before / Math.max(1, after) : null,
    encodeSeconds: seconds,
    byTarget: [...byTarget.entries()]
      .map(([target, v]) => ({ target, ...v, savedBytes: Math.max(0, v.before - v.after) }))
      .sort((a, b) => b.savedBytes - a.savedBytes),
  };
}

export function toEntry(result, { encodeSeconds = 0 } = {}) {
  return {
    action: result.action,
    input: result.input,
    output: result.output,
    targetId: result.target.kind === 'platform' ? result.target.platform.id : 'custom',
    targetLabel: result.target.label,
    beforeBytes: result.before,
    afterBytes: result.after,
    durationSec: result.inputInfo?.durationSec ?? null,
    contentKind: result.content?.kind ?? null,
    passCount: result.passes?.length ?? 0,
    fitsHardLimit: result.verdict?.fitsHardLimit ?? null,
    encodeSeconds,
  };
}

const CSS = `
:root{--bg:#0f1115;--panel:#171a21;--line:#252a34;--fg:#e7eaf0;--dim:#8b93a5;--ok:#4ade80;--bad:#f87171;--warn:#fbbf24;--accent:#7c9cff}
*{box-sizing:border-box}
body{margin:0;padding:32px;background:var(--bg);color:var(--fg);
  font:15px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",system-ui,sans-serif}
.wrap{max-width:1080px;margin:0 auto}
h1{font-size:22px;margin:0 0 4px;font-weight:650;letter-spacing:.02em}
.sub{color:var(--dim);font-size:13px;margin-bottom:24px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:24px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.card .k{color:var(--dim);font-size:12px;margin-bottom:4px}
.card .v{font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}
.card .v.ok{color:var(--ok)} .card .v.bad{color:var(--bad)}
table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line)}
th{color:var(--dim);font-weight:500;font-size:12px}
td.num{text-align:right;font-variant-numeric:tabular-nums}
.bar{height:8px;border-radius:4px;background:var(--accent);display:inline-block;vertical-align:middle}
.pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;border:1px solid}
.pill.ok{color:var(--ok);border-color:#1d5c37} .pill.bad{color:var(--bad);border-color:#6b2626}
.pill.warn{color:var(--warn);border-color:#6b5320}
a{color:var(--accent)}
.empty{color:var(--dim);padding:40px;text-align:center;border:1px dashed var(--line);border-radius:10px}
`;

export function reportHtml(summary, entries, { title = '急件 · 压缩台账' } = {}) {
  const rows = entries
    .slice()
    .reverse()
    .map((e) => {
      const pct = e.beforeBytes > 0 ? Math.max(1, Math.round((e.afterBytes / e.beforeBytes) * 100)) : 0;
      return `<tr>
      <td>${esc(e.ts ? e.ts.slice(0, 19).replace('T', ' ') : '—')}</td>
      <td>${esc(pathBasename(e.input))}</td>
      <td>${esc(e.targetLabel || '—')}</td>
      <td class="num">${formatBytes(e.beforeBytes)}</td>
      <td class="num">${formatBytes(e.afterBytes)}</td>
      <td class="num"><span class="bar" style="width:${Math.max(6, 60 - pct * 0.5)}px"></span> ${e.beforeBytes / Math.max(1, e.afterBytes) > 1 ? (e.beforeBytes / e.afterBytes).toFixed(1) + '×' : '—'}</td>
      <td>${e.fitsHardLimit === true ? '<span class="pill ok">达标</span>' : e.fitsHardLimit === false ? '<span class="pill bad">超限</span>' : '—'}</td>
    </tr>`;
    })
    .join('\n');

  const targetRows = summary.byTarget
    .map((t) => `<tr><td>${esc(t.target)}</td><td class="num">${t.count}</td><td class="num">${formatBytes(t.before)}</td><td class="num">${formatBytes(t.after)}</td><td class="num">${formatBytes(t.before - t.after)}</td></tr>`)
    .join('\n');

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head>
<body><div class="wrap">
<h1>${esc(title)}</h1>
<div class="sub">共 ${summary.count} 次处理，累计 ${formatBytes(summary.beforeBytes)} → ${formatBytes(summary.afterBytes)}</div>
<div class="grid">
  <div class="card"><div class="k">累计省下</div><div class="v ok">${formatBytes(summary.savedBytes)}</div></div>
  <div class="card"><div class="k">平均压缩比</div><div class="v">${summary.savedRatio ? summary.savedRatio.toFixed(1) + '×' : '—'}</div></div>
  <div class="card"><div class="k">处理次数</div><div class="v">${summary.count}</div></div>
  <div class="card"><div class="k">累计编码耗时</div><div class="v">${formatDuration(summary.encodeSeconds)}</div></div>
</div>
${summary.byTarget.length ? `<h2 style="font-size:15px;margin:0 0 8px">按目标平台</h2>
<table><thead><tr><th>目标</th><th class="num">次数</th><th class="num">原始</th><th class="num">产出</th><th class="num">省下</th></tr></thead><tbody>${targetRows}</tbody></table>` : ''}
<h2 style="font-size:15px;margin:24px 0 8px">明细</h2>
${entries.length ? `<table><thead><tr><th>时间</th><th>文件</th><th>目标</th><th class="num">原始</th><th class="num">产出</th><th class="num">压缩比</th><th>判定</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="empty">台账还是空的，先压一个文件试试。</div>'}
</div></body></html>`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function pathBasename(p) {
  if (!p) return '—';
  const parts = String(p).split(/[\\/]/);
  return parts[parts.length - 1];
}

export function writeReport(htmlPath, summary, entries, title) {
  mkdirSync(path.dirname(htmlPath), { recursive: true });
  writeFileSync(htmlPath, reportHtml(summary, entries, { title }), 'utf8');
  return htmlPath;
}
