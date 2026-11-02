// @ts-check

/**
 * 文本长度与截断的**唯一实现**。
 *
 * 为什么按**码点**算，不按 UTF-16 码元算：
 *
 *  ① emoji 这类字符在 JS 字符串里占**两个**码元（代理对）。
 *     按码元硬切，切点正好落在代理对中间时，会留下一个**孤立代理**（半个代理对）。
 *     浏览器拿到孤立代理会渲染成 U+FFFD 替换字符（黑色菱形问号）——
 *     2026-10-28 在 MCode 面板上实测确认（不是豆腐块）。
 *  ② 「300 字」这个闸门如果一边按码元算、一边按码点算，
 *     就会出现「截断完反而超限、气泡被拒」的新问题。
 *
 * 所以：**长度一律按码点算**（人眼看到的字数），截断也按码点切，
 * 代理对永远不会被劈开。
 *
 * 唯一真源：长度怎么算、截断怎么切，都在这里。
 * `server.mjs` 的截断与 `state.mjs` 的长度闸门都调它，别处不再另写一份。
 */

/**
 * 文本的码点数 —— 人眼看到的字数。
 * @param {unknown} text
 * @returns {number}
 */
export function textLength(text) {
  return Array.from(String(text ?? '')).length;
}

/**
 * 截断到最多 limit 个码点，超了就用省略号收尾。
 *
 * 代理对不会被劈开：切点按码点走，emoji 要么完整留下，要么完整去掉。
 * @param {unknown} text
 * @param {number} [limit]
 * @returns {string}
 */
export function clip(text, limit = 300) {
  const value = String(text ?? '').trim();
  const points = Array.from(value);
  if (points.length <= limit) return value;
  return `${points.slice(0, limit - 1).join('')}…`;
}
