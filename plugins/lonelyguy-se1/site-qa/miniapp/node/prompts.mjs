/**
 * Builds the text placed in the chat draft when the user clicks Fix.
 * The Host confirms before it is appended; the user still presses Send.
 *
 * @param {{
 *   rule: string,
 *   severity: string,
 *   category: string,
 *   file: string,
 *   message: string,
 *   detail?: string,
 *   selectorHint?: string,
 * }} finding
 * @param {{ root: string }} context
 */
export function buildFixPrompt(finding, context) {
  const lines = [
    'Fix this Site QA finding in the current project. Do only this item, then stop.',
    '',
    `Project folder: ${context.root}`,
    `File: ${finding.file}`,
    `Category: ${finding.category}`,
    `Severity: ${finding.severity}`,
    `Rule: ${finding.rule}`,
    `Issue: ${finding.message}`,
  ];
  if (finding.detail) lines.push(`Detail: ${finding.detail}`);
  if (finding.selectorHint) lines.push(`Likely element: ${finding.selectorHint}`);
  lines.push(
    '',
    'Requirements:',
    '- Edit the real source files for this page (not a one-off explanation).',
    '- Keep existing design and copy unless the issue requires a small text change.',
    '- After the change, say which file you edited and how to verify the issue is gone.',
    '- Do not start unrelated refactors.',
  );
  return lines.join('\n');
}

/**
 * @param {{ findings: object[], root: string, filesScanned: number }} report
 */
export function buildSummaryPrompt(report) {
  const errors = report.findings.filter((item) => item.severity === 'error');
  const warnings = report.findings.filter((item) => item.severity === 'warning');
  const top = errors.concat(warnings).slice(0, 8);
  const lines = [
    'I ran Site QA on this project. Please fix the highest-impact issues below.',
    '',
    `Project folder: ${report.root}`,
    `HTML files scanned: ${report.filesScanned}`,
    `Errors: ${errors.length}; warnings: ${warnings.length}`,
    '',
    'Findings to fix:',
  ];
  for (const item of top) {
    lines.push(`- [${item.severity}] ${item.file}: ${item.message} (${item.rule})`);
  }
  if (top.length === 0) lines.push('- None.');
  lines.push(
    '',
    'Start with the errors. Ask me before changing visual design.',
  );
  return lines.join('\n');
}
