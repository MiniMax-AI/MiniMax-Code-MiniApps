// 公众号图文工作台 — Client.
//
// The page owns presentation and interaction only. Every business mutation
// goes through the board's own Node service; no connector, credential or
// Host object ever reaches this file.

const main = document.getElementById('app-main');
const toastEl = document.getElementById('toast');
const headerGateNote = document.getElementById('header-gate-note');
const navDraftCount = document.getElementById('nav-draft-count');

const state = {
  view: 'compose',
  snapshot: { drafts: [], styles: [], statusLabels: {}, notice: '' },
  tools: { tools: [], partial: false, error: '' },
  selectedId: null,
  checked: new Set(),
  filter: 'all',
  query: '',
  busy: false,
  exportPreview: null,
  polish: null,
  form: {
    topic: '',
    title: '',
    body: '',
    coverRequirement: '',
    illustrationRequirement: '',
    styleId: 'style-minimal',
    coverRatio: 'wide',
    coverWithTitle: false,
  },
  newStyle: { open: false, name: '', description: '' },
  polishNote: '',
  showStyleForm: false,
  noticeDismissed: false,
};

/* ------------------------------------------------------------------ *
 * Utilities
 * ------------------------------------------------------------------ */

/**
 * @param {unknown} value
 * @returns {string}
 */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * @param {string} message
 * @param {'ok'|'error'|''} tone
 */
function toast(message, tone = '') {
  toastEl.textContent = message;
  toastEl.className = `toast${tone ? ` toast--${tone}` : ''}`;
  toastEl.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toastEl.hidden = true;
  }, 4200);
}

/**
 * @param {string} path
 * @param {RequestInit} [options]
 * @returns {Promise<any>}
 */
async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const error = new Error(payload.message || `请求失败（${response.status}）`);
    error.code = payload.error;
    error.payload = payload;
    throw error;
  }
  return payload;
}

/**
 * @param {string} text
 * @returns {string}
 */
function relativeTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return '';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}

/**
 * @param {any} draft
 * @returns {string}
 */
function statusLabel(draft) {
  return state.snapshot.statusLabels?.[draft.status] || draft.status;
}

/**
 * @param {any} draft
 * @returns {string}
 */
function statusTone(draft) {
  if (draft.status === 'published_api') return 'pill--accent';
  if (draft.status === 'published_manual') return 'pill--ok';
  if (draft.status === 'ready') return 'pill--warn';
  return '';
}

/**
 * @param {any} draft
 * @returns {string}
 */
function duplicateTone(draft) {
  const tone = draft.duplicate?.tone;
  if (tone === 'danger') return 'pill--danger';
  if (tone === 'warn') return 'pill--warn';
  if (tone === 'ok') return 'pill--ok';
  return '';
}

/**
 * @param {any[]} drafts
 * @returns {any[][]}
 */
function groupByArticle(drafts) {
  const groups = new Map();
  for (const draft of drafts) {
    const key = draft.articleId || draft.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(draft);
  }
  return [...groups.values()]
    .map((versions) => versions.sort((a, b) => b.version - a.version))
    .sort((a, b) => String(b[0].updatedAt).localeCompare(String(a[0].updatedAt)));
}

/* ------------------------------------------------------------------ *
 * Render
 * ------------------------------------------------------------------ */

function render() {
  const drafts = state.snapshot.drafts || [];
  navDraftCount.textContent = String(drafts.length);
  for (const button of document.querySelectorAll('.nav-item')) {
    const target = button.dataset.nav;
    if (target === state.view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  const banner = state.noticeDismissed ? '' : renderNotice();
  if (state.view === 'compose') main.innerHTML = banner + renderCompose();
  else if (state.view === 'drafts') main.innerHTML = banner + renderDrafts();
  else if (state.view === 'styles') main.innerHTML = banner + renderStyles();
  else if (state.view === 'detail') main.innerHTML = banner + renderDetail();
  if (state.view === 'detail') {
    const frame = document.getElementById('export-frame');
    if (frame && state.exportPreview) frame.srcdoc = state.exportPreview;
  }
}

/**
 * The board's own notice, for example a state file that could not be read.
 *
 * @returns {string}
 */
function renderNotice() {
  const notice = String(state.snapshot.notice || '').trim();
  if (!notice) return '';
  return `<div class="notice notice--warn" style="margin-bottom:12px;">
      <div class="row" style="justify-content:space-between;align-items:flex-start;">
        <span>${esc(notice)}</span>
        <button class="btn" data-action="dismiss-notice" type="button">知道了</button>
      </div>
    </div>`;
}

function renderCompose() {
  const styles = state.snapshot.styles || [];
  const styleOptions = styles
    .map(
      (style) =>
        `<option value="${esc(style.id)}"${state.form.styleId === style.id ? ' selected' : ''}>${esc(style.name)}${style.builtin ? '' : '（自定义）'}</option>`,
    )
    .join('');

  const styleForm = state.newStyle.open
    ? `<div class="card" style="margin-top:12px;">
        <h3 class="section-title">新建视觉风格</h3>
        <p class="section-desc">风格描述会直接写进封面与插图的生成提示词。</p>
        <div class="field">
          <label class="field__label" for="new-style-name">风格名称</label>
          <input id="new-style-name" type="text" value="${esc(state.newStyle.name)}" placeholder="例如：赛博霓虹" />
        </div>
        <div class="field">
          <label class="field__label" for="new-style-desc">风格描述</label>
          <textarea id="new-style-desc" style="min-height:90px;" placeholder="例如：深色底、霓虹紫蓝、高对比、赛博质感">${esc(state.newStyle.description)}</textarea>
        </div>
        <div class="row">
          <button class="btn btn--primary" data-action="create-style" type="button">创建风格</button>
          <button class="btn" data-action="cancel-style" type="button">取消</button>
        </div>
      </div>`
    : '';

  return `
    <section class="card">
      <div class="card__header">
        <div>
          <h2 class="section-title">新建文章</h2>
          <p class="section-desc">填写主题与正文后，系统会生成封面与插图方案、查重结论和可发布内容。</p>
        </div>
      </div>
      <form id="compose-form" novalidate>
        <div class="field">
          <label class="field__label" for="f-topic">文章主题 <span aria-hidden="true">*</span></label>
          <input id="f-topic" type="text" required value="${esc(state.form.topic)}" placeholder="例如：为什么大部分团队的时间管理都失败了" />
          <p class="field__hint">主题会作为封面与插图提示词的核心依据。</p>
        </div>
        <div class="field">
          <label class="field__label" for="f-title">文章标题</label>
          <input id="f-title" type="text" value="${esc(state.form.title)}" placeholder="留空则使用文章主题" />
        </div>
        <div class="field">
          <label class="field__label" for="f-body">正文 <span aria-hidden="true">*</span></label>
          <textarea id="f-body" required placeholder="支持 ## 二级标题、### 三级标题、&gt; 引用、- 列表、**加粗**">${esc(state.form.body)}</textarea>
          <p class="field__hint">正文结构会被用于拆分插图位置，并把内容转换成公众号可粘贴的格式。</p>
        </div>
        <div class="grid-2">
          <div class="field">
            <label class="field__label" for="f-cover-req">封面需求</label>
            <textarea id="f-cover-req" style="min-height:90px;" placeholder="例如：人物站在窗前，背景是清晨的城市">${esc(state.form.coverRequirement)}</textarea>
          </div>
          <div class="field">
            <label class="field__label" for="f-illus-req">插图需求</label>
            <textarea id="f-illus-req" style="min-height:90px;" placeholder="例如：每张插图配一个简洁的信息图，不出现人物">${esc(state.form.illustrationRequirement)}</textarea>
          </div>
        </div>
        <div class="grid-2">
          <div class="field">
            <label class="field__label" for="f-style">视觉风格</label>
            <select id="f-style">${styleOptions}</select>
            <p class="field__hint">共 ${styles.length} 个可用风格。</p>
          </div>
          <div class="field">
            <label class="field__label" for="f-ratio">封面比例</label>
            <select id="f-ratio">
              <option value="wide"${state.form.coverRatio === 'wide' ? ' selected' : ''}>2.35:1 主封面（900×383）</option>
              <option value="square"${state.form.coverRatio === 'square' ? ' selected' : ''}>1:1 分享缩略图（900×900）</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label class="checkbox">
            <input id="f-cover-text" type="checkbox"${state.form.coverWithTitle ? ' checked' : ''} />
            <span>封面图中排版中文标题文字</span>
          </label>
          <p class="field__hint">默认关闭：公众号标题单独显示，封面带字容易重复。</p>
        </div>
        <div class="row">
          <button class="btn btn--primary" type="submit"${state.busy ? ' disabled' : ''}>保存为草稿</button>
          <button class="btn" data-action="toggle-style-form" type="button">新建视觉风格</button>
        </div>
      </form>
      ${styleForm}
    </section>
  `;
}

function renderDrafts() {
  const all = state.snapshot.drafts || [];
  const query = state.query.trim().toLowerCase();
  const filtered = all.filter((draft) => {
    if (state.filter !== 'all' && draft.status !== state.filter) return false;
    if (!query) return true;
    return `${draft.title} ${draft.topic} ${draft.body}`.toLowerCase().includes(query);
  });
  const groups = groupByArticle(filtered);

  const toolbar = `
    <section class="card">
      <div class="card__header">
        <div>
          <h2 class="section-title">草稿箱</h2>
          <p class="section-desc">同一篇文章的多个版本会归在一起，不同版本和发布状态互不影响。</p>
        </div>
        <div class="toolbar">
          <input id="draft-search" type="text" placeholder="搜索主题或标题" value="${esc(state.query)}" style="width:200px;" />
          <select id="draft-filter" style="width:140px;">
            <option value="all"${state.filter === 'all' ? ' selected' : ''}>全部状态</option>
            <option value="draft"${state.filter === 'draft' ? ' selected' : ''}>草稿</option>
            <option value="ready"${state.filter === 'ready' ? ' selected' : ''}>待发布</option>
            <option value="published_api"${state.filter === 'published_api' ? ' selected' : ''}>已发布（接口）</option>
            <option value="published_manual"${state.filter === 'published_manual' ? ' selected' : ''}>已发布（手动）</option>
          </select>
          <button class="btn btn--danger" data-action="bulk-delete" type="button"${state.checked.size ? '' : ' disabled'}>删除所选（${state.checked.size}）</button>
        </div>
      </div>
      ${
        filtered.length
          ? `<div class="draft-list">${groups.map(renderArticleGroup).join('')}</div>`
          : `<div class="empty-state">
              <h3>${all.length ? '没有符合条件的草稿' : '还没有草稿'}</h3>
              <p>${all.length ? '换个关键词或状态筛选试试。' : '先在「新建文章」里写下主题与正文。'}</p>
            </div>`
      }
    </section>
  `;
  return toolbar;
}

function renderArticleGroup(versions) {
  const head = versions[0];
  return `
    <div class="card" style="padding:14px;">
      <div class="card__header" style="margin-bottom:8px;">
        <div>
          <h3 class="section-title">${esc(head.title || head.topic)}</h3>
          <p class="section-desc">共 ${versions.length} 个版本 · 最近更新 ${esc(relativeTime(head.updatedAt))}</p>
        </div>
      </div>
      <div class="draft-list">
        ${versions.map(renderDraftRow).join('')}
      </div>
    </div>
  `;
}

function renderDraftRow(draft) {
  const words = String(draft.body || '').replace(/\s/g, '').length;
  return `
    <div class="draft-row">
      <input type="checkbox" data-check="${esc(draft.id)}"${state.checked.has(draft.id) ? ' checked' : ''} aria-label="选择 ${esc(draft.title || draft.topic)}" />
      <div class="draft-row__main">
        <span class="draft-row__title">${esc(draft.title || draft.topic)}</span>
        <div class="draft-row__meta">
          <span class="pill${statusTone(draft) ? ` ${statusTone(draft)}` : ''}">${esc(statusLabel(draft))}</span>
          <span class="pill">v${draft.version}</span>
          <span>${esc(draft.styleName)}</span>
          <span>${words} 字</span>
          <span>${esc(relativeTime(draft.updatedAt))}</span>
          ${draft.duplicate && draft.duplicate.score > 0 ? `<span class="pill ${duplicateTone(draft)}">查重 ${draft.duplicate.score}%</span>` : ''}
          ${draft.assets?.cover ? '<span class="pill pill--ok">已出封面</span>' : '<span class="pill">未出封面</span>'}
        </div>
      </div>
      <div class="draft-row__actions">
        <button class="btn btn--link" data-action="open-draft" data-id="${esc(draft.id)}" type="button">详情</button>
        <button class="btn btn--link" data-action="delete-draft" data-id="${esc(draft.id)}" type="button">删除</button>
      </div>
    </div>
  `;
}

function renderStyles() {
  const styles = state.snapshot.styles || [];
  const form = state.showStyleForm
    ? `<section class="card">
        <h2 class="section-title">新建视觉风格</h2>
        <p class="section-desc">新风格会出现在「新建文章」的风格列表里。</p>
        <div class="grid-2">
          <div class="field">
            <label class="field__label" for="s-name">风格名称</label>
            <input id="s-name" type="text" value="${esc(state.newStyle.name)}" placeholder="例如：极简黑白" />
          </div>
          <div class="field">
            <label class="field__label" for="s-desc">风格描述</label>
            <input id="s-desc" type="text" value="${esc(state.newStyle.description)}" placeholder="例如：黑白灰、强对比、几何构图" />
          </div>
        </div>
        <div class="row">
          <button class="btn btn--primary" data-action="create-style" type="button">创建风格</button>
          <button class="btn" data-action="cancel-style" type="button">取消</button>
        </div>
      </section>`
    : '';

  return `
    ${form}
    <section class="card">
      <div class="card__header">
        <div>
          <h2 class="section-title">视觉风格库</h2>
          <p class="section-desc">预置风格可随时使用；自定义风格只保存在本机。</p>
        </div>
        <button class="btn btn--primary" data-action="toggle-style-form" type="button">新建风格</button>
      </div>
      <div class="style-grid">
        ${styles
          .map(
            (style) => `
          <article class="style-card">
            <div class="row" style="justify-content:space-between;">
              <h3 class="section-title" style="font-size:15px;">${esc(style.name)}</h3>
              <span class="pill">${style.builtin ? '预置' : '自定义'}</span>
            </div>
            <div class="style-card__swatches">
              ${(style.palette || []).map((color) => `<span class="style-swatch" style="background:${esc(color)};"></span>`).join('')}
            </div>
            <p class="section-desc" style="margin:0;">${esc(style.tone)}</p>
            ${style.builtin ? '' : `<button class="btn btn--link" data-action="delete-style" data-id="${esc(style.id)}" type="button">删除此风格</button>`}
          </article>`,
          )
          .join('')}
      </div>
    </section>
  `;
}

function renderDetail() {
  const draft = (state.snapshot.drafts || []).find((item) => item.id === state.selectedId);
  if (!draft) {
    return `<section class="card"><div class="empty-state"><h3>草稿不存在</h3><p>它可能已经被删除。</p>
      <button class="btn" data-nav="drafts" type="button">返回草稿箱</button></div></section>`;
  }

  const checks = draft.publishChecks || {};
  const gateOrder = ['account', 'material', 'interface'];
  const allConfirmed = gateOrder.every((key) => checks[key]?.status === 'confirmed');
  const allInterface = gateOrder.every((key) => checks[key]?.status === 'confirmed' && checks[key]?.confirmedBy === 'interface');

  const gateHtml = gateOrder
    .map((key) => {
      const check = checks[key];
      const status = check?.status || 'pending';
      const tone = status === 'confirmed' ? 'pill--ok' : status === 'unavailable' ? 'pill--danger' : 'pill--warn';
      const statusText = status === 'confirmed' ? '已确认' : status === 'unavailable' ? '未接入' : '未确认';
      const via = check?.confirmedBy === 'interface' ? '接口检测' : check?.confirmedBy === 'manual' ? '人工确认' : '—';
      return `
        <div class="gate-item">
          <div>
            <div class="row">
              <span class="gate-item__label">${esc(check?.label || key)}</span>
              <span class="pill ${tone}">${statusText}</span>
              <span class="pill">${via}</span>
            </div>
            <p class="gate-item__note">${esc(check?.note || '尚未检查。点击「重新检测」扫描本机已连接的接口。')}</p>
            ${
              (check?.detected || []).length
                ? `<p class="gate-item__note mono">检测到：${esc(check.detected.join('、'))}</p>`
                : ''
            }
          </div>
          <div class="row">
            <button class="btn" data-action="confirm-check" data-key="${key}" data-id="${esc(draft.id)}" type="button">我已确认</button>
            ${
              check?.status === 'confirmed'
                ? `<button class="btn btn--link" data-action="confirm-check" data-key="${key}" data-id="${esc(draft.id)}" data-confirmed="0" type="button">撤销</button>`
                : ''
            }
          </div>
        </div>`;
    })
    .join('');

  const plan = draft.plan || { cover: null, illustrations: [] };
  const coverSlot = plan.cover;
  const illustrationSlots = plan.illustrations || [];

  const assetImage = (asset) =>
    asset ? `<img src="/api/assets/${esc(asset.assetId)}" alt="${esc(asset.role || '配图')}" />` : '';

  const slotCard = (slot, asset) => `
    <article class="plan-slot">
      <div class="plan-slot__media">
        ${
          asset
            ? assetImage(asset)
            : `<p class="plan-slot__placeholder">尚未渲染<br />${esc(slot.ratio)} · ${esc(slot.pixels)}</p>`
        }
      </div>
      <div class="plan-slot__body">
        <div class="row" style="justify-content:space-between;">
          <span class="pill">${esc(slot.role)}</span>
          <span class="pill">${esc(slot.ratio)} · ${esc(slot.pixels)}</span>
        </div>
        <p class="section-desc" style="margin:0;">${esc(slot.anchor)}</p>
        <ul class="check-list">${(slot.checklist || []).map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
        <details>
          <summary class="section-desc" style="cursor:pointer;">生成提示词</summary>
          <pre class="prompt-box">${esc(slot.prompt)}</pre>
        </details>
      </div>
    </article>`;

  const coverAsset = draft.assets?.cover;
  const illustrationAssets = draft.assets?.illustrations || {};

  const duplicateBlock = draft.duplicate
    ? `<div class="notice notice--${draft.duplicate.tone === 'danger' ? 'danger' : draft.duplicate.tone === 'warn' ? 'warn' : 'ok'}">
        ${esc(draft.duplicate.verdict)}${
          draft.duplicate.score > 0 ? `（最高重合度 ${draft.duplicate.score}%）` : ''
        }
      </div>
      ${
        (draft.duplicate.compared || []).length
          ? `<dl class="meta-list" style="margin-top:12px;">
              ${draft.duplicate.compared
                .map(
                  (item) =>
                    `<dt>${esc(item.relation)}</dt><dd>${esc(item.title)} · v${item.version} · ${esc(item.detail)}</dd>`,
                )
                .join('')}
            </dl>`
          : ''
      }`
    : '';

  const polishState = state.polish && state.polish.draftId === draft.id ? state.polish : null;
  const polishTone = !polishState
    ? ''
    : polishState.status === 'failed'
      ? 'danger'
      : polishState.status === 'done'
        ? polishState.committed
          ? 'ok'
          : 'warn'
        : '';
  const polishBlock = polishState
    ? `<div class="notice notice--${polishTone}">
        <div class="row" style="justify-content:space-between;">
          <span>${esc(polishState.message)}</span>
          <span class="pill">${esc(polishState.status)}</span>
        </div>
        ${
          polishState.permission
            ? `<div class="row" style="margin-top:8px;">
                <span>Agent 请求调用 ${esc(polishState.permission.toolName)}</span>
                <button class="btn" data-action="polish-permission" data-decision="allowOnce" type="button">允许一次</button>
                <button class="btn btn--link" data-action="polish-permission" data-decision="deny" type="button">拒绝</button>
              </div>`
            : ''
        }
        ${
          polishState.question
            ? `<div class="stack" style="margin-top:8px;">
                ${(polishState.question.steps || [])
                  .map(
                    (step) => `<div class="field">
                      <span class="field__label">${esc(step.question)}</span>
                      <div class="row">
                        ${(step.options || [])
                          .map(
                            (option) => `<button class="btn" data-action="polish-answer" data-step="${esc(step.id)}" data-option="${esc(option.id)}" type="button">${esc(option.label)}</button>`,
                          )
                          .join('')}
                      </div>
                    </div>`,
                  )
                  .join('')}
              </div>`
            : ''
        }
      </div>`
    : '';

  return `
    <section class="card">
      <div class="card__header">
        <div>
          <div class="row">
            <button class="btn btn--link" data-nav="drafts" type="button">← 草稿箱</button>
            <span class="pill${statusTone(draft) ? ` ${statusTone(draft)}` : ''}">${esc(statusLabel(draft))}</span>
            <span class="pill">v${draft.version}</span>
            <span class="pill">${esc(draft.styleName)}</span>
          </div>
          <h2 class="section-title" style="margin-top:6px;">${esc(draft.title || draft.topic)}</h2>
          <p class="section-desc">${esc(draft.topic)}</p>
        </div>
        <div class="toolbar">
          <button class="btn" data-action="open-draft" data-id="${esc(draft.id)}" type="button">编辑内容</button>
          <button class="btn" data-action="render" data-target="all" data-id="${esc(draft.id)}" type="button"${state.busy ? ' disabled' : ''}>渲染封面与插图</button>
        </div>
      </div>
      ${
        draft.versionSource === 'agent'
          ? '<div class="notice">此版本由 Agent 润色生成，上一版本仍然保留在草稿箱中。</div>'
          : ''
      }
      ${
        draft.assetsInheritedFrom
          ? `<div class="notice">配图继承自 v${draft.assetsInheritedFrom}，正文已改动，建议重新渲染。</div>`
          : ''
      }
    </section>

    <section class="card">
      <h2 class="section-title">内容概览</h2>
      <p class="section-desc">摘要与标题候选由正文规则提取，可直接编辑后使用。</p>
      <dl class="meta-list" style="margin-top:12px;">
        <dt>摘要</dt><dd>${esc(draft.derived?.digest || '（正文缺少可用段落）')}</dd>
        <dt>标题候选</dt><dd>${(draft.derived?.titleCandidates || []).map((item) => esc(item)).join(' / ') || '（无）'}</dd>
        <dt>正文字数</dt><dd>${String(draft.body || '').replace(/\s/g, '').length} 字</dd>
        <dt>结构</dt><dd>${(draft.derived?.outline || []).length ? esc(draft.derived.outline.join(' / ')) : '（没有使用 ## 标题）'}</dd>
        <dt>封面比例</dt><dd>${draft.coverRatio === 'square' ? '1:1 分享缩略图（900×900）' : '2.35:1 主封面（900×383）'}</dd>
      </dl>
    </section>

    <section class="card">
      <h2 class="section-title">查重结论</h2>
      <p class="section-desc">与上一条草稿、上一篇已发布文章比对标题、正文与要点。</p>
      <div style="margin-top:12px;">${duplicateBlock}</div>
    </section>

    <section class="card">
      <div class="card__header">
        <div>
          <h2 class="section-title">封面与插图方案</h2>
          <p class="section-desc">方案由主题、正文结构与视觉风格推导；渲染会调用图像生成能力并消耗对应额度。</p>
        </div>
        <div class="toolbar">
          <button class="btn" data-action="render" data-target="cover" data-id="${esc(draft.id)}" type="button"${state.busy ? ' disabled' : ''}>仅渲染封面</button>
          <button class="btn" data-action="render" data-target="illustrations" data-id="${esc(draft.id)}" type="button"${state.busy ? ' disabled' : ''}>仅渲染插图</button>
          ${state.tools.tools.some((tool) => tool.permission === 'ask' && tool.name.includes('generate_image')) ? '<button class="btn" data-action="authorize-tool" type="button">授权图片渲染能力</button>' : ''}
        </div>
      </div>
      <div class="grid-2" style="margin-top:12px;">
        ${coverSlot ? slotCard(coverSlot, coverAsset) : ''}
        ${illustrationSlots.map((slot) => slotCard(slot, illustrationAssets[slot.id])).join('')}
      </div>
      ${state.tools.error ? `<div class="notice notice--warn" style="margin-top:12px;">${esc(state.tools.error)}</div>` : ''}
      ${
        state.renderFailures && state.renderFailures.draftId === draft.id && state.renderFailures.failures.length
          ? `<div class="notice notice--warn" style="margin-top:12px;">
              ${state.renderFailures.failures
                .map((failure) => `${esc(failure.role || failure.slotId)}：${esc(failure.reason)}`)
                .join('<br />')}
            </div>`
          : ''
      }
    </section>

    <section class="card">
      <h2 class="section-title">正文润色</h2>
      <p class="section-desc">交给 Agent 改写正文，结果会保存为新版本，原版本保留。</p>
      <div class="field" style="margin-top:12px;">
        <label class="field__label" for="polish-note">额外要求（可选）</label>
        <input id="polish-note" type="text" value="${esc(state.polishNote)}" placeholder="例如：控制在 1200 字以内，口语化一些" />
      </div>
      <div class="row">
        <button class="btn" data-action="start-polish" data-id="${esc(draft.id)}" type="button"${state.busy ? ' disabled' : ''}>交给 Agent 润色</button>
        ${polishState && polishState.status === 'running' ? `<button class="btn btn--link" data-action="cancel-polish" type="button">取消</button>` : ''}
      </div>
      ${polishBlock}
    </section>

    <section class="card">
      <div class="card__header">
        <div>
          <h2 class="section-title">发布前检查</h2>
          <p class="section-desc">三项全部确认之前，内容只会保持为草稿。</p>
        </div>
        <button class="btn" data-action="publish-check" data-id="${esc(draft.id)}" type="button"${state.busy ? ' disabled' : ''}>重新检测</button>
      </div>
      <div style="margin-top:8px;">${gateHtml}</div>
      <div class="notice notice--${allConfirmed ? 'ok' : 'warn'}" style="margin-top:12px;">
        ${
          allConfirmed
            ? '三项检查均已确认，可以选择发布方式。'
            : '仍有检查项未确认，本应用不会执行任何发布动作。'
        }
      </div>
      <div class="row" style="margin-top:12px;">
        <button class="btn btn--primary" data-action="publish" data-mode="api" data-id="${esc(draft.id)}" type="button"${allInterface ? '' : ' disabled'}>通过接口发布</button>
        <button class="btn" data-action="publish" data-mode="manual" data-id="${esc(draft.id)}" type="button"${allConfirmed ? '' : ' disabled'}>记录为已发布（手动）</button>
      </div>
      ${
        allInterface
          ? ''
          : '<p class="field__hint" style="margin-top:8px;">「通过接口发布」需要本机连接公众号发布接口；当前未检测到，因此不可用。</p>'
      }
      ${
        draft.publish
          ? `<p class="field__hint" style="margin-top:8px;">发布记录：${esc(draft.publish.mode === 'api' ? '接口发布' : '手动标记')} · ${esc(new Date(draft.publish.at).toLocaleString('zh-CN'))}${
              draft.publish.interfaceName ? ` · ${esc(draft.publish.interfaceName)}` : ''
            }。${esc(draft.publish.note || '')}</p>`
          : ''
      }
    </section>

    <section class="card">
      <div class="card__header">
        <div>
          <h2 class="section-title">可发布内容</h2>
          <p class="section-desc">已转换为公众号可直接粘贴的内联样式正文，图片已内嵌。</p>
        </div>
        <div class="toolbar">
          <button class="btn" data-action="preview-export" data-id="${esc(draft.id)}" type="button">预览</button>
          <button class="btn" data-action="copy-export" data-id="${esc(draft.id)}" type="button">复制正文</button>
          <button class="btn btn--primary" data-action="download-export" data-id="${esc(draft.id)}" type="button">下载 HTML</button>
        </div>
      </div>
      <div class="export-preview" id="export-preview"${state.exportPreview ? '' : ' hidden'}>
        <iframe id="export-frame" title="可发布内容预览" sandbox=""></iframe>
      </div>
      ${state.exportPreview ? '' : '<p class="section-desc">点击「预览」查看排版结果。</p>'}
    </section>

    <section class="card">
      <h2 class="section-title">编辑正文与需求</h2>
      <form id="detail-form" novalidate>
        <div class="grid-2">
          <div class="field">
            <label class="field__label" for="d-title">标题</label>
            <input id="d-title" type="text" value="${esc(draft.title)}" />
          </div>
          <div class="field">
            <label class="field__label" for="d-topic">主题</label>
            <input id="d-topic" type="text" value="${esc(draft.topic)}" />
          </div>
        </div>
        <div class="field">
          <label class="field__label" for="d-body">正文（改动会保存为新版本）</label>
          <textarea id="d-body">${esc(draft.body)}</textarea>
        </div>
        <div class="grid-2">
          <div class="field">
            <label class="field__label" for="d-cover-req">封面需求</label>
            <textarea id="d-cover-req" style="min-height:80px;">${esc(draft.coverRequirement)}</textarea>
          </div>
          <div class="field">
            <label class="field__label" for="d-illus-req">插图需求</label>
            <textarea id="d-illus-req" style="min-height:80px;">${esc(draft.illustrationRequirement)}</textarea>
          </div>
        </div>
        <div class="row">
          <button class="btn btn--primary" type="submit">保存修改</button>
          <span class="field__hint">正文改动会生成新版本，旧版本仍在草稿箱。</span>
        </div>
      </form>
    </section>
  `;
}

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

async function refresh() {
  const data = await api('/api/state');
  state.snapshot = data;
  const published = (data.drafts || []).filter((draft) => draft.status.startsWith('published')).length;
  const pending = (data.drafts || []).length - published;
  headerGateNote.textContent = published
    ? `${published} 篇已发布 · ${pending} 篇仍为草稿`
    : `${pending} 篇草稿，尚未发布任何内容`;
  if (state.view === 'detail' && state.selectedId && !(data.drafts || []).some((draft) => draft.id === state.selectedId)) {
    state.selectedId = null;
    state.view = 'drafts';
  }
  render();
}

async function loadTools() {
  try {
    state.tools = await api('/api/tools');
  } catch {
    state.tools = { tools: [], partial: false, error: '工具清单读取失败' };
  }
}

/**
 * @param {string} path
 * @param {string} method
 * @param {any} body
 */
async function send(path, method, body) {
  const data = await api(path, { method, body: JSON.stringify(body || {}) });
  if (data.snapshot) state.snapshot = data.snapshot;
  return data;
}

/**
 * @param {string} message
 * @param {any} error
 */
function reportError(message, error) {
  console.error(message, error);
  toast(`${message}：${error?.message || '未知错误'}`, 'error');
}

/* ------------------------------------------------------------------ *
 * Polish polling
 * ------------------------------------------------------------------ */

let polishTimer = null;

function startPolishPolling(callId, draftId) {
  clearInterval(polishTimer);
  polishTimer = setInterval(async () => {
    try {
      const data = await api(`/api/polish/${encodeURIComponent(callId)}`);
      const call = data.call;
      if (data.snapshot) state.snapshot = data.snapshot;
      state.polish = {
        draftId,
        status: call.status,
        message:
          call.status === 'done'
            ? call.committed
              ? call.committedVersion
                ? `润色完成，已保存为 v${call.committedVersion}`
                : '润色完成，已保存为新版本'
              : '润色完成，但没有保存为新版本，草稿保持不变'
            : call.status === 'failed'
              ? `润色失败${call.failureCode ? `（${call.failureCode}）` : ''}`
              : call.status === 'waiting_answer'
                ? 'Agent 在等待你的回答'
                : 'Agent 正在润色…',
        committed: Boolean(call.committed),
        committedVersion: call.committedVersion || 0,
        permission: call.permission,
        question: call.question,
      };
      render();
      if (['done', 'failed', 'cancelled'].includes(call.status)) {
        clearInterval(polishTimer);
        polishTimer = null;
        await refresh();
      }
    } catch (error) {
      clearInterval(polishTimer);
      polishTimer = null;
      reportError('读取润色状态失败', error);
    }
  }, 1200);
}

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

document.addEventListener('click', async (event) => {
  const navButton = event.target.closest('[data-nav]');
  if (navButton) {
    state.view = navButton.dataset.nav;
    state.exportPreview = null;
    render();
    return;
  }

  const actionEl = event.target.closest('[data-action]');
  if (!actionEl) return;
  const action = actionEl.dataset.action;
  const id = actionEl.dataset.id;

  try {
    if (action === 'dismiss-notice') {
      // The notice stays in the saved state and comes back on the next reload;
      // dismissing it only hides it for this session.
      state.noticeDismissed = true;
      render();
      return;
    }

    if (action === 'open-draft') {
      state.selectedId = id;
      state.view = 'detail';
      state.exportPreview = null;
      state.polish = null;
      render();
      return;
    }

    if (action === 'delete-draft') {
      const draft = (state.snapshot.drafts || []).find((item) => item.id === id);
      if (!draft) return;
      const isPublished = draft.status.startsWith('published');
      const confirmed = window.confirm(
        isPublished
          ? `「${draft.title || draft.topic}」是已发布记录，仍要删除吗？`
          : `确定删除「${draft.title || draft.topic}」这个版本吗？`,
      );
      if (!confirmed) return;
      await send(`/api/drafts/${encodeURIComponent(id)}?allowPublished=1`, 'DELETE');
      state.checked.delete(id);
      await refresh();
      toast('已删除该版本', 'ok');
      return;
    }

    if (action === 'bulk-delete') {
      const ids = [...state.checked];
      if (!ids.length) return;
      const confirmed = window.confirm(`确定删除所选的 ${ids.length} 个版本吗？此操作不可撤销。`);
      if (!confirmed) return;
      const result = await send('/api/drafts/bulk-delete', 'POST', { ids, allowPublished: true });
      state.checked.clear();
      await refresh();
      toast(
        result.blocked?.length ? `已删除 ${result.removed.length} 个，${result.blocked.length} 个已发布记录被保留` : `已删除 ${result.removed.length} 个版本`,
        'ok',
      );
      return;
    }

    if (action === 'toggle-style-form') {
      state.newStyle = { open: true, name: '', description: '' };
      state.showStyleForm = true;
      render();
      return;
    }

    if (action === 'cancel-style') {
      state.newStyle = { open: false, name: '', description: '' };
      state.showStyleForm = false;
      render();
      return;
    }

    if (action === 'create-style') {
      const name = document.getElementById('new-style-name')?.value || document.getElementById('s-name')?.value || '';
      const description = document.getElementById('new-style-desc')?.value || document.getElementById('s-desc')?.value || '';
      if (!name.trim() || !description.trim()) {
        toast('请填写风格名称与描述', 'error');
        return;
      }
      await send('/api/styles', 'POST', { name: name.trim(), description: description.trim() });
      state.newStyle = { open: false, name: '', description: '' };
      state.showStyleForm = false;
      await refresh();
      toast('风格已创建', 'ok');
      return;
    }

    if (action === 'delete-style') {
      if (!window.confirm('确定删除这个自定义风格吗？')) return;
      await send(`/api/styles/${encodeURIComponent(id)}`, 'DELETE');
      await refresh();
      toast('风格已删除', 'ok');
      return;
    }

    if (action === 'render') {
      state.busy = true;
      render();
      try {
        const result = await send(`/api/drafts/${encodeURIComponent(id)}/render`, 'POST', {
          target: actionEl.dataset.target || 'all',
        });
        await refresh();
        const failures = result.failures || [];
        state.renderFailures = { draftId: id, failures };
        await refresh();
        const detail = failures.length ? `，${failures.length} 个失败：${failures[0].reason}` : '';
        toast(`已渲染 ${result.rendered} 张图片${detail}`, failures.length ? 'error' : 'ok');
      } finally {
        state.busy = false;
        render();
      }
      return;
    }

    if (action === 'authorize-tool') {
      const names = state.tools.tools
        .filter((tool) => tool.name.includes('generate_image') && tool.permission === 'ask')
        .map((tool) => tool.name);
      const request = window.mcode?.miniapp?.tool?.request;
      if (!request || !names.length) {
        toast('当前没有需要授权的工具', 'error');
        return;
      }
      const result = await request(names);
      await loadTools();
      render();
      const denied = names.filter((name) => result[name] === 'deny');
      toast(denied.length ? '图片渲染能力被拒绝，渲染仍会按权限规则询问' : '图片渲染能力已授权', denied.length ? 'error' : 'ok');
      return;
    }

    if (action === 'publish-check') {
      state.busy = true;
      render();
      try {
        const result = await send(`/api/drafts/${encodeURIComponent(id)}/publish-check`, 'POST', {});
        await refresh();
        const detected = result.wechatTools?.length || 0;
        toast(detected ? `检测到 ${detected} 个公众号相关接口` : '本机未连接公众号接口，内容保持为草稿', detected ? 'ok' : '');
      } finally {
        state.busy = false;
        render();
      }
      return;
    }

    if (action === 'confirm-check') {
      const confirmed = actionEl.dataset.confirmed !== '0';
      await send(`/api/drafts/${encodeURIComponent(id)}/confirm-check`, 'POST', {
        key: actionEl.dataset.key,
        confirmed,
      });
      await refresh();
      toast(confirmed ? '已记录你的确认' : '已撤销确认', 'ok');
      return;
    }

    if (action === 'publish') {
      const mode = actionEl.dataset.mode;
      if (mode === 'manual') {
        const confirmed = window.confirm('确认你已经在公众号后台发布了这篇文章？应用只记录状态，不会调用任何发布接口。');
        if (!confirmed) return;
      } else {
        const confirmed = window.confirm(
          '将通过本机检测到的公众号发布接口真实提交这篇文章。确认发布？',
        );
        if (!confirmed) return;
      }
      const result = await send(`/api/drafts/${encodeURIComponent(id)}/publish`, 'POST', { mode });
      await refresh();
      toast(result.message || '已更新发布状态', 'ok');
      return;
    }

    if (action === 'preview-export' || action === 'copy-export') {
      const data = await api(`/api/export/${encodeURIComponent(id)}`);
      if (action === 'copy-export') {
        try {
          await navigator.clipboard.writeText(data.html);
          toast('正文 HTML 已复制到剪贴板', 'ok');
        } catch {
          toast('复制失败，请改用预览后手动选择', 'error');
        }
        return;
      }
      state.exportPreview = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:16px;background:#fff;}</style></head><body>${data.html}</body></html>`;
      render();
      return;
    }

    if (action === 'download-export') {
      const response = await fetch(`/api/export/${encodeURIComponent(id)}?download=1`);
      if (!response.ok) {
        toast('下载失败', 'error');
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `公众号-${id.slice(0, 6)}.html`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast('已下载可发布 HTML', 'ok');
      return;
    }

    if (action === 'start-polish') {
      state.busy = true;
      render();
      try {
        const noteInput = document.getElementById('polish-note');
        state.polishNote = noteInput ? noteInput.value : state.polishNote;
        const result = await api('/api/polish', { method: 'POST', body: JSON.stringify({ draftId: id, note: state.polishNote }) });
        state.polish = { draftId: id, status: 'running', message: 'Agent 正在润色…', permission: null, question: null };
        startPolishPolling(result.callId, id);
        toast('已交给 Agent 润色');
      } finally {
        state.busy = false;
        render();
      }
      return;
    }

    if (action === 'cancel-polish') {
      const callId = state.polish?.callId;
      if (!callId) return;
      await api(`/api/polish/${encodeURIComponent(callId)}/cancel`, { method: 'POST', body: '{}' });
      clearInterval(polishTimer);
      polishTimer = null;
      state.polish = null;
      render();
      toast('已请求取消');
      return;
    }

    if (action === 'polish-permission') {
      const callId = state.polish?.callId;
      if (!callId) return;
      const result = await api(`/api/polish/${encodeURIComponent(callId)}/permission`, {
        method: 'POST',
        body: JSON.stringify({ decision: actionEl.dataset.decision }),
      });
      state.polish.permission = null;
      render();
      toast(result.message, result.ok ? 'ok' : 'error');
      return;
    }

    if (action === 'polish-answer') {
      const callId = state.polish?.callId;
      if (!callId) return;
      const stepId = actionEl.dataset.step;
      const optionId = actionEl.dataset.option;
      const question = state.polish.question;
      const answers = (question?.steps || []).map((step) => ({
        stepId: step.id,
        selectedOptionIds: step.id === stepId ? [optionId] : [],
        selectedOther: false,
        skipped: step.id !== stepId,
      }));
      const result = await api(`/api/polish/${encodeURIComponent(callId)}/answer`, {
        method: 'POST',
        body: JSON.stringify({ answers }),
      });
      state.polish.question = null;
      render();
      toast(result.message, result.ok ? 'ok' : 'error');
      return;
    }
  } catch (error) {
    reportError('操作失败', error);
  }
});

/**
 * Compose form field -> state key. The live DOM is mirrored into state on
 * every input so a re-render can never discard what the user has typed or
 * selected.
 */
const COMPOSE_FIELDS = {
  'f-topic': 'topic',
  'f-title': 'title',
  'f-body': 'body',
  'f-cover-req': 'coverRequirement',
  'f-illus-req': 'illustrationRequirement',
  'f-style': 'styleId',
  'f-ratio': 'coverRatio',
  'f-cover-text': 'coverWithTitle',
};

document.addEventListener('input', (event) => {
  const target = event.target;
  const key = COMPOSE_FIELDS[target.id];
  if (key) state.form[key] = target.type === 'checkbox' ? target.checked : target.value;
  if (target.id === 'draft-search') {
    state.query = target.value;
    render();
    const input = document.getElementById('draft-search');
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
    return;
  }
  if (target.id === 'polish-note') state.polishNote = target.value;
});

document.addEventListener('change', (event) => {
  const target = event.target;
  const key = COMPOSE_FIELDS[target.id];
  if (key) state.form[key] = target.type === 'checkbox' ? target.checked : target.value;
  if (target.dataset && target.dataset.check) {
    if (target.checked) state.checked.add(target.dataset.check);
    else state.checked.delete(target.dataset.check);
    render();
    return;
  }
  if (target.id === 'draft-filter') {
    state.filter = target.value;
    render();
  }
});

document.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;

  if (form.id === 'compose-form') {
    // Read every field before anything re-renders the form.
    const payload = {
      topic: document.getElementById('f-topic').value.trim(),
      title: document.getElementById('f-title').value.trim(),
      body: document.getElementById('f-body').value.trim(),
      coverRequirement: document.getElementById('f-cover-req').value.trim(),
      illustrationRequirement: document.getElementById('f-illus-req').value.trim(),
      styleId: document.getElementById('f-style').value,
      coverRatio: document.getElementById('f-ratio').value,
      coverWithTitle: document.getElementById('f-cover-text').checked,
    };
    if (!payload.topic || !payload.body) {
      toast('文章主题与正文都不能为空', 'error');
      return;
    }
    Object.assign(state.form, payload);
    try {
      state.busy = true;
      render();
      const result = await api('/api/drafts', { method: 'POST', body: JSON.stringify(payload) });
      state.snapshot = result.snapshot;
      state.form = {
        topic: '',
        title: '',
        body: '',
        coverRequirement: '',
        illustrationRequirement: '',
        styleId: payload.styleId,
        coverRatio: payload.coverRatio,
        coverWithTitle: false,
      };
      state.selectedId = result.draft.id;
      state.view = 'detail';
      await refresh();
      toast('草稿已保存', 'ok');
    } catch (error) {
      reportError('保存草稿失败', error);
    } finally {
      state.busy = false;
      render();
    }
    return;
  }

  if (form.id === 'detail-form') {
    const id = state.selectedId;
    // Read every field before anything re-renders the detail view.
    const payload = {
      title: document.getElementById('d-title').value.trim(),
      topic: document.getElementById('d-topic').value.trim(),
      body: document.getElementById('d-body').value,
      coverRequirement: document.getElementById('d-cover-req').value.trim(),
      illustrationRequirement: document.getElementById('d-illus-req').value.trim(),
    };
    try {
      state.busy = true;
      render();
      const result = await api(`/api/drafts/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      state.snapshot = result.snapshot;
      if (result.draft && result.draft.id !== id) {
        state.selectedId = result.draft.id;
      }
      await refresh();
      const previousVersion = (state.snapshot.drafts || []).find((draft) => draft.id === id)?.version;
      toast(
        previousVersion && result.draft.version > previousVersion ? '已保存为新版本' : '已保存',
        'ok',
      );
    } catch (error) {
      reportError('保存失败', error);
    } finally {
      state.busy = false;
      render();
    }
  }
});

/* ------------------------------------------------------------------ *
 * Host appearance
 * ------------------------------------------------------------------ */

// Follow the Host's effective theme when the bridge is available; fall back
// to prefers-color-scheme otherwise (the stylesheet owns that default).
function subscribeHostAppearance() {
  const miniAppHost = window.mcode?.miniapp?.host;
  if (!miniAppHost?.ui?.subscribe) return;
  const subscription = miniAppHost.ui.subscribe(
    ({ theme, language }) => {
      if (theme === 'light' || theme === 'dark') {
        document.documentElement.dataset.theme = theme;
      }
      if (language) document.documentElement.lang = language;
    },
    {
      onError: ({ code }) => {
        console.warn('Host appearance unavailable:', code);
      },
    },
  );
  window.addEventListener('pagehide', () => subscription?.dispose(), { once: true });
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

async function boot() {
  try {
    subscribeHostAppearance();
    await loadTools();
    await refresh();
  } catch (error) {
    main.innerHTML = `<section class="card"><div class="notice notice--danger">工作台载入失败：${esc(error.message)}</div></section>`;
  }
}

void boot();
