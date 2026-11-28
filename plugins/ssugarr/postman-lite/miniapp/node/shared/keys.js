/** 键值表操作：前后端共用（params / headers / 表单字段） */

export function createRow(key = '', value = '', enabled = true) {
  return { key, value, enabled };
}

export function enabledRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter(
    (row) => row && row.enabled !== false && String(row.key ?? '').trim() !== '',
  );
}

export function rowsToObject(rows) {
  const out = {};
  for (const row of enabledRows(rows)) {
    out[String(row.key).trim()] = String(row.value ?? '');
  }
  return out;
}

export function rowsToSearchParams(rows) {
  const search = new URLSearchParams();
  for (const row of enabledRows(rows)) {
    search.append(String(row.key).trim(), String(row.value ?? ''));
  }
  return search;
}

export function updateRow(rows, index, patch) {
  const next = [...(rows ?? [])];
  if (index < 0 || index >= next.length) return next;
  next[index] = { ...next[index], ...patch };
  return next;
}

export function removeRow(rows, index) {
  const next = [...(rows ?? [])];
  if (index < 0 || index >= next.length) return next;
  next.splice(index, 1);
  return next;
}

export function appendRow(rows, row = createRow()) {
  return [...(rows ?? []), row];
}

export function toggleRow(rows, index) {
  const next = [...(rows ?? [])];
  if (index < 0 || index >= next.length) return next;
  next[index] = { ...next[index], enabled: next[index].enabled === false };
  return next;
}
