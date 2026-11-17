// @ts-check
/**
 * Listing-level rules: target-market requirements, content consistency between
 * what the user typed and what the manifest declares, and the missing-item list.
 *
 * Sources for each rule are marked with the official guide section
 * (https://code.minimax.cn/docs/code/agents/plugin-submission.md).
 */
import { CATEGORIES, LIMITS, validateManifest } from './manifest-rules.mjs';

/**
 * @typedef {import('./manifest-rules.mjs').Issue} Issue
 */

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   role: 'icon' | 'screenshot' | 'skill' | 'mcp' | 'app' | 'doc',
 *   size: number,
 *   mime: string,
 *   createdAt: string,
 * }} Asset
 */

/**
 * @typedef {{
 *   manifestText: string,
 *   marketName: string,
 *   summary: string,
 *   documentation: string,
 *   category: string,
 *   exampleQueries: string[],
 *   regions: string[],
 *   enabledEnds: string[],
 *   operation: 'new' | 'update',
 *   existingName: string,
 *   previousVersion: string,
 *   submitEmail: string,
 *   submitAccount: string,
 *   organization: string,
 * }} Draft
 */

/**
 * @param {string} value
 * @returns {number}
 */
function byteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function looksLikePlaceholder(value) {
  return /(todo|lorem ipsum|待补充|占位|placeholder|xxx+)/i.test(value);
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function keywords(text) {
  return text
    .toLowerCase()
    .split(/[\s,，。、;；:：!！?？"'`()（）\[\]{}/\\|]+/)
    .filter((word) => word.length >= 2);
}

/**
 * Run listing-level validation on a draft plus its uploaded assets.
 * @param {Draft} draft
 * @param {Asset[]} assets
 * @returns {{ issues: Issue[], manifest: Record<string, unknown> | null, manifestIssues: Issue[] }}
 */
export function validateDraft(draft, assets) {
  /** @type {Issue[]} */
  const issues = [];
  const manifestResult = validateManifest(draft.manifestText ?? '');
  const manifest = manifestResult.manifest;
  const manifestIssues = manifestResult.issues;

  const screenshots = assets.filter((asset) => asset.role === 'screenshot');
  const iconAssets = assets.filter((asset) => asset.role === 'icon');
  const skillAssets = assets.filter((asset) => asset.role === 'skill');
  const mcpAssets = assets.filter((asset) => asset.role === 'mcp');
  const appAssets = assets.filter((asset) => asset.role === 'app');

  // ---- target market requirements (guide §8) ----
  if (!Array.isArray(draft.regions) || draft.regions.length === 0) {
    issues.push({
      id: 'market.region.missing',
      severity: 'error',
      title: '未选择目标区域',
      detail: '提交表单需要分别选择目标区域 CN/US。',
      source: '指南 §8 提交新 Plugin 或更新',
      field: 'regions',
      missing: true,
    });
  }
  if (!Array.isArray(draft.enabledEnds) || draft.enabledEnds.length === 0) {
    issues.push({
      id: 'market.ends.missing',
      severity: 'error',
      title: '未选择启用端',
      detail: '提交表单需要选择桌面端和/或云端。',
      source: '指南 §8 提交新 Plugin 或更新',
      field: 'enabledEnds',
      missing: true,
    });
  }
  if (draft.operation !== 'new' && draft.operation !== 'update') {
    issues.push({
      id: 'market.operation.missing',
      severity: 'error',
      title: '未选择操作类型',
      detail: '需要选择“上架新 Plugin”或“更新已有 Plugin”。',
      source: '指南 §8 提交新 Plugin 或更新',
      field: 'operation',
      missing: true,
    });
  }
  if (draft.operation === 'update') {
    if (!draft.existingName.trim()) {
      issues.push({
        id: 'market.update.existingName',
        severity: 'error',
        title: '更新操作缺少原 Plugin 名',
        detail: '更新已有 Plugin 时 name 必须保持不变，需要填写原名称用于核对。',
        source: '指南 §8 提交新 Plugin 或更新',
        field: 'existingName',
        missing: true,
      });
    }
    if (!draft.previousVersion.trim()) {
      issues.push({
        id: 'market.update.previousVersion',
        severity: 'error',
        title: '更新操作缺少上次提交版本',
        detail: '包内内容变化时必须提升 version，需要填写上次提交版本用于核对。',
        source: '指南 §8 提交新 Plugin 或更新',
        field: 'previousVersion',
        missing: true,
      });
    }
  }
  if (!draft.submitEmail.trim()) {
    issues.push({
      id: 'market.email.missing',
      severity: 'error',
      title: '缺少提交邮箱',
      detail: '查询进度需要“原提交飞书账号 + submission_id + 提交邮箱”三者匹配。',
      source: '指南 §8 提交新 Plugin 或更新',
      field: 'submitEmail',
      missing: true,
    });
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.submitEmail.trim())) {
    issues.push({
      id: 'market.email.invalid',
      severity: 'error',
      title: '提交邮箱格式不正确',
      detail: `当前值：${draft.submitEmail}`,
      source: '指南 §8 提交新 Plugin 或更新',
      field: 'submitEmail',
    });
  }
  if (!draft.submitAccount.trim()) {
    issues.push({
      id: 'market.account.missing',
      severity: 'warning',
      title: '未填写提交飞书账号',
      detail: '提交需要登录飞书账号；查询进度时账号必须与提交时一致。',
      source: '指南 §8 提交新 Plugin 或更新',
      field: 'submitAccount',
      missing: true,
    });
  }
  if (!draft.organization.trim()) {
    issues.push({
      id: 'market.organization.missing',
      severity: 'warning',
      title: '未填写组织/团队',
      detail: '提交表单需要填写组织/团队名称。',
      source: '指南 §8 提交新 Plugin 或更新',
      field: 'organization',
      missing: true,
    });
  }

  // ---- listing copy fields (guide §3, §9) ----
  const marketName = (draft.marketName ?? '').trim();
  if (marketName === '') {
    issues.push({
      id: 'listing.name.missing',
      severity: 'error',
      title: '缺少期望市场名称',
      detail: '需要填写在市场中展示的名称。',
      source: '指南 §9 提交前自查',
      field: 'marketName',
      missing: true,
    });
  } else if (byteLength(marketName) > 1024) {
    issues.push({
      id: 'listing.name.bytes',
      severity: 'error',
      title: '市场名称超过 1024 字节',
      detail: `当前 ${byteLength(marketName)} 字节。`,
      source: '指南 §3 编写 Plugin Manifest',
      field: 'marketName',
    });
  }

  const summary = (draft.summary ?? '').trim();
  if (summary === '') {
    issues.push({
      id: 'listing.summary.missing',
      severity: 'error',
      title: '缺少简介',
      detail: '简介是市场卡片上的第一句话，必须填写。',
      source: '指南 §9 提交前自查',
      field: 'summary',
      missing: true,
    });
  } else if (byteLength(summary) > 1024) {
    issues.push({
      id: 'listing.summary.bytes',
      severity: 'error',
      title: '简介超过 1024 字节',
      detail: `当前 ${byteLength(summary)} 字节。`,
      source: '指南 §3 编写 Plugin Manifest',
      field: 'summary',
    });
  } else if (looksLikePlaceholder(summary)) {
    issues.push({
      id: 'listing.summary.placeholder',
      severity: 'warning',
      title: '简介看起来仍是占位内容',
      detail: '审核会检查描述是否仍是测试内容。',
      source: '指南 §10 常见驳回原因',
      field: 'summary',
    });
  }

  const documentation = (draft.documentation ?? '').trim();
  if (documentation === '') {
    issues.push({
      id: 'listing.documentation.missing',
      severity: 'error',
      title: '缺少说明文档',
      detail: '说明文档会写入包的 README.md。',
      source: '指南 §2 标准目录结构',
      field: 'documentation',
      missing: true,
    });
  } else if (looksLikePlaceholder(documentation)) {
    issues.push({
      id: 'listing.documentation.placeholder',
      severity: 'warning',
      title: '说明文档看起来仍是占位内容',
      detail: '提交前请替换为正式文案。',
      source: '指南 §10 常见驳回原因',
      field: 'documentation',
    });
  }

  // ---- screenshots (guide §9) ----
  if (screenshots.length === 0) {
    issues.push({
      id: 'listing.screenshot.missing',
      severity: 'error',
      title: '没有上传截图',
      detail: '至少需要一张截图用于市场展示。',
      source: '指南 §9 提交前自查',
      field: 'screenshots',
      missing: true,
    });
  }
  for (const shot of screenshots) {
    if (shot.size > LIMITS.singleFileBytes) {
      issues.push({
        id: `listing.screenshot.size.${shot.id}`,
        severity: 'error',
        title: `截图 ${shot.name} 超过单文件上限`,
        detail: `当前 ${shot.size} 字节，上限 ${LIMITS.singleFileBytes} 字节。`,
        source: '指南 §7 包体与安全限制',
        field: 'screenshots',
      });
    }
  }

  // ---- target category (guide §3) ----
  // The category is a listing-form field in its own right: it must be reported
  // even when the manifest is empty or invalid, so it lives outside the
  // manifest-consistency block below.
  if (!draft.category.trim()) {
    issues.push({
      id: 'listing.category.missing',
      severity: 'error',
      title: '未选择目标分类',
      detail: `需要从固定分类中选择：${CATEGORIES.join('、')}`,
      source: '指南 §3 编写 Plugin Manifest',
      field: 'category',
      missing: true,
    });
  } else if (!CATEGORIES.includes(draft.category)) {
    issues.push({
      id: 'listing.category.invalid',
      severity: 'error',
      title: '目标分类不在固定分类中',
      detail: `当前值：${draft.category}`,
      source: '指南 §3 编写 Plugin Manifest',
      field: 'category',
    });
  }

  // ---- consistency between listing copy and manifest (guide §3, §9) ----
  if (manifest) {
    const manifestDisplayName =
      typeof manifest.displayName === 'string' && manifest.displayName.trim() !== ''
        ? manifest.displayName.trim()
        : typeof manifest.name === 'string'
          ? manifest.name
          : '';

    if (marketName && manifestDisplayName && marketName !== manifestDisplayName) {
      issues.push({
        id: 'consistency.marketName',
        severity: 'warning',
        title: '市场名称与清单展示名不一致',
        detail: `市场名称「${marketName}」，清单 displayName「${manifestDisplayName}」。市场展示名以清单为准。`,
        source: '指南 §3 编写 Plugin Manifest',
        field: 'marketName',
      });
    }
    if (!manifestDisplayName && marketName) {
      issues.push({
        id: 'consistency.displayName.absent',
        severity: 'info',
        title: '清单未声明 displayName',
        detail: `市场将回退显示 name「${String(manifest.name ?? '')}」。`,
        source: '指南 §3 编写 Plugin Manifest',
        field: 'manifest',
      });
    }

    if (summary && typeof manifest.description === 'string') {
      const manifestDescription = manifest.description.trim();
      if (manifestDescription && manifestDescription !== summary) {
        const shared = keywords(summary).filter((word) => keywords(manifestDescription).includes(word));
        issues.push({
          id: 'consistency.summary',
          severity: shared.length === 0 ? 'warning' : 'info',
          title: '简介与清单 description 不一致',
          detail:
            shared.length === 0
              ? '两段文字没有共同关键词，可能指向不同能力。'
              : `两段文字共同关键词：${shared.join('、')}。`,
          source: '指南 §3 编写 Plugin Manifest',
          field: 'summary',
        });
      }
    }

    if (documentation && manifestDisplayName && !documentation.includes(manifestDisplayName)) {
      issues.push({
        id: 'consistency.documentation',
        severity: 'warning',
        title: '说明文档没有提到插件名',
        detail: `文档中未出现「${manifestDisplayName}」。`,
        source: '指南 §9 提交前自查',
        field: 'documentation',
      });
    }

    if (draft.category && manifest.category && draft.category !== manifest.category) {
      issues.push({
        id: 'consistency.category',
        severity: 'warning',
        title: '目标分类与清单 category 不一致',
        detail: `目标分类「${draft.category}」，清单 category「${String(manifest.category)}」。`,
        source: '指南 §3 编写 Plugin Manifest',
        field: 'category',
      });
    }

    const listingQueries = (draft.exampleQueries ?? []).filter((query) => query.trim() !== '');
    if (listingQueries.length > 3) {
      issues.push({
        id: 'listing.queries.count',
        severity: 'error',
        title: '示例 query 超过 3 条',
        detail: `当前 ${listingQueries.length} 条。`,
        source: '指南 §3 编写 Plugin Manifest',
        field: 'exampleQueries',
      });
    }
    for (const query of listingQueries) {
      if (looksLikePlaceholder(query)) {
        issues.push({
          id: 'listing.queries.placeholder',
          severity: 'warning',
          title: '示例 query 看起来仍是测试内容',
          detail: `命中：${query}`,
          source: '指南 §10 常见驳回原因',
          field: 'exampleQueries',
        });
      }
    }
    const manifestQueries = Array.isArray(manifest.exampleQueries) ? manifest.exampleQueries : [];
    if (listingQueries.length > 0 && manifestQueries.length > 0) {
      const same =
        listingQueries.length === manifestQueries.length &&
        listingQueries.every((query, index) => query.trim() === String(manifestQueries[index] ?? '').trim());
      if (!same) {
        issues.push({
          id: 'consistency.queries',
          severity: 'warning',
          title: '示例 query 与清单 exampleQueries 不一致',
          detail: '市场展示的示例 query 需要与清单保持一致。',
          source: '指南 §3 编写 Plugin Manifest',
          field: 'exampleQueries',
        });
      }
    }
    if (listingQueries.length === 0 && manifestQueries.length === 0) {
      issues.push({
        id: 'listing.queries.none',
        severity: 'warning',
        title: '没有示例 query',
        detail: '指南允许 0–3 条，但示例能显著降低用户误用概率。',
        source: '指南 §3 编写 Plugin Manifest',
        field: 'exampleQueries',
      });
    }

    // ---- capability files present in the package (guide §9, §10) ----
    const declaredSkills = Array.isArray(manifest.skills) ? manifest.skills.map(String) : [];
    const declaredMcp = Array.isArray(manifest.mcpServers) ? manifest.mcpServers.map(String) : [];
    const declaredApps = Array.isArray(manifest.apps) ? manifest.apps.map(String) : [];

    for (const path of declaredSkills) {
      if (!skillAssets.some((asset) => asset.name === path)) {
        issues.push({
          id: `asset.skill.missing.${path}`,
          severity: 'error',
          title: `缺少 Skill 文件 ${path}`,
          detail: '清单引用了它，但上传的素材里没有同名文件。',
          source: '指南 §10 常见驳回原因',
          field: 'skills',
          missing: true,
        });
      }
    }
    for (const path of declaredMcp) {
      if (!mcpAssets.some((asset) => asset.name === path)) {
        issues.push({
          id: `asset.mcp.missing.${path}`,
          severity: 'error',
          title: `缺少 MCP 文件 ${path}`,
          detail: '清单引用了它，但上传的素材里没有同名文件。',
          source: '指南 §10 常见驳回原因',
          field: 'mcpServers',
          missing: true,
        });
      }
    }
    for (const path of declaredApps) {
      if (!appAssets.some((asset) => asset.name === path)) {
        issues.push({
          id: `asset.app.missing.${path}`,
          severity: 'error',
          title: `缺少 App 文件 ${path}`,
          detail: '清单引用了它，但上传的素材里没有同名文件。',
          source: '指南 §10 常见驳回原因',
          field: 'apps',
          missing: true,
        });
      }
    }

    const iconPath = typeof manifest.icon === 'string' ? manifest.icon : '';
    if (iconPath && !iconAssets.some((asset) => asset.name === iconPath)) {
      issues.push({
        id: 'asset.icon.missing',
        severity: 'error',
        title: `缺少图标文件 ${iconPath}`,
        detail: '清单声明了 icon，但上传的素材里没有这个路径的图标。',
        source: '指南 §9 提交前自查',
        field: 'icon',
        missing: true,
      });
    }

    // ---- version bump on update (guide §8) ----
    if (draft.operation === 'update' && manifest.version && draft.previousVersion.trim()) {
      const previous = draft.previousVersion.trim();
      const current = String(manifest.version);
      if (previous === current) {
        issues.push({
          id: 'market.update.versionSame',
          severity: 'error',
          title: '版本号没有提升',
          detail: `上次提交 ${previous}，当前仍为 ${current}。包内内容变化时必须提升 version。`,
          source: '指南 §8 提交新 Plugin 或更新',
          field: 'previousVersion',
        });
      } else if (previous.localeCompare(current, undefined, { numeric: true }) >= 0) {
        issues.push({
          id: 'market.update.versionLower',
          severity: 'error',
          title: '版本号没有提升',
          detail: `上次提交 ${previous}，当前 ${current} 未高于上次版本。`,
          source: '指南 §8 提交新 Plugin 或更新',
          field: 'previousVersion',
        });
      }
    }
    if (
      draft.operation === 'update' &&
      manifest.name &&
      draft.existingName.trim() &&
      draft.existingName.trim() !== manifest.name
    ) {
      issues.push({
        id: 'market.update.nameChanged',
        severity: 'error',
        title: '更新操作修改了 Plugin 名',
        detail: `原名「${draft.existingName.trim()}」，清单 name「${String(manifest.name)}」。更新时 name 必须保持不变。`,
        source: '指南 §8 提交新 Plugin 或更新',
        field: 'existingName',
      });
    }
  }

  const all = [...manifestIssues, ...issues];
  return { issues: all, manifest, manifestIssues };
}
