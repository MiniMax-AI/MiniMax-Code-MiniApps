import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDesignEdits, DESIGN_EMBEDDED_CSP, prepareDesignHtml, validateDesignHtml } from '../miniapp/node/artifact.mjs';

const page = (body = '<h1>Hi</h1>', head = '<meta charset="utf-8"><title>T</title>') =>
  `<!doctype html><html lang="en"><head>${head}</head><body>${body}</body></html>`;

test('a complete self-contained page is accepted', () => {
  const result = validateDesignHtml(
    page(
      '<canvas id="c"></canvas><img src="data:image/png;base64,AAAA" alt=""><a href="#top">Top</a>' +
        '<a href="https://example.com/docs">Docs</a><script>const c = document.getElementById("c"); c.getContext("2d");</script>',
      '<meta charset="utf-8"><style>body{margin:0}</style>',
    ),
  );
  assert.equal(result.ok, true);
});

test('pages that could reach the network, navigate or hide markup are rejected', () => {
  const cases = [
    [page('<script src="https://cdn.example.com/x.js"></script>'), /scripts must be inline/],
    [page('<img src="https://example.com/a.png">'), /data: URL/],
    [page('<iframe></iframe>'), /<iframe>/],
    [page('<form><button>Go</button></form>'), /forms/],
    [page('<a href="javascript:alert(1)">x</a>'), /scripted URLs/],
    [page('<a href="jav&#x61;script:alert(1)">x</a>'), /scripted URLs/],
    [page('<a href="http://example.com">x</a>'), /local fragments, https links/],
    [page('<p>x</p>', '<meta http-equiv="refresh" content="0;url=https://example.com">'), /meta refresh/],
    [page('<!-- note --><p>x</p>'), /comments/],
    [page('<base href="https://example.com/">'), /<base>/],
    [page('<p class="a" class="b">x</p>'), /repeat the class attribute/],
    ['<html><head></head><body></body></html>', /start with <!doctype html>/],
    ['<!doctype html><html><head></head><body></body><body></body></html>', /exactly one <body>/],
  ];
  for (const [html, pattern] of cases) {
    const result = validateDesignHtml(html);
    assert.equal(result.ok, false, html);
    assert.match(/** @type {any} */ (result).error, pattern, html);
  }
});

test('the size limit is 512 KiB of UTF-8', () => {
  const filler = 'x'.repeat(512 * 1024);
  const result = validateDesignHtml(page(`<p>${filler}</p>`));
  assert.deepEqual(result, { ok: false, error: 'the design exceeds 512 KiB' });
  assert.equal(validateDesignHtml(42).ok, false);
});

test('the preview copy gets the CSP and bootstrap right after the doctype, before any design script', () => {
  const html = page('<script>window.x = 1</script>');
  const prepared = prepareDesignHtml(html, 'tok123');
  assert.ok(prepared.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy"'));
  assert.ok(prepared.includes("connect-src 'none'"));
  assert.ok(DESIGN_EMBEDDED_CSP.includes("form-action 'none'"));
  assert.ok(prepared.indexOf('RTCPeerConnection') < prepared.indexOf('window.x = 1'));
  assert.ok(prepared.includes('"tok123"'));
});

test('edits apply in order and atomically, each matching exactly once', () => {
  const html = page('<h1>Hello</h1><p>One</p>');
  const ok = applyDesignEdits(html, [
    { old_string: 'Hello', new_string: 'Hi there' },
    { old_string: 'Hi there</h1>', new_string: 'Hi there!</h1>' },
  ]);
  assert.equal(ok.ok, true);
  assert.ok(/** @type {any} */ (ok).html.includes('<h1>Hi there!</h1>'));

  const twice = applyDesignEdits(page('<p>a</p><p>a</p>'), [{ old_string: '<p>a</p>', new_string: '' }]);
  assert.deepEqual(twice, { ok: false, error: 'edit 1: old_string matched 2 times; it must match exactly once (nothing was published)' });

  const missing = applyDesignEdits(html, [
    { old_string: 'Hello', new_string: 'Bye' },
    { old_string: 'not there', new_string: 'x' },
  ]);
  assert.equal(missing.ok, false);
  assert.match(/** @type {any} */ (missing).error, /^edit 2: old_string matched 0 times/);

  assert.equal(applyDesignEdits(html, []).ok, false);
  assert.equal(applyDesignEdits(html, [{ old_string: '', new_string: 'x' }]).ok, false);
  assert.equal(applyDesignEdits(html, 'nope').ok, false);
  // A replacement string with $ patterns is inserted literally.
  const dollars = applyDesignEdits(html, [{ old_string: 'One', new_string: '$& $1 $$' }]);
  assert.ok(/** @type {any} */ (dollars).html.includes('<p>$& $1 $$</p>'));
});
