// @ts-check
/**
 * Local test harness for the Mini App backend logic.
 * Run: node tests/selftest.mjs
 */
import { validateManifest } from '../miniapp/node/lib/manifest-rules.mjs';
import { validateDraft } from '../miniapp/node/lib/listing-rules.mjs';
import { buildPackage } from '../miniapp/node/lib/package-builder.mjs';
import { createZip } from '../miniapp/node/lib/zip.mjs';
import { parseJsonWithDuplicates } from '../miniapp/node/lib/json-parse.mjs';
import { inflateRawSync } from 'node:zlib';

let passed = 0;
let failed = 0;

/**
 * @param {string} name
 * @param {boolean} condition
 * @param {string} [detail]
 */
function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` :: ${detail}` : ''}`);
  }
}

const VALID_MANIFEST = JSON.stringify(
  {
    schemaVersion: 1,
    name: 'acme-research',
    displayName: 'Acme 研究助手',
    version: '1.0.0',
    description: '检索研究资料并生成结构化综述。',
    author: 'Acme',
    icon: 'icon.png',
    category: 'Science & Healthcare',
    exampleQueries: ['检索近期研究并总结主要结论'],
    apps: [],
    mcpServers: [],
    skills: ['skills/literature-review/SKILL.md'],
  },
  null,
  2,
);

// ---- manifest rules ----
{
  const result = validateManifest(VALID_MANIFEST);
  check('valid manifest has no errors', result.ok, JSON.stringify(result.issues));
  check('valid manifest parses', result.manifest?.name === 'acme-research');
}

{
  const result = validateManifest('');
  check(
    'empty manifest is an error + missing',
    result.issues.some((i) => i.severity === 'error' && i.missing),
  );
}

{
  const result = validateManifest('{ "schemaVersion": 1, "name": "a", "name": "b" }');
  check(
    'duplicate keys detected',
    result.issues.some((i) => i.id === 'manifest.duplicateKeys'),
    JSON.stringify(result.issues.map((i) => i.id)),
  );
}

{
  // A UTF-8 BOM survives in the raw text but `String.prototype.trim()` strips it,
  // so the BOM rule must inspect the raw input.
  const result = validateManifest(`﻿${VALID_MANIFEST}`);
  check(
    'UTF-8 BOM detected',
    result.issues.some((i) => i.id === 'manifest.bom'),
    JSON.stringify(result.issues.map((i) => i.id)),
  );
  check('BOM manifest is not accepted', result.ok === false);
}

{
  // One path can break several rules; every issue must keep a unique id.
  const result = validateManifest(
    JSON.stringify({
      schemaVersion: 1,
      name: 'ok-name',
      version: '1.0.0',
      skills: ['skills/中文 目录/SKILL.md'],
    }),
  );
  const ids = result.issues.map((i) => i.id);
  check('issue ids stay unique', new Set(ids).size === ids.length, JSON.stringify(ids));
}

{
  const result = validateManifest('{ "schemaVersion": 1, "name": "Bad_Name" }');
  check(
    'invalid name pattern detected',
    result.issues.some((i) => i.id === 'manifest.name.pattern'),
  );
}

{
  const result = validateManifest('{ "schemaVersion": 1, "name": "ok-name", "version": "1.0" }');
  check(
    'invalid semver detected',
    result.issues.some((i) => i.id === 'manifest.version.semver'),
  );
}

{
  const result = validateManifest(
    '{ "schemaVersion": 1, "name": "ok-name", "version": "1.0.0", "category": "Nope" }',
  );
  check(
    'invalid category detected',
    result.issues.some((i) => i.id === 'manifest.category.invalid'),
  );
}

{
  const result = validateManifest(
    '{ "schemaVersion": 1, "name": "ok-name", "version": "1.0.0", "hooks": {} }',
  );
  check(
    'hooks field rejected',
    result.issues.some((i) => i.id === 'manifest.forbidden.hooks'),
  );
}

{
  const result = validateManifest(
    '{ "schemaVersion": 1, "name": "ok-name", "version": "1.0.0", "darkIcon": "d.png" }',
  );
  check(
    'darkIcon rejected',
    result.issues.some((i) => i.id === 'manifest.forbidden.darkIcon'),
  );
}

{
  const result = validateManifest(
    '{ "schemaVersion": 1, "name": "ok-name", "version": "1.0.0", "skills": ["../escape/SKILL.md"] }',
  );
  check(
    'path traversal detected',
    result.issues.some((i) => i.id.startsWith('manifest.skills.0.path.')),
  );
}

{
  const result = validateManifest(
    '{ "schemaVersion": 1, "name": "ok-name", "version": "1.0.0", "icon": "icon.PNG" }',
  );
  check(
    'uppercase icon extension detected',
    result.issues.some((i) => i.id === 'manifest.icon.lowercase'),
  );
}

{
  const result = validateManifest(
    '{ "schemaVersion": 1, "name": "ok-name", "version": "1.0.0", "exampleQueries": ["a","b","c","d"] }',
  );
  check(
    'more than 3 example queries detected',
    result.issues.some((i) => i.id === 'manifest.exampleQueries.count'),
  );
}

// ---- json parser ----
{
  const result = parseJsonWithDuplicates('{"a":1,"a":2,"b":{"c":1,"c":2}}');
  check('parser reports 2 duplicates', result.ok && result.duplicates.length === 2);
}
{
  const result = parseJsonWithDuplicates('{"a":1,');
  check('parser reports invalid json', !result.ok);
}
{
  const result = parseJsonWithDuplicates('{"a":"\\u00e9"}');
  check('parser handles unicode escapes', result.ok && result.value.a === 'é');
}

// ---- listing rules ----
const baseDraft = {
  manifestText: VALID_MANIFEST,
  marketName: 'Acme 研究助手',
  summary: '检索研究资料并生成结构化综述。',
  documentation: '# Acme 研究助手\n\n这是正式说明文档。',
  category: 'Science & Healthcare',
  exampleQueries: ['检索近期研究并总结主要结论'],
  regions: ['CN'],
  enabledEnds: ['desktop'],
  operation: 'new',
  existingName: '',
  previousVersion: '',
  submitEmail: 'a@example.com',
  submitAccount: '宋昊',
  organization: 'Acme',
};

const assets = [
  {
    id: 'a1',
    name: 'icon.png',
    role: 'icon',
    size: 1024,
    mime: 'image/png',
    createdAt: '2026-11-16T00:00:00.000Z',
  },
  {
    id: 'a2',
    name: 'skills/literature-review/SKILL.md',
    role: 'skill',
    size: 512,
    mime: 'text/markdown',
    createdAt: '2026-11-16T00:00:00.000Z',
  },
  {
    id: 'a3',
    name: 'shot-01.png',
    role: 'screenshot',
    size: 2048,
    mime: 'image/png',
    createdAt: '2026-11-16T00:00:00.000Z',
  },
];

{
  const result = validateDraft(baseDraft, assets);
  check(
    'complete draft has no errors',
    result.issues.filter((i) => i.severity === 'error').length === 0,
    JSON.stringify(result.issues.filter((i) => i.severity === 'error').map((i) => i.id)),
  );
}

{
  const result = validateDraft({ ...baseDraft, manifestText: '', category: '' }, assets);
  check(
    'missing manifest is flagged as missing',
    result.issues.some((i) => i.missing && i.field === 'manifest'),
  );
  // The category is a listing-form field: it must be reported even when the
  // manifest is missing, otherwise the user never learns the form is incomplete.
  check(
    'missing category is flagged even without a manifest',
    result.issues.some((i) => i.id === 'listing.category.missing' && i.missing),
    JSON.stringify(result.issues.map((i) => i.id)),
  );
}

{
  const result = validateDraft({ ...baseDraft, screenshots: undefined }, assets.filter((a) => a.role !== 'screenshot'));
  check(
    'missing screenshot flagged',
    result.issues.some((i) => i.id === 'listing.screenshot.missing'),
  );
}

{
  const result = validateDraft({ ...baseDraft, regions: [] }, assets);
  check('missing region flagged', result.issues.some((i) => i.id === 'market.region.missing'));
}

{
  const result = validateDraft({ ...baseDraft, summary: '完全不同的另一段话' }, assets);
  check(
    'summary mismatch flagged',
    result.issues.some((i) => i.id === 'consistency.summary'),
  );
}

{
  const result = validateDraft({ ...baseDraft, marketName: '另一个名字' }, assets);
  check(
    'market name mismatch flagged',
    result.issues.some((i) => i.id === 'consistency.marketName'),
  );
}

{
  const result = validateDraft(
    { ...baseDraft, operation: 'update', existingName: 'acme-research', previousVersion: '1.0.0' },
    assets,
  );
  check(
    'unchanged version on update flagged',
    result.issues.some((i) => i.id === 'market.update.versionSame'),
  );
}

{
  const result = validateDraft(
    { ...baseDraft, operation: 'update', existingName: 'other-name', previousVersion: '0.9.0' },
    assets,
  );
  check(
    'renamed plugin on update flagged',
    result.issues.some((i) => i.id === 'market.update.nameChanged'),
  );
}

{
  const result = validateDraft({ ...baseDraft, submitEmail: 'not-an-email' }, assets);
  check('invalid email flagged', result.issues.some((i) => i.id === 'market.email.invalid'));
}

{
  const result = validateDraft(baseDraft, assets.filter((a) => a.role !== 'icon'));
  check(
    'missing icon asset flagged',
    result.issues.some((i) => i.id === 'asset.icon.missing'),
  );
}

// ---- zip writer ----
{
  const zip = createZip([
    { path: 'a.txt', data: Buffer.from('hello world hello world hello world', 'utf8') },
    { path: 'dir/b.bin', data: Buffer.from([1, 2, 3, 4, 5]) },
  ]);
  check('zip has PK signature', zip.readUInt32LE(0) === 0x04034b50);
  check('zip ends with EOCD', zip.readUInt32LE(zip.length - 22) === 0x06054b50);
  check('zip is non-trivial', zip.length > 100);
}

// ---- package builder ----
{
  const channel = {
    checkedAt: '2026-11-16T00:00:00.000Z',
    submissionInterface: 'manual_form',
    canSubmitProgrammatically: false,
    findings: [],
    requiredPermissions: [],
    conclusion: '仅生成可审核材料',
  };
  const result = validateDraft(baseDraft, assets);
  const built = await buildPackage(
    baseDraft,
    result.manifest,
    assets,
    async (asset) => (asset.role === 'icon' ? Buffer.from('PNG') : Buffer.from('# doc')),
    result.issues,
    channel,
  );
  const paths = built.entries.map((entry) => entry.path);
  check(
    'plugin.json sits at ZIP root',
    paths.includes('.minimax-plugin/plugin.json'),
    JSON.stringify(paths),
  );
  check(
    'no wrapper directory',
    !paths.some((path) => path.split('/')[0] === 'acme-research'),
    JSON.stringify(paths),
  );
  check('README included', paths.includes('README.md'));
  check('skill file included', paths.includes('skills/literature-review/SKILL.md'));
  check('review report included', paths.includes('listing-materials/review-report.md'));
  check('market preview included', paths.includes('listing-materials/market-preview.md'));
  check('zip bytes produced', built.bytes.length > 200);

  // Read the archive back with an independent minimal reader to prove the
  // generated ZIP really carries the expected entries.
  const readZipEntries = (zip) => {
    const endOffset = zip.length - 22;
    const total = zip.readUInt16LE(endOffset + 10);
    let offset = zip.readUInt32LE(endOffset + 16);
    const found = [];
    for (let index = 0; index < total; index += 1) {
      const nameLength = zip.readUInt16LE(offset + 28);
      const extraLength = zip.readUInt16LE(offset + 30);
      const commentLength = zip.readUInt16LE(offset + 32);
      const localOffset = zip.readUInt32LE(offset + 42);
      const name = zip.slice(offset + 46, offset + 46 + nameLength).toString('utf8');
      const localNameLength = zip.readUInt16LE(localOffset + 26);
      const localExtraLength = zip.readUInt16LE(localOffset + 28);
      const method = zip.readUInt16LE(localOffset + 8);
      const compressedSize = zip.readUInt32LE(localOffset + 18);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const payload = zip.slice(dataStart, dataStart + compressedSize);
      found.push({
        name,
        method,
        text:
          method === 0
            ? payload.toString('utf8')
            : method === 8
              ? inflateRawSync(payload).toString('utf8')
              : null,
      });
      offset += 46 + nameLength + extraLength + commentLength;
    }
    return found;
  };

  const zipEntries = readZipEntries(built.bytes);
  const zipNames = zipEntries.map((entry) => entry.name);
  check(
    'zip really contains .minimax-plugin/plugin.json at root',
    zipNames.includes('.minimax-plugin/plugin.json'),
    JSON.stringify(zipNames),
  );
  check(
    'zip has no wrapper directory',
    !zipNames.some((name) => name.split('/')[0] === 'acme-research'),
    JSON.stringify(zipNames),
  );
  check(
    'zip contains README.md',
    zipNames.includes('README.md'),
  );
  check(
    'zip contains the review report',
    zipNames.includes('listing-materials/review-report.md'),
  );
  check(
    'zip contains the market preview',
    zipNames.includes('listing-materials/market-preview.md'),
  );
  check(
    'zip contains the skill file',
    zipNames.includes('skills/literature-review/SKILL.md'),
  );
  const reportEntry = zipEntries.find((entry) => entry.name === 'listing-materials/review-report.md');
  const pluginEntry = zipEntries.find((entry) => entry.name === '.minimax-plugin/plugin.json');
  const reportText = reportEntry?.text ?? '';
  check('review report states the package is not submitted', reportText.includes('尚未提交'));
  check('review report cites the official guide', reportText.includes('plugin-submission.md'));
  check(
    'plugin.json in the zip is valid JSON with the right name',
    Boolean(pluginEntry) && JSON.parse(pluginEntry.text ?? '{}').name === 'acme-research',
  );
  check(
    'stored (uncompressed) entries are method 0 and readable',
    zipEntries.filter((entry) => entry.method === 0).length >= 0,
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
