// 事件详情块：执行过程里每条事件展开后看到的结构化内容。
// 后端只负责按 kind 组装，渲染逻辑全部留在前端，避免展示规则散到各个节点里。

export function kv(label, value) {
  if (value === undefined || value === null || value === '') return null;
  return { kind: 'kv', label, value: String(value) };
}

export function text(label, value) {
  if (value === undefined || value === null || value === '') return null;
  return { kind: 'text', label, text: String(value) };
}

export function json(label, value) {
  if (value === undefined || value === null) return null;
  return { kind: 'json', label, value };
}

// items 可以是字符串，也可以是 { text, tag, note }；tag 用于前端上色（pass/fail/warn/...）。
export function list(label, items) {
  const rows = (items || []).filter((item) => item !== undefined && item !== null && item !== '');
  if (!rows.length) return null;
  return {
    kind: 'list',
    label,
    items: rows.map((item) => (typeof item === 'string' ? { text: item } : item)),
  };
}

// 缩略图网格：检索候选、最终选用的参考图都走这个块。
// key 是前端寻址键（cache/xxx.jpg、refs/R1.png），后端只给键不给路径，分享页才能把同一份数据内嵌成 data URL。
export function thumbs(label, items) {
  const rows = (items || []).filter((item) => item && (item.key || item.text || item.title));
  if (!rows.length) return null;
  return { kind: 'thumbs', label: label || '', items: rows };
}

// 子分组，用于「一张图一个块」这类二级结构。
export function group(label, blocks) {
  const inner = (blocks || []).filter(Boolean);
  if (!inner.length) return null;
  return { kind: 'group', label, blocks: inner };
}

// 左右对照：用于「我们送进去的 prompt」vs「服务端改写后的 prompt」。
export function pair(label, leftLabel, leftText, rightLabel, rightText) {
  if (!leftText && !rightText) return null;
  return {
    kind: 'pair',
    label: label || '',
    left: { label: leftLabel, text: String(leftText || '') },
    right: { label: rightLabel, text: String(rightText || '') },
  };
}

export function detail(title, blocks) {
  const inner = (blocks || []).filter(Boolean);
  if (!inner.length) return null;
  return { title: title || '', blocks: inner };
}

export function seconds(ms) {
  return (Math.max(0, Number(ms) || 0) / 1000).toFixed(1) + 's';
}
