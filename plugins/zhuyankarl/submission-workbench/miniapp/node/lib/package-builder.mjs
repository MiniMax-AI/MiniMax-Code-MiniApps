// @ts-check
/**
 * Build the preview object and the reviewable listing package.
 *
 * The package layout follows the official guide §2 exactly: `.minimax-plugin/plugin.json`
 * sits directly at the ZIP root with no wrapper directory, capability files keep
 * the paths the manifest declares, and the listing materials (market copy, docs,
 * screenshots, review notes) live under `listing-materials/`.
 */
import { createZip } from './zip.mjs';
import { sha256 } from './store.mjs';
import { CATEGORIES, GUIDE_URL, LIMITS } from './manifest-rules.mjs';

/**
 * @typedef {import('./manifest-rules.mjs').Issue} Issue
 * @typedef {import('./store.mjs').Asset} Asset
 */

/**
 * @typedef {{
 *   marketName: string,
 *   summary: string,
 *   version: string,
 *   category: string,
 *   author: string,
 *   regions: string[],
 *   enabledEnds: string[],
 *   exampleQueries: string[],
 *   screenshotCount: number,
 *   capabilityFiles: { path: string, role: string, present: boolean }[],
 * }} ListingPreview
 */

/**
 * Build the market-facing preview shown in the UI.
 * @param {Record<string, unknown> | null} manifest
 * @param {import('./listing-rules.mjs').Draft} draft
 * @param {Asset[]} assets
 * @returns {ListingPreview}
 */
export function buildPreview(manifest, draft, assets) {
  const screenshots = assets.filter((asset) => asset.role === 'screenshot');
  const capabilityFiles = [];
  if (manifest) {
    for (const field of ['skills', 'mcpServers', 'apps']) {
      const value = manifest[field];
      if (!Array.isArray(value)) continue;
      for (const entry of value) {
        const path = String(entry);
        const role = field === 'skills' ? 'skill' : field === 'mcpServers' ? 'mcp' : 'app';
        capabilityFiles.push({
          path,
          role,
          present: assets.some((asset) => asset.role === role && asset.name === path),
        });
      }
    }
  }
  return {
    marketName: draft.marketName || (typeof manifest?.displayName === 'string' ? manifest.displayName : ''),
    summary: draft.summary || (typeof manifest?.description === 'string' ? manifest.description : ''),
    version: typeof manifest?.version === 'string' ? manifest.version : '',
    category: draft.category || (typeof manifest?.category === 'string' ? manifest.category : ''),
    author: typeof manifest?.author === 'string' ? manifest.author : '',
    regions: draft.regions ?? [],
    enabledEnds: draft.enabledEnds ?? [],
    exampleQueries: (draft.exampleQueries ?? []).filter((query) => query.trim() !== ''),
    screenshotCount: screenshots.length,
    capabilityFiles,
  };
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeCell(value) {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/**
 * Render the review report as Markdown.
 * @param {import('./listing-rules.mjs').Draft} draft
 * @param {Record<string, unknown> | null} manifest
 * @param {Issue[]} issues
 * @param {Asset[]} assets
 * @param {import('./channel.mjs').ChannelReport} channel
 * @returns {string}
 */
export function renderReviewReport(draft, manifest, issues, assets, channel) {
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  const missing = issues.filter((issue) => issue.missing);
  const lines = [];

  lines.push('# 上架材料自检报告');
  lines.push('');
  lines.push(`生成时间：${new Date().toISOString()}`);
  lines.push('');
  lines.push(
    '> 本报告由本地 Mini App 生成。**材料尚未提交到官方市场，也不代表已上架。**',
    '> 官方受理入口为飞书表单（人工提交）与公开 GitHub 仓库；本工具只产出可审核材料。',
    '',
  );
  lines.push(`规则依据：《插件开发与上架指南》 ${GUIDE_URL}`);
  lines.push('');

  lines.push('## 一、结论');
  lines.push('');
  lines.push(`- 错误：${errors.length} 项`);
  lines.push(`- 警告：${warnings.length} 项`);
  lines.push(`- 缺失项：${missing.length} 项`);
  lines.push(`- 提交通道：${channel.conclusion}`);
  lines.push('');

  lines.push('## 二、缺失项');
  lines.push('');
  if (missing.length === 0) {
    lines.push('无。');
  } else {
    lines.push('| 字段 | 问题 | 依据 |');
    lines.push('| --- | --- | --- |');
    for (const issue of missing) {
      lines.push(`| ${escapeCell(issue.field ?? '-')} | ${escapeCell(issue.title)}：${escapeCell(issue.detail)} | ${escapeCell(issue.source)} |`);
    }
  }
  lines.push('');

  lines.push('## 三、逐项检查');
  lines.push('');
  if (issues.length === 0) {
    lines.push('未发现问题。');
  } else {
    lines.push('| 级别 | 问题 | 说明 | 依据 |');
    lines.push('| --- | --- | --- | --- |');
    for (const issue of issues) {
      const level = issue.severity === 'error' ? '错误' : issue.severity === 'warning' ? '警告' : '提示';
      lines.push(`| ${level} | ${escapeCell(issue.title)} | ${escapeCell(issue.detail)} | ${escapeCell(issue.source)} |`);
    }
  }
  lines.push('');

  lines.push('## 四、上架字段');
  lines.push('');
  lines.push('| 表单项 | 值 |');
  lines.push('| --- | --- |');
  lines.push(`| Plugin 名 | ${escapeCell(String(manifest?.name ?? '（缺失）'))} |`);
  lines.push(`| 操作类型 | ${draft.operation === 'update' ? '更新已有 Plugin' : '上架新 Plugin'} |`);
  lines.push('| 来源类型 | ZIP |');
  lines.push(`| 目标区域 | ${escapeCell(draft.regions.join('、') || '（未选）')} |`);
  lines.push(`| 启用端 | ${escapeCell(draft.enabledEnds.join('、') || '（未选）')} |`);
  lines.push(`| 组织/团队 | ${escapeCell(draft.organization || '（未填）')} |`);
  lines.push(`| 联系邮箱 | ${escapeCell(draft.submitEmail || '（未填）')} |`);
  lines.push(`| 期望市场名称 | ${escapeCell(draft.marketName || '（未填）')} |`);
  lines.push(`| 简介 | ${escapeCell(draft.summary || '（未填）')} |`);
  lines.push(`| 分类 | ${escapeCell(draft.category || '（未选）')} |`);
  lines.push(
    `| 示例 query | ${escapeCell((draft.exampleQueries ?? []).filter((q) => q.trim()).join(' / ') || '（未填）')} |`,
  );
  lines.push('');

  lines.push('## 五、素材清单');
  lines.push('');
  if (assets.length === 0) {
    lines.push('未上传素材。');
  } else {
    lines.push('| 角色 | 路径 | 大小(字节) |');
    lines.push('| --- | --- | --- |');
    for (const asset of assets) {
      lines.push(`| ${escapeCell(asset.role)} | ${escapeCell(asset.name)} | ${asset.size} |`);
    }
  }
  lines.push('');

  lines.push('## 六、提交通道与权限');
  lines.push('');
  for (const finding of channel.findings) {
    lines.push(`- **${finding.label}**（${finding.status}）：${finding.detail} 证据：${finding.evidence}`);
  }
  lines.push('');
  for (const permission of channel.requiredPermissions) {
    lines.push(`- ${permission.satisfied ? '已具备' : '未具备'}：${permission.label} —— ${permission.detail}`);
  }
  lines.push('');
  lines.push('## 七、人工提交步骤');
  lines.push('');
  lines.push('1. 打开准备提交表单，选择“上架新 Plugin”或“更新已有 Plugin”。');
  lines.push('2. 目标区域选择 CN / US，启用端勾选桌面端 / 云端。');
  lines.push('3. 来源选择 ZIP，上传本包生成的 `.minimax-plugin/plugin.json` 位于根目录的 ZIP。');
  lines.push('4. 填写组织/团队与联系邮箱，提交后**保存 submission_id**。');
  lines.push('5. 查询进度需使用原提交飞书账号 + submission_id + 提交邮箱三者匹配。');
  lines.push('');
  lines.push(`固定分类可选值：${CATEGORIES.join('、')}`);
  lines.push('');
  lines.push(
    `包体上限参考：ZIP ≤ ${LIMITS.zipBytes} 字节、entries ≤ ${LIMITS.entries}、普通文件 ≤ ${LIMITS.files}、单文件解包 ≤ ${LIMITS.singleFileBytes} 字节、完整路径 ≤ ${LIMITS.pathBytes} 字节、路径深度 ≤ ${LIMITS.pathDepth} 段。`,
  );
  lines.push('');

  return lines.join('\n');
}

/**
 * Assemble the ZIP payload and its entry manifest.
 * @param {import('./listing-rules.mjs').Draft} draft
 * @param {Record<string, unknown> | null} manifest
 * @param {Asset[]} assets
 * @param {(asset: Asset) => Promise<Buffer | null>} readAsset
 * @param {Issue[]} issues
 * @param {import('./channel.mjs').ChannelReport} channel
 * @returns {Promise<{ bytes: Buffer, entries: { path: string, size: number }[] }>}
 */
export async function buildPackage(draft, manifest, assets, readAsset, issues, channel) {
  /** @type {{ path: string, data: Buffer }[]} */
  const entries = [];

  if (manifest) {
    const pluginJson = `${JSON.stringify(manifest, null, 2)}\n`;
    entries.push({
      path: '.minimax-plugin/plugin.json',
      data: Buffer.from(pluginJson, 'utf8'),
    });
  }

  const documentation = (draft.documentation ?? '').trim();
  if (documentation !== '') {
    entries.push({ path: 'README.md', data: Buffer.from(documentation, 'utf8') });
  }

  // Capability files keep the exact paths the manifest declares.
  for (const asset of assets) {
    if (asset.role !== 'skill' && asset.role !== 'mcp' && asset.role !== 'app' && asset.role !== 'icon') {
      continue;
    }
    const bytes = await readAsset(asset);
    if (!bytes) continue;
    entries.push({ path: asset.name, data: bytes });
  }

  // Review-only material lives in one clearly separated folder.
  entries.push({
    path: 'listing-materials/review-report.md',
    data: Buffer.from(renderReviewReport(draft, manifest, issues, assets, channel), 'utf8'),
  });

  const summaryText = [
    `# ${draft.marketName || '（未命名）'}`,
    '',
    draft.summary || '（未填写简介）',
    '',
    `版本：${String(manifest?.version ?? '-')}`,
    `分类：${draft.category || '-'}`,
    `作者：${String(manifest?.author ?? '-')}`,
    `目标区域：${(draft.regions ?? []).join('、') || '-'}`,
    `启用端：${(draft.enabledEnds ?? []).join('、') || '-'}`,
    '',
    '## 示例 query',
    '',
    ...((draft.exampleQueries ?? []).filter((query) => query.trim() !== '').map((query) => `- ${query}`)),
    '',
    '## 说明',
    '',
    '本目录是供人工审核的上架材料副本，不代表已提交或已上架。',
    '',
  ].join('\n');
  entries.push({ path: 'listing-materials/market-preview.md', data: Buffer.from(summaryText, 'utf8') });

  const screenshots = assets.filter((asset) => asset.role === 'screenshot');
  for (const shot of screenshots) {
    const bytes = await readAsset(shot);
    if (!bytes) continue;
    entries.push({ path: `listing-materials/screenshots/${shot.name}`, data: bytes });
  }

  const bytes = createZip(entries);
  const entryList = entries.map((entry) => ({
    path: entry.path,
    size: entry.data.length,
  }));
  return { bytes, entries: entryList };
}

/**
 * @param {Buffer} bytes
 * @returns {string}
 */
export function packageDigest(bytes) {
  return sha256(bytes);
}
