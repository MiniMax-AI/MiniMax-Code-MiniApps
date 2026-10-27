import assert from 'node:assert/strict';
import test from 'node:test';
import { bindDraftEntry, createDraftController } from '../miniapp/client/chat-draft.mjs';
const settle = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
class Control extends EventTarget { value = ''; }
function harness(append) {
  const calls = [], results = [], starts = [];
  const controller = createDraftController({ message: { append(...args) { calls.push(args); return append?.(...args); } } });
  controller.setOrigin({ sessionId: 'original', title: '原属对话 A' });
  const entries = {}, disposers = [];
  for (const entry of ['panel', 'desktop']) {
    const form = new Control(), input = new Control(); entries[entry] = { form, input };
    disposers.push(bindDraftEntry({ controller, entry, form, input, onPending: (s) => starts.push(s), onResult: (r) => results.push(r) }));
  }
  return { controller, calls, results, starts, entries,
    edit(entry, text) { entries[entry].input.value = text; entries[entry].input.dispatchEvent(new Event('input')); },
    submit(entry) { entries[entry].form.dispatchEvent(new Event('submit', { cancelable: true })); },
    dispose() { for (const dispose of disposers) dispose(); controller.dispose(); },
  };
}
for (const entry of ['panel', 'desktop']) {
  test(`${entry}: append is synchronous, takes only text and freezes original-chat label`, async () => {
    const h = harness(); h.edit(entry, 'draft'); h.submit(entry);
    assert.deepEqual(h.calls, [['draft']]); assert.equal(h.starts[0].title, '原属对话 A');
    h.controller.setOrigin({ sessionId: 'original', title: '更新标题' });
    await settle(); assert.equal(h.results[0].submission.title, '原属对话 A'); assert.equal(h.entries[entry].input.value, ''); h.dispose();
  });
  test(`${entry}: pending edits including edit-away-and-back and ASR insertion survive older success`, async () => {
    const request = deferred(); const h = harness(() => request.promise);
    h.edit(entry, 'one'); h.submit(entry); h.edit(entry, 'two'); h.edit(entry, 'one');
    h.entries[entry].input.value = h.controller.appendText(entry, '\nASR final');
    request.resolve(); await settle(); assert.equal(h.results[0].clear, false); assert.equal(h.entries[entry].input.value, 'one\nASR final'); h.dispose();
  });
  test(`${entry}: cancellation, no origin, denied and unknown result preserve input with no retry`, async () => {
    for (const code of ['user_cancelled', 'target_unavailable', 'not_allowed', 'result_unknown']) {
      const h = harness(() => Promise.reject({ message: code })); h.edit(entry, 'keep'); h.submit(entry); await settle();
      assert.equal(h.results[0].code, code); assert.equal(h.entries[entry].input.value, 'keep'); assert.equal(h.calls.length, 1); h.dispose();
    }
  });
}
test('only one page-wide pending request; dispose prevents late result touching either entry', async () => {
  const request = deferred(); const h = harness(() => request.promise);
  h.edit('panel', 'keep'); h.submit('panel'); h.edit('desktop', 'other'); h.submit('desktop'); await settle();
  assert.equal(h.calls.length, 1); assert.equal(h.results[0].code, 'busy'); h.dispose(); request.resolve(); await settle();
  assert.equal(h.results.length, 1); assert.equal(h.entries.panel.input.value, 'keep');
});
