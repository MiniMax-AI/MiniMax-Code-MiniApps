// @ts-check

/**
 * Content domain logic for the 公众号图文工作台.
 *
 * This module is deliberately deterministic: everything it produces is
 * derived from the user's own topic, body and requirements by rule. Nothing
 * here invents prose or claims an AI wrote it — derived fields are labelled
 * as 规则提取 in the UI.
 */

/** @typedef {{ type: string, text: string, items: string[] }} Block */
/** @typedef {{ id: string, role: string, ratio: string, pixels: string, anchor: string, prompt: string, checklist: string[], status: string }} PlanSlot */

export const COVER_RATIOS = {
  wide: { ratio: '47:20', pixels: '900×383', label: '2.35:1 主封面' },
  square: { ratio: '1:1', pixels: '900×900', label: '1:1 分享缩略图' },
};

const MAX_ILLUSTRATIONS = 4;
const DIGEST_LIMIT = 120;

/* ------------------------------------------------------------------ *
 * Body parsing — a deliberately small markdown subset
 * ------------------------------------------------------------------ */

/**
 * @param {string} body
 * @returns {Block[]}
 */
export function parseBlocks(body) {
  const text = String(body ?? '').replace(/\r\n/g, '\n');
  /** @type {Block[]} */
  const blocks = [];
  /** @type {string[]} */
  const paragraph = [];

  const flushParagraph = () => {
    const joined = paragraph.join('').trim();
    paragraph.length = 0;
    if (joined) blocks.push({ type: 'p', text: joined, items: [] });
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      continue;
    }
    if (line.startsWith('### ')) {
      flushParagraph();
      blocks.push({ type: 'h3', text: line.slice(4).trim(), items: [] });
      continue;
    }
    if (line.startsWith('## ')) {
      flushParagraph();
      blocks.push({ type: 'h2', text: line.slice(3).trim(), items: [] });
      continue;
    }
    if (line.startsWith('# ')) {
      flushParagraph();
      blocks.push({ type: 'h1', text: line.slice(2).trim(), items: [] });
      continue;
    }
    if (line.startsWith('> ')) {
      flushParagraph();
      blocks.push({ type: 'quote', text: line.slice(2).trim(), items: [] });
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      flushParagraph();
      blocks.push({ type: 'li', text: '', items: [line.replace(/^[-*]\s+/, '').trim()] });
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  return blocks;
}

/**
 * @param {string} body
 * @returns {string[]}
 */
export function headings(body) {
  return parseBlocks(body)
    .filter((block) => block.type === 'h2' || block.type === 'h3')
    .map((block) => block.text);
}

/* ------------------------------------------------------------------ *
 * Derivation — digest, title candidates, outline, key points
 * ------------------------------------------------------------------ */

/**
 * @param {string} body
 * @returns {string[]}
 */
export function sentences(body) {
  return String(body ?? '')
    .split(/\n+/)
    .flatMap((line) => line.replace(/^[#>\-*\s]+/, '').split(/[。！？!?；;]/))
    .map((s) => s.trim())
    .filter((s) => s.length >= 6);
}

/**
 * @param {string} body
 * @returns {string[]}
 */
export function keyPoints(body, limit = 4) {
  const scored = sentences(body).map((text, index) => ({
    text,
    score: Math.min(text.length, 42) + Math.max(0, 24 - index * 2),
  }));
  scored.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const item of scored) {
    if (picked.length >= limit) break;
    if (picked.some((other) => other.includes(item.text) || item.text.includes(other))) continue;
    picked.push(item.text);
  }
  return picked;
}

/**
 * @param {any} draft
 * @returns {{ digest: string, titleCandidates: string[], outline: string[], keyPoints: string[] }}
 */
export function deriveContent(draft) {
  const body = String(draft.body ?? '');
  const blocks = parseBlocks(body);
  const firstParagraph = blocks.find((block) => block.type === 'p');
  const digestSource = firstParagraph ? firstParagraph.text : sentences(body)[0] || '';
  const digest = digestSource.length > DIGEST_LIMIT
    ? `${digestSource.slice(0, DIGEST_LIMIT - 1)}…`
    : digestSource;

  const topic = String(draft.topic ?? '').trim();
  const points = keyPoints(body);
  const sectionTitles = blocks.filter((b) => b.type === 'h2').map((b) => b.text);

  /** @type {string[]} */
  const titleCandidates = [];
  if (topic) titleCandidates.push(topic);
  const lead = sentences(body)[0] || '';
  if (lead && lead !== topic) {
    titleCandidates.push(lead.length > 26 ? `${lead.slice(0, 26)}…` : lead);
  }
  if (sectionTitles.length >= 2) {
    titleCandidates.push(`${sectionTitles[0]}｜${sectionTitles[1]}`);
  }
  if (sectionTitles.length === 1) {
    titleCandidates.push(`${sectionTitles[0]}：${topic}`);
  }

  return {
    digest,
    titleCandidates: [...new Set(titleCandidates)].slice(0, 3),
    outline: blocks
      .filter((block) => block.type === 'h2' || block.type === 'h3')
      .map((block) => `${block.type === 'h2' ? '' : '　'}${block.text}`),
    keyPoints: points,
  };
}

/* ------------------------------------------------------------------ *
 * Cover / illustration plan
 * ------------------------------------------------------------------ */

/**
 * @param {any} draft
 * @param {any} style
 * @returns {{ cover: PlanSlot, illustrations: PlanSlot[], styleName: string }}
 */
export function buildPlan(draft, style) {
  const body = String(draft.body ?? '');
  const topic = String(draft.topic ?? '').trim();
  const coverRequirement = String(draft.coverRequirement ?? '').trim();
  const illustrationRequirement = String(draft.illustrationRequirement ?? '').trim();
  const points = keyPoints(body, 4);
  const coverSpec = COVER_RATIOS[draft.coverRatio === 'square' ? 'square' : 'wide'];

  const coverPrompt = [
    `公众号文章封面主视觉。`,
    `视觉风格：${style.coverPrompt}。`,
    `文章主题：${topic || '（未填写主题）'}。`,
    points.length ? `正文要点：${points.join('；')}。` : '',
    coverRequirement ? `封面需求：${coverRequirement}。` : '',
    `画面比例 ${coverSpec.ratio} 横向构图（公众号推荐 ${specPixels(coverSpec)}），主体明确、四周留出安全边距。`,
    draft.coverWithTitle
      ? `画面中排版中文主标题文字「${(draft.title || topic).slice(0, 16)}」，字形端正清晰，不错字。`
      : `画面中不要出现任何文字、水印、logo 或二维码。`,
  ]
    .filter(Boolean)
    .join('');

  const cover = {
    id: 'cover',
    role: '封面主图',
    ratio: coverSpec.ratio,
    pixels: coverSpec.pixels,
    anchor: '文章首图（公众号列表与正文顶部）',
    prompt: coverPrompt,
    checklist: [
      `比例 ${coverSpec.ratio}，目标 ${coverSpec.pixels}`,
      draft.coverWithTitle ? '含中文标题文字，无错字' : '不含任何文字，避免和文章标题重复',
      '主体清晰，缩略图尺寸下仍可辨识',
    ],
    status: draft.assets?.cover ? 'rendered' : 'pending',
  };

  /** @type {PlanSlot[]} */
  const illustrations = [];
  const blocks = parseBlocks(body);
  const anchors = [];
  blocks.forEach((block, index) => {
    if (block.type === 'h2' && anchors.length < MAX_ILLUSTRATIONS) {
      anchors.push({ title: block.text, index });
    }
  });
  if (anchors.length === 0) {
    const lead = blocks.find((block) => block.type === 'p');
    if (lead) anchors.push({ title: '开篇', index: blocks.indexOf(lead) });
  }

  anchors.forEach((anchor, position) => {
    const related = points[position % Math.max(points.length, 1)] || topic;
    illustrations.push({
      id: `illustration-${position + 1}`,
      role: `插图 ${position + 1}`,
      ratio: '16:9',
      pixels: '1080×608',
      anchor: `小节「${anchor.title}」之后`,
      prompt: [
        `公众号正文插图。`,
        `视觉风格：${style.illustrationPrompt}。`,
        `对应小节：${anchor.title}。`,
        `该段要点：${related}。`,
        illustrationRequirement ? `插图需求：${illustrationRequirement}。` : '',
        `画面比例 16:9 横向，主体居中偏一侧，为正文文字留出空间，不含文字。`,
      ]
        .filter(Boolean)
        .join(''),
      checklist: ['比例 16:9', '不含文字', '与封面同一视觉语言'],
      status: draft.assets?.illustrations?.[`illustration-${position + 1}`] ? 'rendered' : 'pending',
    });
  });

  return { cover, illustrations, styleName: style.name };
}

/**
 * @param {{ ratio: string, pixels: string }} spec
 * @returns {string}
 */
function specPixels(spec) {
  return spec.pixels;
}

/* ------------------------------------------------------------------ *
 * Duplicate detection against the previous article
 * ------------------------------------------------------------------ */

/**
 * @param {string} text
 * @returns {Set<string>}
 */
function shingles(text, size) {
  const normalized = String(text ?? '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
  const set = new Set();
  if (normalized.length === 0) return set;
  if (normalized.length < size) {
    set.add(normalized);
    return set;
  }
  for (let i = 0; i <= normalized.length - size; i += 1) {
    set.add(normalized.slice(i, i + size));
  }
  return set;
}

/**
 * @param {Set<string>} a
 * @param {Set<string>} b
 * @returns {number}
 */
function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * @param {any} left
 * @param {any} right
 * @returns {{ score: number, title: number, body: number, key: number }}
 */
function similarity(left, right) {
  const title = jaccard(shingles(`${left.title ?? ''} ${left.topic ?? ''}`, 2), shingles(`${right.title ?? ''} ${right.topic ?? ''}`, 2));
  const body = jaccard(shingles(left.body ?? '', 3), shingles(right.body ?? '', 3));
  const leftKey = new Set(keyPoints(left.body ?? '', 4));
  const rightKey = new Set(keyPoints(right.body ?? '', 4));
  let shared = 0;
  for (const item of leftKey) if (rightKey.has(item)) shared += 1;
  const key = leftKey.size === 0 || rightKey.size === 0 ? 0 : shared / Math.min(leftKey.size, rightKey.size);
  const score = title * 0.35 + body * 0.5 + key * 0.15;
  return { score: Math.round(score * 1000) / 10, title: Math.round(title * 100), body: Math.round(body * 100), key: Math.round(key * 100) };
}

/**
 * @param {any} draft
 * @param {any[]} allDrafts
 * @returns {{ score: number, verdict: string, tone: string, compared: any[] }}
 */
export function checkDuplicate(draft, allDrafts) {
  const others = allDrafts.filter(
    (item) => item.id !== draft.id && item.articleId !== draft.articleId && String(item.body ?? '').trim(),
  );
  const published = others
    .filter((item) => item.status === 'published_api' || item.status === 'published_manual')
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const recentDrafts = others
    .filter((item) => item.status !== 'published_api' && item.status !== 'published_manual')
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

  /** @type {any[]} */
  const compared = [];
  const push = (/** @type {any} */ item, /** @type {string} */ relation) => {
    if (!item) return;
    const sim = similarity(draft, item);
    compared.push({
      id: item.id,
      articleId: item.articleId,
      version: item.version,
      title: item.title || item.topic || '(未命名)',
      status: item.status,
      relation,
      score: sim.score,
      detail: `标题重合 ${sim.title}% · 正文重合 ${sim.body}% · 要点重合 ${sim.key}%`,
    });
  };

  push(published[0], '上一篇已发布文章');
  push(recentDrafts[0], '上一条草稿');

  if (compared.length === 0) {
    return {
      score: 0,
      verdict: '没有可比对的历史文章',
      tone: 'neutral',
      compared: [],
    };
  }

  const top = compared.slice().sort((a, b) => b.score - a.score)[0];
  const score = top.score;
  let verdict = '与上一篇基本不重复';
  let tone = 'ok';
  if (score >= 65) {
    verdict = '与上一篇高度重复，建议更换切入点或素材';
    tone = 'danger';
  } else if (score >= 35) {
    verdict = '与上一篇存在部分重合，建议补充新内容';
    tone = 'warn';
  }
  return { score, verdict, tone, compared: compared.sort((a, b) => b.score - a.score) };
}

/* ------------------------------------------------------------------ *
 * Publish-ready export (公众号 editor friendly, inline styles only)
 * ------------------------------------------------------------------ */

/**
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {string} text
 * @returns {string}
 */
function inlineEmphasis(text) {
  return escapeHtml(text).replace(/\*\*([^*]+)\*\*/g, '<strong style="font-weight:600;color:$ACCENT">$1</strong>');
}

/**
 * @param {any} style
 * @returns {Record<string, string>}
 */
function bodyTokens(style) {
  const palette = style.palette || ['#1f2328', '#5b6470', '#e8eaed'];
  const accent = palette[1] || '#2563eb';
  const text = palette[0] || '#1f2328';
  const muted = palette[2] || '#e8eaed';
  const density = style.bodyStyle === 'dense'
    ? { size: '15px', line: '1.8', gap: '20px' }
    : style.bodyStyle === 'airy'
      ? { size: '16px', line: '1.9', gap: '26px' }
      : { size: '16px', line: '1.75', gap: '22px' };
  return {
    ACCENT: accent,
    TEXT: text,
    MUTED: muted,
    size: density.size,
    line: density.line,
    gap: density.gap,
  };
}

/**
 * Build the standalone, copy-pasteable 公众号 body HTML.
 *
 * 公众号 strips <style> blocks and class selectors, so every rule is inline.
 * Images are embedded as data URIs so the exported file is self-contained.
 *
 * @param {any} draft
 * @param {any} style
 * @param {Map<string, { mime: string, dataUri: string }>} assetData
 * @returns {string}
 */
export function toWeChatHtml(draft, style, assetData) {
  const tokens = bodyTokens(style);
  const blocks = parseBlocks(String(draft.body ?? ''));
  const parts = [];

  parts.push(
    `<section style="font-size:${tokens.size};line-height:${tokens.line};color:${tokens.TEXT};letter-spacing:0.4px;word-break:break-word;">`,
  );

  const cover = assetData?.get('cover');
  if (cover) {
    parts.push(
      `<img src="${cover.dataUri}" alt="封面图" style="width:100%;max-width:100%;border-radius:4px;display:block;margin:0 0 ${tokens.gap} 0;" />`,
    );
  }

  for (const block of blocks) {
    if (block.type === 'h1') {
      parts.push(
        `<h1 style="font-size:22px;line-height:1.5;font-weight:600;color:${tokens.TEXT};margin:0 0 14px 0;">${inlineEmphasis(block.text)}</h1>`,
      );
    } else if (block.type === 'h2') {
      parts.push(
        `<h2 style="font-size:18px;line-height:1.6;font-weight:600;color:${tokens.TEXT};margin:${tokens.gap} 0 14px 0;padding-left:10px;border-left:3px solid ${tokens.ACCENT};">${inlineEmphasis(block.text)}</h2>`,
      );
    } else if (block.type === 'h3') {
      parts.push(
        `<h3 style="font-size:16px;line-height:1.7;font-weight:600;color:${tokens.TEXT};margin:${tokens.gap} 0 10px 0;">${inlineEmphasis(block.text)}</h3>`,
      );
    } else if (block.type === 'quote') {
      parts.push(
        `<blockquote style="margin:0 0 ${tokens.gap} 0;padding:12px 14px;border-left:3px solid ${tokens.ACCENT};background:${tokens.MUTED};color:${tokens.TEXT};font-size:15px;line-height:1.8;">${inlineEmphasis(block.text)}</blockquote>`,
      );
    } else if (block.type === 'li') {
      const items = block.items
        .map((item) => `<li style="margin:0 0 8px 0;line-height:${tokens.line};">${inlineEmphasis(item)}</li>`)
        .join('');
      parts.push(`<ul style="margin:0 0 ${tokens.gap} 0;padding-left:22px;font-size:${tokens.size};">${items}</ul>`);
    } else {
      parts.push(
        `<p style="margin:0 0 ${tokens.gap} 0;line-height:${tokens.line};font-size:${tokens.size};">${inlineEmphasis(block.text)}</p>`,
      );
    }

    // An illustration is attached to the H2 that introduced it.
    if (block.type === 'h2') {
      const index = blocks.filter((b) => b.type === 'h2').indexOf(block);
      const slotId = `illustration-${index + 1}`;
      const asset = assetData?.get(slotId);
      if (asset) {
        parts.push(
          `<img src="${asset.dataUri}" alt="${escapeHtml(block.text)}" style="width:100%;max-width:100%;border-radius:4px;display:block;margin:0 0 ${tokens.gap} 0;" />`,
        );
      }
    }
  }

  parts.push('</section>');
  return parts.join('');
}

/**
 * @param {any} draft
 * @param {any} style
 * @param {Map<string, { mime: string, dataUri: string }>} assetData
 * @returns {string}
 */
export function toStandaloneHtml(draft, style, assetData) {
  const title = escapeHtml(draft.title || draft.topic || '未命名文章');
  const digest = escapeHtml(draft.derived?.digest || '');
  const body = toWeChatHtml(draft, style, assetData);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
</head>
<body style="margin:0;padding:24px;background:#f5f5f5;">
<article style="max-width:677px;margin:0 auto;padding:24px;background:#ffffff;border-radius:8px;">
<h1 style="font-size:24px;line-height:1.5;font-weight:600;margin:0 0 8px 0;color:${style.palette?.[0] || '#1f2328'};">${title}</h1>
${digest ? `<p style="font-size:14px;line-height:1.7;color:${style.palette?.[1] || '#5b6470'};margin:0 0 20px 0;">${digest}</p>` : ''}
${body}
</article>
</body>
</html>
`;
}
