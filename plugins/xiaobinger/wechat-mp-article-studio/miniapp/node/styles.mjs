// @ts-check

/**
 * Visual style presets.
 *
 * A style is a reusable description of *how an article should look*: the
 * prompt fragments used for the cover and the illustrations, plus the palette
 * and tone the exported HTML is styled with. Built-in styles are read-only;
 * the user can create their own from the style library screen.
 */

/** @typedef {{ id: string, name: string, builtin: boolean, tone: string, palette: string[], coverPrompt: string, illustrationPrompt: string, bodyStyle: 'airy'|'dense'|'classic' }} Style */

/** @type {Style[]} */
export const BUILTIN_STYLES = [
  {
    id: 'style-minimal',
    name: '简约杂志',
    builtin: true,
    tone: '留白克制、细线条、浅色底，适合观点与深度长文',
    palette: ['#1f2328', '#5b6470', '#e8eaed'],
    coverPrompt:
      '极简杂志封面风，大面积纯净留白，一处清晰的主体物，柔和均匀的漫射光，无多余装饰',
    illustrationPrompt:
      '极简编辑插画风，细线条勾勒，少量平涂色块，大面积留白，无文字',
    bodyStyle: 'airy',
  },
  {
    id: 'style-chinese',
    name: '国风文艺',
    builtin: true,
    tone: '水墨与宣纸质感、暖褐与青灰，适合文化与人文主题',
    palette: ['#3a342c', '#8a6a4b', '#e6ddcc'],
    coverPrompt:
      '中国水墨写意画面，留白与墨色层次自然晕染，宣纸质感，暖褐与青灰色调，含蓄的东方意境',
    illustrationPrompt:
      '淡彩水墨插画，笔触松弛，宣纸底色，色调克制，元素简练',
    bodyStyle: 'classic',
  },
  {
    id: 'style-tech',
    name: '科技商务',
    builtin: true,
    tone: '深蓝与高对比、几何结构感，适合行业分析与企业内容',
    palette: ['#0f172a', '#2563eb', '#e2e8f0'],
    coverPrompt:
      '科技商务主视觉，深蓝冷色调，几何结构与数据感构图，干净的渐层，金属与玻璃质感，高对比布光',
    illustrationPrompt:
      '扁平科技信息图风，几何图形与细线网格，冷蓝主色配少量亮色点缀，结构清晰',
    bodyStyle: 'dense',
  },
  {
    id: 'style-handdrawn',
    name: '手绘插画',
    builtin: true,
    tone: '手绘笔触、暖色系，适合亲和生活类内容',
    palette: ['#3f3a34', '#d97706', '#fde9d0'],
    coverPrompt:
      '手绘插画封面，松弛的线条与水彩笔触，暖橙与米色调，画面亲切有故事感',
    illustrationPrompt:
      '手绘小插画，线条简洁，暖色水彩填充，风格统一，略带纸张颗粒',
    bodyStyle: 'airy',
  },
  {
    id: 'style-photo',
    name: '摄影纪实',
    builtin: true,
    tone: '真实光线与环境质感，适合人物与现场报道',
    palette: ['#1c1917', '#78716c', '#f5f5f4'],
    coverPrompt:
      '纪实摄影风格，自然光，真实环境质感，浅景深，胶片颗粒感，避免摆拍痕迹',
    illustrationPrompt:
      '纪实照片风格，自然光与真实场景，画面克制，避免刻意构图',
    bodyStyle: 'classic',
  },
  {
    id: 'style-dark',
    name: '暗色高级',
    builtin: true,
    tone: '深色底与金属光，适合品牌与观点类内容',
    palette: ['#0a0a0a', '#b0b0b0', '#1f1f1f'],
    coverPrompt:
      '暗色高级质感主视觉，深黑背景，单一光源打在主体上形成戏剧性轮廓光，冷调金属反光',
    illustrationPrompt:
      '暗色系高级插画，深底强对比，单点光源，质感细腻',
    bodyStyle: 'dense',
  },
];

/**
 * @param {string} id
 * @param {Style[]} styles
 * @returns {Style}
 */
export function findStyle(id, styles) {
  const found = styles.find((style) => style.id === id);
  if (found) return found;
  const fallback = styles[0];
  if (!fallback) throw new Error('style_library_empty');
  return fallback;
}
