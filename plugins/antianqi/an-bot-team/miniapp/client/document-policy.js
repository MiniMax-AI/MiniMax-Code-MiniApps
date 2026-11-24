// @ts-check
// Generated HTML can run its own UI, but has an opaque origin: no Bot storage, cookies or
// API access. Do not add allow-same-origin, form submission or top navigation capabilities.
export const HTML_PREVIEW_CSP = "default-src 'none'; script-src 'unsafe-inline' http: https:; style-src 'unsafe-inline' http: https:; img-src data: blob: http: https:; font-src data: http: https:; media-src blob: http: https:; connect-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts";

// Markdown contains escaped content and no scripts. Its renderer uses target=_blank links;
// let readers follow those links without imposing the preview sandbox on the destination.
export const MARKDOWN_PREVIEW_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; sandbox allow-popups allow-popups-to-escape-sandbox";

