export function createReport() {
  const diagnostics = [];
  const push = (level) => (code, message, path) => {
    diagnostics.push(path === undefined ? { level, code, message } : { level, code, message, path });
  };
  return { diagnostics, error: push('error'), warning: push('warning') };
}

export function hasErrors(diagnostics) {
  return diagnostics.some((d) => d.level === 'error');
}

export function formatReport(label, diagnostics) {
  if (diagnostics.length === 0) return `${label}: OK`;
  const errors = diagnostics.filter((d) => d.level === 'error').length;
  const warnings = diagnostics.length - errors;
  const lines = [`${label}: ${errors} ${errors === 1 ? 'error' : 'errors'}, ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`];
  for (const d of diagnostics) {
    lines.push(`  ${d.level} ${d.code} ${d.message}${d.path ? ` (${d.path})` : ''}`);
  }
  return lines.join('\n');
}
