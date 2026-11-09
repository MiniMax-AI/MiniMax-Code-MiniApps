import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { auditHtmlPage, auditSiteExtras } from './audit.mjs';
import { discoverHtmlFiles, readHtmlFile } from './discover.mjs';
import { firstTagInner, metaContent, stripScriptsAndStyles } from './html.mjs';
import { buildFixPrompt, buildSummaryPrompt } from './prompts.mjs';
import { PathError, assertProjectRoot } from './paths.mjs';

/**
 * @param {string} rootInput
 * @param {{ signal?: AbortSignal, home?: string, minimaxDataDir?: string }} [options]
 */
export async function scanProject(rootInput, options = {}) {
  const root = await assertProjectRoot(rootInput, options);
  const discovered = await discoverHtmlFiles(root, { signal: options.signal });
  /** @type {import('./audit.mjs').Finding[]} */
  const findings = [];
  /** @type {{ relative: string, bytes: number, skipped: string, title?: string, description?: string }[]} */
  const pages = [];

  for (const file of discovered.files) {
    if (options.signal?.aborted) throw new PathError('aborted', 'The scan was cancelled.');
    const page = await readHtmlFile(root, file);
    const cleaned = page.skipped ? '' : stripScriptsAndStyles(page.html);
    const title = page.skipped ? '' : firstTagInner(cleaned, 'title');
    const description = page.skipped ? '' : metaContent(cleaned, 'description');
    pages.push({
      relative: page.relative,
      bytes: page.bytes,
      skipped: page.skipped,
      title,
      description,
    });
    findings.push(...auditHtmlPage(page));
  }

  const siteFiles = await readSiteFiles(root);
  findings.push(
    ...auditSiteExtras({
      root,
      pages: pages.filter((page) => !page.skipped),
      siteFiles,
    }),
  );

  findings.sort((a, b) => {
    const severity = Number(a.severity === 'warning') - Number(b.severity === 'warning');
    if (severity !== 0) return severity;
    return a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule);
  });

  const report = {
    root,
    scannedAt: new Date().toISOString(),
    filesScanned: pages.filter((page) => !page.skipped).length,
    filesSkipped: pages.filter((page) => page.skipped).length,
    truncated: discovered.truncated,
    skippedDirs: discovered.skipped,
    siteFiles: {
      robotsTxt: Boolean(siteFiles.robotsTxt),
      sitemapXml: Boolean(siteFiles.sitemapXml),
    },
    pages,
    findings,
    counts: {
      error: findings.filter((item) => item.severity === 'error').length,
      warning: findings.filter((item) => item.severity === 'warning').length,
      seo: findings.filter((item) => item.category === 'seo').length,
      accessibility: findings.filter((item) => item.category === 'accessibility').length,
      document: findings.filter((item) => item.category === 'document').length,
    },
  };

  return report;
}

/** @param {string} root */
async function readSiteFiles(root) {
  return {
    robotsTxt: await readOptional(path.join(root, 'robots.txt')),
    sitemapXml:
      (await readOptional(path.join(root, 'sitemap.xml'))) ||
      (await readOptional(path.join(root, 'sitemap_index.xml'))),
  };
}

/** @param {string} filePath */
async function readOptional(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * @param {Awaited<ReturnType<typeof scanProject>>} report
 * @param {string} findingId
 */
export function promptForFinding(report, findingId) {
  const finding = report.findings.find((item) => item.id === findingId);
  if (!finding) throw new PathError('finding_missing', 'That finding is not in the latest scan.');
  return buildFixPrompt(finding, { root: report.root });
}

/**
 * @param {Awaited<ReturnType<typeof scanProject>>} report
 */
export function promptForSummary(report) {
  return buildSummaryPrompt(report);
}

export { PathError, assertProjectRoot };
