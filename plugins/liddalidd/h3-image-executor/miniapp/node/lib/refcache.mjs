// 参考图下载缓存：按图片地址寻址，跨会话复用。
//
// 为什么要有缓存：同一个实体（某个地标、某款产品）在不同会话里会被反复搜到同一批地址，
// 每次重新下载既慢又占带宽；而且判定不合格的地址应该记住，别再试第二遍。
// 缓存只存"下载成功的原图"和"失败原因"，不存任何会话信息，删掉不影响正确性。
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { sniffFormat, imageSize, undecodableReason } from './image.mjs';
import { fetchImage, privateReason } from './urlguard.mjs';

// 失败记录只记一天：防盗链、临时 404 这类问题隔天可能就好了。
const FAIL_TTL_MS = 24 * 60 * 60 * 1000;
// 缓存条目上限。超了按修改时间淘汰最旧的，避免长期运行把磁盘吃满。
const MAX_ENTRIES = 400;
const FETCH_TIMEOUT_MS = 45000;
// 单张参考图的字节上限：参考图会被缩小使用，超过这个大小的多半不是正常图片。
const MAX_BYTES = 25 * 1024 * 1024;
// 机械门槛：太小的图放大就是马赛克，拿去当参考图反而会污染生成。
// 字节门槛压得比较松：纯色 logo 的 PNG 可能只有几 KB，主要靠 MIN_EDGE 把关。
const MIN_BYTES = 3 * 1024;
const MIN_EDGE = 320;

export function createRefCache(dir) {
  const ready = mkdir(dir, { recursive: true }).catch(() => {});

  // 文件名只由地址决定，不含任何可读信息，也不接受外部传入的名字。
  function keyOf(url) {
    return createHash('sha1').update(String(url)).digest('hex').slice(0, 24);
  }

  function extOf(format) {
    return format === 'png' ? 'png' : 'jpg';
  }

  async function lookup(url) {
    await ready;
    const key = keyOf(url);
    for (const ext of ['png', 'jpg']) {
      const file = key + '.' + ext;
      try {
        const info = await stat(join(dir, file));
        if (info.size > 0) return { key, file, path: join(dir, file), bytes: info.size, url, cached: true };
      } catch {
        /* 换下一个后缀 */
      }
    }
    return null;
  }

  async function store(url, buffer, format) {
    await ready;
    const key = keyOf(url);
    const file = key + '.' + extOf(format);
    await writeFile(join(dir, file), buffer);
    return { key, file, path: join(dir, file), bytes: buffer.length, url, cached: false };
  }

  async function failedReason(url) {
    await ready;
    try {
      const parsed = JSON.parse(await readFile(join(dir, keyOf(url) + '.fail'), 'utf8'));
      if (Date.now() - Number(parsed.at || 0) > FAIL_TTL_MS) return '';
      return String(parsed.reason || '下载失败');
    } catch {
      return '';
    }
  }

  async function markFailed(url, reason) {
    await ready;
    try {
      await writeFile(
        join(dir, keyOf(url) + '.fail'),
        JSON.stringify({ at: Date.now(), reason: String(reason || '') }),
      );
    } catch {
      /* 记不住失败不影响主流程 */
    }
  }

  // 下载一张候选图。命中缓存直接返回；失败原因也会缓存，避免反复试同一个坏地址。
  // publicOnly：地址来自检索结果（第三方），不许指向本机或内网，命中缓存也不例外。
  //
  // 方法名不能叫 fetch：函数声明会把全局 fetch 遮蔽掉，里面再调 fetch 就变成自我递归，
  // 表现为整个参考图环节静默挂死（实测卡在规划完成之后一条事件都不出）。
  async function download(url, options) {
    const publicOnly = Boolean(options && options.publicOnly);
    if (publicOnly) {
      const reason = await privateReason(url);
      if (reason) return { ok: false, url, error: '地址被安全策略拒绝：' + reason };
    }
    const hit = await lookup(url);
    if (hit) return { ok: true, ...hit };
    const known = await failedReason(url);
    if (known) return { ok: false, url, error: known, cached: true };
    try {
      // 云元数据这类地址、以及重定向到它们的地址，由 fetchImage 逐跳拦下。
      const buffer = await fetchImage(url, { publicOnly, maxBytes: MAX_BYTES, timeoutMs: FETCH_TIMEOUT_MS });
      const format = sniffFormat(buffer);
      if (format !== 'png' && format !== 'jpeg') throw new Error('格式不支持（' + format + '）');
      // 解不开的图必须在这里就拒掉：否则它会一路当上参考图，却拼不进对比图，
      // 评审端看不到它，判定节点也只能"取第一张可用图"，问题被藏得看不见。
      const undecodable = undecodableReason(buffer);
      if (undecodable) throw new Error(undecodable);
      if (buffer.length < MIN_BYTES) throw new Error('文件过小（' + buffer.length + ' 字节）');
      const size = imageSize(buffer);
      if (size && Math.max(size.width, size.height) < MIN_EDGE) {
        throw new Error('尺寸过小（' + size.width + 'x' + size.height + '）');
      }
      const stored = await store(url, buffer, format);
      return { ok: true, ...stored, width: size ? size.width : 0, height: size ? size.height : 0 };
    } catch (error) {
      const reason = String(error && error.message ? error.message : error);
      // 被安全策略拦下的不记失败：同一个地址换个来源（检索结果 / 用户自己给的）结论可能不一样，
      // 而且每次重新判一遍很便宜。
      if (!(error && error.blocked)) await markFailed(url, reason);
      return { ok: false, url, error: reason };
    }
  }

  // 淘汰最旧的条目。放在每次会话开始时跑一次就够了。
  async function prune() {
    await ready;
    try {
      const names = (await readdir(dir)).filter((name) => /\.(png|jpg)$/.test(name));
      if (names.length <= MAX_ENTRIES) return 0;
      const stats = await Promise.all(
        names.map(async (name) => {
          try {
            const info = await stat(join(dir, name));
            return { name, mtime: info.mtimeMs };
          } catch {
            return null;
          }
        }),
      );
      const alive = stats.filter(Boolean).sort((a, b) => b.mtime - a.mtime);
      const drop = alive.slice(MAX_ENTRIES);
      for (const item of drop) {
        try {
          await unlink(join(dir, item.name));
        } catch {
          /* 删不掉就下次再说 */
        }
      }
      return drop.length;
    } catch {
      return 0;
    }
  }

  async function stats() {
    await ready;
    try {
      const names = await readdir(dir);
      const files = names.filter((name) => /\.(png|jpg)$/.test(name));
      const fails = names.filter((name) => name.endsWith('.fail'));
      let bytes = 0;
      for (const name of files) {
        try {
          bytes += (await stat(join(dir, name))).size;
        } catch {
          /* 统计失败无所谓 */
        }
      }
      return { files: files.length, fails: fails.length, bytes, dir };
    } catch {
      return { files: 0, fails: 0, bytes: 0, dir };
    }
  }

  return { dir, keyOf, lookup, download, failedReason, markFailed, prune, stats };
}
