import assert from 'node:assert/strict';
import { test } from 'node:test';

import { auditHtmlPage, auditSiteExtras } from '../miniapp/node/audit.mjs';
import { buildFixPrompt } from '../miniapp/node/prompts.mjs';

test('a bare page fails the core SEO and accessibility checks', () => {
  const findings = auditHtmlPage({
    relative: 'index.html',
    html: '<html><head></head><body><img src="a.png"><a href="#"></a><button></button><input type="text"></body></html>',
  });
  const rules = new Set(findings.map((item) => item.rule));
  for (const rule of [
    'html_lang_missing',
    'viewport_missing',
    'title_missing',
    'meta_description_missing',
    'h1_missing',
    'img_missing_alt',
    'a_empty_href',
    'a_empty_name',
    'button_empty_name',
    'input_missing_label',
  ]) {
    assert.ok(rules.has(rule), `missing ${rule}`);
  }
});

test('a complete page is quiet for required errors', () => {
  const html = `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Launch checklist for Site QA demos</title>
      <meta name="description" content="A deliberately complete page used to verify Site QA stays quiet when the basics are already in place for search and accessibility." />
      <link rel="canonical" href="https://example.com/" />
      <meta property="og:title" content="Launch checklist for Site QA demos" />
      <meta property="og:description" content="A deliberately complete page used to verify Site QA stays quiet when the basics are already in place for search and accessibility." />
      <meta property="og:image" content="https://example.com/cover.png" />
      <meta property="og:url" content="https://example.com/" />
      <meta property="og:type" content="website" />
      <meta name="twitter:card" content="summary_large_image" />
      <link rel="icon" href="/favicon.ico" />
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"Site QA Demo","url":"https://example.com/"}</script>
    </head>
    <body>
      <a href="#main">Skip to content</a>
      <main id="main">
        <h1>Launch checklist</h1>
        <h2>Basics</h2>
        <p>${'Enough visible copy for the homepage so thin-content does not fire. '.repeat(4)}</p>
        <img src="hero.png" alt="Product hero" />
        <a href="/docs">Read the docs</a>
        <button type="button">Save</button>
        <label for="email">Email</label>
        <input id="email" type="email" name="email" />
      </main>
    </body>
  </html>`;
  const findings = auditHtmlPage({ relative: 'index.html', html });
  assert.deepEqual(
    findings.filter((item) => item.severity === 'error').map((item) => item.rule),
    [],
  );
});

test('heading skips, generic links, and duplicate h1 are flagged', () => {
  const findings = auditHtmlPage({
    relative: 'page.html',
    html: `<!doctype html><html lang="en"><head><title>Long enough title here</title><meta name="description" content="A description that is long enough to avoid the short-description warning for this fixture page content." /><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><h1>One</h1><h1>Two</h1><h3>Skipped</h3><a href="/x">click here</a><a href="javascript:void(0)">Open</a></body></html>`,
  });
  const rules = findings.map((item) => item.rule);
  assert.ok(rules.includes('h1_multiple'));
  assert.ok(rules.includes('heading_level_skip'));
  assert.ok(rules.includes('a_generic_text'));
  assert.ok(rules.includes('a_javascript_href'));
});

test('site extras catch missing robots/sitemap and duplicate titles', () => {
  const findings = auditSiteExtras({
    root: '/tmp/demo',
    pages: [
      { relative: 'index.html', title: 'Same Title For Search', description: 'one' },
      { relative: 'about.html', title: 'Same Title For Search', description: 'two' },
    ],
    siteFiles: { robotsTxt: null, sitemapXml: null },
  });
  const rules = new Set(findings.map((item) => item.rule));
  assert.ok(rules.has('robots_txt_missing'));
  assert.ok(rules.has('sitemap_missing'));
  assert.ok(rules.has('title_duplicate'));
});

test('fix prompts name the file and the rule', () => {
  const text = buildFixPrompt(
    {
      rule: 'title_missing',
      severity: 'error',
      category: 'seo',
      file: 'index.html',
      message: 'The page has no <title>.',
      selectorHint: 'title',
    },
    { root: '/tmp/demo' },
  );
  assert.match(text, /index\.html/);
  assert.match(text, /title_missing/);
  assert.match(text, /Do only this item/);
});
