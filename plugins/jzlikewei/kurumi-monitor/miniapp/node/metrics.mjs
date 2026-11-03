// 指标目录：交易所风格代码 -> 系统指标
// 每项指标是一只「个股」，代码只用于界面显示与历史序列索引。

/** 板块定义（顺序即自选列表的分组顺序） */
export const BOARDS = [
  { id: 'cpu', name: 'CPU 板块', prefix: '0000' },
  { id: 'gpu', name: 'GPU 板块', prefix: '6000' },
  { id: 'thermal', name: '温度 板块', prefix: '7000' },
  { id: 'mem', name: '内存 板块', prefix: '3000' },
  { id: 'disk', name: '磁盘 板块', prefix: '0020' },
  { id: 'net', name: '网络 板块', prefix: '0010' },
  { id: 'sys', name: '系统 板块', prefix: '9000' },
];

/**
 * 内存三段。两个平台的内存模型不同，各用自己的三段填同样的槽位：
 * macOS 是活动页 / 联动页 / 压缩页，Windows 是使用中 / 已修改 / 待机。
 * 指标代码与历史序列跨平台保持稳定，只有显示名跟着平台走，
 * 副图的柱形、图例与浮窗全部读这份定义。
 */
export const MEM_SEGMENTS = process.platform === 'win32'
  ? [
      { code: '300002', name: '使用中', short: '用' },
      { code: '300003', name: '已修改', short: '改' },
      { code: '300006', name: '待机', short: '待' },
    ]
  : [
      { code: '300002', name: '活动页', short: '活' },
      { code: '300003', name: '联动页', short: '联' },
      { code: '300006', name: '压缩页', short: '压' },
    ];

/** 三段之外那一段的显示名。Windows 上没有可清除内存，这一项恒为空 */
const MEM_EXTRA_NAME = process.platform === 'win32' ? '系统缓存' : '非活跃页';

/** 单位渲染规则 */
const UNITS = {
  pct: { d: 1, suffix: '%', ref: 'pct' },
  load: { d: 2, suffix: '', ref: 'raw' },
  gib: { d: 2, suffix: 'G', ref: 'raw' },
  mib: { d: 0, suffix: 'M', ref: 'raw' },
  mbs: { d: 2, suffix: 'M/s', ref: 'rate' },
  kbs: { d: 1, suffix: 'K/s', ref: 'rate' },
  ps: { d: 0, suffix: '/s', ref: 'rate' },
  cnt: { d: 0, suffix: '', ref: 'raw' },
  hrs: { d: 1, suffix: 'h', ref: 'raw' },
  c: { d: 1, suffix: '°C', ref: 'raw' },
  w: { d: 1, suffix: 'W', ref: 'raw' },
};

export const unitOf = (u) => UNITS[u] ?? UNITS.cnt;

/** 静态指标目录。逐核指标在运行时按核心数追加。 */
export const METRICS = [
  { code: '000001', name: 'CPU 综合占用', board: 'cpu', unit: 'pct' },
  { code: '000002', name: '1 分负载', board: 'cpu', unit: 'load' },
  { code: '000003', name: '5 分负载', board: 'cpu', unit: 'load' },
  { code: '000004', name: '15 分负载', board: 'cpu', unit: 'load' },
  { code: '000005', name: '用户态占比', board: 'cpu', unit: 'pct' },
  { code: '000006', name: '系统态占比', board: 'cpu', unit: 'pct' },
  { code: '000007', name: '空闲占比', board: 'cpu', unit: 'pct' },

  { code: '600001', name: '设备占用', board: 'gpu', unit: 'pct' },
  { code: '600002', name: 'Renderer 占用', board: 'gpu', unit: 'pct' },
  { code: '600003', name: 'Tiler 占用', board: 'gpu', unit: 'pct' },
  { code: '600004', name: '显存占用', board: 'gpu', unit: 'gib' },
  { code: '600005', name: '显存分配', board: 'gpu', unit: 'gib' },

  // 温度与功耗只有 Windows 能采到：GPU 读数走 nvidia-smi，热区走 ACPI。
  // macOS 上这三项恒为空，页面显示「—」。
  { code: '700001', name: 'GPU 温度', board: 'thermal', unit: 'c' },
  { code: '700002', name: 'GPU 功耗', board: 'thermal', unit: 'w' },
  { code: '700003', name: '热区温度', board: 'thermal', unit: 'c' },

  { code: '300001', name: '内存占用率', board: 'mem', unit: 'pct' },
  { code: '300002', name: MEM_SEGMENTS[0].name, board: 'mem', unit: 'gib' },
  { code: '300003', name: MEM_SEGMENTS[1].name, board: 'mem', unit: 'gib' },
  { code: '300004', name: '空闲页', board: 'mem', unit: 'gib' },
  { code: '300005', name: MEM_EXTRA_NAME, board: 'mem', unit: 'gib' },
  { code: '300006', name: MEM_SEGMENTS[2].name, board: 'mem', unit: 'gib' },
  { code: '300007', name: '可清除', board: 'mem', unit: 'mib' },

  { code: '002001', name: '磁盘读', board: 'disk', unit: 'mbs' },
  { code: '002002', name: '磁盘写', board: 'disk', unit: 'mbs' },
  { code: '002003', name: '读操作', board: 'disk', unit: 'ps' },
  { code: '002004', name: '写操作', board: 'disk', unit: 'ps' },

  { code: '001001', name: '网络下行', board: 'net', unit: 'kbs' },
  { code: '001002', name: '网络上行', board: 'net', unit: 'kbs' },
  { code: '001003', name: '下行包', board: 'net', unit: 'ps' },
  { code: '001004', name: '上行包', board: 'net', unit: 'ps' },

  { code: '900001', name: '进程数', board: 'sys', unit: 'cnt' },
  { code: '900002', name: '线程数', board: 'sys', unit: 'cnt' },
  { code: '900003', name: '负载率', board: 'sys', unit: 'pct' },
  { code: '900004', name: '运行时间', board: 'sys', unit: 'hrs' },
];

/** 逐核指标代码：核心 0 -> 000010，核心 9 -> 000019，超过 90 核用 000100+ */
export function coreCode(i) {
  return '0000' + String(10 + i).padStart(2, '0');
}

/** 运行时完整目录 = 静态目录 + 按核心数生成的逐核项 */
export function buildCatalog(coreCount) {
  const cores = [];
  for (let i = 0; i < coreCount; i += 1) {
    cores.push({ code: coreCode(i), name: '核心 ' + i, board: 'cpu', unit: 'pct', core: i });
  }
  return [...METRICS, ...cores];
}

/**
 * ps 的 etime 格式 [[dd-]hh:]mm:ss，返回秒数。
 * 拿不到就返回 null，调用方自己决定回退。
 */
export function parseEtime(s) {
  const m = String(s ?? '').trim().match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!m) return null;
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3]) * 60 + Number(m[4]);
}

/**
 * 进程品种代码。pid 会被系统回收复用，只用 pid 会把先后两个进程的历史混成一条线，
 * 所以带上由 etime 反推的启动时刻。
 */
export function procCode(pid, startedAtSec) {
  return 'P' + pid + '-' + startedAtSec;
}

/** 由一条 ps 记录构造目录项，字段与静态指标对齐，前端可以当成普通品种渲染。
 *  startedAtSec 由调用方缓存后传入 —— etime 只有秒精度，每次现算会漂。 */
export function procMetaOf(proc, startedAtSec) {
  return {
    code: procCode(proc.pid, startedAtSec),
    pid: proc.pid,
    startedAt: startedAtSec,
    name: proc.name,
    user: proc.user,
    board: 'proc',
    unit: 'pct',
  };
}

/** 自选进程上限。每多一个自选，每条 tick 就多一个字段，这个上限是拿来兜住存储增长的 */
export const WATCH_MAX = 20;

/** 指数条固定展示的 8 项（与 PerfTicker 的指数条对应） */
export const INDEX_CODES = ['000001', '000002', '600001', '600004', '300001', '600002', '001001', '900001'];

/** 主图默认选中品种 */
export const DEFAULT_CODE = '600001';

/** K 线周期档位（秒）。周期不低于采样间隔的 2 倍，避免退化成一条线。 */
export const PERIODS = [
  { label: '2秒K', seconds: 2 },
  { label: '5秒K', seconds: 5 },
  { label: '10秒K', seconds: 10 },
  { label: '30秒K', seconds: 30 },
  { label: '1分K', seconds: 60 },
];

/** 采样档位（毫秒） */
export const SAMPLE_TIERS = [500, 1000, 2000, 5000, 10000];

/** 按单位格式化数值 */
export function formatValue(v, unit) {
  if (v == null || !Number.isFinite(v)) return '—';
  const u = unitOf(unit);
  return v.toFixed(u.d) + u.suffix;
}

/** 格式化涨跌：始终带符号，不依赖颜色传达方向 */
export function formatDelta(v, unit) {
  if (v == null || !Number.isFinite(v)) return '—';
  const u = unitOf(unit);
  const sign = v > 0 ? '+' : v < 0 ? '-' : '';
  return sign + Math.abs(v).toFixed(u.d) + u.suffix;
}
