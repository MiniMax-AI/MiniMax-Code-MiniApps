// @ts-check
// Drawer, overlays (new/search palette, create Bot, create group, settings) and context menu.
import { renderExecutionRecords } from './execution-records.js';
import { PALETTES, PALETTE_IDS, SKINS, SKIN_IDS, botMark, inkOf } from './octopus.js';
import { escapeHtml } from './markdown.js';
import { localeTag } from './i18n.js';
import {
  api,
  applyAppearance,
  botById,
  canOpenSession,
  chatName,
  clockLabel,
  confirmAction,
  copyText,
  fmtDuration,
  fmtNum,
  groupById,
  groupMarkOf,
  guard,
  h,
  icon,
  fetchAllMessages,
  loadState,
  markOf,
  membersOf,
  nav,
  openSession,
  prefs,
  savePrefs,
  setLanguage,
  state,
  t,
  targetOf,
  toast,
  transcriptMarkdown,
} from './core.js';

const drawer = /** @type {HTMLElement} */ (document.getElementById('drawer'));
const overlayRoot = /** @type {HTMLElement} */ (document.getElementById('overlay-root'));

// ================================================================== drawer
export function renderDrawer() {
  const chatId = state.current;
  if (!state.drawer.open || !chatId) {
    drawer.hidden = true;
    drawer.replaceChildren();
    return;
  }
  const target = targetOf(chatId);
  if (!target.bot && !target.group) {
    state.drawer.open = false;
    drawer.hidden = true;
    return;
  }
  drawer.hidden = false;
  const view = state.drawer.view;
  const viewKey = `${chatId}:${view}:${view === 'memory' ? state.drawer.memTab : ''}`;
  if (drawer.dataset.viewKey === viewKey && (
    (view === 'settings' && state.drawer.dirty) ||
    (view === 'memory' && drawer.querySelector('[data-editing="true"], [data-saving="true"]'))
  )) return;
  drawer.dataset.viewKey = viewKey;
  if (view === 'execution') return renderExecutionRecords(drawer, subBar(t('execution.title')), chatId, (scope) => openOverlay({ kind: 'settings', page: 'memory', scope }));
  if (view === 'settings') return target.bot ? botSettingsView(target.bot) : groupSettingsView(target.group);
  if (view === 'memory' && target.bot) return memoryView(target.bot);
  return target.bot ? botOverview(target.bot) : groupOverview(target.group);
}

export function openExecutionRecords(messageId) {
  state.drawer = { ...state.drawer, open: true, view: 'execution', dirty: false };
  renderDrawer();
  nav.refreshChrome();
  const record = [...drawer.querySelectorAll('[data-record-id]')].find((node) => node.dataset.recordId === messageId);
  if (record) {
    record.open = true;
    record.scrollIntoView({ block: 'nearest' });
  }
  (record?.querySelector('summary') ?? drawer.querySelector('button'))?.focus();
}

function closeDrawer() {
  const execution = state.drawer.view === 'execution';
  state.drawer = { ...state.drawer, open: false, view: 'overview', dirty: false };
  renderDrawer();
  nav.refreshChrome();
  if (execution) document.querySelector('.execution-toggle')?.focus();
}

function setView(view) {
  state.drawer = { ...state.drawer, view, dirty: false };
  renderDrawer();
}

function topBar(chatId) {
  const shareBtn = h(
    'button',
    {
      type: 'button',
      class: 'round',
      title: t('panels.drawer.copyMarkdown'),
      'aria-label': t('panels.drawer.copyMarkdown'),
      onclick: guard(async () => {
        const messages = await fetchAllMessages(chatId);
        if (await copyText(transcriptMarkdown(chatId, messages))) {
          toast(t('panels.drawer.copied'));
          shareBtn.replaceChildren(icon('check'));
          setTimeout(() => shareBtn.replaceChildren(icon('share')), 1400);
        }
      }),
    },
    icon('share'),
  );
  return h(
    'div',
    { class: 'drawer-top' },
    h('span', { class: 'spacer' }),
    h('button', { type: 'button', class: 'round', title: t('panels.drawer.settings'), 'aria-label': chatId.startsWith('bot:') ? t('panels.drawer.editBot') : t('panels.groupSettings.title'), onclick: () => setView('settings') }, icon('gear')),
    shareBtn,
    h('button', { type: 'button', class: 'round', title: t('panels.common.close'), 'aria-label': t('panels.drawer.closeDetails'), onclick: closeDrawer }, icon('close')),
  );
}

function subBar(title) {
  return h(
    'div',
    { class: 'drawer-top' },
    h('button', { type: 'button', class: 'round ghost', 'aria-label': t('panels.drawer.backToDetails'), onclick: () => setView('overview') }, icon('left')),
    h('h2', { class: 'drawer-sub-title', id: 'drawer-title' }, title),
    h('button', { type: 'button', class: 'round ghost', 'aria-label': t('panels.drawer.closeDetails'), onclick: closeDrawer }, icon('close')),
  );
}

function renameable(current, save) {
  const button = h('button', { type: 'button', class: 'drawer-name', id: 'drawer-title', title: t('panels.drawer.clickToRename') }, current);
  button.addEventListener('click', () => {
    const input = /** @type {HTMLInputElement} */ (h('input', { class: 'drawer-name-input', value: current, maxlength: 24, 'aria-label': t('panels.common.name') }));
    let done = false;
    const commit = guard(async () => {
      if (done) return;
      done = true;
      const next = input.value.trim();
      if (next && next !== current) await save(next);
      else input.replaceWith(button);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void commit();
      if (e.key === 'Escape') {
        done = true;
        input.replaceWith(button);
      }
    });
    input.addEventListener('blur', () => void commit());
    button.replaceWith(input);
    input.select();
  });
  return button;
}

function clipped(text) {
  const body = h('div', { class: 'prose-clip' }, text);
  const long = text.split('\n').length > 5 || text.length > 220;
  if (!long) return body;
  const toggle = h('button', { type: 'button', class: 'soft' }, t('panels.drawer.expand'));
  toggle.addEventListener('click', () => {
    body.classList.toggle('open');
    toggle.textContent = body.classList.contains('open') ? t('panels.drawer.collapse') : t('panels.drawer.expand');
  });
  return h('div', null, body, toggle);
}

function botOverview(bot) {
  const chatId = `bot:${bot.id}`;
  const memoryRow = h('button', { type: 'button', class: 'link-row', onclick: () => setView('memory') }, icon('memory'), h('span', { class: 'grow' }, t('panels.common.loading')), h('span', { class: 'end' }, t('panels.drawer.manage'), icon('right', 14)));
  void api('GET', `/api/memory/${bot.id}`)
    .then((data) => memoryRow.querySelector('.grow')?.replaceChildren(t('panels.memory.count', { n: data.entries.length })))
    .catch(() => memoryRow.querySelector('.grow')?.replaceChildren(t('panels.common.loadFailed')));
  const usageBox = h('div', null, h('p', { class: 'muted' }, t('panels.common.counting')));
  void api('GET', '/api/usage?days=7').then((data) => {
    const row = data.byBot.find((r) => r.botId === bot.id);
    usageBox.replaceChildren(...[
      h('div', { class: 'kv' }, h('span', null, t('panels.drawer.last7Days')), h('span', null, row ? t('panels.drawer.usageSummary', { turns: fmtNum(row.turns), turnsCount: row.turns, chars: fmtNum(row.chars), charsCount: row.chars }) : t('panels.drawer.noChats'))),
      row ? h('div', { class: 'kv' }, h('span', null, t('panels.usage.toolCalls')), h('span', null, t('panels.drawer.toolCount', { n: fmtNum(row.tools), count: row.tools }))) : null,
    ].filter(Boolean));
  }).catch(() => usageBox.replaceChildren(h('p', { class: 'muted' }, t('panels.common.statsFailed'))));
  const schedules = state.schedules.filter((s) => s.botId === bot.id);
  const sessionId = state.sessions[chatId]?.[bot.id];
  drawer.replaceChildren(
    topBar(chatId),
    h(
      'div',
      { class: 'drawer-body' },
      h(
        'div',
        { class: 'drawer-hero' },
        markOf(bot, { size: 88, star: true }),
        renameable(bot.name, (name) => api('PATCH', `/api/bots/${bot.id}`, { name })),
        h('div', { class: 'row-end', style: { justifyContent: 'center' } }, bot.isMain && !String(bot.role ?? '').includes(t('panels.bot.main')) ? h('span', { class: 'chip', style: { color: 'var(--star)' } }, t('panels.bot.main')) : null, bot.role ? h('span', { class: 'chip' }, bot.role) : null, bot.model ? h('span', { class: 'chip', title: `${bot.model.providerId}/${bot.model.modelId}` }, effortOf(bot.model) ? `${bot.model.modelId} · ${effortLabel(effortOf(bot.model))}` : bot.model.modelId) : bot.effort ? h('span', { class: 'chip' }, t('panels.bot.effortChip', { level: effortLabel(bot.effort) })) : null),
      ),
      h(
        'section',
        null,
        h('h3', { class: 'section-title' }, t('panels.bot.instructions')),
        bot.instructions ? clipped(bot.instructions) : h('button', { type: 'button', class: 'soft', onclick: () => setView('settings') }, t('panels.drawer.addInstructions')),
      ),
      h('section', null, h('h3', { class: 'section-title' }, t('panels.drawer.memory')), memoryRow),
      h('section', null, h('h3', { class: 'section-title' }, t('panels.drawer.usage')), usageBox),
      h(
        'section',
        null,
        h('h3', { class: 'section-title' }, t('panels.drawer.schedules')),
        schedules.length
          ? schedules.map((s) => h('div', { class: 'sched-item' }, h('span', { class: 'when' }, scheduleWhen(s)), h('span', null, s.name), s.enabled ? null : h('span', { class: 'chip' }, t('panels.schedule.paused'))))
          : h('p', { class: 'muted' }, t('panels.drawer.noSchedules'), h('button', { type: 'button', class: 'soft', onclick: () => openOverlay({ kind: 'settings', page: 'schedules', botId: bot.id }) }, t('panels.drawer.addSchedule'))),
      ),
      h(
        'section',
        null,
        h('h3', { class: 'section-title' }, t('panels.drawer.session')),
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
          sessionId && canOpenSession()
            ? h('button', { type: 'button', class: 'link-row', onclick: () => openSession(/** @type {string} */ (sessionId)) }, icon('panel'), h('span', { class: 'grow' }, t('panels.drawer.viewSession')), icon('right', 14))
            : null,
          h('button', { type: 'button', class: 'link-row', onclick: () => resetChat(chatId) }, icon('eraser'), h('span', { class: 'grow' }, t('panels.chat.newChat')), h('span', { class: 'end' }, t('panels.drawer.memoryKept'))),
        ),
      ),
    ),
  );
}

const resetChat = guard(async (chatId) => {
  if (state.busy.has(chatId)) throw new Error(t('panels.chat.stopFirst'));
  const ok = await confirmAction(t('panels.chat.resetTitle'), t('panels.chat.resetBody'), t('panels.chat.resetOk'));
  if (!ok) return;
  await api('POST', `/api/chats/${chatId}/reset`);
  toast(t('panels.chat.resetDone'));
});

function groupOverview(group) {
  const chatId = `group:${group.id}`;
  const members = membersOf(group);
  const patch = guard((body) => api('PATCH', `/api/groups/${group.id}`, body));
  drawer.replaceChildren(
    topBar(chatId),
    h(
      'div',
      { class: 'drawer-body' },
      h(
        'div',
        { class: 'drawer-hero' },
        groupMarkOf(group, 88),
        renameable(group.name, (name) => api('PATCH', `/api/groups/${group.id}`, { name })),
        h('span', { class: 'muted' }, t('panels.group.memberCount', { n: members.length })),
      ),
      h('section', null, h('h3', { class: 'section-title' }, t('panels.group.notice')), group.notice ? clipped(group.notice) : h('button', { type: 'button', class: 'soft', onclick: () => setView('settings') }, t('panels.group.addNotice'))),
      h(
        'section',
        null,
        h('h3', { class: 'section-title' }, t('panels.group.membersHeading', { n: members.length })),
        members.map((bot) =>
          h(
            'button',
            { type: 'button', class: 'member', onclick: () => nav.openChat(`bot:${bot.id}`) },
            markOf(bot, { size: 32, chatId }),
            h('span', { class: 'grow' }, h('span', null, bot.name), h('small', null, bot.role || ' ')),
            group.adminId === bot.id ? h('span', { class: 'chip' }, t('panels.group.admin')) : null,
          ),
        ),
      ),
      h(
        'section',
        null,
        h('h3', { class: 'section-title' }, t('panels.group.whoReplies')),
        segmented(
          [
            ['admin', t('panels.group.admin')],
            ['all', t('panels.group.allMembers')],
          ],
          group.replyMode ?? 'admin',
          (value) => patch({ replyMode: value }),
          t('panels.group.whoReplies'),
        ),
        h('p', { class: 'hint', style: { marginTop: '8px' } }, group.replyMode === 'all' ? t('panels.group.replyAllHint') : t('panels.group.replyAdminHint')),
      ),
      h(
        'section',
        null,
        h('h3', { class: 'section-title' }, t('panels.group.relayGuard')),
        h(
          'label',
          { class: 'field' },
          h('span', null, t('panels.group.relayLimit')),
          h('input', {
            class: 'input',
            type: 'number',
            name: 'maxHops',
            min: 0,
            max: 20,
            value: Number(group.maxHops ?? 0),
            style: { width: '120px' },
            onchange: (event) => {
              const raw = Number(event.target.value);
              const maxHops = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
              patch({ maxHops });
            },
          }),
        ),
        h('p', { class: 'hint', style: { marginTop: '8px' } }, t('panels.group.relayLimitHint')),
        h(
          'label',
          { class: 'check' },
          h('input', {
            type: 'checkbox',
            class: 'switch',
            name: 'handover',
            checked: group.handover === true,
            onchange: (event) => patch({ handover: event.target.checked === true }),
          }),
          h('span', null, t('panels.group.handover')),
        ),
        h('p', { class: 'hint', style: { marginTop: '8px' } }, t('panels.group.handoverHint')),
      ),
      h(
        'section',
        null,
        h('h3', { class: 'section-title' }, t('panels.drawer.session')),
        h('button', { type: 'button', class: 'link-row', onclick: () => resetChat(chatId) }, icon('eraser'), h('span', { class: 'grow' }, t('panels.chat.newChat')), h('span', { class: 'end' }, t('panels.group.settingsKept'))),
      ),
    ),
  );
}

function segmented(options, value, onChange, label) {
  const box = h('div', { class: 'segmented', role: 'group', 'aria-label': label });
  for (const [id, text] of options) {
    box.append(
      h('button', { type: 'button', 'aria-pressed': id === value ? 'true' : 'false', onclick: () => { for (const b of box.children) b.setAttribute('aria-pressed', 'false'); box.querySelector(`[data-id="${id}"]`)?.setAttribute('aria-pressed', 'true'); onChange(id); }, dataset: { id } }, text),
    );
  }
  return box;
}

/** Side of the square an uploaded avatar is cropped and scaled to before it is sent. */
const AVATAR_SIDE = 256;

/**
 * Reads an image the user picked, crops its centre square and scales it to AVATAR_SIDE, so the
 * server stores a small file whatever was uploaded. Resolves to a data URL (WebP, else PNG).
 * @param {File} file
 */
async function avatarFromFile(file) {
  if (!/^image\//.test(file.type) || file.size > 30 * 1024 * 1024) throw new Error(t('panels.look.badImage'));
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => {
      throw new Error(t('panels.look.badImage'));
    });
    const w = img.naturalWidth || AVATAR_SIDE;
    const hgt = img.naturalHeight || AVATAR_SIDE;
    const side = Math.min(w, hgt);
    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_SIDE;
    canvas.height = AVATAR_SIDE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error(t('panels.look.badImage'));
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (w - side) / 2, (hgt - side) / 2, side, side, 0, 0, AVATAR_SIDE, AVATAR_SIDE);
    const webp = canvas.toDataURL('image/webp', 0.9);
    return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

let appearancePickerId = 0;

/** Built-in looks and a persistent gallery shared by every Bot in this Mini App. */
function appearancePicker(initial, onChange, onBusy) {
  let skin = initial.skin;
  let avatar = initial.avatar;
  const avatars = new Set(avatar ? [avatar] : []);
  const radioName = `appearance-${++appearancePickerId}`;
  const emit = () => onChange({ skin, avatar });
  const box = h('div', { class: 'faces skins', role: 'radiogroup', 'aria-label': t('panels.look.skin') });
  const status = h('p', { class: 'hint', role: 'status' }, t('panels.look.libraryHint'));
  const errors = h('ul', { class: 'hint avatar-errors', hidden: true });
  const retry = h('button', { type: 'button', class: 'btn sm', hidden: true, onclick: () => loadLibrary() }, t('panels.look.retry'));
  const field = /** @type {HTMLFieldSetElement} */ (h('fieldset', { class: 'field avatar-picker' }, h('legend', null, t('panels.look.skin')), box, status, errors, retry));
  // Import one file at a time to bound image decoding memory and request size.
  const fileInput = /** @type {HTMLInputElement} */ (
    h('input', { type: 'file', multiple: true, 'aria-label': t('panels.look.upload'), accept: 'image/png,image/jpeg,image/webp,image/gif' })
  );
  const uploadTile = h('label', { class: 'face upload', title: t('panels.look.uploadHint') }, fileInput, h('span', null, icon('plus')));
  const draw = () => {
    const focused = box.contains(document.activeElement) ? document.activeElement : null;
    const value = focused?.getAttribute('value');
    box.replaceChildren(
      ...SKIN_IDS.map((id) =>
        h('label', { class: 'face', title: t(`panels.skin.${id}`) },
          h('input', { type: 'radio', name: radioName, value: id, checked: !avatar && id === skin, 'aria-label': t(`panels.skin.${id}`) }),
          h('span', null, botMark({ skin: id }, { size: 40 }))),
      ),
      ...[...avatars].map((name, index) =>
        h('label', { class: 'face', title: t('panels.look.customNumber', { n: index + 1 }) },
          h('input', { type: 'radio', name: radioName, value: name, checked: avatar === name, dataset: { avatar: name }, 'aria-label': t('panels.look.customNumber', { n: index + 1 }) }),
          h('span', null, botMark({ avatar: name }, { size: 40 }))),
      ),
      uploadTile,
    );
    if (focused === fileInput) fileInput.focus();
    else if (value) [...box.querySelectorAll('input[type="radio"]')].find((input) => input.getAttribute('value') === value)?.focus();
  };
  const loadLibrary = async () => {
    retry.hidden = true;
    try {
      const data = await api('GET', '/api/avatars');
      for (const name of data.avatars ?? []) avatars.add(name);
      if (!field.disabled) status.textContent = t('panels.look.libraryHint');
      draw();
    } catch {
      status.textContent = t('panels.look.loadFailed');
      retry.hidden = false;
    }
  };
  draw();
  void loadLibrary();
  box.addEventListener('change', (e) => {
    const target = /** @type {HTMLInputElement} */ (e.target);
    if (target.type !== 'radio') return;
    if (target.dataset.avatar) avatar = target.dataset.avatar;
    else { skin = target.value; avatar = undefined; }
    emit();
  });
  fileInput.addEventListener('change', async () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = '';
    if (!files.length || field.disabled) return;
    field.disabled = true;
    field.setAttribute('aria-busy', 'true');
    onBusy(true);
    errors.replaceChildren();
    errors.hidden = true;
    let imported = 0;
    let selected;
    try {
      for (const [index, file] of files.entries()) {
        status.textContent = t('panels.look.importing', { n: index + 1, total: files.length });
        try {
          const data = await api('POST', '/api/avatars', { avatar: await avatarFromFile(file) });
          avatars.add(data.avatar);
          selected ??= data.avatar;
          imported++;
        } catch (error) {
          errors.append(h('li', null, `${file.name}: ${error instanceof Error ? error.message : String(error)}`));
          errors.hidden = false;
        }
      }
      // A closed form can finish importing, but must not dirty or preview the next Bot's form.
      if (selected && field.isConnected) { avatar = selected; emit(); }
      draw();
      status.textContent = t('panels.look.imported', { n: imported, total: files.length });
    } finally {
      field.disabled = false;
      field.removeAttribute('aria-busy');
      onBusy(false);
    }
  });
  return field;
}

/**
 * A catalog entry as the composer would select it: thinking on when the model offers it (an
 * omitted variant clears the session's, it is not inherited), at the model's default effort.
 */
const toSelection = (m) => ({
  providerId: m.providerId,
  modelId: m.modelId,
  ...(m.variants?.includes('thinking') ? { variant: 'thinking' } : {}),
  ...(m.thinking?.default ? { thinking: { effort: m.thinking.default } } : {}),
});

/** Two selections name the same model; variant and effort are tuned per Bot, not compared. */
const sameModel = (a, b) => Boolean(a && b && a.providerId === b.providerId && a.modelId === b.modelId);

/**
 * The Bot's model: "default" plus the Host's catalog, filled in when `/api/models` answers.
 * `value()` is `undefined` for "leave unchanged" (catalog not loaded, unsupported Host, or the
 * Bot's current model kept), `null` for "follow the default", or the picked selection.
 */
/** The efforts a catalog model offers, plus 'off' when it can run with thinking turned off. */
function effortOptions(entry) {
  const levels = Array.isArray(entry?.thinking?.efforts) ? entry.thinking.efforts.filter((e) => typeof e === 'string') : [];
  return entry?.variants?.includes('') ? [...levels, 'off'] : levels;
}

/** Catalog model `entry` at `effort` ('off' = thinking off), as the composer would select it. */
function withEffort(entry, effort) {
  if (!entry || !effortOptions(entry).includes(effort)) return undefined;
  if (effort === 'off') return { providerId: entry.providerId, modelId: entry.modelId, variant: '' };
  return {
    providerId: entry.providerId,
    modelId: entry.modelId,
    ...(entry.variants?.includes('thinking') ? { variant: 'thinking' } : {}),
    thinking: { effort },
  };
}

/** The effort a selection runs at: 'off', a level, or undefined for the model's own default. */
const effortOf = (model) => (model?.variant === '' ? 'off' : model?.thinking?.effort);

/** "高" for high, "关闭思考" for off; an unknown level shows as it is. */
export function effortLabel(effort) {
  const key = `panels.effort.${effort}`;
  const text = t(key);
  return text === key ? effort : text;
}

const sameSelection = (a, b) =>
  sameModel(a, b) && (a.variant ?? null) === (b.variant ?? null) && (a.thinking?.effort ?? null) === (b.thinking?.effort ?? null);

/**
 * The Bot's model and reasoning effort: "default" plus the Host's catalog, and the efforts the
 * chosen model offers. `value()` returns only what changed: `model` (a selection, or null for the
 * default model) and `effort` (a level for the default model, or null to clear it).
 */
function modelField(bot) {
  const select = /** @type {HTMLSelectElement} */ (
    h('select', { class: 'select', name: 'model', disabled: true }, h('option', { value: '' }, t('panels.bot.modelLoading')))
  );
  const effortSelect = /** @type {HTMLSelectElement} */ (h('select', { class: 'select', name: 'effort' }));
  const effortField = h('label', { class: 'field' }, h('span', null, t('panels.bot.effort')), effortSelect);
  effortField.hidden = true;
  const hint = h('p', { class: 'hint' });
  hint.hidden = true;
  /** @type {any[]} */
  let models = [];
  /** @type {any} */
  let defaultEntry;
  const fail = (key) => {
    select.replaceChildren(h('option', { value: '' }, t('panels.bot.modelDefaultPlain')));
    hint.textContent = t(key);
    hint.hidden = false;
  };
  /** The catalog model the model select points at; undefined for a model no longer listed. */
  const entryOf = (value) => (value === '' ? defaultEntry : value === 'keep' ? undefined : models[Number(value)]);
  /** Fills the effort select for `entry`, preselecting `current` ('' = the model's default). */
  const drawEfforts = (entry, current) => {
    const options = effortOptions(entry);
    effortField.hidden = !options.length;
    const def = entry?.thinking?.default;
    effortSelect.replaceChildren(
      h('option', { value: '' }, def ? t('panels.bot.effortDefault', { level: effortLabel(def) }) : t('panels.bot.effortDefaultPlain')),
      ...options.map((e) => h('option', { value: e }, effortLabel(e))),
    );
    effortSelect.value = options.includes(current) ? current : '';
  };
  select.addEventListener('change', () => drawEfforts(entryOf(select.value), ''));
  api('GET', '/api/models')
    .then((res) => {
      if (!res.supported) return fail('panels.bot.modelUnsupported');
      models = res.models ?? [];
      defaultEntry = models.find((m) => sameModel(m, res.default));
      const defaultName = defaultEntry?.displayName ?? res.default?.modelId;
      let selected = '';
      const items = [h('option', { value: '' }, defaultName ? t('panels.bot.modelDefault', { name: defaultName }) : t('panels.bot.modelDefaultPlain'))];
      models.forEach((m, i) => {
        items.push(h('option', { value: String(i) }, m.displayName || m.modelId));
        if (sameModel(m, bot.model)) selected = String(i);
      });
      // A model the Bot still has but the catalog no longer lists: keep showing it, flagged.
      if (bot.model && !selected) {
        items.push(h('option', { value: 'keep' }, t('panels.bot.modelMissing', { name: bot.model.modelId })));
        selected = 'keep';
      }
      select.replaceChildren(...items);
      select.value = selected;
      select.disabled = false;
      const entry = entryOf(selected);
      // The model's own default reads as "default", not as the level it happens to be.
      let current = bot.model ? effortOf(bot.model) ?? '' : bot.effort ?? '';
      if (bot.model && current && current !== 'off' && current === entry?.thinking?.default) current = '';
      drawEfforts(entry, current);
    })
    .catch(() => fail('panels.bot.modelLoadFailed'));
  const value = () => {
    if (select.disabled || select.value === 'keep') return {};
    const effort = effortField.hidden ? '' : effortSelect.value;
    /** @type {Record<string, unknown>} */
    const out = {};
    if (select.value === '') {
      if (bot.model) out.model = null;
      if (effort === '') {
        if (bot.effort) out.effort = null;
      } else if (effort !== bot.effort || bot.model) {
        out.effort = effort;
      }
      return out;
    }
    const picked = models[Number(select.value)];
    if (!picked) return out;
    const selection = (effort && withEffort(picked, effort)) || toSelection(picked);
    if (!bot.model || !sameSelection(selection, bot.model)) out.model = selection;
    if (bot.effort) out.effort = null;
    return out;
  };
  return {
    field: h('div', { class: 'form', style: { gap: '12px' } }, h('label', { class: 'field' }, h('span', null, t('panels.bot.model')), select, hint), effortField),
    value,
  };
}

function botForm(bot, { submitLabel, onSubmit, onPreview }) {
  const savedAvatar = bot.avatar;
  const look = { skin: bot.skin ?? 'bubble', color: bot.color, avatar: bot.avatar };
  const model = modelField(bot);
  const submit = h('button', { type: 'submit', class: 'btn primary' }, submitLabel);
  let importing = false;
  const form = /** @type {HTMLFormElement} */ (
    h(
      'form',
      { class: 'form' },
      h('label', { class: 'field' }, h('span', null, t('panels.common.name')), h('input', { class: 'input', name: 'name', required: true, maxlength: 24, value: bot.name ?? '', placeholder: t('panels.bot.namePlaceholder') })),
      h('label', { class: 'field' }, h('span', null, t('panels.bot.role')), h('input', { class: 'input', name: 'role', maxlength: 60, value: bot.role ?? '', placeholder: t('panels.bot.rolePlaceholder') })),
      h('label', { class: 'field' }, h('span', null, t('panels.bot.instructions')), h('textarea', { class: 'textarea', name: 'instructions', rows: 6, maxlength: 4000, placeholder: t('panels.bot.instructionsPlaceholder') }, bot.instructions ?? '')),
      model.field,
      h(
        'label',
        { class: 'check' },
        h('input', { type: 'checkbox', class: 'switch', name: 'autoHelper', checked: bot.autoHelper !== false }),
        h('span', null, t('panels.bot.autoHelper')),
      ),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', class: 'switch', name: 'isMain', checked: Boolean(bot.isMain) }), h('span', null, t('panels.bot.mainCheck'))),
      h('p', { class: 'hint' }, t('panels.bot.mainAuthority')),
      bot.id ? h('label', { class: 'check' }, h('input', { type: 'checkbox', class: 'switch', name: 'pinned', checked: Boolean(bot.pinned) }), h('span', null, t('panels.common.pinToSidebar'))) : null,
      h('details', { class: 'appearance-details' }, h('summary', null, t('panels.bot.appearance')), appearancePicker(look, (next) => {
        Object.assign(look, next, next.skin ? { color: SKINS[next.skin] } : {});
        state.drawer.dirty = true;
        onPreview?.(look);
      }, (busy) => { importing = busy; submit.disabled = busy; })),
      h('div', { class: 'row-end form-actions' }, submit),
    )
  );
  form.addEventListener('input', () => (state.drawer.dirty = true));
  form.addEventListener('input', (e) => {
    const t = /** @type {HTMLInputElement} */ (e.target);
    if (t.name === 'name' || t.name === 'role') onPreview?.(look, { name: form.elements.namedItem('name').value, role: form.elements.namedItem('role').value });
  });
  form.addEventListener(
    'submit',
    guard(async (event) => {
      event.preventDefault();
      if (importing) return;
      const data = new FormData(form);
      await onSubmit({
        ...model.value(),
        name: String(data.get('name') ?? ''),
        role: String(data.get('role') ?? ''),
        instructions: String(data.get('instructions') ?? ''),
        skin: look.skin,
        // Gallery imports are already saved; this only changes the Bot's selected image.
        ...(look.avatar !== savedAvatar ? { avatar: look.avatar ?? null } : {}),
        autoHelper: data.get('autoHelper') === 'on',
        isMain: data.get('isMain') === 'on',
        ...(bot.id ? { pinned: data.get('pinned') === 'on' } : {}),
      });
    }),
  );
  return form;
}

function botSettingsView(bot) {
  const preview = h('div', { class: 'bot-config-summary' }, markOf(bot, { size: 36, state: 'idle' }), h('span', null, bot.name));
  const form = botForm(bot, {
    submitLabel: t('panels.common.save'),
    onPreview: (look, fields) => preview.replaceChildren(botMark(look, { size: 36 }), h('span', null, fields?.name || bot.name)),
    onSubmit: async (body) => {
      await api('PATCH', `/api/bots/${bot.id}`, body);
      state.drawer.dirty = false;
      toast(t('panels.common.saved'));
      setView('overview');
    },
  });
  drawer.replaceChildren(
    subBar(t('panels.botSettings.title')),
    h(
      'div',
      { class: 'drawer-body' },
      preview,
      form,
      h(
        'section',
        { style: { borderTop: '0.5px solid var(--line)', paddingTop: '16px' } },
        h('h3', { class: 'section-title' }, t('panels.botSettings.delete')),
        h('p', { class: 'hint', style: { marginBottom: '10px' } }, t('panels.botSettings.deleteHint')),
        h('button', { type: 'button', class: 'btn danger', onclick: () => deleteBot(bot) }, icon('trash'), t('panels.common.delete')),
      ),
    ),
  );
}

const deleteBot = guard(async (bot) => {
  if (!(await confirmAction(t('panels.bot.deleteTitle', { name: bot.name }), t('panels.common.cannotUndo'), t('panels.common.delete')))) return;
  await api('DELETE', `/api/bots/${bot.id}`);
  state.drawer = { ...state.drawer, open: false, view: 'overview', dirty: false };
  state.messages.delete(`bot:${bot.id}`);
  toast(t('panels.bot.deleted', { name: bot.name }));
});

const deleteGroup = guard(async (group) => {
  if (!(await confirmAction(t('panels.group.deleteTitle', { name: group.name }), t('panels.group.deleteBody'), t('panels.common.delete')))) return;
  await api('DELETE', `/api/groups/${group.id}`);
  state.drawer = { ...state.drawer, open: false, view: 'overview', dirty: false };
  state.messages.delete(`group:${group.id}`);
  toast(t('panels.group.deleted'));
});

function memberPicker(selected, admin) {
  const members = h('div', { class: 'picks', role: 'group', 'aria-label': t('panels.group.members') });
  const admins = h('div', { class: 'picks', role: 'radiogroup', 'aria-label': t('panels.group.admin') });
  for (const bot of state.bots) {
    members.append(h('label', { class: 'pick' }, h('input', { type: 'checkbox', name: 'members', value: bot.id, checked: selected.includes(bot.id) }), h('span', null, botMark(bot, { size: 22 }), bot.name)));
    admins.append(h('label', { class: 'pick' }, h('input', { type: 'radio', name: 'admin', value: bot.id, checked: bot.id === admin }), h('span', null, botMark(bot, { size: 22 }), bot.name)));
  }
  return [
    h('fieldset', { class: 'field' }, h('legend', null, t('panels.group.admin')), admins, h('p', { class: 'hint' }, t('panels.group.adminHint'))),
    h('fieldset', { class: 'field' }, h('legend', null, t('panels.group.members')), members),
  ];
}

function readGroupForm(form) {
  const data = new FormData(form);
  const admin = String(data.get('admin') ?? '');
  const members = data.getAll('members').map(String);
  if (admin && !members.includes(admin)) members.unshift(admin);
  if (members.length < 1) throw new Error(t('panels.group.needMember'));
  return { name: String(data.get('name') ?? '').trim(), notice: String(data.get('notice') ?? ''), members, admin: admin || members[0], replyMode: String(data.get('replyMode') ?? 'admin') };
}

function groupSettingsView(group) {
  const form = /** @type {HTMLFormElement} */ (
    h(
      'form',
      { class: 'form' },
      h('label', { class: 'field' }, h('span', null, t('panels.group.name')), h('input', { class: 'input', name: 'name', required: true, maxlength: 24, value: group.name })),
      h('label', { class: 'field' }, h('span', null, t('panels.group.notice')), h('textarea', { class: 'textarea', name: 'notice', rows: 3, maxlength: 500, placeholder: t('panels.group.noticePlaceholder') }, group.notice ?? '')),
      ...memberPicker(group.memberIds, group.adminId),
      h(
        'fieldset',
        { class: 'field' },
        h('legend', null, t('panels.group.whoReplies')),
        h('label', { class: 'check' }, h('input', { type: 'radio', name: 'replyMode', value: 'admin', checked: (group.replyMode ?? 'admin') === 'admin' }), h('span', null, t('panels.group.replyAdminOption'))),
        h('label', { class: 'check' }, h('input', { type: 'radio', name: 'replyMode', value: 'all', checked: group.replyMode === 'all' }), h('span', null, t('panels.group.replyAllOption'))),
      ),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', class: 'switch', name: 'pinned', checked: Boolean(group.pinned) }), h('span', null, t('panels.common.pinToSidebar'))),
      h('div', { class: 'row-end' }, h('button', { type: 'submit', class: 'btn primary' }, t('panels.common.save'))),
    )
  );
  form.addEventListener('input', () => (state.drawer.dirty = true));
  form.addEventListener(
    'submit',
    guard(async (event) => {
      event.preventDefault();
      const body = readGroupForm(form);
      await api('PATCH', `/api/groups/${group.id}`, { ...body, name: body.name || group.name, pinned: new FormData(form).get('pinned') === 'on' });
      state.drawer.dirty = false;
      toast(t('panels.common.saved'));
      setView('overview');
    }),
  );
  drawer.replaceChildren(
    subBar(t('panels.groupSettings.title')),
    h(
      'div',
      { class: 'drawer-body' },
      form,
      h(
        'section',
        { style: { borderTop: '0.5px solid var(--line)', paddingTop: '16px' } },
        h('h3', { class: 'section-title' }, t('panels.groupSettings.delete')),
        h('button', { type: 'button', class: 'btn danger', onclick: () => deleteGroup(group) }, icon('trash'), t('panels.common.delete')),
      ),
    ),
  );
}

function memoryView(bot) {
  const tab = state.drawer.memTab === 'team' ? 'team' : 'self';
  const scope = tab === 'team' ? 'team' : bot.id;
  const box = h('div', { class: 'form' }, h('p', { class: 'muted deferred', role: 'status' }, t('panels.common.loading')));
  void fillMemory(box, scope);
  drawer.replaceChildren(
    subBar(t('panels.drawer.memory')),
    h(
      'div',
      { class: 'drawer-body' },
      segmented(
        [
          ['self', t('panels.memory.botMemory', { name: bot.name })],
          ['team', t('panels.memory.teamMemory')],
        ],
        tab,
        (value) => {
          state.drawer.memTab = value;
          renderDrawer();
        },
        t('panels.memory.scope'),
      ),
      h('p', { class: 'hint' }, tab === 'team' ? t('panels.memory.teamHint') : t('panels.memory.botHint', { name: bot.name })),
      box,
    ),
  );
}

async function fillMemory(container, scope) {
  // A newer read wins; a delayed response must not replace an editor the user has opened.
  const token = Symbol('memory-read');
  container.memoryRead = token;
  try {
    const data = await api('GET', `/api/memory/${scope}`);
    if (container.memoryRead !== token || container.querySelector('[data-editing="true"]')) return;
    const budget = data.budget ?? { used: data.chars, limit: 100000, remaining: Math.max(0, 100000 - data.chars), entryMax: 1200, entryLimit: 1000 };
    const countLabel = new Intl.NumberFormat(localeTag()).format;
    const editor = (entry) => {
      let baseEntry = entry;
      let sending = false;
      let conflicted = false;
      const effectiveMax = () => Math.max(budget.entryMax, baseEntry?.text?.length ?? 0);
      const input = h('textarea', { class: 'textarea', name: 'text', rows: 3, maxlength: effectiveMax(), required: true, 'aria-label': entry ? t('panels.memory.edit') : t('panels.memory.new'), placeholder: t('panels.memory.addPlaceholder') }, entry?.text ?? '');
      const legacyHint = h('p', { class: 'hint' }, t('panels.memory.legacyLength'));
      const key = h('input', { class: 'input', name: 'key', value: entry?.key ?? '', maxlength: 64, pattern: '[a-z0-9][a-z0-9._\\-]{0,63}', readonly: Boolean(entry?.key), placeholder: 'reply.preferences' });
      const pinned = h('input', { type: 'checkbox', class: 'switch', name: 'pinned', checked: Boolean(entry?.pinned) });
      const count = h('span', { class: 'hint', role: 'status' });
      const feedback = h('div', { class: 'memory-edit-feedback', hidden: true });
      const save = h('button', { type: 'submit', class: 'btn primary' }, entry ? t('panels.common.save') : t('panels.common.add'));
      const form = h('form', { class: 'memory-editor form', dataset: { editing: entry ? 'true' : 'false' } }, input, legacyHint,
        h('label', { class: 'field' }, h('span', null, t('panels.memory.topicKey')), key, h('small', { class: 'hint' }, t('panels.memory.topicHint'))),
        h('label', { class: 'check' }, pinned, h('span', null, t('panels.memory.pinned'))),
        h('p', { class: 'hint' }, t('panels.memory.pinnedHint')), feedback,
        h('div', { class: 'memory-editor-actions' }, count, entry ? h('button', { type: 'button', class: 'btn', onclick: () => { form.dataset.editing = 'false'; void fillMemory(container, scope); } }, t('panels.common.cancel')) : null, save));
      const draft = () => ({ text: input.value, key: key.value.trim(), pinned: pinned.checked });
      const sync = () => {
        input.maxLength = effectiveMax();
        count.textContent = t('panels.memory.entryCount', { used: input.value.length, max: input.maxLength });
        legacyHint.hidden = input.maxLength <= budget.entryMax;
      };
      const changed = () => { form.dataset.editing = String(Boolean(input.value.trim() || key.value.trim() || pinned.checked || baseEntry)); sync(); };
      form.addEventListener('input', changed);
      pinned.addEventListener('change', changed);
      sync();
      const readLatest = h('button', { type: 'button', class: 'btn sm', onclick: guard(async () => {
        readLatest.disabled = true;
        try {
          const latest = await api('GET', `/api/memory/${scope}`);
          const current = latest.entries.find((item) => baseEntry?.id ? item.id === baseEntry.id : key.value.trim() && item.key === key.value.trim());
          if (!current) {
            feedback.replaceChildren(h('p', { role: 'alert' }, t('panels.memory.entryGone')));
            return;
          }
          baseEntry = current;
          sync();
          if (current.key) { key.value = current.key; key.readOnly = true; }
          conflicted = false;
          save.disabled = sending;
          feedback.replaceChildren(h('p', { role: 'status' }, t('panels.memory.latestLoaded')),
            h('strong', null, t('panels.memory.latest')), h('p', { class: 'memory-latest' }, current.text));
        } finally { readLatest.disabled = false; }
      }) }, t('panels.memory.readLatest'));
      form.addEventListener('submit', guard(async (event) => {
        event.preventDefault();
        if (sending || conflicted || !input.value.trim() || !form.checkValidity()) return;
        sending = true;
        save.disabled = true;
        form.dataset.saving = 'true';
        form.dataset.editing = 'true';
        const submitted = draft();
        try {
          const result = await api('POST', `/api/memory/${scope}`, {
            text: submitted.text, pinned: submitted.pinned,
            ...(submitted.key ? { key: submitted.key } : {}),
            ...(baseEntry ? { replaceId: baseEntry.id, ...(baseEntry.revision ? { expectedRevision: baseEntry.revision } : {}) } : {}),
          });
          if (result.entry) { baseEntry = result.entry; sync(); }
          if (JSON.stringify(draft()) === JSON.stringify(submitted)) form.dataset.editing = 'false';
          toast(t('panels.common.saved'));
          await fillMemory(container, scope);
        } catch (error) {
          if (error.code !== 'memory_conflict') throw error;
          conflicted = true;
          feedback.hidden = false;
          feedback.replaceChildren(h('p', { role: 'alert' }, t('panels.memory.conflict')), readLatest);
        } finally { sending = false; save.disabled = conflicted; delete form.dataset.saving; }
      }));
      return form;
    };
    container.dataset.memoryScope = scope;
    container.replaceChildren(
      h('div', { class: 'memory-budget' },
        h('strong', null, t('panels.memory.storage')),
        h('span', null, t('panels.memory.summary', { n: budget.entryCount ?? data.entries.length, entryLimit: countLabel(budget.entryLimit ?? 1000), chars: countLabel(budget.used), limit: countLabel(budget.limit), remaining: countLabel(budget.remaining) })),
        h('meter', { min: 0, max: budget.limit, value: budget.used, 'aria-label': t('panels.memory.capacity') }),
        h('span', { class: 'hint' }, t('panels.memory.scopeLabel', { scope: scope === 'team' ? t('panels.memory.team') : botById(scope)?.name ?? scope })),
        h('p', { class: 'hint' }, t('panels.memory.context', { limit: countLabel(data.contextBudget?.limit ?? 6000) }))),
      data.entries.length ? h('ul', { class: 'mem-list' }, data.entries.map((entry) => {
        const row = h('li', null);
        const edit = h('button', { type: 'button', class: 'btn sm', onclick: () => { const form = editor(entry); row.replaceChildren(form); form.querySelector('textarea').focus(); } }, t('panels.memory.edit'));
        row.append(h('div', { class: 'mem-text' }, entry.pinned ? h('span', { class: 'chip' }, t('panels.memory.pinned')) : null, entry.text,
          h('details', { class: 'mem-meta' }, h('summary', null, t('panels.memory.source')), h('p', null, [entry.key, entry.added, entry.by && t('panels.memory.by', { name: entry.by }), entry.source].filter(Boolean).join(' · ')))),
          h('div', { class: 'memory-entry-actions' }, edit, h('button', { type: 'button', class: 'tool-btn', 'aria-label': t('panels.memory.deleteLabel', { text: entry.text }), onclick: guard(async () => {
            if (!(await confirmAction(t('panels.memory.deleteTitle'), entry.text, t('panels.common.delete')))) return;
            await api('DELETE', `/api/memory/${scope}/${entry.id}`);
            await fillMemory(container, scope);
          }) }, icon('trash', 15))));
        return row;
      })) : h('div', { class: 'empty-box' }, t('panels.memory.empty')),
      editor(null));
  } catch (error) {
    if (container.memoryRead !== token) return;
    if (container.querySelector('[data-editing="true"]')) { toast(error instanceof Error ? error.message : String(error)); return; }
    container.replaceChildren(h('p', { class: 'muted', role: 'alert' }, t('panels.common.loadFailedWith', { error: error instanceof Error ? error.message : error })), h('button', { type: 'button', class: 'btn', onclick: () => void fillMemory(container, scope) }, t('panels.memory.refresh')));
  }
}

// ================================================================== overlays
/** @type {HTMLElement | null} */
let restoreFocus = null;

export function openOverlay(overlay) {
  if (!state.overlay) restoreFocus = /** @type {HTMLElement | null} */ (document.activeElement);
  state.overlay = overlay;
  renderOverlay();
}

export function closeOverlay() {
  state.overlay = null;
  overlayRoot.replaceChildren();
  restoreFocus?.focus?.();
  restoreFocus = null;
}

export function renderOverlay({ preserveEdits = false } = {}) {
  const o = state.overlay;
  if (!o) {
    overlayRoot.replaceChildren();
    return;
  }
  const previous = overlayRoot.firstElementChild;
  // Background events update lists, but never replace the user's form nodes or focus.
  if (preserveEdits && previous && o.kind !== 'settings') return;
  const active = document.activeElement;
  const retainedForm = preserveEdits && o.kind === 'settings' && o.page === 'schedules' ? previous?.querySelector('form') : null;
  if (preserveEdits && previous && o.kind === 'settings' && (!o.page || o.page === 'general')) return;
  if (preserveEdits && previous && o.kind === 'settings' && o.page === 'memory' && previous.querySelector('[data-editing="true"], [data-saving="true"]')) return;
  let modal;
  if (o.kind === 'palette') modal = paletteModal(o);
  else if (o.kind === 'create-bot') modal = createBotModal(o);
  else if (o.kind === 'create-group') modal = createGroupModal(o);
  else modal = settingsModal(o);
  modal.removeAttribute('role');
  modal.removeAttribute('aria-modal');
  if (retainedForm) modal.querySelector('form')?.replaceWith(retainedForm);
  const keepFocus = active && overlayRoot.contains(active) && o.kind === 'settings';
  const onNav = Boolean(active?.closest('.set-nav'));
  // Re-rendering the overlay that is already open (switching a settings tab, a usage range, a
  // memory scope) keeps its scrim and skips the entrance animation; replacing both made the
  // page underneath flash through and the dialog pop in again on every click.
  const open = /** @type {HTMLElement | null} */ (overlayRoot.firstElementChild);
  if (open && open.dataset.kind === o.kind) {
    modal.classList.add('settled');
    open.replaceChildren(modal);
  } else {
    const scrim = h('dialog', { class: `overlay ${o.kind === 'palette' ? '' : 'center'}`, dataset: { kind: o.kind }, 'aria-labelledby': o.kind === 'palette' ? null : 'modal-title', 'aria-label': o.kind === 'palette' ? t('panels.quick.newOrOpen') : null });
    scrim.addEventListener('cancel', (event) => { event.preventDefault(); closeOverlay(); });
    scrim.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const controls = [...scrim.querySelectorAll('button, input, select, textarea, summary, a[href], [tabindex="0"]')].filter((el) => !el.disabled && el.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    });
    scrim.addEventListener('mousedown', (e) => {
      if (e.target === scrim) closeOverlay();
    });
    scrim.append(modal);
    overlayRoot.replaceChildren(scrim);
    scrim.showModal();
  }
  if (active && modal.contains(active)) active.focus();
  else if (onNav) /** @type {HTMLElement | null} */ (modal.querySelector('.set-nav [aria-current="page"]'))?.focus();
  else if (!keepFocus) /** @type {HTMLElement | null} */ (modal.querySelector('[autofocus]') ?? modal.querySelector('.set-nav [aria-current="page"]') ?? modal.querySelector('input, textarea, button'))?.focus();
}

export function wireOverlayKeys() {
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (closeMenu()) return;
    if (document.querySelector('dialog.confirm[open]')) return;
    if (state.overlay) {
      event.preventDefault();
      closeOverlay();
    } else if (state.drawer.open && drawer.contains(document.activeElement)) {
      closeDrawer();
    }
  });
}

function modalHead(title) {
  return h('div', { class: 'modal-head' }, h('h2', { id: 'modal-title' }, title), h('button', { type: 'button', class: 'round ghost', 'aria-label': t('panels.common.close'), onclick: closeOverlay }, icon('close')));
}

// ---------------------------------------------------------------- palette
function paletteModal(o) {
  const input = /** @type {HTMLInputElement} */ (h('input', { autofocus: true, 'aria-label': o.mode === 'search' ? t('panels.quick.search') : t('panels.quick.newOrOpen'), placeholder: o.mode === 'search' ? t('panels.quick.searchPlaceholder') : t('panels.quick.newPlaceholder'), value: o.query ?? '' }));
  const list = h('div', { class: 'palette-list', role: 'listbox', 'aria-label': t('panels.quick.results') });
  let cursor = 0;
  /** @type {{ key: string, node: () => Node[], run: () => void }[]} */
  let options = [];
  const build = () => {
    const q = input.value.trim().toLowerCase();
    options = [];
    if (o.mode === 'new' && !q) {
      options.push({ key: 'new-bot', node: () => [h('span', { class: 'opt-icon' }, icon('plus')), h('span', { class: 'grow' }, t('panels.quick.newBot'))], run: () => openOverlay({ kind: 'create-bot' }) });
      options.push({ key: 'new-group', node: () => [h('span', { class: 'opt-icon' }, icon('users')), h('span', { class: 'grow' }, t('panels.quick.newGroup'))], run: () => openOverlay({ kind: 'create-group' }) });
    }
    const match = (text) => !q || String(text ?? '').toLowerCase().includes(q);
    for (const bot of state.bots) {
      if (!match(bot.name) && !match(bot.role)) continue;
      options.push({ key: bot.id, node: () => [markOf(bot, { size: 28, star: true }), h('span', { class: 'grow' }, h('span', null, bot.name), h('small', null, bot.role || ' '))], run: () => { closeOverlay(); nav.openChat(`bot:${bot.id}`); } });
    }
    for (const group of state.groups) {
      if (!match(group.name) && !match(group.notice)) continue;
      options.push({ key: group.id, node: () => [groupMarkOf(group, 28), h('span', { class: 'grow' }, h('span', null, group.name), h('small', null, t('panels.group.memberCount', { n: group.memberIds.length })))], run: () => { closeOverlay(); nav.openChat(`group:${group.id}`); } });
    }
    const exact = state.bots.some((b) => b.name.toLowerCase() === q);
    if (q && !exact && o.mode === 'new') {
      options.push({ key: 'create-named', node: () => [h('span', { class: 'opt-icon' }, icon('plus')), h('span', { class: 'grow' }, t('panels.quick.newBotNamed', { name: input.value.trim() }))], run: () => openOverlay({ kind: 'create-bot', name: input.value.trim() }) });
    }
    cursor = Math.min(cursor, Math.max(options.length - 1, 0));
    list.replaceChildren(
      ...(options.length
        ? options.map((opt, i) =>
            h('button', { type: 'button', class: 'option', role: 'option', 'aria-selected': i === cursor ? 'true' : 'false', onmouseenter: () => { cursor = i; mark(); }, onclick: opt.run }, ...opt.node(), i === cursor ? h('kbd', null, '↵') : null),
          )
        : [h('div', { class: 'palette-empty' }, o.mode === 'search' ? t('panels.quick.noMatch') : t('panels.quick.typeToCreate'))]),
    );
  };
  const mark = () => {
    [...list.children].forEach((node, i) => {
      node.setAttribute('aria-selected', i === cursor ? 'true' : 'false');
      node.querySelector('kbd')?.remove();
      if (i === cursor) node.append(h('kbd', null, '↵'));
    });
  };
  input.addEventListener('input', () => {
    cursor = 0;
    build();
  });
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      cursor = Math.min(cursor + 1, options.length - 1);
      mark();
      list.children[cursor]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      cursor = Math.max(cursor - 1, 0);
      mark();
      list.children[cursor]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && options[cursor]) {
      e.preventDefault();
      options[cursor].run();
    }
  });
  build();
  return h(
    'div',
    { class: 'modal palette', role: 'dialog', 'aria-modal': 'true', 'aria-label': o.mode === 'search' ? t('panels.quick.search') : t('panels.quick.newChat') },
    h('div', { class: 'palette-input' }, o.mode === 'search' ? icon('search') : h('span', null, t('panels.quick.with')), input, h('button', { type: 'button', class: 'round ghost', 'aria-label': t('panels.common.close'), onclick: closeOverlay }, icon('close'))),
    list,
  );
}

// ---------------------------------------------------------------- create Bot
function createBotModal(o) {
  const draft = { name: o.name ?? '', role: '', ...(() => { const skin = nextFreeSkin(); return { skin, color: SKINS[skin] }; })(), isMain: false };
  const previewMark = h('span', null, botMark(draft, { size: 112 }));
  const pvName = h('div', { class: 'pv-name' }, draft.name || t('panels.createBot.placeholderName'));
  const pvRole = h('span', { class: 'chip' }, t('panels.bot.role'));
  const form = botForm(draft, {
    submitLabel: t('panels.createBot.submit'),
    onPreview: (look, text) => {
      Object.assign(draft, look);
      previewMark.replaceChildren(botMark(draft, { size: 112 }));
      if (text) {
        pvName.textContent = text.name || t('panels.createBot.placeholderName');
        pvRole.textContent = text.role || t('panels.bot.role');
      }
    },
    onSubmit: async (body) => {
      const { bot } = await api('POST', '/api/bots', body);
      state.bots.push(bot);
      closeOverlay();
      toast(t('panels.createBot.created', { name: bot.name }));
      nav.openChat(`bot:${bot.id}`);
    },
  });
  const nameInput = /** @type {HTMLInputElement | null} */ (form.querySelector('input[name="name"]'));
  nameInput?.setAttribute('autofocus', '');
  return h(
    'div',
    { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-title', style: { width: 'min(720px, 100%)' } },
    modalHead(t('panels.createBot.title')),
    h('div', { class: 'modal-body' }, h('div', { class: 'create-grid' }, h('div', { class: 'preview-card' }, previewMark, pvName, pvRole), form)),
  );
}

function nextFreeSkin() {
  const used = new Map(SKIN_IDS.map((id) => [id, 0]));
  for (const b of state.bots) used.set(b.skin, (used.get(b.skin) ?? 0) + 1);
  return [...used.entries()].sort((a, b) => a[1] - b[1])[0][0];
}

// ---------------------------------------------------------------- create group
function createGroupModal() {
  const main = state.bots.find((b) => b.isMain) ?? state.bots[0];
  const form = /** @type {HTMLFormElement} */ (
    h(
      'form',
      { class: 'form' },
      h('label', { class: 'field' }, h('span', null, t('panels.group.name')), h('input', { class: 'input', name: 'name', maxlength: 24, placeholder: t('panels.createGroup.namePlaceholder'), autofocus: true })),
      ...memberPicker(main ? [main.id] : [], main?.id),
      h('label', { class: 'field' }, h('span', null, t('panels.group.notice')), h('textarea', { class: 'textarea', name: 'notice', rows: 2, maxlength: 500, placeholder: t('panels.createGroup.noticePlaceholder') })),
      h(
        'fieldset',
        { class: 'field' },
        h('legend', null, t('panels.group.whoReplies')),
        h('label', { class: 'check' }, h('input', { type: 'radio', name: 'replyMode', value: 'admin', checked: true }), h('span', null, t('panels.group.replyAdminOption'))),
        h('label', { class: 'check' }, h('input', { type: 'radio', name: 'replyMode', value: 'all' }), h('span', null, t('panels.group.replyAllOption'))),
      ),
      h('label', { class: 'field' }, h('span', null, t('panels.createGroup.firstMessage')), h('textarea', { class: 'textarea', name: 'first', rows: 2, placeholder: t('panels.createGroup.firstPlaceholder') })),
      h('div', { class: 'row-end' }, h('button', { type: 'button', class: 'btn', onclick: closeOverlay }, t('panels.common.cancel')), h('button', { type: 'submit', class: 'btn primary' }, t('panels.createGroup.submit'))),
    )
  );
  form.addEventListener(
    'submit',
    guard(async (e) => {
      e.preventDefault();
      const body = readGroupForm(form);
      if (body.members.length < 2) throw new Error(t('panels.createGroup.needTwo'));
      const name = body.name || body.members.map((id) => botById(id)?.name).filter(Boolean).slice(0, 3).join(t('panels.createGroup.nameSeparator'));
      const { group } = await api('POST', '/api/groups', { ...body, name });
      state.groups.push(group);
      const first = String(new FormData(form).get('first') ?? '').trim();
      closeOverlay();
      nav.openChat(`group:${group.id}`);
      if (first) await api('POST', `/api/chats/group:${group.id}/messages`, { text: first });
    }),
  );
  return h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-title', style: { width: 'min(600px, 100%)' } }, modalHead(t('panels.createGroup.title')), h('div', { class: 'modal-body' }, form));
}

// ---------------------------------------------------------------- settings
/** [id, title key, icon]; titles resolve at render time. */
const PAGES = [
  ['general', 'panels.settings.page.general', 'sliders'],
  ['bots', 'panels.settings.page.bots', 'bot'],
  ['groups', 'panels.settings.page.groups', 'users'],
  ['memory', 'panels.settings.page.memory', 'memory'],
  ['tasks', 'panels.settings.page.tasks', 'check'],
  ['schedules', 'panels.settings.page.schedules', 'clock'],
  ['usage', 'panels.settings.page.usage', 'gauge'],
];

function settingsModal(o) {
  const page = PAGES.find(([id]) => id === o.page) ?? PAGES[0];
  const body = h('div', { class: 'set-body' });
  const nav_ = h(
    'nav',
    { class: 'set-nav', 'aria-label': t('panels.settings.title') },
    PAGES.map(([id, label, ic]) => h('button', { type: 'button', 'aria-current': id === page[0] ? 'page' : null, onclick: () => openOverlay({ ...o, page: id }) }, icon(/** @type {any} */ (ic)), t(label))),
  );
  const content = { general: generalPage, bots: botsPage, groups: groupsPage, memory: memoryPage, tasks: tasksPage, schedules: schedulesPage, usage: usagePage }[page[0]];
  content(body, o);
  return h(
    'div',
    { class: 'modal settings', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-title' },
    nav_,
    h('div', { class: 'set-main' }, h('div', { class: 'set-head' }, h('h2', { id: 'modal-title' }, t(page[1])), h('button', { type: 'button', class: 'round ghost', 'aria-label': t('panels.settings.close'), onclick: closeOverlay }, icon('close'))), body),
  );
}

function setRow(title, sub, control) {
  return h('div', { class: 'set-row' }, h('div', { class: 'grow' }, h('span', null, title), sub ? h('small', null, sub) : null), control);
}

function generalPage(body) {
  const accents = ['ocean', 'sky', 'teal', 'green', 'orange', 'pink', 'violet', 'graphite'];
  const accentBox = h(
    'div',
    { class: 'swatches', role: 'radiogroup', 'aria-label': t('panels.general.accent') },
    accents.map((id) => h('label', { class: 'swatch', title: t(`panels.palette.${id}`) }, h('input', { type: 'radio', name: 'accent', value: id, checked: prefs.accent === id, 'aria-label': t(`panels.palette.${id}`) }), h('span', { style: { background: inkOf(id) } }))),
  );
  accentBox.addEventListener('change', (e) => {
    prefs.accent = /** @type {HTMLInputElement} */ (e.target).value;
    savePrefs();
    applyAppearance();
  });
  // Saved on change (blur or Enter); an empty value falls back to the system account name.
  const nameInput = /** @type {HTMLInputElement} */ (
    h('input', { class: 'input', type: 'text', maxlength: 24, value: state.settings.userName ?? '', placeholder: state.user?.systemName ?? '', 'aria-label': t('panels.general.userName'), style: { width: '200px' } })
  );
  nameInput.addEventListener(
    'change',
    guard(async () => {
      await api('PUT', '/api/settings', { userName: nameInput.value });
      await loadState();
      nav.renderSidebar();
    }),
  );
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') nameInput.blur();
  });
  body.append(
    h(
      'div',
      { class: 'set-group' },
      setRow(t('panels.general.userName'), t('panels.general.userNameSub', { system: state.user?.systemName || '—' }), nameInput),
      setRow(t('panels.general.language'), t('panels.general.languageSub'), segmented([['auto', t('panels.general.followSystem')], ['zh', '中文'], ['en', 'English']], state.settings.language ?? 'auto', guard((v) => setLanguage(v)), t('panels.general.language'))),
      setRow(t('panels.general.theme'), t('panels.general.themeSub'), segmented([['system', t('panels.general.followSystem')], ['light', t('panels.general.light')], ['dark', t('panels.general.dark')]], prefs.theme, (v) => { prefs.theme = v; savePrefs(); applyAppearance(); }, t('panels.general.theme'))),
      setRow(t('panels.general.accent'), t('panels.general.accentSub'), accentBox),
      setRow(t('panels.general.motion'), t('panels.general.motionSub'), segmented([['quiet', t('panels.general.motionQuiet')], ['normal', t('panels.general.motionNormal')], ['lively', t('panels.general.motionLively')]], prefs.motion, (v) => { prefs.motion = v; savePrefs(); applyAppearance(); }, t('panels.general.motion'))),
    ),
    h(
      'div',
      { class: 'set-group' },
      setRow(t('panels.general.storage'), t('panels.general.storageSub'), null),
      setRow(t('panels.general.model'), t('panels.general.modelSub'), null),
    ),
  );
}

function botsPage(body) {
  const group = h('div', { class: 'set-group' });
  for (const bot of state.bots) {
    const sw = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', class: 'switch', checked: bot.isMain, 'aria-label': t('panels.bots.setMain', { name: bot.name }) }));
    sw.addEventListener(
      'change',
      guard(async () => {
        try {
          await api('PATCH', `/api/bots/${bot.id}`, { isMain: sw.checked });
        } catch (error) {
          sw.checked = !sw.checked;
          throw error;
        }
      }),
    );
    group.append(
      h(
        'div',
        { class: 'set-row' },
        markOf(bot, { size: 36, star: true }),
        h('button', { type: 'button', class: 'grow', onclick: () => { closeOverlay(); nav.openChat(`bot:${bot.id}`); state.drawer = { ...state.drawer, open: true, view: 'settings' }; nav.renderDrawer(); } }, h('span', null, bot.name), h('small', null, bot.role || t('panels.bots.noRole'))),
        h('label', { class: 'check' }, h('small', null, t('panels.bot.main')), sw),
      ),
    );
  }
  body.append(
    h('p', { class: 'hint' }, t('panels.bots.hint')),
    group,
    h('div', null, h('button', { type: 'button', class: 'btn', onclick: () => openOverlay({ kind: 'create-bot' }) }, icon('plus'), t('panels.quick.newBot'))),
  );
}

function groupsPage(body) {
  if (!state.groups.length) body.append(h('div', { class: 'empty-box' }, t('panels.groups.empty')));
  else {
    body.append(
      h(
        'div',
        { class: 'set-group' },
        state.groups.map((group) =>
          h(
            'div',
            { class: 'set-row' },
            groupMarkOf(group, 36),
            h('button', { type: 'button', class: 'grow', onclick: () => { closeOverlay(); nav.openChat(`group:${group.id}`); } }, h('span', null, group.name), h('small', null, t('panels.groups.summary', { members: t('panels.group.memberCount', { n: group.memberIds.length }), admin: botById(group.adminId)?.name ?? t('panels.groups.noAdmin'), mode: group.replyMode === 'all' ? t('panels.groups.modeAll') : t('panels.groups.modeAdmin') }))),
          ),
        ),
      ),
    );
  }
  body.append(h('div', null, h('button', { type: 'button', class: 'btn', onclick: () => openOverlay({ kind: 'create-group' }) }, icon('plus'), t('panels.quick.newGroup'))));
}

function memoryPage(body, o) {
  const scope = o.scope && (o.scope === 'team' || botById(o.scope)) ? o.scope : 'team';
  const picks = h(
    'div',
    { class: 'picks', role: 'radiogroup', 'aria-label': t('panels.memory.scope') },
    h('label', { class: 'pick' }, h('input', { type: 'radio', name: 'scope', value: 'team', checked: scope === 'team' }), h('span', null, h('span', { class: 'opt-icon', style: { width: '22px', height: '22px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' } }, icon('users', 14)), t('panels.memory.team'))),
    state.bots.map((bot) => h('label', { class: 'pick' }, h('input', { type: 'radio', name: 'scope', value: bot.id, checked: scope === bot.id }), h('span', null, botMark(bot, { size: 22 }), bot.name))),
  );
  picks.addEventListener('change', (e) => openOverlay({ ...o, scope: /** @type {HTMLInputElement} */ (e.target).value }));
  const box = h('div', { class: 'form' }, h('p', { class: 'muted deferred', role: 'status' }, t('panels.common.loading')));
  body.append(h('p', { class: 'hint' }, t('panels.memory.pageHint')), picks, box);
  void fillMemory(box, scope);
}

function tasksPage(body, o) {
  const active = new Set(['queued', 'running', 'waiting_for_tasks']);
  const waiting = (helper) => helper.status === 'waiting_for_user' || [...state.approvals.values()].some((approval) => approval.helperId === helper.id || (helper.sessionId && approval.sessionId === helper.sessionId));
  const statusOf = (helper) => waiting(helper) ? 'waiting' : active.has(helper.status) ? 'active' : helper.status === 'done' ? 'done' : 'interrupted';
  const filter = o.taskFilter ?? 'all';
  body.append(h('p', { class: 'hint' }, t('panels.tasks.hint')),
    segmented(['all', 'active', 'waiting', 'done', 'interrupted'].map((id) => [id, t(`panels.tasks.${id}`)]), filter, (taskFilter) => openOverlay({ ...o, taskFilter }), t('panels.settings.page.tasks')),
    h('div', { class: 'row-end' }, h('button', { type: 'button', class: 'btn', onclick: () => openOverlay({ kind: 'settings', page: 'schedules' }) }, icon('clock'), t('panels.tasks.schedules'))));
  const helpers = [...state.helpers, ...state.tasks].filter((helper) => filter === 'all' || statusOf(helper) === filter).sort((a, b) => Number(active.has(b.status)) - Number(active.has(a.status)) || b.createdAt - a.createdAt);
  if (!helpers.length) { body.append(h('div', { class: 'empty-box' }, t('panels.tasks.empty'))); return; }
  body.append(h('div', { class: 'task-list' }, helpers.map((helper) => {
    const bot = botById(helper.botId);
    const openChat = () => {
      closeOverlay();
      if (!waiting(helper) && helper.resultMessageId) void nav.revealMessage(helper.chatId, helper.resultMessageId);
      else nav.openChat(helper.chatId);
    };
    return h('article', { class: 'panel task-card' },
      h('div', { class: 'task-heading' }, h('h3', null, helper.title), h('span', { class: 'chip', dataset: { status: statusOf(helper) } }, t(helper.batchId ? `task.state.${helper.status}` : `panels.tasks.${statusOf(helper)}`))),
      h('p', { class: 'hint' }, `${bot?.name ?? 'Bot'} · ${chatName(helper.chatId)} · ${clockLabel(helper.createdAt)}`),
      h('p', { class: 'task-description' }, helper.task),
      helper.error ? h('p', { class: 'task-error' }, helper.error) : null,
      h('div', { class: 'task-actions' },
        h('button', { type: 'button', class: 'btn sm', onclick: openChat }, helper.status === 'waiting_for_user' ? t('task.answer') : waiting(helper) ? t('panels.tasks.review') : helper.status === 'done' ? t('panels.tasks.result') : t('panels.tasks.openChat')),
        helper.sessionId && canOpenSession() ? h('button', { type: 'button', class: 'btn sm', onclick: () => openSession(helper.sessionId) }, t('panels.tasks.session')) : null,
        (active.has(helper.status) || (helper.batchId && ['paused', 'waiting_for_user'].includes(helper.status))) ? h('button', { type: 'button', class: 'btn sm danger', onclick: guard(async () => { if (await confirmAction(t('panels.tasks.stop'), helper.title, t('panels.tasks.stop'))) await api('POST', `/api/${helper.batchId ? 'tasks' : 'helpers'}/${helper.id}/stop`); }) }, t('panels.tasks.stop')) : null));
  })));
}

/** When a schedule runs, in words. */
function scheduleWhen(s) {
  if (s.kind === 'once') return t('panels.schedule.onceAt', { time: clockLabel(s.runAt ?? s.nextRunAt) });
  if (s.kind === 'interval') return t('panels.schedule.everyMinutes', { n: s.everyMinutes });
  return t('panels.schedule.dailyAt', { time: s.time });
}

function schedulesPage(body, o) {
  const bots = state.bots;
  const form = /** @type {HTMLFormElement} */ (
    h(
      'form',
      { class: 'panel form', 'aria-labelledby': 'sch-title' },
      h('div', { class: 'panel-head' }, h('h3', { id: 'sch-title' }, t('panels.schedule.new'))),
      h('label', { class: 'field' }, h('span', null, t('panels.schedule.assignee')), h('div', { class: 'picks', role: 'radiogroup' }, bots.map((b, i) => h('label', { class: 'pick' }, h('input', { type: 'radio', name: 'botId', value: b.id, checked: o.botId ? b.id === o.botId : i === 0 }), h('span', null, botMark(b, { size: 22 }), b.name))))),
      h('label', { class: 'field' }, h('span', null, t('panels.schedule.prompt')), h('textarea', { class: 'textarea', name: 'prompt', rows: 2, required: true, placeholder: t('panels.schedule.promptPlaceholder') })),
      h(
        'div',
        { style: { display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' } },
        h('label', { class: 'field', style: { flex: '1', minWidth: '160px' } }, h('span', null, t('panels.schedule.name')), h('input', { class: 'input', name: 'name', maxlength: 40, placeholder: t('panels.schedule.namePlaceholder') })),
        h('label', { class: 'field' }, h('span', null, t('panels.schedule.frequency')), h('select', { class: 'select', name: 'kind' }, h('option', { value: 'daily' }, t('panels.schedule.daily')), h('option', { value: 'interval' }, t('panels.schedule.interval')), h('option', { value: 'once' }, t('panels.schedule.once')))),
        h('label', { class: 'field', dataset: { kind: 'daily' } }, h('span', null, t('panels.schedule.time')), h('input', { class: 'input', type: 'time', name: 'time', value: '09:00' })),
        h('label', { class: 'field', dataset: { kind: 'interval' }, hidden: true }, h('span', null, t('panels.schedule.intervalMinutes')), h('input', { class: 'input', type: 'number', name: 'everyMinutes', min: 5, value: 60, style: { width: '120px' } })),
        h('label', { class: 'field', dataset: { kind: 'once' }, hidden: true }, h('span', null, t('panels.schedule.inMinutes')), h('input', { class: 'input', type: 'number', name: 'inMinutes', min: 1, max: 10080, value: 10, style: { width: '120px' } })),
      ),
      h('p', { class: 'hint' }, t('panels.schedule.hint')),
      h('div', { class: 'row-end' }, h('button', { type: 'submit', class: 'btn primary', disabled: !bots.length }, t('panels.common.add'))),
    )
  );
  const sync = () => {
    const kind = /** @type {HTMLSelectElement} */ (form.elements.namedItem('kind')).value;
    for (const el of form.querySelectorAll('[data-kind]')) {
      el.hidden = el.dataset.kind !== kind;
      for (const input of el.querySelectorAll('input')) input.disabled = el.hidden;
    }
  };
  form.elements.namedItem('kind')?.addEventListener('change', sync);
  sync();
  form.addEventListener(
    'submit',
    guard(async (e) => {
      e.preventDefault();
      if (form.dataset.sending === 'true') return;
      form.dataset.sending = 'true';
      const submitted = Object.fromEntries(new FormData(form));
      try {
        await api('POST', '/api/schedules', submitted);
        if (JSON.stringify(Object.fromEntries(new FormData(form))) === JSON.stringify(submitted)) { form.reset(); sync(); }
      } finally { delete form.dataset.sending; }
      toast(t('panels.schedule.added'));
    }),
  );
  const rows = state.schedules.map((s) => {
    const bot = botById(s.botId);
    return h(
      'tr',
      null,
      h('td', null, s.name),
      h('td', null, h('span', { style: { display: 'inline-flex', gap: '6px', alignItems: 'center' } }, bot ? botMark(bot, { size: 18 }) : null, bot?.name ?? '—')),
      h('td', null, scheduleWhen(s)),
      h('td', { class: 'wrap' }, s.prompt),
      h('td', null, s.enabled ? (s.nextRunAt ? clockLabel(s.nextRunAt) : '—') : h('span', { class: 'chip' }, t('panels.schedule.paused'))),
      h('td', null, s.lastRunAt ? clockLabel(s.lastRunAt) : t('panels.schedule.neverRun')),
      h(
        'td',
        null,
        h(
          'div',
          { style: { display: 'flex', gap: '6px' } },
          h('button', { type: 'button', class: 'btn sm', onclick: guard(async () => { await api('POST', `/api/schedules/${s.id}/run`); toast(t('panels.schedule.ranNow', { name: botById(s.botId)?.name ?? 'Bot' })); }) }, t('panels.schedule.runNow')),
          h('button', { type: 'button', class: 'btn sm', onclick: guard(() => api('POST', '/api/schedules', { ...s, enabled: !s.enabled })) }, s.enabled ? t('panels.schedule.pause') : t('panels.schedule.enable')),
          h('button', { type: 'button', class: 'btn sm danger', onclick: guard(async () => { if (await confirmAction(t('panels.schedule.deleteTitle', { name: s.name }), t('panels.schedule.deleteBody'), t('panels.common.delete'))) await api('DELETE', `/api/schedules/${s.id}`); }) }, t('panels.common.delete')),
        ),
      ),
    );
  });
  body.append(
    form,
    h(
      'section',
      null,
      h('h3', { class: 'section-title' }, t('panels.schedule.listHeading', { n: state.schedules.length })),
      state.schedules.length
        ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', null, h('tr', null, [t('panels.schedule.name'), t('panels.schedule.colBot'), t('panels.schedule.frequency'), t('panels.schedule.colPrompt'), t('panels.schedule.colNext'), t('panels.schedule.colLast'), t('panels.schedule.colActions')].map((label) => h('th', { scope: 'col' }, label)))), h('tbody', null, rows)))
        : h('div', { class: 'empty-box' }, t('panels.schedule.empty')),
    ),
  );
}

function usagePage(body, o) {
  const days = o.days ?? 7;
  const seg = segmented([['1', t('panels.usage.range24h')], ['7', t('panels.usage.rangeDays', { n: 7 })], ['30', t('panels.usage.rangeDays', { n: 30 })], ['90', t('panels.usage.rangeDays', { n: 90 })]], String(days), (v) => openOverlay({ ...o, days: Number(v) }), t('panels.usage.range'));
  const holder = h('div', { class: 'form', style: { gap: '18px' } }, h('p', { class: 'muted deferred', role: 'status' }, t('panels.common.counting')));
  body.append(h('div', null, seg), holder);
  void api('GET', `/api/usage?days=${days}`)
    .then((data) => {
      if (state.overlay?.kind !== 'settings' || state.overlay.page !== 'usage') return;
      const totals = data.totals;
      const kpis = h(
        'div',
        { class: 'kpis' },
        h('div', { class: 'kpi big' }, h('span', { class: 'k-label' }, days === 1 ? t('panels.usage.last24h') : t('panels.usage.lastDays', { n: days })), h('span', { class: 'k-value' }, fmtNum(totals.turns), h('span', { class: 'k-unit' }, t('panels.usage.turnsUnit', { count: totals.turns })))),
        h('div', { class: 'kpi' }, h('span', { class: 'k-label' }, t('panels.usage.replyChars')), h('span', { class: 'k-value' }, fmtNum(totals.chars))),
        h('div', { class: 'kpi' }, h('span', { class: 'k-label' }, t('panels.usage.toolCalls')), h('span', { class: 'k-value' }, fmtNum(totals.tools))),
        h('div', { class: 'kpi' }, h('span', { class: 'k-label' }, t('panels.usage.avgDuration')), h('span', { class: 'k-value' }, totals.turns ? fmtDuration(totals.durationMs / totals.turns) : '—')),
      );
      holder.replaceChildren(
        kpis,
        h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', null, t('panels.usage.turnsTitle')), h('span', { class: 'count' }, days === 1 ? t('panels.usage.hourly') : t('panels.usage.daily'))), usageChart(data), legend(data.byBot)),
        h(
          'div',
          { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h3', null, t('panels.usage.botsTitle')), h('span', { class: 'count' }, data.byBot.length)),
          data.byBot.length
            ? h(
                'div',
                { class: 'bars' },
                data.byBot.map((r) =>
                  h(
                    'div',
                    { class: 'bar-row' },
                    botMark(r, { size: 32 }),
                    h('div', { class: 'grow' }, h('div', { class: 'bar-name' }, r.name, h('small', null, r.deleted ? t('panels.usage.deleted') : r.role)), h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: { width: `${totals.turns ? (r.turns / totals.turns) * 100 : 0}%`, background: `linear-gradient(90deg, ${PALETTES[r.color]?.stops[2] ?? '#ccc'}, ${PALETTES[r.color]?.stops[0] ?? '#888'})` } }))),
                    h('div', { class: 'bar-num' }, t('panels.usage.turns', { n: fmtNum(r.turns), count: r.turns }), h('small', null, t('panels.usage.shareChars', { pct: totals.turns ? Math.round((r.turns / totals.turns) * 100) : 0, chars: fmtNum(r.chars), count: r.chars }))),
                  ),
                ),
              )
            : h('div', { class: 'empty-box' }, t('panels.usage.empty')),
        ),
        h('p', { class: 'hint' }, t('panels.usage.hint')),
      );
    })
    .catch((error) => holder.replaceChildren(h('p', { class: 'muted', role: 'alert' }, t('panels.usage.failedWith', { error: error instanceof Error ? error.message : error }))));
}

function usageChart(data) {
  const width = 860;
  const height = 220;
  const pad = { l: 36, r: 8, t: 12, b: 26 };
  const max = Math.max(1, ...data.buckets.map((b) => b.turns));
  const nice = max <= 4 ? max : Math.ceil(max / 4) * 4;
  const step = (width - pad.l - pad.r) / data.buckets.length;
  const barW = Math.max(3, Math.min(30, step * 0.56));
  const y = (v) => pad.t + (height - pad.t - pad.b) * (1 - v / nice);
  const parts = [];
  for (const tick of [0, nice / 2, nice]) {
    parts.push(`<line class="grid" x1="${pad.l}" x2="${width - pad.r}" y1="${y(tick)}" y2="${y(tick)}"/>`);
    parts.push(`<text class="axis" x="${pad.l - 8}" y="${y(tick) + 4}" text-anchor="end">${Math.round(tick)}</text>`);
  }
  const order = data.byBot.map((r) => r.botId);
  const colorOf = (id) => data.byBot.find((r) => r.botId === id)?.color ?? 'graphite';
  const every = Math.ceil(data.buckets.length / 10);
  data.buckets.forEach((b, i) => {
    const x = pad.l + i * step + (step - barW) / 2;
    let acc = 0;
    for (const id of order) {
      const v = b.bots[id] ?? 0;
      if (!v) continue;
      const top = y(acc + v);
      const bottom = y(acc);
      const ink = PALETTES[colorOf(id)] ? colorOf(id) : 'graphite';
      const title = escapeHtml(t('panels.usage.barTitle', { label: b.label, name: data.byBot.find((r) => r.botId === id)?.name ?? '', n: v }));
      parts.push(`<rect x="${x}" y="${top + 1}" width="${barW}" height="${Math.max(1, bottom - top - 1)}" rx="3" style="fill:var(--ink-${ink})"><title>${title}</title></rect>`);
      acc += v;
    }
    if (!b.turns) parts.push(`<circle cx="${x + barW / 2}" cy="${y(0)}" r="1.6" style="fill:var(--subtle)"/>`);
    if (i % every === 0 || i === data.buckets.length - 1) parts.push(`<text class="axis" x="${x + barW / 2}" y="${height - 6}" text-anchor="middle">${escapeHtml(b.label)}</text>`);
  });
  return h('div', { html: `<svg class="chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(t('panels.usage.chartLabel'))}">${parts.join('')}</svg>` });
}

function legend(rows) {
  if (!rows.length) return null;
  return h('div', { class: 'legend' }, rows.map((r) => h('span', null, h('i', { style: { background: inkOf(r.color) } }), r.name)));
}

// ================================================================== context menu
/** @type {HTMLElement | null} */
let menuEl = null;

function closeMenu() {
  if (!menuEl) return false;
  menuEl.remove();
  menuEl = null;
  return true;
}

export function openContextMenu(x, y, chatId) {
  closeMenu();
  const target = targetOf(chatId);
  const item = target.bot ?? target.group;
  if (!item) return;
  const isBot = Boolean(target.bot);
  const run = (fn) => () => {
    closeMenu();
    void fn();
  };
  const entries = [
    [t('panels.menu.open'), 'chat', () => nav.openChat(chatId)],
    [item.pinned ? t('panels.menu.unpin') : t('panels.menu.pin'), 'pin', guard(() => api('PATCH', isBot ? `/api/bots/${item.id}` : `/api/groups/${item.id}`, { pinned: !item.pinned }))],
    [isBot ? t('panels.botSettings.title') : t('panels.groupSettings.title'), 'gear', () => { nav.openChat(chatId); state.drawer = { ...state.drawer, open: true, view: 'settings' }; nav.renderDrawer(); }],
    [t('panels.chat.newChat'), 'eraser', () => resetChat(chatId)],
    [t('panels.common.delete'), 'trash', () => (isBot ? deleteBot(item) : deleteGroup(item)), 'danger'],
  ];
  menuEl = h(
    'div',
    { class: 'menu', role: 'menu', 'aria-label': t('panels.menu.label', { name: chatName(chatId) }) },
    entries.map(([label, ic, fn, cls]) => h('button', { type: 'button', role: 'menuitem', class: cls ?? '', onclick: run(fn) }, icon(/** @type {any} */ (ic)), label)),
  );
  document.body.append(menuEl);
  const rect = menuEl.getBoundingClientRect();
  menuEl.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
  menuEl.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;
  /** @type {HTMLElement | null} */ (menuEl.querySelector('button'))?.focus();
  setTimeout(() => document.addEventListener('mousedown', (e) => { if (menuEl && !menuEl.contains(/** @type {Node} */ (e.target))) closeMenu(); }, { once: true }));
}
