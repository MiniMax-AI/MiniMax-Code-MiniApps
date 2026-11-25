// @ts-check
/**
 * Manifest validation rules for the MiniMax Plugin marketplace.
 *
 * Every rule carries the official guide section it comes from
 * (https://code.minimax.cn/docs/code/agents/plugin-submission.md, read 2026-11-16),
 * so the UI can always answer "why is this flagged".
 */
import { parseJsonWithDuplicates } from './json-parse.mjs';

export const GUIDE_URL = 'https://code.minimax.cn/docs/code/agents/plugin-submission.md';

export const CATEGORIES = [
  'Office',
  'Studio',
  'Design & Sites',
  'Code',
  'Business',
  'Sales',
  'Productivity',
  'Science & Healthcare',
  'Education',
  'Other',
];

export const ICON_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

export const LIMITS = {
  zipBytes: 64 * 1024 * 1024,
  entries: 2048,
  files: 1024,
  singleFileBytes: 16 * 1024 * 1024,
  totalUnpackedBytes: 64 * 1024 * 1024,
  pathBytes: 512,
  pathSegmentBytes: 128,
  pathDepth: 16,
};

const NAME_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const KNOWN_FIELDS = new Set([
  'schemaVersion',
  'name',
  'displayName',
  'version',
  'description',
  'author',
  'icon',
  'category',
  'exampleQueries',
  'apps',
  'mcpServers',
  'skills',
]);

/** Fields the guide explicitly says do not belong in plugin.json (guide §3). */
const FORBIDDEN_FIELDS = new Set(['deliveryTargets', 'installationPolicy', 'listed', 'darkIcon', 'hooks']);

const CAPABILITY_FIELDS = ['apps', 'mcpServers', 'skills'];

/**
 * @typedef {{
 *   id: string,
 *   severity: 'error' | 'warning' | 'info',
 *   title: string,
 *   detail: string,
 *   source: string,
 *   field?: string,
 *   missing?: boolean,
 * }} Issue
 */

/**
 * @param {string} value
 * @returns {number} UTF-8 byte length
 */
function byteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

/**
 * Validate a capability path declared in the manifest (guide §2, §3, §7).
 * @param {string} path
 * @param {string} label
 * @returns {string[]} problems
 */
function checkCapabilityPath(path, label) {
  /** @type {string[]} */
  const problems = [];
  if (typeof path !== 'string' || path.trim() === '') {
    problems.push(`${label} 不是有效的相对路径`);
    return problems;
  }
  if (path.includes('\\')) problems.push(`${label} 使用了反斜杠，路径必须使用 /`);
  if (path.startsWith('/')) problems.push(`${label} 是绝对路径，必须是包内相对路径`);
  if (/^[A-Za-z]:/.test(path)) problems.push(`${label} 是 Windows 绝对路径，必须是包内相对路径`);
  if (path.split('/').some((part) => part === '..')) problems.push(`${label} 包含上级目录穿越`);
  if (!/^[\x21-\x7e]+$/.test(path)) problems.push(`${label} 含有非 ASCII 字符`);
  if (!/^[A-Za-z0-9._\-/]+$/.test(path)) problems.push(`${label} 含不允许的字符（只允许字母、数字、点、下划线、连字符）`);
  const depth = path.split('/').length;
  if (depth > LIMITS.pathDepth) problems.push(`${label} 路径深度 ${depth} 超过 ${LIMITS.pathDepth} 段`);
  if (byteLength(path) > LIMITS.pathBytes) problems.push(`${label} 路径长度超过 ${LIMITS.pathBytes} 字节`);
  for (const segment of path.split('/')) {
    if (byteLength(segment) > LIMITS.pathSegmentBytes) {
      problems.push(`${label} 中 "${segment}" 超过 ${LIMITS.pathSegmentBytes} 字节`);
    }
  }
  return problems;
}

/**
 * Run every manifest rule against the pasted manifest text.
 * @param {string} manifestText
 * @returns {{ issues: Issue[], manifest: Record<string, unknown> | null, ok: boolean }}
 */
export function validateManifest(manifestText) {
  /** @type {Issue[]} */
  const issues = [];
  const raw = manifestText ?? '';
  const trimmed = raw.trim();

  // `String.prototype.trim()` strips U+FEFF, so the BOM must be checked on the
  // raw text before trimming — otherwise a BOM-prefixed manifest looks clean.
  if (raw.charCodeAt(0) === 0xfeff) {
    issues.push({
      id: 'manifest.bom',
      severity: 'error',
      title: '清单包含 UTF-8 BOM',
      detail: '文本文件必须使用 UTF-8 且不带 BOM。',
      source: '指南 §2 标准目录结构',
      field: 'manifest',
    });
  }

  if (trimmed === '') {
    issues.push({
      id: 'manifest.empty',
      severity: 'error',
      title: '插件清单为空',
      detail: '还没有粘贴 .minimax-plugin/plugin.json 的内容。',
      source: '指南 §3 编写 Plugin Manifest',
      field: 'manifest',
      missing: true,
    });
    return { issues, manifest: null, ok: false };
  }

  const parsed = parseJsonWithDuplicates(trimmed);
  if (!parsed.ok) {
    issues.push({
      id: 'manifest.json',
      severity: 'error',
      title: '清单不是合法 JSON',
      detail: parsed.error,
      source: '指南 §2 标准目录结构（JSON 必须是 object）',
      field: 'manifest',
      missing: true,
    });
    return { issues, manifest: null, ok: false };
  }

  if (parsed.duplicates.length > 0) {
    issues.push({
      id: 'manifest.duplicateKeys',
      severity: 'error',
      title: '清单包含重复 key',
      detail: `重复位置：${parsed.duplicates.map((item) => item.path).join('、')}`,
      source: '指南 §2 标准目录结构（JSON 不能包含重复 key）',
      field: 'manifest',
    });
  }

  if (typeof parsed.value !== 'object' || parsed.value === null || Array.isArray(parsed.value)) {
    issues.push({
      id: 'manifest.notObject',
      severity: 'error',
      title: '清单顶层必须是对象',
      detail: '当前顶层不是 JSON object。',
      source: '指南 §2 标准目录结构',
      field: 'manifest',
    });
    return { issues, manifest: null, ok: false };
  }

  const manifest = /** @type {Record<string, unknown>} */ (parsed.value);

  if (manifest.schemaVersion !== 1) {
    issues.push({
      id: 'manifest.schemaVersion',
      severity: 'error',
      title: 'schemaVersion 必须为 1',
      detail: `当前值：${JSON.stringify(manifest.schemaVersion ?? null)}`,
      source: '指南 §3 编写 Plugin Manifest',
      field: 'schemaVersion',
    });
  }

  // name
  const name = manifest.name;
  if (typeof name !== 'string' || name.trim() === '') {
    issues.push({
      id: 'manifest.name.missing',
      severity: 'error',
      title: '缺少 name',
      detail: 'name 是包的机器名，必填。',
      source: '指南 §3 编写 Plugin Manifest',
      field: 'name',
      missing: true,
    });
  } else {
    if (name.length > 80) {
      issues.push({
        id: 'manifest.name.length',
        severity: 'error',
        title: 'name 超过 80 个字符',
        detail: `当前长度 ${name.length}。`,
        source: '指南 §3 编写 Plugin Manifest',
        field: 'name',
      });
    }
    if (!NAME_PATTERN.test(name)) {
      issues.push({
        id: 'manifest.name.pattern',
        severity: 'error',
        title: 'name 不符合小写机器名规则',
        detail: '要求以字母开头，只使用小写字母、数字及 . _ - 分隔符。',
        source: '指南 §3 编写 Plugin Manifest',
        field: 'name',
      });
    }
  }

  // version
  const version = manifest.version;
  if (typeof version !== 'string' || version.trim() === '') {
    issues.push({
      id: 'manifest.version.missing',
      severity: 'error',
      title: '缺少 version',
      detail: 'version 必填且必须是 SemVer。',
      source: '指南 §3 编写 Plugin Manifest',
      field: 'version',
      missing: true,
    });
  } else if (!SEMVER_PATTERN.test(version)) {
    issues.push({
      id: 'manifest.version.semver',
      severity: 'error',
      title: 'version 不是合法 SemVer',
      detail: `当前值：${version}。`,
      source: '指南 §3 编写 Plugin Manifest',
      field: 'version',
    });
  }

  // displayName
  if (manifest.displayName !== undefined) {
    const displayName = manifest.displayName;
    if (typeof displayName !== 'string' || displayName.trim() === '') {
      issues.push({
        id: 'manifest.displayName.empty',
        severity: 'error',
        title: 'displayName 去除空白后为空',
        detail: '省略 displayName 时会回退到 name；保留该字段时必须非空。',
        source: '指南 §3 编写 Plugin Manifest',
        field: 'displayName',
      });
    } else if (byteLength(displayName) > 1024) {
      issues.push({
        id: 'manifest.displayName.bytes',
        severity: 'error',
        title: 'displayName 超过 1024 字节',
        detail: `当前 ${byteLength(displayName)} 字节。`,
        source: '指南 §3 编写 Plugin Manifest',
        field: 'displayName',
      });
    }
  }

  // description
  const description = manifest.description;
  if (typeof description !== 'string' || description.trim() === '') {
    issues.push({
      id: 'manifest.description.missing',
      severity: 'error',
      title: '缺少 description',
      detail: 'description 必填，需要说明能解决什么问题。',
      source: '指南 §3 编写 Plugin Manifest',
      field: 'description',
      missing: true,
    });
  } else {
    const implementationHints = [
      'hook',
      'stdio',
      'json schema',
      '内部实现',
      '内部技术实现',
      '端点地址',
      'endpoint',
      'api key',
      '调试',
    ].filter((word) => description.toLowerCase().includes(word));
    if (implementationHints.length > 0) {
      issues.push({
        id: 'manifest.description.implementation',
        severity: 'warning',
        title: 'description 可能写入了内部技术实现',
        detail: `命中：${implementationHints.join('、')}。指南要求只说明能解决什么问题。`,
        source: '指南 §3 编写 Plugin Manifest',
        field: 'description',
      });
    }
  }

  // author
  const author = manifest.author;
  if (typeof author !== 'string' || author.trim() === '') {
    issues.push({
      id: 'manifest.author.missing',
      severity: 'error',
      title: '缺少 author',
      detail: 'author 必填，填写开发者、团队或公司名称。',
      source: '指南 §3 编写 Plugin Manifest',
      field: 'author',
      missing: true,
    });
  } else if (byteLength(author) > 1024) {
    issues.push({
      id: 'manifest.author.bytes',
      severity: 'error',
      title: 'author 超过 1024 字节',
      detail: `当前 ${byteLength(author)} 字节。`,
      source: '指南 §3 编写 Plugin Manifest',
      field: 'author',
    });
  }

  // icon
  const icon = manifest.icon;
  if (typeof icon !== 'string' || icon.trim() === '') {
    issues.push({
      id: 'manifest.icon.missing',
      severity: 'error',
      title: '缺少 icon',
      detail: 'icon 必填，指向包内相对路径，且不能为 null。',
      source: '指南 §3 编写 Plugin Manifest',
      field: 'icon',
      missing: true,
    });
  } else {
    const extension = icon.slice(icon.lastIndexOf('.')).toLowerCase();
    if (!ICON_EXTENSIONS.includes(extension)) {
      issues.push({
        id: 'manifest.icon.extension',
        severity: 'error',
        title: 'icon 扩展名不被接受',
        detail: `只支持 ${ICON_EXTENSIONS.join(' / ')}。`,
        source: '指南 §3 编写 Plugin Manifest',
        field: 'icon',
      });
    }
    if (icon !== icon.toLowerCase()) {
      issues.push({
        id: 'manifest.icon.lowercase',
        severity: 'error',
        title: 'icon 路径必须全小写',
        detail: '生产发布仅接受小写扩展名。',
        source: '指南 §3 编写 Plugin Manifest',
        field: 'icon',
      });
    }
    checkCapabilityPath(icon, 'icon').forEach((problem, problemIndex) => {
      issues.push({
        id: `manifest.icon.path.${problemIndex}`,
        severity: 'error',
        title: 'icon 路径不合规',
        detail: problem,
        source: '指南 §2 标准目录结构',
        field: 'icon',
      });
    });
  }

  // category
  const category = manifest.category;
  if (typeof category !== 'string' || category.trim() === '') {
    issues.push({
      id: 'manifest.category.missing',
      severity: 'error',
      title: '缺少 category',
      detail: 'category 必填，需从固定分类中选择。',
      source: '指南 §3 编写 Plugin Manifest',
      field: 'category',
      missing: true,
    });
  } else if (!CATEGORIES.includes(category)) {
    issues.push({
      id: 'manifest.category.invalid',
      severity: 'error',
      title: 'category 不在固定分类中',
      detail: `当前值：${category}。可选：${CATEGORIES.join('、')}`,
      source: '指南 §3 编写 Plugin Manifest',
      field: 'category',
    });
  }

  // exampleQueries
  const queries = manifest.exampleQueries;
  if (!Array.isArray(queries)) {
    issues.push({
      id: 'manifest.exampleQueries.type',
      severity: 'error',
      title: 'exampleQueries 必须是数组',
      detail: '允许 0–3 条真实示例。',
      source: '指南 §3 编写 Plugin Manifest',
      field: 'exampleQueries',
    });
  } else {
    if (queries.length > 3) {
      issues.push({
        id: 'manifest.exampleQueries.count',
        severity: 'error',
        title: 'exampleQueries 超过 3 条',
        detail: `当前 ${queries.length} 条。`,
        source: '指南 §3 编写 Plugin Manifest',
        field: 'exampleQueries',
      });
    }
    queries.forEach((query, index) => {
      if (typeof query !== 'string' || query.trim() === '') {
        issues.push({
          id: `manifest.exampleQueries.${index}.empty`,
          severity: 'error',
          title: `exampleQueries 第 ${index + 1} 条为空`,
          detail: '每条示例必须非空。',
          source: '指南 §3 编写 Plugin Manifest',
          field: 'exampleQueries',
        });
      } else if (query.length > 4096) {
        issues.push({
          id: `manifest.exampleQueries.${index}.length`,
          severity: 'error',
          title: `exampleQueries 第 ${index + 1} 条超过 4096 个字符`,
          detail: `当前 ${query.length} 个字符。`,
          source: '指南 §3 编写 Plugin Manifest',
          field: 'exampleQueries',
        });
      }
    });
  }

  // capability arrays
  let capabilityCount = 0;
  for (const field of CAPABILITY_FIELDS) {
    const value = manifest[field];
    if (value === undefined) {
      issues.push({
        id: `manifest.${field}.missing`,
        severity: 'warning',
        title: `缺少 ${field} 字段`,
        detail: '未使用的能力也要保留为空数组。',
        source: '指南 §3 编写 Plugin Manifest',
        field,
      });
      continue;
    }
    if (!Array.isArray(value)) {
      issues.push({
        id: `manifest.${field}.type`,
        severity: 'error',
        title: `${field} 必须是数组`,
        detail: '填写包内相对路径；未使用的能力必须保留为空数组。',
        source: '指南 §3 编写 Plugin Manifest',
        field,
      });
      continue;
    }
    capabilityCount += value.length;
    value.forEach((entry, index) => {
      const problems = checkCapabilityPath(String(entry), `${field}[${index}]`);
      problems.forEach((problem, problemIndex) => {
        issues.push({
          // A single path can break several rules at once, so the problem index
          // keeps every issue id unique.
          id: `manifest.${field}.${index}.path.${problemIndex}`,
          severity: 'error',
          title: `${field} 路径不合规`,
          detail: problem,
          source: '指南 §2 标准目录结构',
          field,
        });
      });
    });
  }
  if (capabilityCount === 0) {
    issues.push({
      id: 'manifest.capability.none',
      severity: 'error',
      title: '至少需要一种能力',
      detail: 'App、MCP、Skill 至少填写一项。',
      source: '指南 §1 先选择要提供的能力',
      field: 'capabilities',
      missing: true,
    });
  }

  // hooks / forbidden fields
  for (const field of FORBIDDEN_FIELDS) {
    if (manifest[field] !== undefined) {
      const isHook = field === 'hooks';
      issues.push({
        id: `manifest.forbidden.${field}`,
        severity: 'error',
        title: isHook ? '不能提交 hooks 字段' : `不能声明 ${field} 字段`,
        detail: isHook
          ? '当前第三方表单尚不受理 Hook，请勿提交 hooks 字段或 Hook JSON 文件。'
          : '该字段不属于 plugin.json，生产发布会拒绝。',
        source: isHook ? '指南 §1 先选择要提供的能力' : '指南 §3 编写 Plugin Manifest',
        field,
      });
    }
  }

  for (const key of Object.keys(manifest)) {
    if (!KNOWN_FIELDS.has(key) && !FORBIDDEN_FIELDS.has(key)) {
      issues.push({
        id: `manifest.unknown.${key}`,
        severity: 'warning',
        title: `清单出现未知字段 ${key}`,
        detail: 'plugin.json 的字段集合是固定的，未知字段可能触发审核问题。',
        source: '指南 §3 编写 Plugin Manifest',
        field: key,
      });
    }
  }

  const ok = !issues.some((issue) => issue.severity === 'error');
  return { issues, manifest, ok };
}
