// 参考图检索：运行时直连 Connector 搜图工具。
//
// 为什么不让 planner 自己调：planner 跑在 Mini App 派生的子会话里，工具列表里
// 看不到 Connector 工具，它只会转而用 tool_search / run_code 摸索并烧光工具预算，
// refs 永远为空（实测多次，全部 refs: []）。
// 改成：planner 只产出「要搜什么」（ref_queries），检索由运行时确定性执行。

const TOOL_MATCH = 'search_images';
const MAX_QUERIES = 6;
// 每个实体保留的候选池大小。池子只是"待选名单"，不会一次全下：
// 运行时按 3 张一批下载并判定，不合格才取下一批（见 workflow.mjs 的 refBatch）。
// 池子留大一点，是为了让"这一批不行"时有下一批可取，而不是立刻放弃整个实体。
const MAX_CANDIDATES = 9;

// 工具名必须从 list() 取，不能自己拼（运行时文档明确要求）。
const nameCache = new WeakMap();

function asText(value) {
  return typeof value === 'string' ? value : '';
}

function message(error) {
  return String(error && error.message ? error.message : error);
}

// 用户可以在插件详情里关掉工具调用（tool:call），之后 list() 把所有工具报成 deny、call() 报
// TOOL_NOT_PERMITTED。失败原因会原样进时间线，所以这里写清楚去哪里打开，而不只是一个错误码。
const TOOL_OFF_HINT =
  '如果你在 MiniMax Code 的插件详情里关闭了 H3-Image-Executor 的工具调用（tool:call），请重新打开；' +
  '也可能是你的权限规则拒绝了这个工具';

// 失败原因要带错误码，否则排查时只能看到一句 provider down。
function describeError(error) {
  const code = error && error.code ? String(error.code) : '';
  const base = (code ? '（' + code + '）' : '') + message(error);
  if (code === 'TOOL_NOT_PERMITTED') return base + '。' + TOOL_OFF_HINT;
  if (code === 'TOOL_APPROVAL_REQUIRED') return base + '。搜图工具需要你确认，但现在没有能弹出确认框的 MiniMax Code 窗口';
  return base;
}

// provider 侧的临时故障值得再试一次；权限和参数错误重试也没用。
const RETRYABLE_CODES = new Set([
  'CONNECTOR_PROVIDER_ERROR',
  'CONNECTOR_TIMEOUT',
  'CONNECTOR_UNAVAILABLE',
  'TOOL_TIMEOUT',
  'SERVICE_RESTARTED',
]);

function isRetryable(error) {
  if (!error) return false;
  if (error.retryable === true) return true;
  return RETRYABLE_CODES.has(String(error.code || ''));
}

// 权限类错误和查询内容无关：换写法、换实体再调只会被同样拒绝，等于绕着 deny 反复试
// （docs/security.md：Do not try to work around a deny）。碰到就整次检索停下。
const PERMISSION_CODES = new Set(['TOOL_NOT_PERMITTED', 'TOOL_APPROVAL_REQUIRED']);

function isPermissionError(error) {
  return Boolean(error) && PERMISSION_CODES.has(String(error.code || ''));
}

function normalizeQuery(value) {
  return asText(value).replace(/\s+/g, ' ').trim();
}

async function resolveTool(context) {
  if (!context || !context.tool || typeof context.tool.call !== 'function') {
    return { error: '运行时没有 tool 能力：manifest 需要声明 "toolAccess": ["call"]' };
  }
  const cached = nameCache.get(context);
  // 只缓存已放行的结果：deny / ask 每次都重新列一遍，用户把开关打开后下一轮就能用，不用重启。
  if (cached && cached.permission === 'allow') return cached;
  let listed;
  try {
    listed = await context.tool.list();
  } catch (error) {
    return { error: '读取工具列表失败：' + message(error) };
  }
  const tools = (listed && listed.tools) || [];
  const found = tools.find((item) => String(item.name || '').indexOf(TOOL_MATCH) >= 0);
  if (!found) return { error: '工具列表里没有搜图工具（已列出 ' + tools.length + ' 个）' };
  const resolved = { name: found.name, permission: found.permission };
  nameCache.set(context, resolved);
  return resolved;
}

// ask 状态先弹一次授权，把工具加进用户的长期允许列表；没人可问就放弃，不要盲调。
async function ensureAllowed(context, resolved) {
  if (resolved.permission === 'allow') return '';
  if (resolved.permission === 'deny') return '搜图工具 ' + resolved.name + ' 当前被拒绝（deny）。' + TOOL_OFF_HINT;
  const caps = context.capabilities;
  const canRequest = caps && typeof caps.has === 'function' && caps.has('tool.request');
  if (!canRequest) return '搜图工具需要授权，但当前运行时不支持 tool.request';
  try {
    const answer = await context.tool.request([resolved.name]);
    const state = answer && answer[resolved.name];
    if (state) resolved.permission = state;
  } catch (error) {
    return '搜图工具授权未完成：' + describeError(error);
  }
  if (resolved.permission === 'deny') return '搜图工具 ' + resolved.name + ' 被拒绝（deny）。' + TOOL_OFF_HINT;
  if (resolved.permission !== 'allow') return '搜图工具仍需授权（' + resolved.permission + '）：你没有在确认框里允许它';
  return '';
}

// provider 可能返回 JSON 字符串，也可能直接返回对象，两种都接。
function parseValue(value) {
  if (value && typeof value === 'object') return value;
  const raw = asText(value);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// provider 用 results[].query 回显查询文本；优先按文本匹配，匹配不上再按顺序兜底。
//
// 每个实体保留多张候选（https 优先），因为第一张经常下载失败或是不支持的格式（比如 webp）。
// 只取一张会让整个实体白丢。
// 批量返回是一份扁平 results，要按 query 文本分回各个实体。
// 只有条数一一对应时才允许按顺序兜底：拆单条之后 rows 会比 queries 短，
// 此时 rows[index] 指向的是别人的结果——参考图张冠李戴比没有参考图危险得多。
function splitBatchRows(rows, queries) {
  const aligned = rows.length === queries.length;
  const used = new Set();
  return queries.map((item, index) => {
    const byText = rows.find(
      (candidate) =>
        !used.has(candidate) && normalizeQuery(candidate && candidate.query) === normalizeQuery(item.query),
    );
    let row = byText || null;
    if (!row && aligned) {
      const fallback = rows[index];
      if (fallback && !used.has(fallback)) row = fallback;
    }
    if (row) used.add(row);
    return row ? [row] : [];
  });
}

// rowsPerQuery 与 queries 一一对应，每项是该实体自己的结果行。
// 每个实体保留一串候选（https 优先），因为第一张经常下载失败或是不支持的格式。
function pickImages(rowsPerQuery, queries) {
  return queries.map((item, index) => {
    const images = [];
    for (const row of rowsPerQuery[index] || []) {
      for (const image of row && Array.isArray(row.images) ? row.images : []) images.push(image);
    }
    const seen = new Set();
    const candidates = [];
    for (const pattern of [/^https:\/\//i, /^http:\/\//i]) {
      for (const image of images) {
        const url = asText(image && image.image_url);
        if (!pattern.test(url) || seen.has(url)) continue;
        seen.add(url);
        candidates.push({
          url,
          title: asText(image.title),
          source: asText(image.source) || asText(image.link),
        });
        if (candidates.length >= MAX_CANDIDATES) break;
      }
      if (candidates.length >= MAX_CANDIDATES) break;
    }
    const head = candidates[0] || null;
    return {
      task_name: item.task_name,
      query: item.query,
      url: head ? head.url : '',
      title: head ? head.title : '',
      source: head ? head.source : '',
      candidates,
    };
  });
}

// 同一个实体换一批说法再搜。只在搜索成功、但候选全部下载失败或判定不合格时用，
// 不用于绕过搜索服务的拒绝。原查询通常写得很"描述性"（"东京塔 黄昏 侧面 远景"），
// 搜索引擎更吃"实体名 + 官方图 / 高清正面"这种写法。
export function broadenQuery(query, round) {
  const base = normalizeQuery(query);
  const head = base.split(' ').slice(0, 2).join(' ') || base;
  const variants = [base + ' 官方图', head + ' 高清 正面', head];
  const picked = variants[Math.max(0, Math.min(Number(round) || 0, variants.length - 1))];
  return normalizeQuery(picked) || base;
}

export function normalizeRefQueries(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    if (!item) continue;
    const query = asText(typeof item === 'string' ? item : item.query).trim();
    if (!query) continue;
    let taskName = asText(item.task_name).trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
    if (!taskName) taskName = 'ref' + (out.length + 1);
    while (seen.has(taskName)) taskName += '1';
    seen.add(taskName);
    out.push({ task_name: taskName, query, prompt: asText(item.prompt).trim() });
    if (out.length >= MAX_QUERIES) break;
  }
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// provider 侧限流明显：单条调用之间几乎不间隔时，后面几条会直接报 CONNECTOR_PROVIDER_ERROR。
// 拆单条之后必须留间隔，失败再退避重试。
const SINGLE_GAP_MS = 900;
const SINGLE_ATTEMPTS = 2;
const BACKOFF_MS = 1200;
// 连续这么多个实体都失败，就认定搜图服务整体不可用，后面的实体不再逐个去试，
// 否则服务真挂掉时会把整轮时间耗光。
const BREAKER_LIMIT = 3;

function isOk(payload) {
  return Boolean(payload) && (payload.code === undefined || Number(payload.code) === 0);
}

function invoke(context, name, list) {
  return context.tool.call(name, {
    queries: list.map((item) => ({
      query: item.query,
      prompt: item.prompt || item.query,
      task_name: item.task_name,
    })),
  });
}

// 单条查询：抛错和「返回了但 code != 0」都算失败，临时故障（限流等）值得退避后用同一个查询再试一次。
// 不换说法去绕过：搜索服务拒绝某个查询时，这个实体就按没搜到处理，用户可以自己上传参考图。
// 权限错误直接停下整次检索。
async function searchOne(context, name, item) {
  let lastError = '';
  for (let attempt = 0; attempt < SINGLE_ATTEMPTS; attempt += 1) {
    if (attempt) await sleep(BACKOFF_MS * attempt);
    try {
      const payload = parseValue((await invoke(context, name, [item])).value);
      if (isOk(payload) && Array.isArray(payload.results)) return { rows: payload.results, error: '' };
      lastError = payload ? asText(payload.message) || 'code ' + payload.code : '返回无法解析';
    } catch (error) {
      lastError = describeError(error);
      if (isPermissionError(error)) return { rows: [], error: lastError, blocked: true };
      if (!isRetryable(error)) break;
    }
  }
  return { rows: [], error: lastError || '未知失败' };
}

export async function searchRefImages(context, queries) {
  const list = (queries || []).filter((item) => item && asText(item.query));
  if (!list.length) return { ok: false, reason: '没有检索意图', hits: [], notes: [] };
  const resolved = await resolveTool(context);
  if (resolved.error) return { ok: false, reason: resolved.error, hits: [], notes: [] };
  const blocked = await ensureAllowed(context, resolved);
  if (blocked) return { ok: false, reason: blocked, hits: [], notes: [] };

  const failures = [];
  const notes = [];
  let rowsPerQuery = null;
  // 权限被拒：整次检索停下，并丢掉「已放行」的缓存，下一次检索重新列工具、读到最新的权限。
  const stopForPermission = (reason) => {
    nameCache.delete(context);
    return { ok: false, reason: '搜图工具不可用：' + reason, hits: [], notes };
  };

  // 批量只试一次：这个 provider 对多条 queries 经常直接报错，单条才稳定。
  if (list.length > 1) {
    try {
      const payload = parseValue((await invoke(context, resolved.name, list)).value);
      if (isOk(payload) && Array.isArray(payload.results)) rowsPerQuery = splitBatchRows(payload.results, list);
      else failures.push('批量检索：' + (payload ? asText(payload.message) || 'code ' + payload.code : '返回无法解析'));
    } catch (error) {
      if (isPermissionError(error)) return stopForPermission(describeError(error));
      failures.push('批量检索：' + describeError(error));
    }
  }

  if (!rowsPerQuery) {
    rowsPerQuery = [];
    let deadStreak = 0;
    for (let index = 0; index < list.length; index += 1) {
      const item = list[index];
      if (deadStreak >= BREAKER_LIMIT) {
        rowsPerQuery.push([]);
        failures.push(item.task_name + '：搜图服务连续失败，已跳过');
        continue;
      }
      if (index) await sleep(SINGLE_GAP_MS);
      const one = await searchOne(context, resolved.name, item);
      if (one.blocked) return stopForPermission(one.error);
      rowsPerQuery.push(one.rows);
      if (one.rows.length) {
        deadStreak = 0;
      } else {
        deadStreak += 1;
        failures.push(item.task_name + '：' + (one.error || '没有返回结果'));
      }
    }
  }

  const hits = pickImages(rowsPerQuery, list);
  const got = hits.filter((item) => item.url);
  if (!got.length) {
    return {
      ok: false,
      reason: '搜图失败：' + (failures[0] || '没有返回结果'),
      hits: [],
      notes,
    };
  }
  return {
    ok: true,
    reason: failures.length ? '部分实体没搜到：' + failures.join('；') : '',
    notes,
    tool: resolved.name,
    hits,
  };
}
