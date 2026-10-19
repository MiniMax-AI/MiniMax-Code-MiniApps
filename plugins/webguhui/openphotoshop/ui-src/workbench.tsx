import { t, subscribeLanguage, getLanguage } from './photo-i18n.js';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Button } from './components/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './components/tooltip';
import {
  Move,
  SquareDashed,
  CircleDashed,
  Spline,
  Lasso,
  WandSparkles,
  Crop,
  Paintbrush,
  Paintbrush2,
  Pencil,
  Eraser,
  ScanLine,
  PaintBucket,
  Blend,
  Stamp,
  Bandage,
  Droplets,
  Triangle,
  Fingerprint,
  Sun,
  Moon,
  Contrast,
  Square,
  Circle,
  Minus,
  Star,
  Type,
  PenTool,
  Pipette,
  Ruler,
  Hand,
  RotateCw,
  ZoomIn,
  ZoomOut,
  Undo2,
  Redo2,
  Copy,
  ArrowUp,
  ArrowDown,
  Trash2,
  Plus,
  Save,
  Download,
  Sparkles,
  FolderOpen,
  BookOpen,
  ImagePlus,
  Maximize,
  X,
  Monitor,
} from 'lucide-react';

const toolIcons = {
  move: Move,
  marquee: SquareDashed,
  ellipseSelect: CircleDashed,
  polyLasso: Spline,
  lasso: Lasso,
  wand: WandSparkles,
  crop: Crop,
  brush: Paintbrush,
  pencil: Pencil,
  colorReplace: Paintbrush2,
  magicEraser: WandSparkles,
  backgroundEraser: ScanLine,
  eraser: Eraser,
  fill: PaintBucket,
  gradient: Blend,
  clone: Stamp,
  heal: Bandage,
  blur: Droplets,
  sharpen: Triangle,
  smudge: Fingerprint,
  dodge: Sun,
  burn: Moon,
  sponge: Contrast,
  rect: Square,
  ellipse: Circle,
  line: Minus,
  star: Star,
  text: Type,
  pen: PenTool,
  eyedropper: Pipette,
  ruler: Ruler,
  hand: Hand,
  rotateView: RotateCw,
  zoom: ZoomIn,
};
const groups = [7, 8, 8, 6, 5];
export function mountAgentPanel({ context, submit, dock = false, showResults = () => {} }) {
  const host = document.createElement('div');
  host.id = 'agent-panel-root';
  document.body.append(host);
  let openPanel = () => {},
    updateContext = () => {},
    compose = (text: string) => {};
  function AgentPanel() {
    const language = React.useSyncExternalStore(subscribeLanguage, getLanguage);
    const [open, setOpen] = React.useState(!dock);
    const [position, setPosition] = React.useState<{ x: number; y: number } | null>(null);
    const panelRef = React.useRef<HTMLElement>(null);
    const drag = React.useRef<{ x: number; y: number; left: number; top: number } | null>(null);
    const clampPosition = (x: number, y: number) => ({
      x: Math.max(8, Math.min(x, window.innerWidth - (panelRef.current?.offsetWidth || 360) - 8)),
      y: Math.max(
        56,
        Math.min(y, window.innerHeight - (panelRef.current?.offsetHeight || 260) - 8),
      ),
    });
    React.useEffect(() => {
      if (!dock) return;
      const resize = () => setPosition((p) => (p ? clampPosition(p.x, p.y) : null));
      window.addEventListener('resize', resize);
      return () => window.removeEventListener('resize', resize);
    }, []);
    React.useEffect(() => {
      if (dock && open) void showResults();
    }, [open, language]);
    const closePanel = () => {
      setOpen(false);
      requestAnimationFrame(() => host.querySelector<HTMLButtonElement>('button')?.focus());
    };
    const [current, setCurrent] = React.useState(context);
    const [mode, setMode] = React.useState(dock ? 'auto' : 'workbench');
    const [draft, setDraft] = React.useState('');
    const [pending, setPending] = React.useState(false);
    const [feedback, setFeedback] = React.useState('');
    const [output, setOutput] = React.useState('');
    const [failed, setFailed] = React.useState(false);
    const input = React.useRef<HTMLTextAreaElement>(null);
    const busy = React.useRef(false);
    openPanel = () => {
      setCurrent(context());
      setOpen(true);
      requestAnimationFrame(() => input.current?.focus());
    };
    compose = (text: string) => {
      setDraft(text);
      setFeedback('');
      setOutput('');
      openPanel();
    };
    updateContext = () => setCurrent(context());
    async function send(event) {
      event.preventDefault();
      if (busy.current || !draft.trim()) return;
      busy.current = true;
      setPending(true);
      setFailed(false);
      setFeedback('');
      setOutput('');
      try {
        const result = await submit(mode, draft);
        if (result.delivered) setFeedback('已放入主聊天输入框，请在那里点击发送。');
        else {
          setOutput(result.text);
          setFeedback('需求已准备好，点击下方复制，再到 MiniMax Code 聊天中粘贴发送。');
        }
      } catch (error) {
        setFailed(true);
        setFeedback(error.message);
      } finally {
        busy.current = false;
        setPending(false);
      }
    }
    if (!open)
      return (
        <Button
          className="agent-launcher"
          aria-label={t('打开 AI 助手')}
          aria-expanded={false}
          onClick={openPanel}
        >
          <Sparkles aria-hidden="true" />
          {t('AI 助手')}
        </Button>
      );
    return (
      <section
        ref={panelRef}
        style={
          dock && position
            ? { left: position.x, top: position.y, bottom: 'auto', transform: 'none' }
            : undefined
        }
        className="agent-panel"
        aria-label={t('AI 修图助手')}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            closePanel();
          }
        }}
      >
        <div
          className="agent-panel-heading"
          onPointerDown={(e) => {
            if (!dock || e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
            const rect = panelRef.current!.getBoundingClientRect();
            drag.current = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (drag.current) {
              const d = drag.current;
              setPosition(clampPosition(d.left + e.clientX - d.x, d.top + e.clientY - d.y));
            }
          }}
          onPointerUp={(e) => {
            drag.current = null;
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
        >
          <span>
            <Sparkles size={16} aria-hidden="true" />
            <strong>{t('AI 助手')}</strong>
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('收起 AI 助手')}
            aria-expanded={true}
            onClick={closePanel}
          >
            <Minus aria-hidden="true" />
          </Button>
        </div>
        {
          <p className="agent-context" title={current.name || t('还没有打开图片')}>
            {current.name
              ? t('当前工程 · {name}', { name: current.name })
              : t('描述想法，或先打开一张图片')}
          </p>
        }
        <form onSubmit={send}>
          {!dock && (
            <details className="agent-options" open>
              <summary>{t('高级选项')}</summary>
              <label className="agent-mode">
                {t('任务')}
                <select
                  aria-label={t('AI 任务类型')}
                  value={mode}
                  disabled={pending}
                  onChange={(e) => {
                    setMode(e.target.value);
                    setOutput('');
                    setFeedback('');
                  }}
                >
                  {dock && <option value="auto">{t('自动选择')}</option>}
                  <option value="workbench">{t('编辑工程')}</option>
                  <option value="generate">{t('生成图片')}</option>
                  <option value="edit" disabled={!current.name}>
                    {t('修改图片')}
                  </option>
                </select>
              </label>
            </details>
          )}
          {dock && !draft && (
            <div className="agent-suggestions">
              {[
                ['生成海报', '帮我设计一张咖啡海报，奶油色背景，标题 COFFEE BREAK。'],
                ['改善照片', '请先让我选择一张照片，再改善曝光和色彩，保留自然细节。'],
              ].map(([label, text]) => (
                <Button
                  key={label}
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => compose(t(text))}
                >
                  {t(label)}
                </Button>
              ))}
            </div>
          )}
          <textarea
            ref={input}
            aria-label={t('AI 修图需求')}
            placeholder={t(
              current.name
                ? '想怎么改？比如：背景调暖，加一个白色标题…'
                : '描述你想做的图片，或先打开一张照片…',
            )}
            rows={3}
            maxLength={8000}
            value={draft}
            disabled={pending}
            onChange={(e) => {
              setDraft(e.target.value);
              setOutput('');
              setFeedback('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(e);
              }
            }}
          />
          <div className="agent-send-row">
            <span>{t('Ctrl / ⌘ + Enter')}</span>
            <Button type="submit" size="sm" disabled={!draft.trim() || pending}>
              <ArrowUp aria-hidden="true" />
              {pending
                ? t('正在准备…')
                : current.supported
                  ? t('在 MiniMax Code 中继续')
                  : t('准备需求')}
            </Button>
          </div>
        </form>
        {feedback && (
          <p
            className={failed ? 'agent-feedback error' : 'agent-feedback'}
            role={failed ? 'alert' : 'status'}
          >
            {t(feedback)}
          </p>
        )}
        {output && (
          <div className="agent-copy">
            <details className="agent-copy-details">
              <summary>{t('查看完整需求')}</summary>
              <textarea
                aria-label={t('给 Agent 的需求文本')}
                readOnly
                rows={4}
                value={output}
                onFocus={(e) => e.target.select()}
              />
            </details>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(output);
                  setFeedback('已复制，请粘贴到 MiniMax Code 聊天中发送。');
                } catch {
                  setFailed(true);
                  setFeedback('无法自动复制，请选中文本手动复制。');
                }
              }}
            >
              <Copy aria-hidden="true" />
              {t('复制需求')}
            </Button>
          </div>
        )}
        {dock && (
          <details className="agent-results-area" hidden>
            <summary onClick={showResults}>
              <ImagePlus size={14} />
              {t('AI 返回的图片')}
            </summary>
            <div id="result-list" />
          </details>
        )}
      </section>
    );
  }
  flushSync(() => createRoot(host).render(<AgentPanel />));
  return {
    open: () => openPanel(),
    refresh: () => updateContext(),
    compose: (text: string) => compose(text),
  };
}
function TipButton({ label, icon: Icon, children, ...props }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={label} {...props}>
          <Icon aria-hidden="true" strokeWidth={1.65} />
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
export function mountTools(element, tools, select) {
  let offset = 0;
  flushSync(() =>
    createRoot(element).render(
      <TooltipProvider delayDuration={350}>
        {groups.map((count, group) => {
          const items = tools.slice(offset, (offset += count));
          return (
            <div
              className="tool-group"
              key={group}
              role="group"
              aria-label={['选择与移动', '绘画与擦除', '修饰', '形状与文字', '视图与测量'][group]}
            >
              {items.map(([id, label, key]) => (
                <TipButton
                  key={id}
                  label={label + (key ? ` (${key})` : '')}
                  icon={toolIcons[id]}
                  variant="ghost"
                  size="icon"
                  data-tool={id}
                  aria-pressed={id === 'move'}
                  onClick={() => select(id)}
                />
              ))}
            </div>
          );
        })}
      </TooltipProvider>,
    ),
  );
}
export function mountActions() {
  const actions = {
    'ask-agent': [Sparkles, '交给 Agent', true],
    save: [Save, '保存工程', true],
    export: [Download, '导出图片', true],
    undo: [Undo2, '撤销'],
    redo: [Redo2, '重做'],
    'add-layer': [Plus, '新建透明图层'],
    'duplicate-layer': [Copy, '复制图层'],
    'layer-up': [ArrowUp, '上移图层'],
    'layer-down': [ArrowDown, '下移图层'],
    'delete-layer': [Trash2, '删除图层'],
    'zoom-out': [ZoomOut, '缩小'],
    'zoom-in': [ZoomIn, '放大'],
    fit: [Maximize, '适合窗口', true],
    'agent-results': [ImagePlus, 'Agent 图片', true],
    projects: [FolderOpen, '本地工程', true],
    manual: [BookOpen, '使用说明', true],
    'open-start': [ImagePlus, '打开图片', true],
    'new-start': [Plus, '新建画布', true],
    demo: [Paintbrush, '试用示例', true],
  };
  for (const [id, [Icon, label, text]] of Object.entries(actions)) {
    const old = document.getElementById(id);
    if (!old) continue;
    const host = document.createElement('span');
    host.className = 'action-mount';
    old.replaceWith(host);
    flushSync(() =>
      createRoot(host).render(
        <TooltipProvider delayDuration={350}>
          <TipButton
            id={id}
            type="button"
            label={label}
            icon={Icon}
            variant={['export', 'open-start'].includes(id) ? 'default' : text ? 'outline' : 'ghost'}
            size={text ? 'sm' : 'icon-sm'}
          >
            {text ? label : null}
          </TipButton>
        </TooltipProvider>,
      ),
    );
  }
  const themeRoot = document.createElement('span');
  themeRoot.className = 'action-mount';
  document.querySelector('header').append(themeRoot);
  const media = matchMedia('(prefers-color-scheme: dark)');
  let preference = 'system';
  try {
    preference = localStorage.getItem('retouch-theme') || 'system';
  } catch {}
  function apply() {
    document.documentElement.dataset.theme =
      preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
  }
  apply();
  media.addEventListener('change', apply);
  function ThemeControl() {
    const [choice, setChoice] = React.useState(preference);
    const label = `主题：${{ system: '跟随系统', light: '浅色', dark: '深色' }[choice]}，点击切换`;
    return (
      <TooltipProvider delayDuration={350}>
        <TipButton
          label={label}
          icon={choice === 'system' ? Monitor : choice === 'light' ? Sun : Moon}
          variant="ghost"
          size="icon-sm"
          onClick={() => {
            preference = { system: 'light', light: 'dark', dark: 'system' }[choice];
            try {
              localStorage.setItem('retouch-theme', preference);
            } catch {}
            apply();
            setChoice(preference);
          }}
        />
      </TooltipProvider>
    );
  }
  flushSync(() => createRoot(themeRoot).render(<ThemeControl />));
}

export function mountPhotoToolbar(actions) {
  const host = document.querySelector('#photo-actions');
  const items = [['export', Download, '导出 PNG']];
  let update = (_hasDocument: boolean) => {};
  function Toolbar() {
    React.useSyncExternalStore(subscribeLanguage, getLanguage);
    const [hasDocument, setHasDocument] = React.useState(false);
    update = setHasDocument;
    if (!hasDocument) return null;
    return (
      <TooltipProvider delayDuration={300}>
        {items.map(([key, Icon, label]) => (
          <Tooltip key={key as string}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                data-photo-action={key as string}
                onClick={actions[key as string]}
                aria-label={t(label as string)}
              >
                <Icon size={16} />
                <span>{t(label as string)}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t(label as string)}</TooltipContent>
          </Tooltip>
        ))}
      </TooltipProvider>
    );
  }
  flushSync(() => createRoot(host).render(<Toolbar />));
  return { refresh: (hasDocument: boolean) => update(hasDocument) };
}

export function mountPhotoWelcome({ open, create, choose, openShowcase }) {
  const host = document.createElement('div');
  host.id = 'photo-welcome';
  document.querySelector('.photo-main')!.append(host);
  let update = (_state: any) => {};
  function Welcome() {
    React.useSyncExternalStore(subscribeLanguage, getLanguage);
    const [state, setState] = React.useState({ ready: false, hasDocument: false });
    update = setState;
    if (state.hasDocument) return null;
    return (
      <section className="welcome-content" aria-label={t('开始创作')}>
        <div className="welcome-intro">
          <span className="welcome-eyebrow">
            <Sparkles size={14} /> OpenPhotoShop
          </span>
          <h1>{t('让想法成为图片')}</h1>
          <p>{t('打开图片精细编辑，或把想法交给 AI。')}</p>
          <div className="welcome-actions">
            <Button disabled={!state.ready} onClick={open}>
              <FolderOpen size={16} />
              {t('打开图片')}
            </Button>
            <Button variant="outline" disabled={!state.ready} onClick={create}>
              <Plus size={16} />
              {t('新建画布')}
            </Button>
          </div>
          <small>{t('支持图片、PSD 和可继续编辑的工程文件')}</small>
        </div>
        <div className="welcome-section-title">
          <span>{t('作品展示')}</span>
          <span>{t('AI 生成 · 可打开编辑')}</span>
        </div>
        <div className="welcome-cases showcase-cases">
          {[
            ['静物广告', '砂岩、柔光与鼠尾草绿', 'product'],
            ['落日人像', '暖色光线与自然肤色', 'portrait'],
            ['咖啡海报', '配图与字体的完整画面', 'poster'],
          ].map(([title, description, id]) => (
            <article key={id} className={'welcome-case ' + id}>
              <button
                className="showcase-image"
                disabled={!state.ready}
                onClick={() => openShowcase(id)}
                aria-label={t('打开作品') + ' · ' + t(title)}
              >
                <img src={'/showcase/' + id + '.webp'} alt={t(title)} loading="lazy" />
              </button>
              <div className="showcase-caption">
                <strong>{t(title)}</strong>
                <p>{t(description)}</p>
                <div className="showcase-actions">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!state.ready}
                    onClick={() => openShowcase(id)}
                  >
                    {t('打开作品')}
                    <ArrowUp size={14} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!state.ready}
                    onClick={() => choose(id)}
                  >
                    {t('试试这个')}
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
        <div className="welcome-steps">
          <span>
            <b>1</b>
            {t('打开图片或选择示例')}
          </span>
          <span>
            <b>2</b>
            {t('描述需求，交给 AI 助手')}
          </span>
          <span>
            <b>3</b>
            {t('查看结果，继续编辑和导出')}
          </span>
        </div>
        <p className="welcome-note">{t('打开作品可直接编辑，也可以让 AI 助手帮你继续创作。')}</p>
      </section>
    );
  }
  createRoot(host).render(<Welcome />);
  return {
    refresh(state) {
      host.hidden = state.hasDocument;
      update(state);
    },
  };
}

export { mountPhotoAssistant } from './photo-assistant';
