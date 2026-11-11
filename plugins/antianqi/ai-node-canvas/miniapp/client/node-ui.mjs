// What a card shows about itself.
//
// The rules that decide the *shape* of a card live here, apart from the rules
// that decide what a card *is* — those are in `forms.mjs`. Everything in this
// file is a pure function of the node and the capability table, so the page
// and the tests read the same one.
//
// The design this file follows is the one the reference canvas uses: a card
// does not carry its parameters as a row of controls. It carries one chip
// that sums them up, and the panel behind that chip holds the controls. Both
// read the same list, so the chip can never say something the panel would not.
// The count has a chip and a panel of its own, so no option is offered twice.

import { NODE_FORMS, cardTools, kindOf, modeOf, modeRecordOf, modesFor, ratioLabel, ratioOptionsFor, roleOf } from './forms.mjs';

/**
 * The name of the mode a node is in.
 *
 * The mode is a choice on the card, so it names itself; a node that is not
 * generating has no mode to name.
 */
export function nodeModeLabel(node) {
  if (roleOf(node) !== 'generate') return '';
  return modeRecordOf(node)?.label ?? '';
}

/**
 * The kind of a node and the mode it is in, as one line of words.
 *
 * `ctx.inputKindLabels` names the kinds of data an input card can take. The
 * page reads those words from the runtime, so the label is the runtime's word
 * and not a copy of it.
 */
export function nodeKindLabel(node, ctx = {}) {
  const mode = nodeModeLabel(node);
  const label = NODE_FORMS[node.type]?.label ?? node.type;
  if (node.type === 'input') {
    return `输入 · ${ctx.inputKindLabels?.[node?.metadata?.kind] ?? node?.metadata?.kind ?? ''}`;
  }
  return mode ? `${label} · ${mode}` : label;
}

/**
 * The mode a node may be put in, as the bar carries it.
 *
 * The bar says what the node is going to do, and it says it in the one place
 * every node has — so a text node, which has no chip of its own to open a
 * panel with, can still be told to become something else. A mode the model
 * cannot run is not offered: only MiniMax-H3 can continue a video.
 */
export function modeChoice(node, caps) {
  const modes = modesFor(node, caps);
  if (!modes.length) return null;
  return {
    value: modeOf(node),
    options: modes.map((mode) => ({ value: mode.id, label: mode.label })),
  };
}

/**
 * Which chip the open panel belongs to.
 *
 * The bar under a card holds a chip for the shape and the size, and a chip
 * for how many. Each chip opens a panel of its own: the shape chip opens the
 * shape and the size, the count chip opens the count — never both, so an
 * option is never offered in two places at once.
 */
export function openChip(panel, nodeId) {
  if (panel?.nodeId !== nodeId) return null;
  if (panel?.type === 'params') return 'params';
  if (panel?.type === 'count') return 'count';
  return null;
}

/**
 * The fields a panel holds.
 *
 * The shape panel holds what shapes the thing — the frame, the size, the
 * length — and leaves the count to the count chip. The count panel holds the
 * count and nothing else. The model is in neither: it has a button of its
 * own and a list of its own.
 */
export function panelFields(fields, scope) {
  const list = fields ?? [];
  if (scope === 'count') return list.filter((field) => field?.key === 'count');
  return list.filter((field) => field?.key !== 'model' && field?.key !== 'count');
}

/**
 * What floats above a card.
 *
 * The dock of tools, and the small buttons — the way out of the app and the
 * menu of the material — at the end of the row. Nothing else floats above a
 * card: what a card is and how it is doing are said by the card itself.
 */
export function railParts(layers) {
  return (layers?.above ?? []).map((part) => ({
    part,
    where: part === 'save' || part === 'menu' ? 'acts' : 'main',
  }));
}

/**
 * The controls a card's parameters have, in the order the panel shows them.
 *
 * Every field says the same thing four times: which value it holds, which
 * values it may take, and — for the summary chip — how it reads in one line.
 * The chip and the panel are two drawings of this one list, which is the
 * whole point: a card cannot show "16:9" in the chip and "9:16" in the
 * panel, because there is only one list.
 *
 * `ctx` carries the three things only the page knows: the models this node
 * can run, the voice catalogue the runtime fetched, and the batch sizes.
 */
export function paramFields(node, caps, ctx = {}) {
  const md = node?.metadata ?? {};
  const fields = [];

  // The ratio follows the request the mode makes. The two keyframe requests
  // follow the frame, so there is nothing to choose there.
  const ratios = ratioOptionsFor(node, caps);
  if (ratios.length) {
    const value = ratios.includes(md.ratio) ? md.ratio : ratios[0];
    fields.push({
      key: 'ratio',
      label: '画幅',
      value,
      // The button says the ratio and nothing else: the grid draws the shape
      // anyway, and the way the frame lies is in the tooltip.
      options: ratios.map((ratio) => ({
        value: ratio,
        label: ratioLabel(ratio, { short: true }),
        hint: ratioLabel(ratio),
      })),
      chip: ratioLabel(value, { short: true }),
    });
  }

  const resolutions = caps?.resolutions ?? [];
  if (resolutions.length) {
    const value = resolutions.includes(md.resolution) ? md.resolution : resolutions[0];
    fields.push({
      key: 'resolution',
      label: '清晰度',
      value,
      options: resolutions.map((item) => ({ value: item, label: item })),
      chip: value,
    });
  }

  const durations = caps?.durations ?? [];
  if (caps?.supportsDuration && durations.length) {
    const value = durations.map(String).includes(String(md.duration)) ? String(md.duration) : String(durations[0]);
    fields.push({
      key: 'duration',
      label: '时长',
      value,
      options: durations.map((item) => ({ value: String(item), label: `${item}s` })),
      chip: `${value}s`,
    });
  }

  const models = ctx.models ?? [];
  if (models.length) {
    const value = models.some((item) => item.value === md.model) ? md.model : models[0].value;
    fields.push({
      key: 'model',
      label: '模型',
      value,
      options: models,
      chip: models.find((item) => item.value === value)?.label ?? value,
    });
  }

  const voices = ctx.voices ?? [];
  if (caps?.supportsVoice && voices.length) {
    const value = md.voice ?? '';
    fields.push({
      key: 'voice',
      label: '音色',
      value,
      options: voices,
      chip: voices.find((item) => item.value === value)?.label ?? value,
    });
  }

  const emotions = caps?.emotions ?? [];
  if (emotions.length) {
    const value = md.emotion ?? '';
    fields.push({
      key: 'emotion',
      label: '情绪',
      value,
      options: [{ value: '', label: '默认' }, ...emotions.map((item) => ({ value: item.value, label: item.label }))],
      chip: emotions.find((item) => item.value === value)?.label ?? '默认',
    });
  }

  const counts = ctx.counts ?? [];
  if (counts.length) {
    const value = String(md.count ?? 1);
    fields.push({
      key: 'count',
      label: '生成数量',
      value,
      options: counts,
      chip: `× ${value}`,
    });
  }

  return fields;
}

/**
 * The parameters the summary chip shows.
 *
 * The chip is one small line in the bar, so it only says what the thing will
 * look like: its shape, its size and how long it runs. The model has a
 * button of its own and the count has a chip of its own, so neither of them
 * is said twice.
 */
const CHIP_FIELDS = new Set(['ratio', 'resolution', 'duration']);

/**
 * The one line that sums the parameters up.
 *
 * The chip shows this, and this is computed from the same list the panel
 * holds, so the two can never fall apart.
 */
export function paramSummary(fields) {
  return (fields ?? [])
    .filter((field) => CHIP_FIELDS.has(field?.key))
    .map((field) => field?.chip ?? '')
    .filter((text) => text !== '')
    .join(' · ');
}

/**
 * The two layers of a card.
 *
 * A card keeps the material — the picture, the text, the thing the card is
 * about — and hands the operation to a surface that floats below the card
 * while the card is selected. The card is a picture of the work; the
 * surface is the desk you work on. A board full of cards therefore stays a
 * board full of cards.
 *
 * The rule is one function of the node, so the card and the surface cannot
 * disagree about what belongs where.
 *
 * `ctx.hasOutput` says that the card has made something, so it shows the
 * product instead of the empty frame. `ctx.tools` is the tool catalogue of
 * the runtime.
 */
export function cardLayers(node, ctx = {}) {
  const role = roleOf(node);
  const kind = kindOf(node);
  const tools = cardTools(node, ctx.tools ?? []);
  // What the card holds: the product it made, or the file the user brought
  // in. The card shows it instead of the empty frame.
  const hasOutput = Boolean(node?.metadata?.output?.media?.length || node?.metadata?.output?.text);
  const material = [];
  const ops = [];
  const above = [];
  if (role === 'group') {
    // A group holds cards, not material: it only says how many are in it.
    material.push('note');
  } else if (role === 'input') {
    if (kind === 'text') {
      // A text input card holds text: the card shows the text it holds, and
      // the template picker and the editor float below it.
      material.push('text');
      ops.push('style', 'composer');
    } else {
      // A card that holds a picture shows the picture, and the way in is
      // the button that floats above it — while it holds nothing.
      material.push(hasOutput ? 'output' : 'frame');
      if (!hasOutput) above.push('upload');
    }
  } else if (role === 'result') {
    material.push('output');
  } else {
    // A generating card is a media card: it shows what it made, and an
    // empty frame until it has made something. The prompt that made it is
    // not on the card — it is in the surface below, where it can be edited.
    material.push(hasOutput ? 'output' : 'frame');
    ops.push('composer');
    if (modeOf(node) === 'prompt') ops.push('prompt-template');
    ops.push('params');
  }
  // The tools float above the card, the way the reference canvas holds them:
  // the card is the picture, and the dock above it is what may be done to
  // that picture. A card with nothing to work on has no dock — an empty
  // input card offers the upload button and nothing else.
  if (tools.length && !(role === 'input' && !hasOutput)) above.push('tools');
  // The way out of the app: a card that holds a file can hand it to the
  // user's machine. An audio card carries its own download in the row under
  // its wave, so one file does not get two ways out of the app.
  if (node?.metadata?.output?.media?.length && kind !== 'audio') above.push('save');
  // A card that holds something says what may be done to it in a menu.
  if (role === 'input' && kind !== 'text' && hasOutput) above.push('menu');
  return { material, ops, above };
}

/**
 * How far the operation surface stays away from the card, in screen pixels.
 * The stylesheet mirrors this number.
 */
export const OPS_GAP = 10;

/**
 * Where the operation surface goes.
 *
 * The surface hangs below the card. When there is no board left below it, it
 * goes above the card instead — and the choice is made from the space that
 * is really there, not from a guess. When neither side has room, it stays
 * below, because that is where the card is.
 */
export function opsSide({
  nodeTop, nodeBottom, panelHeight, viewTop, viewBottom, gap = OPS_GAP, prefer = 'below',
}) {
  const fits = (side) => (side === 'below'
    ? nodeBottom + gap + panelHeight <= viewBottom
    : nodeTop - gap - panelHeight >= viewTop);
  if (fits(prefer)) return prefer;
  const other = prefer === 'below' ? 'above' : 'below';
  if (fits(other)) return other;
  return prefer;
}

/**
 * How far the operation surface moves sideways to stay inside the window.
 *
 * The surface that holds the prompt is as wide as a page, because a prompt is
 * read across. A card near the edge of the window would push half of that
 * page off the screen, so the surface moves back inside — and when it is
 * wider than the window there is nowhere to move to, so it stays put.
 */
export function opsOffset({ rect, view, margin = 8 }) {
  if (!rect || !view) return 0;
  const room = view.width - margin * 2;
  if (rect.width >= room) return 0;
  if (rect.left < view.left + margin) return view.left + margin - rect.left;
  if (rect.right > view.right - margin) return view.right - margin - rect.right;
  return 0;
}

/**
 * The box a text line lands on.
 *
 * A card that holds text has no text port: the line ends on the box that
 * holds the text. That box is on the card, so the line does not follow the
 * operation surface out of it.
 *
 * It reads the layers of the card, so the box is chosen by the same rule
 * that put the text on the card in the first place. A card that takes no
 * text of its own — a generating card, whose prompt lives in the surface
 * below it — has no box at all: the line ends on the card's text port.
 */
export function textAnchor(layers) {
  return (layers?.material ?? []).find((part) => part === 'text') ?? null;
}

/**
 * The rectangle a ratio is drawn as.
 *
 * "16:9" is a number; a button that only says the number asks the reader
 * to picture it. So every ratio is drawn as the shape it stands for, inside
 * one box, and the label under the shape names it.
 *
 * A shape the provider decides — `auto`, `adaptive` — has no proportion to
 * draw, so it is drawn as a square and marked as adaptive.
 */
export function ratioGlyph(ratio, box = { width: 24, height: 16 }) {
  const maxWidth = Number(box?.width ?? 24) || 24;
  const maxHeight = Number(box?.height ?? 16) || 16;
  const [wide, tall] = String(ratio ?? '').split(':').map((part) => Number(part));
  if (!Number.isFinite(wide) || !Number.isFinite(tall) || wide <= 0 || tall <= 0) {
    return { width: maxHeight, height: maxHeight, adaptive: true };
  }
  const scale = Math.min(maxWidth / wide, maxHeight / tall);
  const round = (value) => Math.round(value * 10) / 10;
  return {
    width: Math.max(4, round(wide * scale)),
    height: Math.max(4, round(tall * scale)),
    adaptive: false,
  };
}

/**
 * The resolutions a model offers, as one line.
 *
 * The model list says what a model can do, and the range of its resolutions
 * is the part that matters at a glance. The order the provider lists is not
 * the order a reader expects, so the two ends are put in order here.
 */
export function modelRange(model) {
  const list = (Array.isArray(model?.resolutions) ? model.resolutions : []).filter(Boolean);
  if (!list.length) return '';
  if (list.length === 1) return String(list[0]);
  // 4K is four thousand pixels and 768P is seven hundred and sixty-eight, so
  // the unit decides which end is the big one.
  const rank = (item) => {
    const text = String(item).toUpperCase();
    const number = Number(text.replace(/[^0-9.]/g, '')) || 0;
    return text.includes('K') ? number * 1000 : number;
  };
  const sorted = [...list].sort((a, b) => rank(a) - rank(b));
  const low = sorted[0];
  const high = sorted[sorted.length - 1];
  return low === high ? String(low) : `${low}-${high}`;
}

/**
 * What a failed card offers.
 *
 * A failure that only says what went wrong leaves the user with nothing to
 * do about it, so the card grows four buttons: try again, take the failure
 * back, delete the node, and report it. Only a node that makes something can
 * be tried again.
 */
export function errorActions(node) {
  if (!node?.metadata?.output?.error) return [];
  const actions = [];
  if (roleOf(node) === 'generate') actions.push({ key: 'retry', label: '重试' });
  actions.push({ key: 'cancel', label: '取消' });
  actions.push({ key: 'delete', label: '删除' });
  actions.push({ key: 'report', label: '上报' });
  return actions;
}

/**
 * The menu that opens on a card, in five sections.
 *
 * The sections are the same five the reference canvas uses: 素材 (what the
 * card holds), 编辑 (what can be done to the card), 组织 (how it sits with
 * the others), 视图 (where the board looks) and 危险 (the one that undoes
 * it). A section with nothing in it is left out, so the menu never shows a
 * divider with nothing under it.
 *
 * The entries carry the *name* of the action, not the action itself: the page
 * turns the names into what they do, and this file stays pure.
 */
export function nodeMenuEntries(node, ctx = {}) {
  const output = node?.metadata?.output ?? {};
  const media = output.media?.[0] ?? null;

  const material = [];
  // The clipboard takes a picture, so only a picture is offered for copying.
  if (media?.kind === 'image') material.push({ label: '复制素材', action: 'copy-media' });
  if (output.text) material.push({ label: '复制文本', action: 'copy-text' });
  if (media?.url) material.push({ label: '保存到本地', action: 'save-local' });

  const edit = [
    { label: '重命名', action: 'rename' },
    { label: '剪切', action: 'cut' },
    { label: '复制', action: 'copy' },
    { label: '创建副本', action: 'duplicate' },
    { label: '粘贴', action: 'paste', disabled: !ctx.canPaste },
  ];

  const organize = [];
  if ((ctx.selectedCount ?? 1) > 1) organize.push({ label: '编组', action: 'group' });
  if (ctx.isGroup) organize.push({ label: '解组', action: 'ungroup' });

  const view = [{ label: '聚焦选中内容', action: 'focus' }];
  if (media?.url || output.text) view.push({ label: '清除结果', action: 'clear' });

  const danger = [{ label: '删除节点', action: 'delete', danger: true }];

  const sections = [material, edit, organize, view, danger].filter((section) => section.length);
  return sections.flatMap((section, index) => (index === 0 ? section : ['-', ...section]));
}

/**
 * The cards a group holds.
 *
 * A group does not keep a list of its members: the members are the cards
 * that sit inside it. That way a card dragged into a group is in it, and a
 * card dragged out of it is not, with nothing to keep in step.
 */
export function groupMembers(group, nodes) {
  if (!group) return [];
  const left = group.position?.x ?? 0;
  const top = group.position?.y ?? 0;
  const right = left + (group.width ?? 0);
  const bottom = top + (group.height ?? 0);
  return (nodes ?? [])
    .filter((node) => node.id !== group.id && node.type !== 'group')
    .filter((node) => {
      const cx = (node.position?.x ?? 0) + (node.width ?? 0) / 2;
      const cy = (node.position?.y ?? 0) + (node.height ?? 0) / 2;
      return cx >= left && cx <= right && cy >= top && cy <= bottom;
    })
    .map((node) => node.id);
}

/**
 * The shortest cut the runtime accepts, in milliseconds.
 *
 * A cut shorter than this is not a cut: ffmpeg would be asked for a piece
 * that is not there.
 */
export const CLIP_MIN_MS = 200;

/**
 * How far the handles stay inside the ends of the strip.
 *
 * The stylesheet mirrors this number: a handle is 12 wide, so it sits half
 * its width inside the end of the strip, and the strip and the handle agree
 * on where a point of the clip is.
 */
export const CLIP_HANDLE_INSET = 6;

/**
 * How much of the strip a point of it is, in percent.
 *
 * The strip is the whole material, and the range is picked out of it, so
 * every point of the strip has one number: how far along the material it
 * is. The handles and the playhead all read that number, so they cannot
 * disagree about where a moment of the material is.
 */
export function stripPercent(ms, durationMs) {
  const total = Math.max(0, Number(durationMs) || 0);
  if (!total) return 0;
  return Math.min(100, Math.max(0, (Number(ms) || 0) / total * 100));
}

/**
 * The moment of the material a point of the strip means.
 *
 * The two ends of the strip are held in by the handles' own inset, so the
 * ends of the strip and the ends of the material are the same place. A
 * press outside the strip is held at the end it belongs to, so the answer
 * is always a moment of the material.
 */
export function stripMsAt({ clientX, rectLeft = 0, rectWidth = 0, durationMs = 0 }) {
  const total = Math.max(0, Number(durationMs) || 0);
  const usable = Math.max(1, Math.max(1, Number(rectWidth) || 0) - CLIP_HANDLE_INSET * 2);
  const x = (Number(clientX) || 0) - (Number(rectLeft) || 0) - CLIP_HANDLE_INSET;
  const ratio = Math.min(1, Math.max(0, x / usable));
  return Math.round(ratio * total);
}

/**
 * The moment of the material a hand that took the mark arrives at.
 *
 * A hand that took the mark carries it by the distance it travels, so the
 * mark does not jump under the finger: it stays where it was and follows
 * the hand from there. The distance is measured against the same usable
 * part of the strip a press is measured against, so both hands mean the
 * same thing.
 */
export function stripMsShift({ baseMs, deltaX, rectWidth, durationMs }) {
  const total = Math.max(0, Number(durationMs) || 0);
  const usable = Math.max(1, Math.max(1, Number(rectWidth) || 0) - CLIP_HANDLE_INSET * 2);
  const ms = (Number(baseMs) || 0) + (Number(deltaX) || 0) / usable * total;
  return Math.max(0, Math.min(total, ms));
}

/**
 * Where a part of the strip stands, as the stylesheet says it.
 *
 * The strip is the whole material, so a percent of the material is one
 * place on the strip. The two ends are held in by the handles' own inset,
 * so the ends of the strip and the ends of the material are the same
 * place.
 *
 * This is the one rule that says where the range, the dimming and the
 * handles are, so they cannot disagree about where a moment of the
 * material is.
 */
export function stripAt(percent) {
  const part = (Number(percent) || 0) / 100;
  return `calc(${CLIP_HANDLE_INSET}px + (100% - ${CLIP_HANDLE_INSET * 2}px) * ${part})`;
}

/**
 * How wide a part of the strip is, as the stylesheet says it.
 */
export function stripWidth(percent) {
  const part = (Number(percent) || 0) / 100;
  return `calc((100% - ${CLIP_HANDLE_INSET * 2}px) * ${part})`;
}

/**
 * The moment of the material the playhead stands at.
 *
 * The playhead shows what is about to be cut, so it stays inside the range
 * that is about to be cut: a moment outside the range is held at the end
 * it belongs to. The mark on the strip, the drag that moves it and the
 * button that starts the preview all read this one number, so they cannot
 * disagree about where the material is.
 */
export function playheadMs({ ms, range } = {}) {
  const total = Math.max(0, Number(range?.durationMs) || 0);
  if (!total) return 0;
  const from = Math.max(0, Math.min(total, Number(range?.startMs) || 0));
  const to = Math.max(from, Math.min(total, Number(range?.endMs) || 0));
  return Math.min(to, Math.max(from, Number(ms) || 0));
}

/**
 * The window of a clip, kept inside the clip.
 *
 * The two ends are what the user dragged; this is the one place that says
 * what a legal window is. It never leaves the clip, and it is never shorter
 * than the shortest cut the runtime accepts — a drag that would make an
 * impossible window is refused here rather than sent to ffmpeg.
 *
 * The handles may cross each other while they are being dragged; the window
 * follows the drag instead of turning inside out.
 */
export function clipRange({ durationMs = 0, startMs = 0, endMs = 0, minMs = CLIP_MIN_MS } = {}) {
  const total = Math.max(0, Math.round(Number(durationMs) || 0));
  if (!total) return { durationMs: 0, startMs: 0, endMs: 0, minMs: Math.max(1, Math.round(minMs)) };
  const min = Math.max(1, Math.min(Math.round(Number(minMs) || CLIP_MIN_MS), total));
  let start = Math.round(Number(startMs) || 0);
  let end = Math.round(Number(endMs) || 0);
  if (end < start) [start, end] = [end, start];
  start = Math.min(Math.max(0, start), total - min);
  end = Math.min(Math.max(start + min, end), total);
  if (end - start < min) start = Math.max(0, end - min);
  return { durationMs: total, startMs: start, endMs: end, minMs: min };
}

/**
 * The time on a clip, as the readout shows it: minutes and seconds.
 */
export function timecode(ms) {
  const total = Math.max(0, Math.round(Number(ms) || 0));
  const seconds = Math.floor(total / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * The clock of the preview: where the playhead is, and how long the material
 * is.
 */
export function clipClock(currentMs, totalMs) {
  return `${timecode(currentMs)} / ${timecode(totalMs)}`;
}

/**
 * The length of a clip, as the readout shows it.
 */
export function durationLabel(ms) {
  const total = Math.max(0, Number(ms) || 0);
  return `${(total / 1000).toFixed(2)}s`;
}

/**
 * Is this media playing right now?
 *
 * A file that has run out is not playing: the browser leaves `paused` false
 * after the last moment, so the state has to be asked in two parts. One rule,
 * so the card and the clip panel cannot disagree about it.
 */
export function isPlaying(media) {
  if (!media) return false;
  return !media.paused && !media.ended;
}

/**
 * The window of a clip, the way the runtime takes it: seconds.
 */
export function clipSeconds(range) {
  const start = Math.max(0, (Number(range?.startMs) || 0) / 1000);
  const end = Math.max(0, (Number(range?.endMs) || 0) / 1000);
  return { start: Number(start.toFixed(3)), end: Number(end.toFixed(3)) };
}

/**
 * A point on the clip, in seconds.
 *
 * The preview and the runtime both work in seconds; the page drags in
 * milliseconds. The conversion lives here so both sides read the same point.
 */
export function clipSecond(ms) {
  return Math.max(0, (Number(ms) || 0) / 1000);
}

/**
 * What the preview does next.
 *
 * The preview plays the range that is about to be cut, over and over. Inside
 * the range it keeps going; at the end of the range it goes back to the
 * start. A position outside the range — the user dragged the playhead, or the
 * browser drifted — lands on the start too, so what is heard is always what
 * is about to be cut.
 *
 * The material can also run out before the range does: when the range is the
 * whole material, the browser stops the playback at the end of the file. The
 * preview starts over then, so the range is played over and over instead of
 * stopping at the end of the file.
 */
export function previewAction({ currentSec = 0, fromSec = 0, toSec = 0, ended = false, playing = false } = {}) {
  const from = Math.max(0, Number(fromSec) || 0);
  const to = Math.max(from, Number(toSec) || 0);
  const current = Math.max(0, Number(currentSec) || 0);
  // The material ran out: the range starts over. The browser only says
  // so when the material really ended, so this holds whatever the preview
  // was doing a moment ago.
  if (ended) return { type: 'restart', at: from };
  // The user stopped the preview: it stays where it is.
  if (!playing) return { type: 'pause', at: current };
  // Outside the range — its end, or a drift before it: back to the start. A
  // range of nothing falls in here too: it has no length to play, so the
  // preview sits at its start.
  if (current >= to || current < from) return { type: 'seek', at: from };
  return { type: 'continue', at: current };
}
