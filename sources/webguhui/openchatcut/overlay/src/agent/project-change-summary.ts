import type { ProjectDoc } from '../editor/types';

/** 返回有限的结构化差异，让 Agent 能看到读取工程后发生的外部修改。 */
export function projectChangeSummary(before: ProjectDoc, after: ProjectDoc) {
  const changes: Array<{ path: string; before: unknown; after: unknown }> = [];
  let truncated = false;
  const preview = (value: unknown): unknown => {
    const text = JSON.stringify(value);
    return text && text.length > 400 ? `${text.slice(0, 400)}…` : value ?? null;
  };
  function visit(left: unknown, right: unknown, path: string): void {
    if (JSON.stringify(left) === JSON.stringify(right)) return;
    if (changes.length >= 50) { truncated = true; return; }
    if (left && right && typeof left === 'object' && typeof right === 'object'
      && !Array.isArray(left) && !Array.isArray(right)) {
      const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) visit(a[key], b[key], `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`);
      return;
    }
    // 数组按位置比较，保留明确的 JSON 路径；增删和重排不会被隐藏。
    if (Array.isArray(left) && Array.isArray(right)) {
      for (let i = 0; i < Math.max(left.length, right.length); i++) visit(left[i], right[i], `${path}/${i}`);
      return;
    }
    changes.push({ path, before: preview(left), after: preview(right) });
  }
  visit(before, after, '');
  return { changes, truncated };
}
