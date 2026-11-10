// @ts-check
import { h, icon } from './core.js';
import { t } from './i18n.js';
import { escapeHtml } from './markdown.js';
import { HTML_PREVIEW_CSP, MARKDOWN_PREVIEW_CSP } from './document-policy.js';

const MAX_PREVIEW_BYTES = 16 * 1024 * 1024;

/** Bound memory use even if a response has no trustworthy Content-Length. */
async function readDocument(response) {
  if (Number(response.headers.get('content-length')) > MAX_PREVIEW_BYTES) {
    await response.body?.cancel();
    throw new Error(t('media.previewLarge'));
  }
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_PREVIEW_BYTES) {
        await reader.cancel();
        throw new Error(t('media.previewLarge'));
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    return chunks.join('') + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

/**
 * Only the owning Mini App WebContents can authenticate /api/media. Fetch here, then put
 * the document in an opaque-origin iframe: never hand that protected URL to a browser tab
 * or expose Host credentials. Keep CSP when moving the HTTP body into srcdoc.
 * @param {string} url
 * @param {string} name
 * @param {boolean} html
 */
export function openDocumentPreview(url, name, html) {
  const previousFocus = document.activeElement;
  const body = h('div', { class: 'document-preview-body', 'aria-busy': 'true' });
  const dialog = /** @type {HTMLDialogElement} */ (h('dialog', { class: 'document-preview', 'aria-label': name }));
  let request = new AbortController();
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    request.abort();
    dialog.close();
    dialog.remove();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
  };
  const retry = h('button', { type: 'button', class: 'btn', hidden: true, onclick: () => void load() }, t('media.retry'));
  dialog.append(h('div', { class: 'modal-head' },
    h('h2', null, name), retry,
    h('a', { class: 'btn', href: url, download: name }, t('media.download')),
    h('button', { type: 'button', class: 'round ghost', 'aria-label': t('panels.common.close'), onclick: close }, icon('close')),
  ), body);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', close);
  document.body.append(dialog);
  dialog.showModal();
  void load();

  async function load() {
    request.abort();
    request = new AbortController();
    const { signal } = request;
    retry.hidden = true;
    body.setAttribute('aria-busy', 'true');
    body.replaceChildren(h('p', { role: 'status' }, t('main.loading')));
    try {
      const response = await fetch(url, { signal, credentials: 'same-origin' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const source = await readDocument(response);
      if (closed || signal.aborted) return;
      // CSP sandbox is ignored in a meta tag, so apply that directive to the iframe itself.
      const policy = html ? HTML_PREVIEW_CSP : MARKDOWN_PREVIEW_CSP;
      const [csp, sandbox] = policy.split('; sandbox ');
      const content = response.headers.get('content-type')?.startsWith('text/html')
        ? source : `<pre style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(source)}</pre>`;
      body.replaceChildren(h('iframe', {
        title: name, sandbox, referrerpolicy: 'no-referrer',
        srcdoc: `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">${content}`,
      }));
    } catch (error) {
      if (closed || signal.aborted) return;
      body.replaceChildren(h('p', { role: 'alert' }, t('media.previewFailed', { reason: error instanceof Error ? error.message : String(error) })));
      retry.hidden = false;
    } finally {
      if (!closed && !signal.aborted) body.setAttribute('aria-busy', 'false');
    }
  }
}
