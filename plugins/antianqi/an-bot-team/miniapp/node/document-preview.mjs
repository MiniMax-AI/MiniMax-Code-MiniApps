// @ts-check
import { escapeHtml, renderMarkdown } from '../client/markdown.js';

export { HTML_PREVIEW_CSP, MARKDOWN_PREVIEW_CSP } from '../client/document-policy.js';

/** A standalone reading view using the same safe Markdown renderer as chat messages. */
export function markdownDocument(source, name) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(name)}</title><style>
:root { color-scheme: light dark; }
body { margin: 0 auto; max-width: 900px; padding: 32px 24px; font: 16px/1.6 ui-sans-serif, -apple-system, system-ui, 'PingFang SC', 'Segoe UI', sans-serif; overflow-wrap: anywhere; }
pre, .md-table { overflow: auto; } pre { padding: 16px; } code, pre { background: light-dark(#efefef, #262626); border-radius: 6px; }
code { padding: 2px 4px; } pre code { padding: 0; } table { border-collapse: collapse; } th, td { padding: 8px 12px; border: 1px solid light-dark(#ddd, #555); }
blockquote { margin-inline: 0; padding-inline: 16px; border-inline-start: 3px solid light-dark(#ddd, #555); }
</style></head><body><main>${renderMarkdown(source)}</main></body></html>`;
}
