import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import '../ui/theme.css';
import { useEffect, useRef, useState } from 'react';
import type { ChatPanelProps } from './chatPanelController';
import { useExternalAgentBridge } from '../../agent/useExternalAgentBridge';
import { ExternalProposalCard } from './ExternalProposalCard';
import { ChatMessage } from './ChatMessage';
import { Icon } from '../icons';
import { loadComposerDraft, saveComposerDraft, loadMiniAppSession, saveMiniAppSession, loadMiniAppReferences, saveMiniAppReferences, loadMiniAppGuideSeen, saveMiniAppGuideSeen, loadMiniAppChatEntries, saveMiniAppChatEntries } from '../../persist/sessionPrefs';
import './MiniAppChatPanel.css';
import { assistantStarters, assistantToolLabel, insertAssistantSuggestion, generationCapabilityPrompt, generationInstructions } from './miniAppAssistantCopy';
import { selectedIdsOf } from '../../editor/timelineTypes';

type Event = { type: string; sessionId?: string; requestId?: string; text?: string; name?: string; reason?: string; ok?: boolean; position?: number };
type Result = { sessionId: string; status: string; text?: string; error?: { message: string }; pendingQuestion?: unknown };
type HostAgent = {
  run(input: { text: string; sessionId?: string; requestId: string }, options: { onEvent(event: Event): void }): Promise<Result>;
  cancel(requestId: string): void;
  open(sessionId: string): Promise<void>;
};
type Entry = { id: string; role: 'user' | 'assistant' | 'tool'; text: string; state?: 'running' | 'done' | 'error' | 'unknown' };
function hostAgent(): HostAgent | undefined {
  return (window as unknown as { mcode?: { miniapp?: { agent?: HostAgent } } }).mcode?.miniapp?.agent;
}


export function ChatPanel(props: ChatPanelProps) {
  return <ProjectChatPanel key={props.projectId} {...props} />;
}
function ProjectChatPanel(props: ChatPanelProps) {
  const external = useExternalAgentBridge(props.ctx, props.projectId);
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showGuide, setShowGuide] = useState(() => !loadMiniAppGuideSeen());
  const [references, setReferences] = useState(() => loadMiniAppReferences(props.projectId));
  const launcher = useRef<HTMLButtonElement>(null);
  const timeline = props.ctx.getState();
  const selected = timeline.items.filter(item => selectedIdsOf(timeline).includes(item.id));
  const [input, setInput] = useState(() => loadComposerDraft(props.projectId));
  const [entries, setEntries] = useState<Entry[]>(() => loadMiniAppChatEntries(props.projectId));
  const [status, setStatus] = useState(() => loadMiniAppChatEntries(props.projectId).length ? '已恢复记录；继续前请核对完整对话中的任务结果' : '');
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const [root, setRoot] = useState(() => loadMiniAppSession(props.projectId));
  const [attention, setAttention] = useState<string>();
  const [newChatConfirm, setNewChatConfirm] = useState(false);
  const active = useRef<string | undefined>(undefined);
  const inputRef = useRef(input);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const agent = hostAgent();
  const assetCount = props.ctx.getDoc().assets.length;
  const starters = assistantStarters(assetCount, timeline.items.length);
  function useSuggestion(prompt: string) {
    changeInput(insertAssistantSuggestion(inputRef.current, prompt));
    textarea.current?.focus();
  }
  function dismissGuide() { setShowGuide(false); saveMiniAppGuideSeen(); }
  const savedEntries = useRef(entries);
  useEffect(() => { savedEntries.current = entries; const timer = setTimeout(() => saveMiniAppChatEntries(props.projectId, entries), 300); return () => clearTimeout(timer); }, [props.projectId, entries]);
  useEffect(() => {
    const flush = () => saveMiniAppChatEntries(props.projectId, savedEntries.current);
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); flush(); };
  }, [props.projectId]);
  useEffect(() => { saveMiniAppReferences(props.projectId, references); }, [props.projectId, references]);
  function changeInput(value: string) {
    inputRef.current = value;
    setInput(value);
    saveComposerDraft(props.projectId, value);
  }
  function rememberSession(sessionId: string) {
    setRoot(sessionId);
    saveMiniAppSession(props.projectId, sessionId);
  }
  useEffect(() => { if (props.seed) { changeInput(props.seed.text); setReferences(props.seed.references?.map(reference => ({ id: reference.id, name: reference.name, kind: reference.kind })) ?? []); setVisible(true); } }, [props.seed?.nonce]);
  useEffect(() => { if (visible) textarea.current?.focus(); }, [visible]);
  useEffect(() => {
    if (showGuide && scroll.current) { follow.current = false; scroll.current.scrollTop = 0; }
  }, [showGuide]);
  useEffect(() => { if (attention || external.proposal || external.pendingGuard) setVisible(true); }, [attention, external.proposal, external.pendingGuard]);
  function minimize() { setVisible(false); launcher.current?.focus(); }
  function referenceSelection() {
    setReferences(selected.map(item => ({ id: item.id, name: item.name })));
    textarea.current?.focus();
  }
  useEffect(() => () => {
    const request = active.current;
    active.current = undefined;
    if (request) hostAgent()?.cancel(request);
  }, []);
  useEffect(() => {
    if (follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [entries, status, failure]);
  async function open(sessionId = attention ?? root) {
    if (!sessionId || !agent) return;
    try { await agent.open(sessionId); }
    catch (error) { setFailure(`无法打开对话：${String(error)}`); }
  }
  function newChat() {
    saveMiniAppSession(props.projectId, undefined);
    saveMiniAppChatEntries(props.projectId, []);
    setRoot(undefined); setReferences([]); setEntries([]); setFailure(''); setStatus(''); setAttention(undefined); setNewChatConfirm(false);
    textarea.current?.focus();
  }
  async function submit() {
    if (!agent || active.current || !inputRef.current.trim()) return;
    const submitted = inputRef.current;
    const submittedReferences = references;
    const requestId = crypto.randomUUID();
    const answerId = `${requestId}-answer`;
    active.current = requestId;
    follow.current = true;
    dismissGuide();
    setBusy(true); setFailure(''); setAttention(undefined); setStatus('正在处理');
    setEntries(previous => [...previous, { id: requestId, role: 'user', text: submitted }]);
    const updateAnswer = (text: string, append = false) => setEntries(previous => {
      const found = previous.some(entry => entry.id === answerId);
      return found ? previous.map(entry => entry.id === answerId ? { ...entry, text: append ? entry.text + text : text } : entry)
        : [...previous, { id: answerId, role: 'assistant', text }];
    });
    const text = `你正在 MiniMax Video 中帮助用户编辑工程。当前工程 ID：${props.projectId}。\n使用本 Mini App 的 openchatcut MCP 工具，先 target_project 绑定此 ID，再读取工程、执行编辑。需要编辑时，begin_edit_session 必须使用 approvalMode=manual；草稿完成后必须调用 review_edit_session，才能把可预览的提案交给编辑器。drafting 仅表示草稿，不得宣称提案已送达或要求用户预览；只有待审阅提案已发布才能报告等待用户确认，只有 status=applied 才能报告修改已应用。不得改用 auto 绕过确认。每轮及问卷续答后，先 list_edit_sessions 和 get_edit_session 读取最新草稿及 operations。草稿属于工程，另一对话在线不阻止继续编辑。DRAFT_CHANGED 表示其他对话更新过草稿，重新读取后再修改；DRAFT_BUSY 时等待当前操作结束。projectChanges 是正式工程相对草稿起点的外部变化，不是草稿修改列表。仅对 orphaned=true 且允许 resume 的草稿调用 recover_edit_session action=resume；正式工程版本冲突时停止覆盖，不能自动 discard。保留已生成素材的文件或 URL，导入失败不得重新生成收费素材。不要写源码或直接修改数据库。${generationInstructions}若委派任务，使用前台委派并等待结果。回复简短清楚，先说结果和下一步。信息不够时只问最关键的一个问题，不反复询问已明确的要求。读取和建议不必创建草稿；工具要求草稿时可创建空的 manual 草稿用于检查。涉及画面、字幕、构图的修改后，用真实时间线抽帧检查，先看最多两个代表帧，每次只抽一帧；抽帧失败要说明，不得编造已看过画面。\n用户显式引用的素材或片段（先读取确认类型与存在性）：${JSON.stringify(submittedReferences)}。\n用户要求：${submitted}`;
    try {
      const result = await agent.run({ text, sessionId: root, requestId }, { onEvent(event) {
        if (active.current !== requestId) return;
        if (event.type === 'turn.started' && event.sessionId) {
          rememberSession(event.sessionId);
          // 仅清空已被宿主接收的输入，不覆盖执行期间写下的新草稿。
          if (inputRef.current === submitted) { changeInput(''); setReferences(current => current === submittedReferences ? [] : current); }
        }
        if (event.type === 'run.queued') setStatus(`等待执行${event.position ? ` · 前方 ${event.position - 1} 项` : ''}`);
        if (event.type === 'text.delta') updateAnswer(event.text ?? '', true);
        if (event.type === 'message.committed' && event.text) updateAnswer(event.text);
        if (event.type === 'tool.started') {
          setStatus(assistantToolLabel(event.name ?? ''));
          setEntries(previous => [...previous, { id: crypto.randomUUID(), role: 'tool', text: event.name ?? '工具', state: 'running' }]);
        }
        if (event.type === 'tool.finished') setEntries(previous => {
          const index = previous.findIndex(entry => entry.role === 'tool' && entry.text === event.name && entry.state === 'running');
          return previous.map((entry, i) => i === index ? { ...entry, state: event.ok ? 'done' : 'error' } : entry);
        });
        if (event.type === 'permission.requested' || event.type === 'question.requested') {
          setAttention(event.sessionId);
          setStatus('需要你确认');
        }
      } });
      if (active.current !== requestId) return;
      rememberSession(result.sessionId);
      if (result.text) updateAnswer(result.text);
      setStatus(result.pendingQuestion ? '后续进度请查看完整对话' : result.status === 'finished' ? '回复已完成，请查看结果' : result.status === 'aborted' ? '已停止' : '执行失败');
      if (result.error) setFailure(result.error.message);
      if (result.pendingQuestion) setAttention(result.sessionId);
    } catch (error) {
      if (active.current !== requestId) return;
      setFailure(`执行未完成：${String(error)}。请打开完整对话核对结果后再继续。`);
      setStatus('执行未完成');
    } finally {
      if (active.current === requestId) {
        active.current = undefined; setBusy(false);
        setEntries(previous => previous.map(entry => entry.state === 'running' ? { ...entry, state: 'unknown' } : entry));
      }
    }
  }
  return <>
    <Button ref={launcher} className="miniapp-assistant-launcher" aria-label="打开剪辑助手" aria-expanded={visible} aria-controls="miniapp-assistant" onClick={() => setVisible(value => !value)}>
      <Icon name="sparkles" size={18} /><span>{attention || external.proposal ? '有待确认的编辑' : busy ? '助手正在处理…' : !root && !loadMiniAppGuideSeen() ? '试试 AI 剪辑' : '剪辑助手'}</span>
    </Button>
    <aside id="miniapp-assistant" role="dialog" tabIndex={-1} aria-modal="false" aria-labelledby="miniapp-assistant-title" hidden={!visible} className={`cc-chat-panel miniapp-chat miniapp-chat--floating${expanded ? ' is-expanded' : ''}`} data-cc-shortcut-surface="agent-chat" onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); minimize(); } }}>
    <header className="miniapp-chat__header">
      <div><strong id="miniapp-assistant-title">剪辑助手</strong><small>先预览修改，再由你应用</small></div>
      <Button variant="ghost" size="icon" title="新对话" aria-label="新对话" disabled={busy} onClick={() => root || entries.length ? setNewChatConfirm(true) : newChat()}><Icon name="plus" size={16} /></Button>
      <Button variant="ghost" size="icon" aria-label={expanded ? '恢复对话窗口' : '放大对话窗口'} onClick={() => setExpanded(value => !value)}><Icon name="fullscreen" size={16} /></Button>
      <Button variant="ghost" size="icon" title="收起，任务会继续" aria-label="收起剪辑助手" onClick={minimize}><Icon name="x" size={16} /></Button>
    </header>
    <div className="miniapp-chat__scope"><span>{agent ? '当前工程' : '手动编辑模式'} · {assetCount} 个素材 · {timeline.items.length} 个片段</span><Button variant="ghost" className="miniapp-chat__link" aria-expanded={showGuide} onClick={() => setShowGuide(value => !value)}>使用指南</Button></div>
    {newChatConfirm && <div className="miniapp-chat__notice" role="alert">开始新对话？已有工程和输入草稿会保留。
      <div><Button variant="ghost" className="miniapp-chat__link" onClick={() => setNewChatConfirm(false)}>返回</Button><Button variant="ghost" className="miniapp-chat__link" onClick={newChat}>开始新对话</Button></div>
    </div>}
    <div className="cc-chat-messages-shell">
      <div ref={scroll} className={`cc-chat-messages${entries.length ? '' : ' empty'}`} onScroll={() => { const node = scroll.current; if (node) follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 64; }}>
        {showGuide && <section className="miniapp-chat__guide" aria-label="AI 剪辑使用指南">
          <strong>AI 剪辑，从这里开始</strong>
          <ol><li><b>准备素材</b><span>在“我的素材”上传文件，也可以先聊想法。</span></li><li><b>说出目标</b><span>写用途、时长和风格；局部修改可引用片段。</span></li><li><b>预览后应用</b><span>先预览草稿，勾选要保留的修改，再应用。</span></li></ol>
          <p>图片、视频和语音生成使用你在 MiniMax Code 中配置的能力。未配置也可以用已有素材剪辑。</p>
          <Button variant="outline" size="sm" onClick={dismissGuide}>知道了，开始剪辑</Button>
        </section>}
        {!entries.length && <div className="cc-chat-onboarding">
          <div className="cc-chat-onboarding-kicker">{root ? '继续你的剪辑' : '从这里开工'}</div>
          <h2>{root ? '接着上次继续' : !assetCount && !timeline.items.length ? '先从一个想法开始' : '你想怎么剪？'}</h2>
          <p>{root ? '已有对话和工程草稿会保留。可以先了解进度，再继续修改。' : '选择一个起点，要求会填入下方输入框，确认后再发送。'}</p>
          <div className="cc-chat-starter-list">{starters.map(starter => <Button variant="ghost" key={starter.label} onClick={() => useSuggestion(starter.prompt)}><span className="cc-chat-starter-copy"><strong>{starter.label}</strong><small>{starter.hint}</small></span><span className="cc-chat-starter-arrow">→</span></Button>)}</div>
        </div>}
        {entries.map((entry, index) => {
          if (entry.role !== 'tool') return <ChatMessage key={entry.id} msg={{ role: entry.role, text: entry.text }} streaming={busy && entry.role === 'assistant' && entry.id === entries.at(-1)?.id} />;
          if (entries[index - 1]?.role === 'tool') return null;
          const end = entries.findIndex((item, next) => next > index && item.role !== 'tool');
          const group = entries.slice(index, end < 0 ? undefined : end);
          const running = group.find(item => item.state === 'running');
          const failed = group.filter(item => item.state === 'error').length;
          return <details key={entry.id} className="miniapp-chat__activity">
            <summary>{running ? assistantToolLabel(running.text) : failed ? '部分操作未完成' : '查看执行过程'}<small>{group.length} 步{failed ? ` · ${failed} 步失败` : ''}</small></summary>
            {group.map(item => <div key={item.id} className="miniapp-chat__tool" data-state={item.state} title={item.text}><span className="miniapp-chat__dot" /><span>{assistantToolLabel(item.text)}</span><small>{item.state === 'running' ? '执行中' : item.state === 'done' ? '完成' : item.state === 'error' ? '失败' : '结果待确认'}</small></div>)}
          </details>;
        })}
        {external.proposal && <p className="miniapp-chat__review-help" role="status">{external.proposalStale ? '工程已有其他修改。请先核对差异，避免覆盖已保存的内容。' : '修改尚未应用。先预览，再勾选要保留的修改；不满意可以拒绝后继续提要求。'}</p>}
        <ExternalProposalCard external={external} onPreviewState={props.onPreviewState} />
      </div>
    </div>
    {(failure || attention || !agent) && <div className="miniapp-chat__notice" role="alert">
      {failure || (attention ? '请在完整对话中回答问题或授权，并查看后续进度。编辑提案会显示在这里。' : '请从 MiniMax Code 打开此应用以使用助手。你仍可手动剪辑。')}
      {attention && <Button variant="ghost" className="miniapp-chat__link" onClick={() => void open()}>前往确认</Button>}
    </div>}
    <footer className="miniapp-chat__footer">
      {failure && entries.some(entry => entry.role === 'user') && <Button variant="outline" size="sm" disabled={busy} onClick={() => { const previous = entries.findLast(entry => entry.role === 'user'); if (previous) useSuggestion(previous.text); }}>把上次要求放回输入框</Button>}
      <div className="miniapp-chat__status"><span role="status">{external.proposal ? '修改等待你确认' : attention ? '需要你回答或授权' : status}</span>{root && <Button variant="ghost" type="button" className="miniapp-chat__link" onClick={() => void open(root)}>完整对话</Button>}</div>
      <div className="miniapp-chat__references">
        <Button variant="outline" size="sm" disabled={!agent || busy} title="将检查要求填入输入框，发送后查询，不生成素材" onClick={() => useSuggestion(generationCapabilityPrompt)}>检查生成能力</Button>
        <Button variant="outline" size="sm" disabled={!selected.length} onClick={referenceSelection}>引用选中片段{selected.length ? ` (${selected.length})` : ''}</Button>
        {references.map(reference => <Button variant="secondary" size="sm" key={reference.id} title={reference.name} aria-label={`移除引用：${reference.name}`} onClick={() => setReferences(current => current.filter(item => item.id !== reference.id))}>{reference.name}<Icon name="x" size={12} /></Button>)}
      </div>
      <div className="cc-chat-composer miniapp-chat__composer">
        <Textarea ref={textarea} aria-label="编辑要求" value={input} onChange={event => changeInput(event.target.value)} rows={3} placeholder={assetCount || timeline.items.length ? "例如：剪成 15 秒，保留小狗特写，加上字幕" : "例如：做一条 15 秒的旅行短片，轻松一点"} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} />
        <div className="cc-chat-composer-bar"><span className="miniapp-chat__provider">MiniMax Code</span><span className="miniapp-chat__hint">Shift + Enter 换行</span>
          {busy ? <Button size="icon" className="miniapp-chat__send" aria-label="停止执行" title="停止执行" onClick={() => { if (active.current) { agent?.cancel(active.current); setStatus('正在停止'); } }}><Icon name="x" size={14} /></Button>
          : <Button size="icon" className="miniapp-chat__send" aria-label="发送" title="发送 (Enter)" disabled={!agent || !input.trim()} onClick={() => void submit()}><Icon name="arrowUp" size={16} /></Button>}
        </div>
      </div>
    </footer>
  </aside></>;
}
