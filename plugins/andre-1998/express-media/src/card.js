// 投递卡：把「压好了」变成一个能直接发出去的成品。
// 产出是 HTML + 封面图，引用同目录下的视频文件——不是把视频转成 base64 塞进去。
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { run } from './ffmpeg.js';
import { formatBytes, formatBitrate, formatDuration } from './format.js';

export function posterArgs({ input, output, at = 1, width = 640 }) {
  return [
    '-nostdin', '-v', 'error', '-y', '-ss', String(at), '-i', input,
    '-frames:v', '1', '-vf', `scale=${width}:-2:flags=lanczos`, '-q:v', '3', output,
  ];
}

/** 抽封面。失败不算致命——投递卡没有封面也能用。 */
export async function extractPoster(input, { ffmpeg, at = 1, width = 640, out }) {
  if (!ffmpeg?.path) return { path: null, error: '没有 ffmpeg' };
  const outPath = out || path.join(path.dirname(input), `${path.basename(input, path.extname(input))}.cover.jpg`);
  // ffmpeg -y 自带覆盖，所以不需要先删旧封面
  const { code, stderr } = await run(ffmpeg.path, posterArgs({ input, output: outPath, at, width }));
  if (code !== 0 || !existsSync(outPath)) {
    return { path: null, error: (stderr || '').trim().slice(0, 200) || `退出码 ${code}` };
  }
  return { path: outPath, bytes: statSync(outPath).size };
}

const CSS = `
:root{--bg:#0e1014;--panel:#161920;--line:#242936;--fg:#e8ebf1;--dim:#8d95a7;--ok:#4ade80;--bad:#f87171;--accent:#7c9cff}
*{box-sizing:border-box}
body{margin:0;padding:28px;background:var(--bg);color:var(--fg);font:15px/1.65 -apple-system,"Segoe UI","Microsoft YaHei",system-ui,sans-serif}
.wrap{max-width:960px;margin:0 auto}
h1{font-size:21px;margin:0 0 2px;font-weight:650}
.sub{color:var(--dim);font-size:13px;margin-bottom:22px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden;margin-bottom:18px}
video{width:100%;display:block;background:#000}
.bar{display:block;padding:11px 14px;border-top:1px solid var(--line);font-size:13px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
a.dl{color:var(--accent);text-decoration:none;border:1px solid var(--line);border-radius:7px;padding:5px 11px;font-size:13px}
a.dl:hover{border-color:var(--accent)}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:8px 12px;border-bottom:1px solid var(--line);text-align:left}
th{color:var(--dim);font-weight:500;width:130px;font-size:12px}
tr:last-child td{border-bottom:none}
td.num{font-variant-numeric:tabular-nums}
.pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;border:1px solid}
.pill.ok{color:var(--ok);border-color:#1d5c37;background:#0f2418}
.pill.bad{color:var(--bad);border-color:#6b2626;background:#251414}
.pill.warn{color:#fbbf24;border-color:#6b5320;background:#241f10}
h2{font-size:14px;margin:22px 0 8px;color:var(--dim);font-weight:600}
.metric{font-size:30px;font-weight:650;font-variant-numeric:tabular-nums}
.metric.ok{color:var(--ok)}
.foot{color:var(--dim);font-size:12px;margin-top:24px;text-align:center}
ul.alt{margin:6px 0 0;padding-left:20px;color:var(--fg)} ul.alt li{margin:3px 0}
code{background:#1e222c;padding:1px 5px;border-radius:4px;font-size:12px}
`;

/**
 * 生成投递卡。
 * @param videoPath 要展示的视频（相对路径引用）
 * @param meta 附加信息 { beforeBytes, afterBytes, target, verdict, platformChecks, alternatives, content, passes }
 */
export function cardHtml({ videoPath, meta = {}, title, posterName: poster = '' }) {
  const m = meta;
  const v = m.verdict || {};
  const head = title || path.basename(videoPath || '视频');
  const saving = Number.isFinite(m.beforeBytes) && Number.isFinite(m.afterBytes) ? Math.max(0, m.beforeBytes - m.afterBytes) : null;
  const ratio = Number.isFinite(m.afterBytes) && m.afterBytes > 0 && Number.isFinite(m.beforeBytes)
    ? (m.beforeBytes / m.afterBytes) : null;
  const posterName = poster || '';

  const verdictPill = v.fitsHardLimit === true
    ? '<span class="pill ok">可以发</span>'
    : v.fitsHardLimit === false ? '<span class="pill bad">仍然超限</span>' : '';
  const durPill = v.durationOk === false ? '<span class="pill warn">时长超限</span>' : '';

  const rows = [
    ['原始体积', m.beforeBytes ? formatBytes(m.beforeBytes) : '—'],
    ['产出体积', m.afterBytes ? `${formatBytes(m.afterBytes)} ${verdictPill}` : '—'],
    ['省下', saving !== null ? `${formatBytes(saving)}${ratio ? `（${ratio.toFixed(1)}×）` : ''}` : '—'],
    ['目标', m.target || '—'],
    ['时长', m.durationSec ? formatDuration(m.durationSec) : '—'],
    ['画面', m.resolution || '—'],
    ['内容判定', m.contentLabel || '—'],
    ['码率', m.bitrate || '—'],
  ];
  if (Number.isFinite(m.encodeSeconds)) rows.push(['编码耗时', formatDuration(m.encodeSeconds)]);

  // 判定必须区分「体积超」和「时长超」：有些平台体积很宽松但卡时长（朋友圈 30 秒），
  // 那种情况下体积差值是 0 甚至负数，只按体积算就会显示成「超 0 B」，等于没说。
  const checks = (m.platformChecks || []).map((c) => {
    const sizeOver = typeof c.sizeOk === 'boolean' && !c.sizeOk;
    const durOver = typeof c.durationOk === 'boolean' && !c.durationOk;
    const overBytes = Math.max(0, (c.bytes || 0) - (c.maxBytes || 0));
    let cls = 'ok';
    let label = '可发';
    let note = '';
    if (sizeOver && durOver) {
      cls = 'bad';
      label = '体积和时长都超';
      note = `超出 ${formatBytes(overBytes)}；时长 ${formatDuration(c.durationSec)} 超过 ${formatDuration(c.maxDurationSec)}`;
    } else if (sizeOver) {
      cls = 'bad';
      label = `超 ${formatBytes(overBytes)}`;
    } else if (durOver) {
      cls = 'bad';
      label = '时长超限';
      note = `${formatDuration(c.durationSec)} 超过 ${formatDuration(c.maxDurationSec)}`;
    }
    return `<tr><td>${esc(c.label)}</td><td class="num">${c.maxBytes ? formatBytes(c.maxBytes) : '—'}</td><td><span class="pill ${cls}">${label}</span></td><td>${esc(note || c.note || '')}</td></tr>`;
  }).join('');

  const alts = (m.alternatives || []).length
    ? `<h2>这个体积还是发不出去的话</h2><ul class="alt">${m.alternatives.map((a) => `<li>${esc(a.text)}</li>`).join('')}</ul>`
    : '';

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(head)}</title><style>${CSS}</style></head>
<body><div class="wrap">
<h1>${esc(head)}</h1>
<div class="sub">急件 · 投递卡${m.target ? ' · 目标 ' + esc(m.target) : ''}</div>

<div class="panel">
  <video controls preload="metadata" poster="${esc(posterName)}" src="${esc(videoPath)}"></video>
  <div class="bar">
    <a class="dl" href="${esc(videoPath)}" download>下载原文件</a>
    <span style="color:var(--dim)">${m.afterBytes ? formatBytes(m.afterBytes) : ''}</span>
    ${saving !== null ? `<span style="color:var(--ok)">省下 ${formatBytes(saving)}</span>` : ''}
    ${durPill}
  </div>
</div>

${saving !== null ? `<div class="metric ok">${formatBytes(saving)}</div><div style="color:var(--dim);font-size:12px;margin-bottom:18px">相对原始体积节省${ratio ? ` ${(100 - 100 / ratio).toFixed(0)}%` : ''}</div>` : ''}

<div class="panel"><table>${rows.map(([k, val]) => `<tr><th>${esc(k)}</th><td>${val}</td></tr>`).join('')}</table></div>

${checks ? `<h2>各平台能不能收</h2><div class="panel"><table><tr><th>平台</th><th>上限</th><th>判定</th><th>说明</th></tr>${checks}</table></div>` : ''}
${alts}
<div class="foot">本文件在本机生成，视频没有被上传到任何服务器。</div>
</div></body></html>`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
