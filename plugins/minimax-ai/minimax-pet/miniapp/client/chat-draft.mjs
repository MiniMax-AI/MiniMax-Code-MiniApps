// Original-chat drafts only. The observed task never changes the Host's bound destination.
const codeOf = (error) => error?.code || error?.message || 'result_unknown';
export function createDraftController({ message, onChange = () => {} }) {
  const drafts = new Map();
  let pending = false;
  let disposed = false;
  let origin = null;
  const draft = (entry) => { if (!drafts.has(entry)) drafts.set(entry, { text: '', revision: 0 }); return drafts.get(entry); };
  const emit = () => { if (!disposed) onChange({ pending, origin: origin ? { ...origin } : null }); };
  return {
    getState: () => ({ pending, origin: origin ? { ...origin } : null }),
    getDraft: (entry) => ({ ...draft(entry) }),
    setOrigin(value) { origin = value ? { sessionId: value.sessionId, title: value.title } : null; emit(); },
    edit(entry, text) { const current = draft(entry); current.text = String(text); current.revision++; },
    syncText(entry, text) { const current = draft(entry); if (current.text !== text) { current.text = String(text); current.revision++; } },
    appendText(entry, text) { const current = draft(entry); current.text += String(text); current.revision++; return current.text; },
    submit(entry) {
      const fail = (code) => ({ submission: null, result: Promise.resolve({ ok: false, clear: false, code, submission: null, entry }) });
      if (disposed) return fail('target_unavailable');
      if (pending) return fail('busy');
      if (typeof message?.append !== 'function') return fail('unsupported');
      const current = draft(entry);
      if (!current.text.trim()) return fail('empty');
      const submission = Object.freeze({ entry, text: current.text, title: origin?.title || '打开桌宠的原属对话', editRevision: current.revision });
      pending = true;
      let request;
      // No await and exactly one argument: this must remain in the real submit gesture.
      try { request = message.append(submission.text); } catch (error) { request = Promise.reject(error); }
      emit();
      const result = Promise.resolve(request).then(
        () => { const value = draft(entry); const clear = !disposed && value.revision === submission.editRevision; if (clear) { value.text = ''; value.revision++; } return { ok: true, clear, submission, entry }; },
        (error) => ({ ok: false, clear: false, code: codeOf(error), submission, entry }),
      ).finally(() => { pending = false; emit(); });
      return { submission, result };
    },
    dispose() { disposed = true; origin = null; drafts.clear(); },
  };
}
export function bindDraftEntry({ controller, entry, form, input, onPending, onResult }) {
  let active = true;
  const onInput = () => controller.edit(entry, input.value);
  const onSubmit = (event) => {
    event.preventDefault(); controller.syncText(entry, input.value);
    const attempt = controller.submit(entry);
    if (attempt.submission) onPending?.(attempt.submission);
    void attempt.result.then((result) => { if (!active) return; if (result.clear) input.value = controller.getDraft(entry).text; onResult(result); });
  };
  input.addEventListener('input', onInput); form.addEventListener('submit', onSubmit);
  return () => { active = false; input.removeEventListener('input', onInput); form.removeEventListener('submit', onSubmit); };
}
