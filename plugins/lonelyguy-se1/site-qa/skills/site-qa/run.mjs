#!/usr/bin/env node
// Headless Site QA for the Agent skill. Prints a markdown report to stdout.

import { scanProject } from '../../miniapp/node/scan.mjs';

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const pathArg = args.find((item) => item !== '--json');
  if (!pathArg) {
    process.stderr.write('Usage: node cli.mjs <site-root> [--json]\n');
    process.exit(2);
  }

  try {
    const report = await scanProject(pathArg);
    if (json) {
      process.stdout.write(`${JSON.stringify(publicReport(report))}\n`);
      return;
    }
    process.stdout.write(`${formatMarkdown(report)}\n`);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : 'scan_failed';
    const message = error instanceof Error ? error.message : 'Scan failed.';
    process.stderr.write(`${code}: ${message}\n`);
    process.exit(1);
  }
}

/** @param {Awaited<ReturnType<typeof scanProject>>} report */
function publicReport(report) {
  return {
    root: report.root,
    scannedAt: report.scannedAt,
    filesScanned: report.filesScanned,
    counts: report.counts,
    siteFiles: report.siteFiles,
    findings: report.findings,
  };
}

/** @param {Awaited<ReturnType<typeof scanProject>>} report */
function formatMarkdown(report) {
  const lines = [
    '# Site QA report',
    '',
    `Root: \`${report.root}\``,
    `HTML files: ${report.filesScanned}`,
    `Errors: ${report.counts.error} · Warnings: ${report.counts.warning} · SEO: ${report.counts.seo} · A11y: ${report.counts.accessibility}`,
    '',
  ];
  if (report.findings.length === 0) {
    lines.push('No automated findings.');
    return lines.join('\n');
  }
  lines.push('## Findings');
  for (const item of report.findings.slice(0, 40)) {
    lines.push(`- **[${item.severity}]** ${item.file}: ${item.message} (\`${item.rule}\`)`);
    if (item.detail) lines.push(`  - ${item.detail}`);
  }
  if (report.findings.length > 40) {
    lines.push(`- and ${report.findings.length - 40} more`);
  }
  lines.push(
    '',
    'Fix the highest-impact errors first. Prefer editing the real site source, then re-run this command to verify.',
  );
  return lines.join('\n');
}

await main();
