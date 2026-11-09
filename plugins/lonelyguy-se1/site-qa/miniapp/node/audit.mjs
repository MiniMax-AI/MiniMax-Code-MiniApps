import {
  accessibleName,
  allMetaContent,
  bodyText,
  collectContainers,
  collectTags,
  documentLang,
  firstTagInner,
  hasCharset,
  hasDoctype,
  hasViewport,
  isAbsoluteHttpUrl,
  isGenericLinkText,
  isNonCrawlableHref,
  jsonLdBlocks,
  looksLikeLang,
  metaContent,
  stripScriptsAndStyles,
} from './html.mjs';

/**
 * @typedef {{
 *   id: string,
 *   rule: string,
 *   severity: 'error' | 'warning',
 *   category: 'seo' | 'accessibility' | 'document',
 *   file: string,
 *   message: string,
 *   detail?: string,
 *   selectorHint?: string,
 * }} Finding
 */

/**
 * Static on-page SEO + accessibility checklist for local HTML.
 * Inspired by Google's SEO starter guide, Lighthouse SEO audits, and
 * WCAG 2.2 Level A/AA items that can be judged from markup alone.
 *
 * @param {{ relative: string, html: string, skipped?: string }} page
 * @returns {Finding[]}
 */
export function auditHtmlPage(page) {
  if (page.skipped === 'too_large') {
    return [
      finding({
        rule: 'file_too_large',
        severity: 'warning',
        category: 'document',
        file: page.relative,
        message: 'This HTML file is larger than 1.5 MB and was skipped.',
      }),
    ];
  }

  const raw = String(page.html ?? '');
  const html = stripScriptsAndStyles(raw);
  const file = page.relative;
  /** @type {Finding[]} */
  const out = [];
  const isHome = /(?:^|\/)index\.html?$/i.test(file);

  if (!hasDoctype(raw)) {
    out.push(
      finding({
        rule: 'doctype_missing',
        severity: 'warning',
        category: 'document',
        file,
        message: 'The document is missing <!DOCTYPE html>.',
        detail: 'Browsers may render in quirks mode without it.',
      }),
    );
  }

  const lang = documentLang(html);
  if (!lang) {
    out.push(
      finding({
        rule: 'html_lang_missing',
        severity: 'error',
        category: 'accessibility',
        file,
        message: 'The <html> element has no lang attribute.',
        selectorHint: 'html',
        detail: 'Add lang="en" or the correct BCP 47 language code.',
      }),
    );
  } else if (!looksLikeLang(lang)) {
    out.push(
      finding({
        rule: 'html_lang_invalid',
        severity: 'warning',
        category: 'accessibility',
        file,
        message: `The lang value "${lang}" does not look like a valid language code.`,
        selectorHint: 'html',
      }),
    );
  }

  if (!hasCharset(html)) {
    out.push(
      finding({
        rule: 'charset_missing',
        severity: 'warning',
        category: 'document',
        file,
        message: 'No character encoding meta tag was found.',
        detail: 'Add <meta charset="utf-8"> early in <head>.',
      }),
    );
  }

  const viewport = metaContent(html, 'viewport');
  if (!viewport) {
    out.push(
      finding({
        rule: 'viewport_missing',
        severity: 'error',
        category: 'seo',
        file,
        message: 'No viewport meta tag was found.',
        detail: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
      }),
    );
  } else if (!/width\s*=\s*device-width/i.test(viewport) && !/initial-scale/i.test(viewport)) {
    out.push(
      finding({
        rule: 'viewport_weak',
        severity: 'warning',
        category: 'seo',
        file,
        message: 'The viewport meta tag is missing width=device-width or initial-scale.',
        detail: viewport,
      }),
    );
  }

  const title = firstTagInner(html, 'title');
  if (!title) {
    out.push(
      finding({
        rule: 'title_missing',
        severity: 'error',
        category: 'seo',
        file,
        message: 'The page has no <title>.',
        selectorHint: 'title',
      }),
    );
  } else {
    if (title.length < 15) {
      out.push(
        finding({
          rule: 'title_too_short',
          severity: 'warning',
          category: 'seo',
          file,
          message: `The title is only ${title.length} characters.`,
          detail: title,
          selectorHint: 'title',
        }),
      );
    } else if (title.length > 60) {
      out.push(
        finding({
          rule: 'title_too_long',
          severity: 'warning',
          category: 'seo',
          file,
          message: `The title is ${title.length} characters (Google often truncates around 50-60).`,
          detail: title,
          selectorHint: 'title',
        }),
      );
    }
    if (/^(untitled|home|page|document|new page)$/i.test(title.trim())) {
      out.push(
        finding({
          rule: 'title_generic',
          severity: 'warning',
          category: 'seo',
          file,
          message: 'The title looks generic and will not stand out in search results.',
          detail: title,
          selectorHint: 'title',
        }),
      );
    }
  }

  const descriptions = allMetaContent(html, 'description');
  const description = descriptions[0] || '';
  if (!description) {
    out.push(
      finding({
        rule: 'meta_description_missing',
        severity: 'error',
        category: 'seo',
        file,
        message: 'No meta description was found.',
        detail: 'Add <meta name="description" content="...">. It drives search snippet CTR.',
      }),
    );
  } else {
    if (descriptions.length > 1) {
      out.push(
        finding({
          rule: 'meta_description_multiple',
          severity: 'warning',
          category: 'seo',
          file,
          message: `Found ${descriptions.length} meta description tags.`,
          detail: 'Keep a single clear description per page.',
        }),
      );
    }
    if (description.length < 70) {
      out.push(
        finding({
          rule: 'meta_description_too_short',
          severity: 'warning',
          category: 'seo',
          file,
          message: `The meta description is only ${description.length} characters.`,
          detail: description,
        }),
      );
    } else if (description.length > 160) {
      out.push(
        finding({
          rule: 'meta_description_too_long',
          severity: 'warning',
          category: 'seo',
          file,
          message: `The meta description is ${description.length} characters (aim for about 120-160).`,
          detail: description,
        }),
      );
    }
  }

  const robots = metaContent(html, 'robots').toLowerCase();
  if (robots && /\bnoindex\b/.test(robots)) {
    out.push(
      finding({
        rule: 'meta_robots_noindex',
        severity: isHome ? 'error' : 'warning',
        category: 'seo',
        file,
        message: 'This page has a robots noindex directive.',
        detail: robots,
      }),
    );
  }
  if (robots && /\bnofollow\b/.test(robots)) {
    out.push(
      finding({
        rule: 'meta_robots_nofollow',
        severity: 'warning',
        category: 'seo',
        file,
        message: 'This page has a robots nofollow directive.',
        detail: robots,
      }),
    );
  }

  const canonicals = collectTags(html, 'link').filter((tag) => /\bcanonical\b/i.test(tag.attrs.rel || ''));
  if (canonicals.length === 0) {
    out.push(
      finding({
        rule: 'canonical_missing',
        severity: 'warning',
        category: 'seo',
        file,
        message: 'No rel=canonical link was found.',
        detail: 'Add <link rel="canonical" href="https://example.com/this-page"> to avoid duplicate URL signals.',
      }),
    );
  } else {
    if (canonicals.length > 1) {
      out.push(
        finding({
          rule: 'canonical_multiple',
          severity: 'warning',
          category: 'seo',
          file,
          message: `Found ${canonicals.length} canonical links.`,
        }),
      );
    }
    const href = (canonicals[0].attrs.href || '').trim();
    if (!href) {
      out.push(
        finding({
          rule: 'canonical_empty',
          severity: 'error',
          category: 'seo',
          file,
          message: 'The canonical link has an empty href.',
        }),
      );
    } else if (!isAbsoluteHttpUrl(href) && !href.startsWith('/')) {
      out.push(
        finding({
          rule: 'canonical_invalid',
          severity: 'warning',
          category: 'seo',
          file,
          message: 'The canonical href should be an absolute URL or a root-relative path.',
          detail: href,
        }),
      );
    }
  }

  for (const link of collectTags(html, 'link')) {
    const hreflang = (link.attrs.hreflang || '').trim();
    if (!hreflang) continue;
    if (hreflang.toLowerCase() !== 'x-default' && !looksLikeLang(hreflang)) {
      out.push(
        finding({
          rule: 'hreflang_invalid',
          severity: 'warning',
          category: 'seo',
          file,
          message: `Invalid hreflang value "${hreflang}".`,
          detail: link.attrs.href || '',
        }),
      );
    }
    if (link.attrs.href && !isAbsoluteHttpUrl(link.attrs.href)) {
      out.push(
        finding({
          rule: 'hreflang_not_absolute',
          severity: 'warning',
          category: 'seo',
          file,
          message: 'hreflang alternate links should use absolute URLs.',
          detail: link.attrs.href,
        }),
      );
    }
  }

  for (const [property, rule, severity] of [
    ['og:title', 'og_title_missing', 'warning'],
    ['og:description', 'og_description_missing', 'warning'],
    ['og:image', 'og_image_missing', 'warning'],
    ['og:url', 'og_url_missing', 'warning'],
    ['og:type', 'og_type_missing', 'warning'],
  ]) {
    if (!metaContent(html, property)) {
      out.push(
        finding({
          rule,
          severity,
          category: 'seo',
          file,
          message: `Missing Open Graph tag ${property}.`,
          detail: `Add <meta property="${property}" content="..."> for social previews.`,
        }),
      );
    }
  }

  const ogImage = metaContent(html, 'og:image');
  if (ogImage && !isAbsoluteHttpUrl(ogImage) && !ogImage.startsWith('/')) {
    out.push(
      finding({
        rule: 'og_image_not_absolute',
        severity: 'warning',
        category: 'seo',
        file,
        message: 'og:image should be an absolute URL for crawlers and chat apps.',
        detail: ogImage,
      }),
    );
  }

  if (!metaContent(html, 'twitter:card')) {
    out.push(
      finding({
        rule: 'twitter_card_missing',
        severity: 'warning',
        category: 'seo',
        file,
        message: 'No twitter:card meta tag was found.',
        detail: 'Add <meta name="twitter:card" content="summary_large_image">.',
      }),
    );
  }

  const ldBlocks = jsonLdBlocks(raw);
  if (ldBlocks.length === 0) {
    out.push(
      finding({
        rule: 'json_ld_missing',
        severity: isHome ? 'warning' : 'warning',
        category: 'seo',
        file,
        message: 'No JSON-LD structured data was found.',
        detail: 'Add a <script type="application/ld+json"> block (Organization, WebSite, Article, FAQ, etc.).',
      }),
    );
  } else {
    for (const block of ldBlocks.slice(0, 5)) {
      try {
        const parsed = JSON.parse(block);
        const nodes = Array.isArray(parsed) ? parsed : parsed['@graph'] ? parsed['@graph'] : [parsed];
        for (const node of nodes) {
          if (!node || typeof node !== 'object') continue;
          if (!node['@type'] && !node['@context']) {
            out.push(
              finding({
                rule: 'json_ld_incomplete',
                severity: 'warning',
                category: 'seo',
                file,
                message: 'A JSON-LD block is missing @type.',
              }),
            );
          }
        }
      } catch {
        out.push(
          finding({
            rule: 'json_ld_invalid',
            severity: 'error',
            category: 'seo',
            file,
            message: 'A JSON-LD block is not valid JSON.',
            detail: block.slice(0, 120),
          }),
        );
      }
    }
  }

  if (!collectTags(html, 'link').some((tag) => /\bicon\b/i.test(tag.attrs.rel || ''))) {
    out.push(
      finding({
        rule: 'favicon_missing',
        severity: 'warning',
        category: 'document',
        file,
        message: 'No favicon link was found.',
        detail: 'Add <link rel="icon" href="/favicon.ico">.',
      }),
    );
  }

  const h1 = collectContainers(html, 'h1');
  if (h1.length === 0) {
    out.push(
      finding({
        rule: 'h1_missing',
        severity: 'error',
        category: 'seo',
        file,
        message: 'The page has no <h1>.',
        selectorHint: 'h1',
      }),
    );
  } else if (h1.length > 1) {
    out.push(
      finding({
        rule: 'h1_multiple',
        severity: 'warning',
        category: 'seo',
        file,
        message: `The page has ${h1.length} <h1> headings.`,
        detail: h1.map((item) => item.inner || '(empty)').slice(0, 5).join(' | '),
        selectorHint: 'h1',
      }),
    );
  } else if (!h1[0].inner) {
    out.push(
      finding({
        rule: 'h1_empty',
        severity: 'error',
        category: 'seo',
        file,
        message: 'The <h1> is empty.',
        selectorHint: 'h1',
      }),
    );
  }

  const ordered = [];
  const headingRe = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let hm;
  while ((hm = headingRe.exec(html))) {
    ordered.push({
      level: Number(hm[1]),
      text: hm[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    });
  }
  let previous = 0;
  for (const heading of ordered) {
    if (!heading.text) {
      out.push(
        finding({
          rule: 'heading_empty',
          severity: 'warning',
          category: 'accessibility',
          file,
          message: `An h${heading.level} heading is empty.`,
          selectorHint: `h${heading.level}`,
        }),
      );
    }
    if (previous && heading.level > previous + 1) {
      out.push(
        finding({
          rule: 'heading_level_skip',
          severity: 'warning',
          category: 'accessibility',
          file,
          message: `Heading level jumps from h${previous} to h${heading.level}.`,
          detail: heading.text || '(empty)',
          selectorHint: `h${heading.level}`,
        }),
      );
      break;
    }
    previous = heading.level;
  }

  const text = bodyText(html);
  if (text.length > 0 && text.length < 200 && isHome) {
    out.push(
      finding({
        rule: 'thin_content',
        severity: 'warning',
        category: 'seo',
        file,
        message: `Visible body text looks thin (${text.length} characters).`,
        detail: 'Search engines need enough unique copy to understand the page topic.',
      }),
    );
  }

  if (!/<main\b/i.test(html) && !/\brole\s*=\s*["']main["']/i.test(html)) {
    out.push(
      finding({
        rule: 'main_landmark_missing',
        severity: 'warning',
        category: 'accessibility',
        file,
        message: 'No <main> landmark was found.',
        detail: 'Wrap primary content in <main> so assistive tech and crawlers can find it.',
      }),
    );
  }

  const hasSkip = collectContainers(html, 'a').some((anchor) => {
    const href = (anchor.attrs.href || '').toLowerCase();
    const name = accessibleName(anchor.attrs, anchor.inner).toLowerCase();
    return (href.startsWith('#') && /skip|main|content/.test(name)) || /skip to (main|content)/i.test(name);
  });
  if (!hasSkip) {
    out.push(
      finding({
        rule: 'skip_link_missing',
        severity: 'warning',
        category: 'accessibility',
        file,
        message: 'No skip-to-content link was found.',
        detail: 'Add a first-focus link like “Skip to content” pointing at #main.',
      }),
    );
  }

  for (const img of collectTags(html, 'img')) {
    if (!Object.prototype.hasOwnProperty.call(img.attrs, 'alt')) {
      out.push(
        finding({
          rule: 'img_missing_alt',
          severity: 'error',
          category: 'accessibility',
          file,
          message: 'An <img> is missing an alt attribute.',
          detail: img.attrs.src || img.attrs['data-src'] || '',
          selectorHint: 'img',
        }),
      );
    } else if ((img.attrs.alt || '').trim().length > 125) {
      out.push(
        finding({
          rule: 'img_alt_too_long',
          severity: 'warning',
          category: 'accessibility',
          file,
          message: 'An image alt text is longer than ~125 characters.',
          detail: (img.attrs.alt || '').slice(0, 140),
          selectorHint: 'img',
        }),
      );
    }
  }

  for (const anchor of collectContainers(html, 'a')) {
    const href = (anchor.attrs.href || '').trim();
    const name = accessibleName(anchor.attrs, anchor.inner);
    if (isNonCrawlableHref(href)) {
      out.push(
        finding({
          rule: href.toLowerCase().startsWith('javascript:') ? 'a_javascript_href' : 'a_empty_href',
          severity: 'warning',
          category: 'seo',
          file,
          message: href.toLowerCase().startsWith('javascript:')
            ? 'A link uses a javascript: href and is not crawlable.'
            : 'A link has an empty or placeholder href.',
          detail: name || href || '(no text)',
          selectorHint: 'a',
        }),
      );
    }
    if (!name) {
      out.push(
        finding({
          rule: 'a_empty_name',
          severity: 'error',
          category: 'accessibility',
          file,
          message: 'A link has no accessible name.',
          detail: href || '(no href)',
          selectorHint: 'a',
        }),
      );
    } else if (isGenericLinkText(name)) {
      out.push(
        finding({
          rule: 'a_generic_text',
          severity: 'warning',
          category: 'seo',
          file,
          message: `Link text “${name}” is too generic for SEO and screen readers.`,
          detail: href || '',
          selectorHint: 'a',
        }),
      );
    }
    if ((anchor.attrs.target || '') === '_blank') {
      const rel = (anchor.attrs.rel || '').toLowerCase();
      if (!/\bnoopener\b/.test(rel)) {
        out.push(
          finding({
            rule: 'a_target_blank_noopener',
            severity: 'warning',
            category: 'document',
            file,
            message: 'A target="_blank" link is missing rel="noopener".',
            detail: href || name,
            selectorHint: 'a',
          }),
        );
      }
    }
  }

  for (const button of collectContainers(html, 'button')) {
    if (!accessibleName(button.attrs, button.inner)) {
      out.push(
        finding({
          rule: 'button_empty_name',
          severity: 'error',
          category: 'accessibility',
          file,
          message: 'A <button> has no accessible name.',
          selectorHint: 'button',
        }),
      );
    }
  }

  for (const el of [...collectTags(html, 'div'), ...collectTags(html, 'span')]) {
    const role = (el.attrs.role || '').toLowerCase();
    if (!role) continue;
    if (['button', 'link', 'menuitem', 'tab', 'checkbox', 'switch'].includes(role)) {
      if (!accessibleName(el.attrs)) {
        out.push(
          finding({
            rule: 'aria_role_empty_name',
            severity: 'error',
            category: 'accessibility',
            file,
            message: `An element with role="${role}" has no accessible name.`,
            detail: el.raw.slice(0, 120),
            selectorHint: `[role="${role}"]`,
          }),
        );
      }
    }
  }

  for (const el of [...collectTags(html, 'a'), ...collectTags(html, 'button'), ...collectTags(html, 'input')]) {
    if ((el.attrs['aria-hidden'] || '').toLowerCase() === 'true') {
      out.push(
        finding({
          rule: 'aria_hidden_focusable',
          severity: 'warning',
          category: 'accessibility',
          file,
          message: 'A focusable control is marked aria-hidden="true".',
          detail: el.raw.slice(0, 120),
        }),
      );
    }
    const tab = el.attrs.tabindex;
    if (tab && Number(tab) > 0) {
      out.push(
        finding({
          rule: 'tabindex_positive',
          severity: 'warning',
          category: 'accessibility',
          file,
          message: 'A positive tabindex was found (prefer natural document order).',
          detail: el.raw.slice(0, 120),
        }),
      );
    }
  }

  const labels = collectTags(html, 'label');
  const labeledIds = new Set(labels.map((label) => label.attrs.for).filter(Boolean));
  for (const input of collectTags(html, 'input')) {
    const type = (input.attrs.type || 'text').toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) continue;
    const id = input.attrs.id || '';
    const named = accessibleName(input.attrs) || (id && labeledIds.has(id));
    if (!named) {
      out.push(
        finding({
          rule: 'input_missing_label',
          severity: 'error',
          category: 'accessibility',
          file,
          message: 'A form control has no label or accessible name.',
          detail: [type, input.attrs.name || input.attrs.id || ''].filter(Boolean).join(' '),
          selectorHint: 'input',
        }),
      );
    }
  }
  for (const tag of ['textarea', 'select']) {
    for (const control of collectTags(html, tag)) {
      const id = control.attrs.id || '';
      const named = accessibleName(control.attrs) || (id && labeledIds.has(id));
      if (!named) {
        out.push(
          finding({
            rule: `${tag}_missing_label`,
            severity: 'error',
            category: 'accessibility',
            file,
            message: `A <${tag}> has no label or accessible name.`,
            detail: control.attrs.name || control.attrs.id || '',
            selectorHint: tag,
          }),
        );
      }
    }
  }

  for (const frame of [...collectTags(html, 'iframe'), ...collectTags(html, 'frame')]) {
    if (!accessibleName(frame.attrs)) {
      out.push(
        finding({
          rule: 'iframe_missing_title',
          severity: 'error',
          category: 'accessibility',
          file,
          message: 'An iframe has no title / accessible name.',
          detail: frame.attrs.src || '',
          selectorHint: 'iframe',
        }),
      );
    }
  }

  if (collectTags(html, 'video').length > 0) {
    const tracks = collectTags(html, 'track').filter((track) => /captions|subtitles/i.test(track.attrs.kind || 'subtitles'));
    if (tracks.length === 0) {
      out.push(
        finding({
          rule: 'video_missing_captions',
          severity: 'warning',
          category: 'accessibility',
          file,
          message: 'A <video> was found without a captions/subtitles track.',
          detail: 'Add <track kind="captions" ...>.',
        }),
      );
    }
  }

  return out;
}

/**
 * Project-level SEO checks that need the whole scan (robots, sitemap, uniqueness).
 *
 * @param {{
 *   root: string,
 *   pages: { relative: string, html?: string, title?: string, description?: string }[],
 *   siteFiles?: { robotsTxt?: string | null, sitemapXml?: string | null },
 * }} input
 * @returns {Finding[]}
 */
export function auditSiteExtras(input) {
  /** @type {Finding[]} */
  const out = [];
  const file = '.';

  if (!input.siteFiles?.robotsTxt) {
    out.push(
      finding({
        rule: 'robots_txt_missing',
        severity: 'warning',
        category: 'seo',
        file,
        message: 'No robots.txt was found at the site root.',
        detail: 'Add robots.txt so crawlers know what to index. Include a Sitemap: line when you have one.',
      }),
    );
  } else {
    const text = input.siteFiles.robotsTxt;
    if (/syntax error|<<<<<<<|>>>>>>>/i.test(text)) {
      out.push(
        finding({
          rule: 'robots_txt_suspicious',
          severity: 'warning',
          category: 'seo',
          file: 'robots.txt',
          message: 'robots.txt looks malformed or contains merge-conflict markers.',
        }),
      );
    }
    if (/^\s*disallow\s*:\s*\/\s*$/im.test(text) && !/^\s*allow\s*:/im.test(text)) {
      out.push(
        finding({
          rule: 'robots_txt_blocks_all',
          severity: 'error',
          category: 'seo',
          file: 'robots.txt',
          message: 'robots.txt Disallow: / blocks the whole site from crawling.',
        }),
      );
    }
    if (!/^\s*sitemap\s*:/im.test(text)) {
      out.push(
        finding({
          rule: 'robots_txt_no_sitemap',
          severity: 'warning',
          category: 'seo',
          file: 'robots.txt',
          message: 'robots.txt does not declare a Sitemap: URL.',
        }),
      );
    }
  }

  if (!input.siteFiles?.sitemapXml) {
    out.push(
      finding({
        rule: 'sitemap_missing',
        severity: 'warning',
        category: 'seo',
        file,
        message: 'No sitemap.xml was found at the site root.',
        detail: 'Add sitemap.xml (or sitemap_index.xml) listing your public URLs.',
      }),
    );
  } else if (!/<url\b/i.test(input.siteFiles.sitemapXml) && !/<sitemap\b/i.test(input.siteFiles.sitemapXml)) {
    out.push(
      finding({
        rule: 'sitemap_empty',
        severity: 'warning',
        category: 'seo',
        file: 'sitemap.xml',
        message: 'sitemap.xml does not contain <url> or <sitemap> entries.',
      }),
    );
  }

  /** @type {Map<string, string[]>} */
  const titles = new Map();
  /** @type {Map<string, string[]>} */
  const descriptions = new Map();
  for (const page of input.pages) {
    if (!page.title) continue;
    const key = page.title.toLowerCase();
    titles.set(key, [...(titles.get(key) || []), page.relative]);
  }
  for (const page of input.pages) {
    if (!page.description) continue;
    const key = page.description.toLowerCase();
    descriptions.set(key, [...(descriptions.get(key) || []), page.relative]);
  }
  for (const [title, files] of titles) {
    if (files.length < 2) continue;
    out.push(
      finding({
        rule: 'title_duplicate',
        severity: 'error',
        category: 'seo',
        file: files[0],
        message: `Duplicate <title> shared by ${files.length} pages.`,
        detail: `${title} · ${files.slice(0, 6).join(', ')}`,
      }),
    );
  }
  for (const [description, files] of descriptions) {
    if (files.length < 2) continue;
    out.push(
      finding({
        rule: 'meta_description_duplicate',
        severity: 'warning',
        category: 'seo',
        file: files[0],
        message: `Duplicate meta description shared by ${files.length} pages.`,
        detail: `${description.slice(0, 100)} · ${files.slice(0, 6).join(', ')}`,
      }),
    );
  }

  return out;
}

/**
 * @param {Omit<Finding, 'id'> & { id?: string }} input
 * @returns {Finding}
 */
function finding(input) {
  const id = input.id || `${input.rule}:${input.file}:${hash(input.detail || input.message)}`;
  return { ...input, id };
}

/** @param {string} text */
function hash(text) {
  let value = 0;
  for (let i = 0; i < text.length; i += 1) value = (value * 31 + text.charCodeAt(i)) >>> 0;
  return value.toString(16).slice(0, 6);
}
