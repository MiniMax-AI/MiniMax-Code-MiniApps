// @ts-check
import { api, cacheReactionUpdate, h, icon, messageCacheEpoch, state, t, toast } from './core.js';
import { locale } from './i18n.js';
import { canReact, EMOJIS, QUICK_EMOJIS, userReaction } from './emoji-data.js';

const pending = new Set();
const GRID_COLUMNS = 7;
let picker = null;
const messageOf = (chatId, id) => state.messages.get(chatId)?.find((m) => m.id === id);
const labelOf = (emoji) => {
  const entry = EMOJIS.find((item) => item.emoji === emoji);
  return entry?.[locale()] ?? emoji;
};

export function closeReactionPicker() {
  picker?.close();
}

export function closeDetachedReactionPicker() {
  if (picker && !picker.anchor.isConnected) closeReactionPicker();
}

/** Merge only reaction fields; an HTTP response must never roll back a newer SSE update. */
export function applyReactionUpdate(event) {
  const message = cacheReactionUpdate(event);
  if (message) refreshReactions(message);
}

function refreshReactions(m) {
  for (const bar of document.querySelectorAll('.reaction-bar')) {
    if (bar.dataset.mid !== m.id || bar.dataset.chat !== m.chatId) continue;
    replaceBar(bar, m);
  }
  if (picker?.chatId === m.chatId && picker?.messageId === m.id) picker.refresh();
}

function replaceBar(bar, m) {
  const focused = bar.contains(document.activeElement);
  const emoji = document.activeElement?.getAttribute('data-emoji');
  const replacement = reactionBar(m);
  bar.replaceWith(replacement);
  if (focused) {
    const buttons = [...replacement.querySelectorAll('button')];
    (
      buttons.find((b) => b.dataset.emoji === emoji) ??
      buttons[0] ??
      replacement.closest('.bubble-wrap')?.querySelector('.reaction-trigger') ??
      replacement.parentElement?.querySelector('.reaction-trigger')
    )?.focus({ preventScroll: true });
  }
}

/** Keep the badge on the bubble of the reply without replacing its text or media. */
export function updateBubbleReactions(bubble, m) {
  const bar = bubble.querySelector(':scope > .reaction-bar');
  if (bar) replaceBar(bar, m);
  else bubble.append(reactionBar(m));
}

async function selectReaction(m, emoji) {
  const key = `${m.chatId}/${m.id}`;
  if (pending.has(key)) return;
  const current = messageOf(m.chatId, m.id);
  if (!current || !canReact(current)) return;
  pending.add(key);
  const epoch = messageCacheEpoch(m.chatId);
  refreshReactions(current);
  try {
    const result = await api('PUT', `/api/chats/${m.chatId}/messages/${m.id}/reactions`, {
      emoji,
      selected: userReaction(current) !== emoji,
    });
    if (messageCacheEpoch(m.chatId) !== epoch) return;
    applyReactionUpdate({ chatId: m.chatId, ...result });
    if (picker?.chatId === m.chatId && picker?.messageId === m.id) closeReactionPicker();
  } catch {
    toast(t('reaction.failed'), 'error');
  } finally {
    pending.delete(key);
    const latest = messageOf(m.chatId, m.id);
    if (latest) refreshReactions(latest);
  }
}

export function reactionButton(m) {
  if (!canReact(m)) return null;
  const button = h(
    'button',
    {
      type: 'button',
      class: 'tool-btn reaction-trigger',
      title: t('reaction.add'),
      'aria-label': t('reaction.add'),
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
      onclick: () => {
        if (picker?.anchor === button) closeReactionPicker();
        else openPicker(button, m);
      },
    },
    icon('reaction', 17),
  );
  return button;
}

export function reactionBar(m) {
  const selected = canReact(m) ? userReaction(m) : undefined;
  return h(
    'div',
    { class: 'reaction-bar', dataset: { mid: m.id, chat: m.chatId } },
    ...[selected].filter(Boolean).map((emoji) =>
      h(
        'button',
        {
          type: 'button',
          class: 'reaction-chip',
          dataset: { emoji },
          'aria-pressed': 'true',
          'aria-label': t('reaction.remove', { emoji: labelOf(emoji) }),
          title: t('reaction.selected', { emoji: labelOf(emoji) }),
          'aria-disabled': String(pending.has(`${m.chatId}/${m.id}`)),
          onclick: () => void selectReaction(m, emoji),
        },
        h('span', { 'aria-hidden': 'true' }, emoji),
      ),
    ),
  );
}

function openPicker(anchor, m) {
  closeReactionPicker();
  const panel = h('div', {
    class: 'reaction-picker',
    popover: 'auto',
    role: 'dialog',
    'aria-label': t('reaction.add'),
  });
  let expanded = false;
  const refresh = () => {
    const current = messageOf(m.chatId, m.id) ?? m;
    for (const button of panel.querySelectorAll('[data-emoji]')) {
      const emoji = button.getAttribute('data-emoji');
      const selected = userReaction(current) === emoji;
      button.setAttribute('aria-pressed', String(selected));
      button.setAttribute('aria-disabled', String(pending.has(`${m.chatId}/${m.id}`)));
      button.setAttribute(
        'aria-label',
        t(selected ? 'reaction.remove' : 'reaction.choose', { emoji: labelOf(emoji) }),
      );
    }
  };
  const emojiButton = (emoji) =>
    h(
      'button',
      {
        type: 'button',
        class: 'emoji-option',
        dataset: { emoji },
        title: labelOf(emoji),
        onclick: () => void selectReaction(m, emoji),
      },
      h('span', { 'aria-hidden': 'true' }, emoji),
    );
  const position = () => {
    const rect = anchor.getBoundingClientRect();
    const feed = anchor.closest('.feed')?.getBoundingClientRect();
    const top = Math.max(8, feed?.top ?? 8);
    const bottom = Math.min(window.innerHeight - 8, feed?.bottom ?? window.innerHeight - 8);
    const above = rect.top - top - 6;
    const below = bottom - rect.bottom - 6;
    panel.style.maxHeight = `${Math.max(80, above, below)}px`;
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
    const placeAbove = expanded ? above >= height || above >= below : below < height && above > below;
    panel.style.top = `${Math.max(top, placeAbove ? rect.top - height - 6 : rect.bottom + 6)}px`;
  };
  const expand = () => {
    expanded = true;
    panel.classList.add('expanded');
    const input = /** @type {HTMLInputElement} */ (
      h('input', {
        type: 'search',
        class: 'emoji-search',
        placeholder: t('reaction.search'),
        'aria-label': t('reaction.search'),
      })
    );
    const results = h('div', { class: 'emoji-results', 'aria-label': t('reaction.results') });
    let category = 'suggested';
    const categories = h('div', { class: 'emoji-categories', role: 'group', 'aria-label': t('reaction.categories') });
    for (const [group, glyph] of [['suggested', 'clock'], ['smileys', 'smile'], ['gestures', 'hand'], ['hearts', 'heart']]) {
      categories.append(h('button', {
        type: 'button', class: 'emoji-category', dataset: { category: group },
        title: t(`reaction.${group}`), 'aria-label': t(`reaction.${group}`),
        onclick: () => { category = group; input.value = ''; renderResults(); },
      }, icon(glyph, 18)));
    }
    const renderResults = () => {
      const query = input.value.trim().toLowerCase();
      const matches = EMOJIS.filter((e) => `${e.emoji} ${e.en} ${e.zh}`.includes(query));
      results.replaceChildren();
      for (const button of categories.children) button.setAttribute('aria-pressed', String(!query && button.dataset.category === category));
      const groups = query ? ['results'] : category === 'suggested' ? ['suggested', 'smileys', 'gestures', 'hearts'] : [category];
      for (const group of groups) {
        const entries = query ? matches : group === 'suggested'
          ? ['😀', '👍', '❤️', '🎉', '🚀', '👀', '🙏'].map((emoji) => EMOJIS.find((e) => e.emoji === emoji))
          : matches.filter((e) => e.group === group);
        if (entries.length)
          results.append(
            h('h3', null, t(`reaction.${group}`)),
            h(
              'div',
              { class: 'emoji-grid' },
              entries.map((e) => emojiButton(e.emoji)),
            ),
          );
      }
      if (!matches.length) results.append(h('p', { role: 'status' }, t('reaction.empty')));
      results.scrollTop = 0;
      refresh();
    };
    input.addEventListener('input', renderResults);
    const back = h('button', {
      type: 'button', class: 'emoji-back', 'aria-label': t('reaction.back'),
      title: t('reaction.back'), onclick: () => {
        compact();
        position();
        panel.querySelector('.emoji-more')?.focus({ preventScroll: true });
      },
    }, icon('left', 16));
    panel.replaceChildren(h('div', { class: 'emoji-header' }, back,
      h('div', { class: 'emoji-search-wrap' }, icon('search', 15), input)), categories, results);
    renderResults();
    position();
    input.focus({ preventScroll: true });
  };
  const compact = () => {
    expanded = false;
    panel.classList.remove('expanded');
    panel.replaceChildren(
      h(
        'div',
        { class: 'emoji-quick' },
        QUICK_EMOJIS.map(emojiButton),
        h(
          'button',
          {
            type: 'button',
            class: 'emoji-option emoji-more',
            'aria-label': t('reaction.more'),
            title: t('reaction.more'),
            onclick: expand,
          },
          icon('reaction', 20),
        ),
      ),
    );
    refresh();
  };
  compact();
  const close = () => {
    const restore = panel.contains(document.activeElement);
    picker = null;
    panel.remove();
    anchor.setAttribute('aria-expanded', 'false');
    window.removeEventListener('resize', close);
    document.removeEventListener('scroll', onScroll, true);
    if (restore) {
      const target = anchor.isConnected ? anchor : [...document.querySelectorAll('.reaction-bar')]
        .find((bar) => bar.dataset.mid === m.id && bar.dataset.chat === m.chatId)
        ?.closest('.bubble-wrap')?.querySelector('.reaction-trigger');
      target?.focus({ preventScroll: true });
    }
  };
  const onScroll = (event) => {
    if (!panel.contains(event.target)) close();
  };
  picker = {
    panel, anchor, chatId: m.chatId, messageId: m.id, close, refresh,
  };
  panel.addEventListener('toggle', (event) => {
    if (event.newState === 'closed' && picker?.panel === panel) close();
  });
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    const buttons = [...panel.querySelectorAll(expanded ? '[data-emoji]' : 'button')];
    const index = buttons.indexOf(document.activeElement);
    if (index >= 0 && ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      const step =
        event.key === 'ArrowRight'
          ? 1
          : event.key === 'ArrowLeft'
            ? -1
            : (event.key === 'ArrowDown' ? 1 : -1) * (expanded ? GRID_COLUMNS : 1);
      buttons[((index + step) % buttons.length + buttons.length) % buttons.length]?.focus();
    }
    if (event.target.matches('input') && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      const options = panel.querySelectorAll('[data-emoji]');
      (event.key === 'ArrowDown' ? options[0] : options[options.length - 1])?.focus();
    }
    if (event.key === 'Tab') {
      const focusable = [...panel.querySelectorAll('input, button')];
      const next = focusable.indexOf(document.activeElement) + (event.shiftKey ? -1 : 1);
      if (next < 0 || next >= focusable.length) {
        event.preventDefault();
        focusable[(next + focusable.length) % focusable.length]?.focus();
      }
    }
  });
  document.body.append(panel);
  panel.showPopover();
  anchor.setAttribute('aria-expanded', 'true');
  refresh();
  position();
  panel.querySelector('button')?.focus({ preventScroll: true });
  window.addEventListener('resize', close);
  document.addEventListener('scroll', onScroll, true);
}
