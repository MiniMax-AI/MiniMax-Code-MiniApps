// 会话分享：把一整条链路（事件流 + 详情块 + prompt 对照 + 图）打包成一个自包含 HTML。
// 图片全部降采样后内嵌成 data URL，不依赖 Mini App 在线、不暴露任何本地路径或凭据。
import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import * as png from './png.mjs';
import { decodeImage } from './image.mjs';
import { encodeJpeg } from './jpegenc.mjs';

const DEFAULTS = {
  // 预览图长边。再大对"看链路"没帮助，只会把这个 HTML 撑到几十 MB。
  edge: 640,
  // 评审材料图长边。分享页是给人翻的，不是给 VLM 看的——720px 的看图材料内嵌成
  // PNG 后平均 630KB/张，占整页七成体积（实测 20261110-c46dde 16.9MB、
  // 20261109-11b90b 19.4MB），大到部署不动。降到 560px 面积比 0.6，体积省四成，
  // 局部放大块仍然看得清。
  sheetEdge: 560,
  // 检索候选缩略图长边。这些图在页面上只有 92px 宽（2x 屏约 184px），内嵌大了纯属浪费体积。
  thumbEdge: 240,
  // 交付图点开后显示的大图长边。640px 的预览放到全屏会糊，原图又太大（实测单张 3–7 MB、
  // 5472×3072，整页部署不动）。2048px、q86 的 JPEG 实测每张 0.6–0.9 MB，全屏看足够清楚。
  // 设为 0 就不内嵌大图，点开仍是预览图。
  largeEdge: 2048,
  // 大图的总预算（编码后的字节数，base64 之前；base64 之后约再大三分之一）。
  // 按交付顺序加，超出预算的几张只带普通预览，免得交付图多的会话整页大到部署不动。
  largeBudget: 4 * 1024 * 1024,
  includeSheets: true,
  includeRefs: true,
  // 内嵌 JPEG 质量。86 是给「看图材料上有编号文字」留的余量：q82 在照片上已经看不出差别，
  // 但评审材料块号是小字，压太狠会糊。
  embedQuality: 86,
};

const EMBED_QUALITY = DEFAULTS.embedQuality;

// 读一张图，降采样到 maxEdge，返回 data URL；失败返回 null（分享页不能因为一张图挂掉）。
// 用 decodeImage 而不是 decodePng：缓存里的候选图常常是 JPEG，只认 PNG 会让缩略图整片消失。
// 内嵌统一走 JPEG：分享页里的图全是照片类内容（生成图、参考图、评审看图材料），
// PNG 存照片极不划算——实测 640px 交付预览图 PNG level6 要 559KB，同一张 q86 JPEG 只要 ~90KB。
// 整页因此从 13–19MB 降到 1–2MB，否则大到 website_deploy 部署不动。
async function embedImage(path, maxEdge) {
  try {
    const buffer = await readFile(path);
    const decoded = decodeImage(buffer);
    const small = Math.max(decoded.width, decoded.height) > maxEdge ? png.downsample(decoded, maxEdge) : decoded;
    return 'data:image/jpeg;base64,' + encodeJpeg(small, { quality: EMBED_QUALITY }).toString('base64');
  } catch {
    return null;
  }
}

// 交付图的大图。纯 JS 解码一张 5472×3072 的原图要 1.8 秒左右，而分享页在交付后、点预览、
// 点发布时都会重建，所以结果缓存在会话目录的 share/large/ 下：交付文件名带时间戳、内容不会变，
// 同一张图只算一次。同一进程里同时发起的构建共用一次计算。失败返回 null，点开就退回预览图。
const largeJobs = new Map();

async function largeImage(sourcePath, cachePath, maxEdge) {
  let source;
  try {
    source = await stat(sourcePath);
  } catch {
    return null;
  }
  try {
    const cached = await stat(cachePath);
    if (cached.size > 0 && cached.mtimeMs >= source.mtimeMs) return await readFile(cachePath);
  } catch {
    /* 还没缓存过 */
  }
  if (largeJobs.has(cachePath)) return largeJobs.get(cachePath);
  const job = (async () => {
    try {
      // 解码是同步的：先让出一次事件循环，页面轮询之类的请求不至于一直排在几张大图后面。
      await new Promise((resolve) => setImmediate(resolve));
      const decoded = decodeImage(await readFile(sourcePath));
      const small = Math.max(decoded.width, decoded.height) > maxEdge ? png.downsample(decoded, maxEdge) : decoded;
      const bytes = encodeJpeg(small, { quality: EMBED_QUALITY });
      await mkdir(dirname(cachePath), { recursive: true });
      const tmp = cachePath + '.tmp';
      await writeFile(tmp, bytes);
      await rename(tmp, cachePath);
      return bytes;
    } catch {
      return null;
    } finally {
      largeJobs.delete(cachePath);
    }
  })();
  largeJobs.set(cachePath, job);
  return job;
}

// 按交付顺序给每张交付图配一份大图，键是 large/<交付文件>，总量受 largeBudget 限制。
async function collectLargeImages(snapshot, dirs, options, images) {
  if (!(options.largeEdge > 0) || !dirs.root || !dirs.deliver) return 0;
  let used = 0;
  let count = 0;
  for (const item of (snapshot.delivery && snapshot.delivery.items) || []) {
    if (!item || !item.file) continue;
    const parts = String(item.file).split('/');
    const file = parts[parts.length - 1];
    const sub = parts.length > 1 ? parts[0] : '';
    if (!sub || !file) continue;
    const cachePath = join(dirs.root, 'share', 'large', sub + '-' + file.replace(/\.[^.]+$/, '') + '.' + options.largeEdge + '.jpg');
    const bytes = await largeImage(join(dirs.deliver, sub, file), cachePath, options.largeEdge);
    if (!bytes) continue;
    if (used + bytes.length > options.largeBudget) break;
    used += bytes.length;
    count += 1;
    images['large/' + item.file] = 'data:image/jpeg;base64,' + bytes.toString('base64');
  }
  return count;
}

// 事件详情里的缩略图键：检索候选存在共享缓存目录里，分享页要离线可看就必须一并内嵌。
function collectThumbKeys(snapshot) {
  const keys = [];
  const walk = (blocks) => {
    (blocks || []).forEach((block) => {
      if (!block) return;
      if (block.kind === 'thumbs') {
        for (const item of block.items || []) if (item && item.key) keys.push(item.key);
      }
      if (block.kind === 'group') walk(block.blocks);
    });
  };
  for (const event of snapshot.events || []) {
    if (event.detail) walk(event.detail.blocks);
  }
  return keys;
}

// 收集这次会话需要内嵌的所有图片，返回 { key: dataUrl }。
async function collectImages(snapshot, dirs, options) {
  const wanted = new Map();
  const add = (key, path, edge) => {
    if (!key || !path) return;
    if (!wanted.has(key)) wanted.set(key, { path, edge });
  };

  if (options.includeRefs) {
    for (const ref of snapshot.refs || []) {
      const file = String(ref.file || '').split('/').pop();
      if (file) add('refs/' + file, join(dirs.refs, file), options.edge);
    }
  }

  // 检索候选：按事件里出现过的键去取，避免把整个缓存目录扫一遍。
  if (dirs.cache) {
    for (const key of new Set(collectThumbKeys(snapshot))) {
      if (key.indexOf('cache/') !== 0) continue;
      const file = key.slice('cache/'.length);
      if (file) add(key, join(dirs.cache, file), options.thumbEdge);
    }
  }

  for (const image of snapshot.images || []) {
    for (const round of image.rounds || []) {
      for (const candidate of round.candidates || []) {
        if (candidate.previewFile) add('previews/' + candidate.previewFile, join(dirs.previews, candidate.previewFile), options.edge);
        if (options.includeSheets && candidate.sheetFile) {
          add('sheets/' + candidate.sheetFile, join(dirs.sheets, candidate.sheetFile), options.sheetEdge);
        }
      }
    }
  }

  for (const item of (snapshot.delivery && snapshot.delivery.items) || []) {
    if (!item.previewFile) continue;
    const parts = String(item.previewFile).split('/');
    const file = parts[parts.length - 1];
    const sub = parts.length > 1 ? parts[0] : '';
    if (sub && file) add('deliver/' + item.previewFile, join(dirs.deliver, sub, file), options.edge);
  }

  const entries = await Promise.all(
    Array.from(wanted.entries()).map(async ([key, target]) => [key, await embedImage(target.path, target.edge)]),
  );
  const images = {};
  for (const [key, dataUrl] of entries) {
    if (dataUrl) images[key] = dataUrl;
  }
  return images;
}

// 内嵌在 <script type="application/json"> 里，只需要防住 </script> 与行分隔符。
function escapeForScript(json) {
  return json.split('<').join('\\u003c').split('\u2028').join('\\u2028').split('\u2029').join('\\u2029');
}

// 分享页会离开本机、可能被部署成公开链接，而提示词里直接写着看图材料的绝对路径
// （评审节点的输入就是「看图材料：/Users/…/sheets/xxx.png」）。
// 1. 会话目录、插件数据目录：精确替换成占位符，保留后面的相对结构，读者还认得出是哪个文件。
//    原样写法和 JSON 转义后的写法都要换（Windows 路径进了 JSON 反斜杠会翻倍）。
// 2. 其余本机路径整段抹掉：用户主目录下的任何路径，以及 macOS /Users/… 与 Windows X:\Users\… 兜底，
//    覆盖 Agent 回复里提到的工作目录之类的路径。以前只认 /Users/，Windows 上会原样公开出去。
function redactLocalPaths(html, input) {
  let out = html;
  for (const [path, label] of [
    [input.sessionDir, '<会话目录>'],
    [input.dataDir, '<插件数据目录>'],
  ]) {
    for (const form of pathForms(path)) out = out.split(form).join(label);
  }
  for (const form of pathForms(input.homeDir)) {
    out = out.replace(new RegExp(escapeRegExp(form) + '[^\\s"\'<>]*', 'g'), '<本机路径>');
  }
  return out
    .replace(/\/Users\/[^\s"'<>]+/g, '<本机路径>')
    .replace(/[A-Za-z]:(?:\\+|\/)Users(?:\\+|\/)[^\s"'<>]+/gi, '<本机路径>');
}

// 一个目录在页面里可能出现的几种写法，长的在前：先换长的，短的才不会把长的切成两半。
function pathForms(path) {
  const raw = String(path || '').replace(/[\\/]+$/, '');
  // 太短的不替换：根目录或盘符这种前缀会把整页正文都换掉。
  if (raw.length < 4) return [];
  const forms = new Set([raw, JSON.stringify(raw).slice(1, -1)]);
  if (raw.includes('\\')) {
    const slashed = raw.split('\\').join('/');
    forms.add(slashed);
  }
  return Array.from(forms).sort((a, b) => b.length - a.length);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

// 老会话落盘时还没有 candidate.prompt / item.prompt，用当轮动作或规格里的 prompt 兜底，
// 否则分享出去的页面只剩服务端改写那一栏，看不出我们原本送了什么。
function backfillPrompts(snapshot) {
  for (const image of snapshot.images || []) {
    for (const round of image.rounds || []) {
      const actionPrompt = (round.action && round.action.prompt) || image.spec.prompt || '';
      for (const candidate of round.candidates || []) {
        if (!candidate.prompt) candidate.prompt = actionPrompt;
      }
    }
  }
  for (const item of (snapshot.delivery && snapshot.delivery.items) || []) {
    if (item.prompt) continue;
    const image = (snapshot.images || []).find((entry) => entry.id === item.id);
    item.prompt = (image && image.spec && image.spec.prompt) || '';
  }
  return snapshot;
}

export async function buildShareHtml(input) {
  // 逐键合并：直接把 undefined 展开进去会把默认值覆盖掉，
  // 结果是降采样被判成"不需要"，原图被整张内嵌，分享页直接膨胀到十几 MB。
  const options = { ...DEFAULTS };
  for (const [key, value] of Object.entries(input.options || {})) {
    if (value !== undefined) options[key] = value;
  }
  const snapshot = backfillPrompts(input.snapshot);
  const dirs = input.dirs;
  const clientDir = input.clientDir;

  const [css, blocks, pageScript] = await Promise.all([
    readFile(join(clientDir, 'styles.css'), 'utf8'),
    readFile(join(clientDir, 'blocks.js'), 'utf8'),
    readFile(join(clientDir, 'share.js'), 'utf8'),
  ]);
  const images = await collectImages(snapshot, dirs, options);
  const large = await collectLargeImages(snapshot, dirs, options, images);
  const payload = escapeForScript(JSON.stringify({ snapshot, images, generatedAt: Date.now() }));
  const title = 'H3-Image-Executor · ' + (snapshot.instruction || snapshot.id);

  const html = [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '  <head>',
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    '    <title>' + escapeHtml(title) + '</title>',
    '    <style>',
    css,
    '    </style>',
    '  </head>',
    '  <body>',
    '    <header class="page-header">',
    '      <div>',
    '        <h1>H3-Image-Executor · 链路分享</h1>',
    '        <p class="page-desc">会话 ' + escapeHtml(snapshot.id) + ' 的完整执行链路快照，数据与图片全部内嵌，离线可看。</p>',
    '      </div>',
    '      <div class="engine" id="share-meta"></div>',
    '    </header>',
    '    <main id="root"></main>',
    '    <div class="lightbox" id="lightbox" hidden>',
    '      <button type="button" class="lightbox-close" id="lightbox-close" aria-label="关闭大图">关闭</button>',
    '      <img id="lightbox-img" alt="放大预览" />',
    '    </div>',
    '    <script id="share-data" type="application/json">' + payload + '</script>',
    '    <script>',
    blocks,
    '    </script>',
    '    <script>',
    pageScript,
    '    </script>',
    '  </body>',
    '</html>',
    '',
  ].join('\n');

  const safe = redactLocalPaths(html, {
    sessionDir: dirs && dirs.root,
    dataDir: input.dataDir,
    homeDir: homedir(),
  });
  return { html: safe, images: Object.keys(images).length, large, bytes: Buffer.byteLength(safe) };
}
