import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Sparkles, Minus, ArrowUp, Square, Plus } from 'lucide-react';
import { Button } from './components/button';
import { t, subscribeLanguage, getLanguage } from './photo-i18n.js';

// Host media tags refer to local files. Keep them out of plain-text replies;
// generated images are opened through the app's validated result list.
function AssistantReply({ text }: { text: string }) {
  const readable = text.replace(/<media\b[^>]*(?:>|$)/gi, '').trim();
  return (
    <div className="photo-ai-reply">
      {readable
        .split(/(\*\*[^*]+\*\*)/g)
        .map((part, index) =>
          part.startsWith('**') && part.endsWith('**') ? (
            <strong key={index}>{part.slice(2, -2)}</strong>
          ) : (
            part
          ),
        )}
    </div>
  );
}

export function mountPhotoAssistant({ context, prepare, showResults }) {
  const savedId = 'assistant-00000000-0000-4000-8000-000000000001';
  const host = document.createElement('div');
  host.id = 'agent-panel-root';
  document.body.append(host);
  let refresh = () => {},
    compose = (_text: string) => {};
  function Assistant() {
    React.useSyncExternalStore(subscribeLanguage, getLanguage);
    const [hydrated, setHydrated] = React.useState(false);
    const revision = React.useRef(0);
    const writes = React.useRef(Promise.resolve());
    const conflicted = React.useRef(false);
    const lastSaved = React.useRef('');
    const [open, setOpen] = React.useState(false);
    const [draft, setDraft] = React.useState('');
    const [current, setCurrent] = React.useState(context);
    const [busy, setBusy] = React.useState(false);
    const [reply, setReply] = React.useState('');
    const [status, setStatus] = React.useState('');
    const [error, setError] = React.useState('');
    const [permissions, setPermissions] = React.useState<any[]>([]);
    const [question, setQuestion] = React.useState<any>(null);
    const [position, setPosition] = React.useState<any>(null);
    const active = React.useRef<string | null>(null);
    const stopRequested = React.useRef(false);
    const dispatched = React.useRef(false);
    const session = React.useRef<string | undefined>(undefined);
    const input = React.useRef<HTMLTextAreaElement>(null);
    const panel = React.useRef<HTMLElement>(null);
    const drag = React.useRef<any>(null);
    const api = () => (window as any).mcode?.miniapp?.agent;
    React.useEffect(() => {
      fetch('/api/recovery/' + savedId).then(async response => {
        if (!response.ok) throw Error('load');
        const record = await response.json();
        revision.current = record.revision;
        if (record.value) {
          const saved = record.value;
          setDraft(saved.draft); setReply(saved.reply); session.current = saved.sessionId;
          setQuestion(saved.question || null);
          if (!saved.busy && saved.status) setStatus(saved.status);
          if (saved.busy) setStatus('结果尚未确认，请先查看会话，不要重复发送。');
        }
        lastSaved.current = JSON.stringify(record.value || { draft: '', reply: '', busy: false, question: null, status: '' });
        setHydrated(true);
      }).catch(() => setError(t('读取会话失败，请重新打开应用')));
    }, []);
    const persist = (value) => {
      const next = writes.current.then(async () => {
        const serialized = JSON.stringify(value);
        if (serialized === lastSaved.current) return;
        if (conflicted.current) throw Error(t('会话已在其他窗口更新，请重新打开应用'));
        const response = await fetch('/api/recovery/' + savedId, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ revision: revision.current, value }),
        });
        if (response.status === 409) conflicted.current = true;
        if (!response.ok) throw Error(t('会话保存失败，请保留当前页面'));
        revision.current = (await response.json()).revision;
        lastSaved.current = serialized;
      });
      writes.current = next.catch(e => setError(e.message));
      return next;
    };
    React.useEffect(() => {
      if (!hydrated) return;
      const timer = setTimeout(() => void persist({ draft, reply, busy,
        sessionId: session.current, question, status }).catch(() => {}), 200);
      return () => clearTimeout(timer);
    }, [hydrated, draft, reply, busy, question, status]);
    React.useEffect(() => {
      const protect = (event) => { if (busy) { event.preventDefault(); event.returnValue = ''; } };
      window.addEventListener('beforeunload', protect);
      return () => window.removeEventListener('beforeunload', protect);
    }, [busy]);
    async function cancel() {
      stopRequested.current = true;
      setStatus('正在停止…');
      try { if (dispatched.current) await api().cancel(active.current); }
      catch (e) { setError(e.message); }
    }
    refresh = () => setCurrent(context());
    compose = (text) => {
      if (text) setDraft(text);
      setOpen(true);
    };
    React.useEffect(() => {
      if (open) {
        input.current?.focus();
        void showResults();
      }
    }, [open]);
    const clamp = (x, y) => ({
      left: Math.max(8, Math.min(x, innerWidth - (panel.current?.offsetWidth || 360) - 8)),
      top: Math.max(56, Math.min(y, innerHeight - (panel.current?.offsetHeight || 360) - 8)),
    });
    React.useEffect(() => {
      const resize = () => setPosition((p) => (p ? clamp(p.left, p.top) : null));
      window.addEventListener('resize', resize);
      return () => window.removeEventListener('resize', resize);
    }, []);
    function onEvent(event) {
      if (event.type === 'turn.started') session.current = event.sessionId;
      if (event.type === 'text.delta') setReply((text) => (text + event.text).slice(-60000));
      if (event.type === 'message.committed') setReply(event.text);
      if (event.type === 'tool.started') setStatus('正在处理图片…');
      if (event.type === 'permission.requested')
        setPermissions((items) => [...items.filter((p) => p.requestId !== event.requestId), event]);
    }
    async function run(answers?) {
      if (!hydrated || conflicted.current || active.current || (!answers && !draft.trim())) return;
      if (!api()?.run) {
        setError(t('请在 MiniMax Code 中打开此应用以使用 AI。'));
        return;
      }
      const requestId = crypto.randomUUID();
      active.current = requestId;
      stopRequested.current = false;
      dispatched.current = false;
      setBusy(true);
      setError('');
      setReply('');
      setStatus('正在思考…');
      try {
        await persist({ draft, reply, busy: true, sessionId: session.current, question });
        const text = answers ? undefined : await prepare('auto', draft);
        if (stopRequested.current) { setStatus('已停止'); return; }
        dispatched.current = true;
        const result = answers
          ? await api().answer(
              { sessionId: session.current, questionId: question.requestId, answers, requestId },
              { onEvent },
            )
          : await api().run(
              { text, sessionId: session.current, requestId },
              { onEvent },
            );
        session.current = result.sessionId;
        setQuestion(result.pendingQuestion || null);
        if (result.text) setReply(result.text);
        if (result.status === 'error')
          setError(result.error?.message || t('AI 处理失败，请检查后重试。'));
        setStatus(
          result.status === 'aborted' ? '已停止' : result.pendingQuestion ? '请补充信息' : '',
        );
        if (result.status === 'finished' && !answers) setDraft('');
        await showResults();
      } catch (e) {
        const unknown = ['result_unknown', 'AGENT_OUTCOME_UNKNOWN'].includes(e.message);
        setStatus(unknown ? '结果尚未确认，请先查看会话，不要重复发送。' : '');
        const messages = {
          runtime_unavailable: 'AI 连接暂不可用，请重新打开应用后再试。',
          session_not_found: '这段会话已不可用，请新建对话。',
          busy: 'AI 还在处理上一个请求，请稍后再试。',
          not_permitted: '当前应用无法使用 AI，请检查应用权限。',
        };
        setError(unknown ? '' : t(messages[e.message] || 'AI 处理失败，请检查后重试。'));

      } finally {
        active.current = null;
        dispatched.current = false;
        setBusy(false);
      }
    }
    async function decide(p, decision) {
      try {
        await api().reply({ sessionId: p.sessionId, requestId: p.requestId, decision });
        setPermissions((items) => items.filter((i) => i.requestId !== p.requestId));
      } catch (e) {
        setError(e.message);
      }
    }
    if (!open)
      return (
        <Button
          className="agent-launcher"
          aria-label={t('打开 AI 助手')}
          aria-expanded={false}
          onClick={() => setOpen(true)}
        >
          <Sparkles size={16} />
          {t(busy ? '正在处理图片…' : 'AI 助手')}
        </Button>
      );
    return (
      <section
        ref={panel}
        className="agent-panel"
        aria-label={t('AI 修图助手')}
        style={position ? { ...position, right: 'auto', bottom: 'auto' } : undefined}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      >
        <div
          className="agent-panel-heading"
          onPointerDown={(e) => {
            if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
            const r = panel.current!.getBoundingClientRect();
            drag.current = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (d) setPosition(clamp(d.left + e.clientX - d.x, d.top + e.clientY - d.y));
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onLostPointerCapture={() => (drag.current = null)}
        >
          <span>
            <Sparkles size={16} />
            <strong>{t('AI 助手')}</strong>
          </span>
          <Button variant="ghost" size="icon-sm" disabled={busy || !hydrated || permissions.length > 0}
            aria-label={t('新建对话')} title={t('新建对话')}
            onClick={() => { session.current = undefined; setReply(''); setQuestion(null);
              setPermissions([]); setStatus(''); setError(''); }}>
            <Plus />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('收起 AI 助手')}
            onClick={() => setOpen(false)}
          >
            <Minus />
          </Button>
        </div>
        <p className="agent-context">
          {current.name
            ? t('当前工程 · {name}', { name: current.name })
            : t('描述想法，或先打开一张图片')}
        </p>
        {reply && <AssistantReply text={reply} />}
        {status && (
          <p role="status" className="agent-feedback">
            {t(status)}
          </p>
        )}
        {error && (
          <p role="alert" className="agent-feedback error">
            {error}
          </p>
        )}
        {permissions.map((p) => (
          <div className="photo-ai-approval" key={p.requestId}>
            <strong>{t('需要你的确认')}</strong>
            <p>{p.reason}</p>
            <details>
              <summary>{p.toolName}</summary>
              <pre>{p.toolInput}</pre>
            </details>
            <Button onClick={() => void decide(p, 'allowOnce')}>{t('允许本次')}</Button>
            <Button variant="outline" onClick={() => void decide(p, 'deny')}>
              {t('拒绝')}
            </Button>
          </div>
        ))}
        {question && !busy && (
          <form
            key={question.requestId}
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              void run(
                question.request.steps.map((step) => ({
                  stepId: step.id,
                  selectedOptionIds: data.getAll('option-' + step.id),
                  selectedOther: !!String(data.get('other-' + step.id) || '').trim(),
                  otherText: String(data.get('other-' + step.id) || ''),
                })),
              );
            }}
          >
            <strong>{question.request.title || t('请补充信息')}</strong>
            {question.request.modePayload && (
              <pre>{JSON.stringify(question.request.modePayload, null, 2)}</pre>
            )}
            {question.request.steps.map((step) => (
              <fieldset key={step.id}>
                <legend>{step.question}</legend>
                <p>{step.description}</p>
                {step.options.map((option) => (
                  <label className="photo-ai-option" key={option.id}>
                    <input
                      type={step.selectionMode === 'multiple' ? 'checkbox' : 'radio'}
                      name={'option-' + step.id}
                      value={option.id}
                    />
                    {option.label}
                    {option.description && <small>{option.description}</small>}
                  </label>
                ))}
                <input
                  name={'other-' + step.id}
                  aria-label={step.question + ' · ' + t('补充说明')}
                  placeholder={t('补充说明')}
                />
              </fieldset>
            ))}
            <Button type="submit">{t('继续')}</Button>
          </form>
        )}
        {!question && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run();
            }}
          >
            {!draft && !busy && (
              <div className="agent-suggestions">
                {[
                  ['生成海报', '帮我设计一张咖啡海报，奶油色背景，标题 COFFEE BREAK。'],
                  ['改善照片', '请先让我选择一张照片，再改善曝光和色彩，保留自然细节。'],
                ].map(([label, text]) => (
                  <Button
                    key={label}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setDraft(t(text))}
                  >
                    {t(label)}
                  </Button>
                ))}
              </div>
            )}
            <textarea
              ref={input}
              rows={3}
              maxLength={8000}
              aria-label={t('AI 修图需求')}
              placeholder={t('描述你想做的图片，或先打开一张照片…')}
              value={draft}
              disabled={busy || !hydrated}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void run();
                }
              }}
            />
            <div className="agent-send-row">
              <span>Ctrl / ⌘ + Enter</span>
              {busy ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void cancel()}
                >
                  <Square size={14} />
                  {t('停止')}
                </Button>
              ) : (
                <Button type="submit" disabled={!hydrated || conflicted.current || !draft.trim()}>
                  <ArrowUp size={16} />
                  {t('发送')}
                </Button>
              )}
            </div>
          </form>
        )}
        {question && busy && (
          <Button
            onClick={() => void cancel()}
          >
            {t('停止')}
          </Button>
        )}
        {session.current && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              void api()
                .open(session.current)
                .catch((e) => setError(e.message))
            }
          >
            {t('查看完整会话')}
          </Button>
        )}
        <details className="agent-results-area photo-ai-results" open hidden>
          <summary>{t('AI 返回的图片')}</summary>
          <div id="result-list" />
        </details>
      </section>
    );
  }
  flushSync(() => createRoot(host).render(<Assistant />));
  return { refresh: () => refresh(), compose: (text) => compose(text), open: () => compose('') };
}
