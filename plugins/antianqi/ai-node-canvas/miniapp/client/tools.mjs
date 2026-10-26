// Pure geometry for the node tools.
//
// The canvas drawing stays in the client, but the part with real logic — how a
// grid split maps onto source pixels and where the resulting nodes land — is
// here so it can be unit tested without a browser.

export const GRID_MIN = 1;
export const GRID_MAX = 8;
export const DEFAULT_GRID_GAP = 200;

// The gap between two cards the canvas puts next to each other.
export const NODE_GAP = 80;

// A cut-out tile shows one piece of a picture, so it does not need the size
// of a full media card. This is the card a piece gets.
export const TILE_CARD = { width: 240, height: 300 };

/**
 * Where the cards a batch produced go.
 *
 * A batch is laid out as a grid, and the distance between two cards is the
 * card's own size plus a gap. A card that is 320 wide and 420 tall is not
 * sixty pixels away from the next one: that is how cards end up covering each
 * other, and the produced pictures are then hidden under their neighbours.
 *
 * The size of a card is what the card really is, and the page measures it:
 * the preview box follows the media's own ratio and the tool bar wraps. So
 * `sizes` carries the measured size of every card of the batch. When the
 * sizes are not known yet, the size that was asked for is used, and the
 * batch is placed again once the cards are measured.
 *
 * The rule is pure, so the page and the tests read the same one.
 */
export function planBatchPlacement({
  count = 0,
  sizes = null,
  originX = 0,
  originY = 0,
  cardWidth = 320,
  cardHeight = 420,
  gap = NODE_GAP,
  perRow = 0,
} = {}) {
  const measured = Array.isArray(sizes) && sizes.length ? sizes : null;
  const total = measured ? measured.length : Math.max(0, Math.round(Number(count) || 0));
  if (!total) return { columns: 0, rows: 0, cells: [] };
  const columns = perRow > 0 ? Math.min(perRow, total) : Math.max(1, Math.ceil(Math.sqrt(total)));
  const rows = Math.ceil(total / columns);

  // The width of a column is the width of its widest card, and the height of
  // a row is the height of its tallest card. A short card in a tall row does
  // not make the row short.
  const columnWidth = new Array(columns).fill(0);
  const rowHeight = new Array(rows).fill(0);
  for (let index = 0; index < total; index += 1) {
    const size = measured?.[index] ?? { width: cardWidth, height: cardHeight };
    const column = index % columns;
    const row = Math.floor(index / columns);
    columnWidth[column] = Math.max(columnWidth[column], Math.round(Number(size?.width) || 0));
    rowHeight[row] = Math.max(rowHeight[row], Math.round(Number(size?.height) || 0));
  }

  // Where each column starts and where each row starts: the first card of a
  // column stands after the widest card of the column before it.
  const columnX = [];
  let x = originX;
  for (const width of columnWidth) {
    columnX.push(Math.round(x));
    x += width + gap;
  }
  const rowY = [];
  let y = originY;
  for (const height of rowHeight) {
    rowY.push(Math.round(y));
    y += height + gap;
  }

  const cells = [];
  for (let index = 0; index < total; index += 1) {
    cells.push({
      index,
      x: columnX[index % columns],
      y: rowY[Math.floor(index / columns)],
    });
  }
  return { columns, rows, cells };
}

/**
 * The cards never cover each other.
 *
 * A card that lands on another one pushes it aside, to the right, where there
 * is room. The card that was just placed stays where it is: it is the new
 * one, and the user just made it. A card that is pushed onto a third one
 * pushes that one too, so the board ends up without a single overlap.
 *
 * The rule is pure: it takes the document and returns the document.
 */
export function pushAside(doc, placedIds, { gap = NODE_GAP } = {}) {
  const nodes = [...(doc?.nodes ?? [])];
  const placed = new Set(placedIds ?? []);
  if (!placed.size) return doc;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const kept = (placedIds ?? []).map((id) => byId.get(id)).filter(Boolean);
  if (!kept.length) return { ...doc, nodes };

  const overlaps = (a, b) => {
    const ax = Number(a.position?.x) || 0;
    const ay = Number(a.position?.y) || 0;
    const bx = Number(b.position?.x) || 0;
    const by = Number(b.position?.y) || 0;
    const aw = Number(a.width) || 0;
    const ah = Number(a.height) || 0;
    const bw = Number(b.width) || 0;
    const bh = Number(b.height) || 0;
    return Math.min(ax + aw, bx + bw) - Math.max(ax, bx) > 0
      && Math.min(ay + ah, by + bh) - Math.max(ay, by) > 0;
  };

  // The card in the way steps aside. The new card never does; of two old
  // cards, the one that is further right steps aside, so the board keeps its
  // order.
  for (let round = 0; round < 64; round += 1) {
    let changed = false;
    for (const node of nodes) {
      if (placed.has(node.id)) continue;
      for (const other of nodes) {
        if (other.id === node.id) continue;
        if (!overlaps(node, other)) continue;
        if (placed.has(other.id)) {
          node.position.x = (Number(other.position?.x) || 0) + (Number(other.width) || 0) + gap;
        } else if ((Number(node.position?.x) || 0) <= (Number(other.position?.x) || 0)) {
          other.position.x = (Number(node.position?.x) || 0) + (Number(node.width) || 0) + gap;
        } else {
          node.position.x = (Number(other.position?.x) || 0) + (Number(other.width) || 0) + gap;
        }
        changed = true;
        break;
      }
    }
    if (!changed) break;
  }
  return { ...doc, nodes };
}

export function clampGridSize(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(GRID_MIN, Math.min(GRID_MAX, Math.round(n)));
}

// Plan a grid split of a source image.
//
// `origin` is where the first produced node goes on the canvas; the cells are
// laid out left to right, top to bottom. The spacing between the cells is
// the tile card's own size, so no tile covers its neighbour.
export function planGridSplit({
  width,
  height,
  rows,
  cols,
  originX = 0,
  originY = 0,
  cardWidth = TILE_CARD.width,
  cardHeight = TILE_CARD.height,
  gap = NODE_GAP,
}) {
  const rowCount = clampGridSize(rows);
  const colCount = clampGridSize(cols);
  const sourceWidth = Math.max(1, Math.floor(width));
  const sourceHeight = Math.max(1, Math.floor(height));
  const cellWidth = Math.floor(sourceWidth / colCount);
  const cellHeight = Math.floor(sourceHeight / rowCount);
  if (cellWidth < 1 || cellHeight < 1) {
    throw new Error('图片太小，切不了这么多块');
  }
  const placed = planBatchPlacement({
    count: rowCount * colCount,
    originX,
    originY,
    cardWidth,
    cardHeight,
    gap,
    perRow: colCount,
  });
  const cells = [];
  for (let row = 0; row < rowCount; row += 1) {
    for (let col = 0; col < colCount; col += 1) {
      const index = row * colCount + col;
      const place = placed.cells[index];
      cells.push({
        index,
        sx: col * cellWidth,
        sy: row * cellHeight,
        sw: cellWidth,
        sh: cellHeight,
        x: place.x,
        y: place.y,
      });
    }
  }
  return { rows: rowCount, cols: colCount, cellWidth, cellHeight, cells, count: cells.length };
}

// Clamp a crop rectangle expressed in 0..1 image space.
// The preview keeps the media's own ratio and the card is sized around it,
// so a tall or wide asset is shown as it is instead of being squeezed into a
// fixed frame. The box stays inside bounds so one asset cannot blow the card
// up.
export const MEDIA_BOX = { maxWidth: 320, maxHeight: 420, minWidth: 160, minHeight: 110 };

/** The box a media of the given ratio gets inside a card of the given width. */
export function fitMediaBox(aspect, availWidth, limits = MEDIA_BOX) {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  let width = Math.min(Math.max(Number(availWidth) || 0, limits.minWidth), limits.maxWidth);
  let height = width / ratio;
  if (height > limits.maxHeight) {
    height = limits.maxHeight;
    width = height * ratio;
  }
  if (width < limits.minWidth) {
    // The media is too tall to be shown at its own ratio inside the bounds.
    // The box keeps the bounds and the preview is contained inside it, which
    // is the lesser evil compared with a card that grows without limit.
    width = limits.minWidth;
    height = limits.maxHeight;
  }
  if (height < limits.minHeight) {
    height = limits.minHeight;
    width = Math.min(width, height * ratio);
  }
  return { width: Math.round(width), height: Math.round(height) };
}

// The input kinds a generating node takes, from what its model accepts.
//
// The text input is always there — the prompt is what goes in. A media input
// only appears when the model can actually use it, so an image node with a
// text model does not offer a video slot it could never fill.
export function inputKindsFor(caps) {
  const kinds = ['text'];
  if ((caps?.maxImages ?? 0) > 0) kinds.push('image');
  if ((caps?.maxVideos ?? 0) > 0) kinds.push('video');
  if ((caps?.maxAudios ?? 0) > 0) kinds.push('audio');
  return kinds;
}

/**
 * The modes whose provider call takes a list of requests, so one call can
 * produce several assets at once.
 *
 * A video is one task per clip and a text is one Agent turn, so neither of
 * them is batched.
 */
export const BATCH_MODES = ['image', 'audio', 'music'];

/** How many assets one run may ask for. */
export const BATCH_MAX = 8;

/** The counts the page offers. */
export const BATCH_COUNTS = ['1', '2', '3', '4', '6', '8'];

/**
 * How many assets a run asks for.
 *
 * The mode decides whether a batch is possible at all, and the number is
 * clamped, so a request from anywhere cannot ask for an unbounded run.
 */
export function batchCount(mode, requested) {
  if (!BATCH_MODES.includes(mode)) return 1;
  const n = Number(requested);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(BATCH_MAX, Math.round(n)));
}

/**
 * The sources a mention can point at.
 *
 * Only material can be mentioned: a picture, a video or an audio file gets a
 * number in the provider's syntax. Text is not a reference — it is the prompt
 * material, and it goes into the prompt on its own.
 *
 * The whole canvas is in the list, not only the chain above the node: a
 * prompt may be about a picture that sits somewhere else, and naming it is
 * what wires it in. The ones above the node come first, because those are
 * the ones a prompt is usually about.
 */
export function mentionCandidates(canvas, node) {
  const upstream = new Set(upstreamNodes(canvas, node?.id).map((source) => source.id));
  return (canvas?.nodes ?? [])
    .filter((source) => source.type !== 'group')
    .filter((source) => source.id !== node?.id)
    .filter((source) => (source.metadata?.output?.media ?? []).length > 0)
    .map((source) => ({
      id: source.id,
      kind: source.metadata.output.media?.[0]?.kind ?? 'image',
      title: source.title,
      url: source.metadata.output.media?.[0]?.url ?? '',
      // Whether the material is already above this node. The menu says so,
      // because a picture that is already there needs no new line.
      upstream: upstream.has(source.id),
    }))
    .sort((a, b) => Number(b.upstream) - Number(a.upstream));
}

/**
 * The slots of a node: what may be plugged into it, and what it hands on.
 *
 * The rule lives in `forms.mjs`, where the node table is, so the page and the
 * runtime declare the same slots.
 */
// The role a node plays, the kind of data it carries and the slots it
// declares all come from the shared node table in `forms.mjs`. The page and
// the runtime read the same table, so neither of them answers "what is this
// node" on its own.
import { kindOf, modeOf, modeRecordOf, modesOf, roleOf, runModeOf, slotsOf } from './forms.mjs';

export { kindOf, modeOf, modeRecordOf, modesOf, roleOf, runModeOf, slotsOf };
// The whole chain of nodes above this one.
//
// The chain is what a run actually takes with it: every ancestor contributes
// its material, so an input three hops up still reaches the node. The rule
// is pure so the page and the runtime read the same chain.
export function upstreamNodes(canvas, nodeId) {
  const nodes = canvas?.nodes ?? [];
  const connections = canvas?.connections ?? [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set();
  const result = [];
  const visit = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const conn of connections) {
      if (conn.toNodeId !== id) continue;
      const node = byId.get(conn.fromNodeId);
      if (!node) continue;
      result.push(node);
      visit(node.id);
    }
  };
  visit(nodeId);
  return result;
}

// The text a node carries on its own: what the user typed into it, or what
// a text result upstream handed over.
export function ownTextOf(canvas, node) {
  const own = String(node?.metadata?.prompt ?? '').trim();
  if (own) return own;
  for (const source of upstreamNodes(canvas, node?.id)) {
    if (source.type !== 'result') continue;
    if ((source.metadata?.kind ?? 'image') !== 'text') continue;
    const text = String(source.metadata?.output?.text ?? '').trim();
    if (text) return text;
  }
  return '';
}

/**
 * The option a drop-down actually shows.
 *
 * A value that is not in the list falls back to the first one: that is what
 * the page shows, so a reader of the canvas has to see the same value.
 */
export function effectiveOption(options, value) {
  const items = (options ?? []).map((option) => (
    option && typeof option === 'object' ? option : { value: option, label: String(option) }
  ));
  return items.find((item) => String(item.value) === String(value ?? '')) ?? items[0] ?? null;
}

/**
 * The state of an input slot.
 *
 * `filled` means something is plugged in, `ready` means the node already
 * carries that kind of input on its own — the prompt of a generating node is
 * typed into the card, not dragged into it — and `open` means the slot is
 * still waiting for something.
 *
 * The rule is pure, so the card on the page and the runtime read the same
 * state and never say two different things about one input.
 */
export function inputSlotState(canvas, node, kind, role = '') {
  const upstreamKinds = upstreamNodes(canvas, node?.id).map(kindOf);
  if (upstreamKinds.includes(kind)) return 'filled';
  if (kind === 'text' && roleOf(node) === 'generate' && ownTextOf(canvas, node)) return 'ready';
  return 'open';
}

/**
 * The ports a node takes right now: the inputs of the mode it is in.
 *
 * A port is a kind and, when the mode takes the same kind twice, the role
 * that says which one it is. 图生视频·首尾帧 takes two pictures — one for each
 * end of the clip — and the role is what tells the two lines apart.
 */
export function takenPorts(node) {
  return slotsOf(node).inputs.map((slot) => ({
    kind: slot.kind,
    role: slot.role ?? '',
    label: slot.label ?? '',
  }));
}

/** The name of a port, so it can be a key in a map. */
export function portKey(port) {
  return `${port?.kind ?? ''}:${port?.role ?? ''}`;
}

/**
 * The lines that land straight on a node.
 *
 * The chain above a node is its reference set, but a frame request wants the
 * pictures that are plugged into this node itself: the first frame and the
 * last frame are the two lines on the card, not everything above it.
 */
export function directLines(canvas, node) {
  const out = [];
  for (const conn of canvas?.connections ?? []) {
    if (conn.toNodeId !== node?.id) continue;
    const source = (canvas?.nodes ?? []).find((item) => item.id === conn.fromNodeId);
    if (!source) continue;
    out.push({
      kind: kindOf(source),
      role: conn.role ?? '',
      fromNodeId: source.id,
      connectionId: conn.id,
    });
  }
  return out;
}

/**
 * The lines that fill the ports of a node.
 *
 * A port with a role is filled by the line that names it. A port without one
 * takes the first line of that kind that is not spoken for. The mode decides
 * how many ports there are, so the card, the run and the request all read the
 * same assignment.
 */
export function assignPorts(canvas, node) {
  const ports = takenPorts(node);
  const lines = directLines(canvas, node);
  const used = new Set();
  const assigned = new Map();
  for (const port of ports) {
    let index = lines.findIndex((line, i) => (
      !used.has(i) && line.kind === port.kind && line.role === port.role
    ));
    if (index < 0) {
      index = lines.findIndex((line, i) => !used.has(i) && line.kind === port.kind);
    }
    if (index < 0) {
      assigned.set(portKey(port), null);
      continue;
    }
    used.add(index);
    assigned.set(portKey(port), lines[index]);
  }
  return assigned;
}

/**
 * The state of one port: is something plugged into it?
 *
 * A port with a role is its own slot: the first frame is filled by the line
 * on the first frame port, and the last frame by the line on its own. The
 * other ports are filled by any line of that kind.
 */
export function portState(canvas, node, port) {
  const assigned = assignPorts(canvas, node);
  const line = assigned.get(portKey(port));
  if (line) return 'filled';
  if (port.kind === 'text' && roleOf(node) === 'generate' && ownTextOf(canvas, node)) return 'ready';
  return 'open';
}

/**
 * The port each line into a node fills, by the line's id.
 *
 * The card and the line have to agree on which port it is, so the line ends
 * on the port it was assigned to and not on the first port of its kind.
 */
export function portOfConnection(canvas, node, conn) {
  const assigned = assignPorts(canvas, node);
  for (const [key, line] of assigned) {
    if (!line || line.connectionId !== conn?.id) continue;
    const [kind, ...rest] = key.split(':');
    return { kind, role: rest.join(':') };
  }
  return { kind: conn?.kind ?? '', role: conn?.role ?? '' };
}

/**
 * The pictures that are plugged straight into a node, and the port each one
 * fills.
 *
 * The role here is the port's role, not the line's: the first frame port is
 * the first frame, whichever line landed on it. A frame request wants the two
 * lines on the card, not everything above the node.
 */
export function framePorts(canvas, node) {
  const out = [];
  for (const [key, line] of assignPorts(canvas, node)) {
    if (!line) continue;
    const [kind, ...rest] = key.split(':');
    out.push({ id: line.fromNodeId, kind, role: rest.join(':') });
  }
  return out;
}

// The key of the generation mode: the kinds that are actually connected.
export function modeKey(inputKinds) {
  return [...new Set((inputKinds ?? []).filter(Boolean))].sort().join(',');
}

// The name of a generation mode is not derived here any more: the mode is a
// choice on the card, and its table lives in `forms.mjs`.

export function clampCropRect(rect) {
  const x = Math.max(0, Math.min(1, Number(rect?.x) || 0));
  const y = Math.max(0, Math.min(1, Number(rect?.y) || 0));
  const w = Math.max(0.02, Math.min(1 - x, Number(rect?.w) || 1));
  const h = Math.max(0.02, Math.min(1 - y, Number(rect?.h) || 1));
  return { x, y, w, h };
}

/**
 * Where the crop box goes after a drag.
 *
 * The pointer decides where the box goes: dragging the body moves it and keeps
 * its size, dragging the handle changes the size and keeps its corner. The box
 * never leaves the picture.
 *
 * The rule is pure, so the page and the tests read the same one.
 */
export function cropRectAfterDrag(rect, dx, dy, mode = 'resize') {
  const origin = {
    x: Number(rect?.x) || 0,
    y: Number(rect?.y) || 0,
    w: Number(rect?.w) || 1,
    h: Number(rect?.h) || 1,
  };
  const stepX = Number(dx) || 0;
  const stepY = Number(dy) || 0;
  if (mode === 'move') {
    return clampCropRect({
      x: Math.max(0, Math.min(1 - origin.w, origin.x + stepX)),
      y: Math.max(0, Math.min(1 - origin.h, origin.y + stepY)),
      w: origin.w,
      h: origin.h,
    });
  }
  return clampCropRect({
    x: origin.x,
    y: origin.y,
    w: origin.w + stepX,
    h: origin.h + stepY,
  });
}

/**
 * The runs a model-backed tool needs.
 *
 * A tool with a multi parameter asks for several values at once (多角度 with
 * two angles), and one run cannot answer all of them: the model would have to
 * put two angles into one picture. So the tool runs once per value, and each
 * run carries a parameter set of its own.
 *
 * The rule is pure, so the page and the tests read the same one.
 */
export function fanOutParams(tool, params) {
  const multi = (tool?.params ?? []).find((param) => param.type === 'multi');
  if (!multi) return [{ params: { ...params }, label: '' }];
  const values = Array.isArray(params?.[multi.key]) ? params[multi.key] : [];
  if (!values.length) return [];
  return values.map((value) => ({
    params: { ...params, [multi.key]: [value] },
    label: String(value),
  }));
}

// Build the tool prompt for a model-backed tool.
export function toolPrompt(tool, params) {
  const detail = (tool?.params ?? [])
    .filter((param) => {
      const value = params?.[param.key];
      return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== '';
    })
    .map((param) => `${param.label}：${Array.isArray(params[param.key]) ? params[param.key].join('、') : params[param.key]}`)
    .join('；');
  return `${tool?.prompt ?? ''}${detail ? `\n${detail}` : ''}`;
}

// Nodes inside a marquee band.
//
// The band is expressed in viewport-relative screen pixels; the nodes live in
// world space. A node is selected when it overlaps the band at all.
export function bandSelection({ band, viewport, nodes }) {
  const k = viewport?.k || 1;
  const left = (band.left - (viewport?.x ?? 0)) / k;
  const top = (band.top - (viewport?.y ?? 0)) / k;
  const right = (band.right - (viewport?.x ?? 0)) / k;
  const bottom = (band.bottom - (viewport?.y ?? 0)) / k;
  return (nodes ?? [])
    .filter((node) => node.type !== 'group')
    .filter(
      (node) =>
        node.position.x + node.width > left &&
        node.position.x < right &&
        node.position.y + node.height > top &&
        node.position.y < bottom,
    )
    .map((node) => node.id);
}

// Where pasted nodes land.
//
// The clipboard keeps the copied nodes; the paste drops them centred in the
// current viewport, keeping their relative arrangement.
export function planPaste({ clip, viewport, viewportSize, idFor }) {
  const nodes = clip?.nodes ?? [];
  if (!nodes.length) return [];
  const k = viewport?.k || 1;
  const cx = ((viewportSize?.width ?? 0) / 2 - (viewport?.x ?? 0)) / k;
  const cy = ((viewportSize?.height ?? 0) / 2 - (viewport?.y ?? 0)) / k;
  const minX = Math.min(...nodes.map((n) => n.position.x));
  const minY = Math.min(...nodes.map((n) => n.position.y));
  return nodes.map((node) => ({
    ...node,
    id: idFor ? idFor(node) : node.id,
    position: {
      x: Math.round(cx - (node.width ?? 300) / 2 + (node.position.x - minX)),
      y: Math.round(cy - (node.height ?? 300) / 2 + (node.position.y - minY)),
    },
  }));
}

// Where the dragged nodes land.
//
// `origins` is the list of nodes being dragged with their start positions;
// the delta is in screen pixels and the scale converts it to world units.
export function dragPositions(origins, dx, dy, scale = 1) {
  const k = scale || 1;
  return origins.map((origin) => ({
    id: origin.id,
    x: Math.round(origin.x + dx / k),
    y: Math.round(origin.y + dy / k),
  }));
}

// Resolve the element an event happened on, across JavaScript realms.
//
// The MiniApp page can be rendered by the desktop host inside a webview, which
// is a different realm: `event.target instanceof Element` is then false for a
// perfectly real element, and every delegated lookup silently falls through.
// Duck-typing on `closest` is realm independent.
export function resolveEventTarget(event) {
  const target = event?.target;
  return typeof target?.closest === 'function' ? target : null;
}

// The controls that live inside the canvas viewport.
//
// A press on one of them must not be cancelled: a cancelled pointerdown
// suppresses the compatibility mouse events, so a control that listens for
// click would never be reached. The task panel and the minimap are the two
// that are not inside a node, so nothing else stops the press for them.
const CONTROL_SELECTOR = 'button, select, input, textarea, .nxc-composer, .nxc-minimap';

export function isControlTarget(target) {
  if (typeof target?.closest !== 'function') return false;
  return Boolean(target.closest(CONTROL_SELECTOR));
}

/**
 * The one-line summary of what a model offers.
 *
 * Not every model has every dimension: an image model has no durations and
 * an audio model has no resolutions. The summary therefore reads only what
 * the model actually carries, because a missing field used to throw and take
 * the whole panel down with it.
 */
export function modelSummary(model) {
  if (!model) return '—';
  const resolutions = Array.isArray(model.resolutions) ? model.resolutions.join('/') : '';
  const durations = Array.isArray(model.durations) ? model.durations : [];
  if (model.resolutionByDuration) {
    const coupled = Object.entries(model.resolutionByDuration)
      .map(([duration, list]) => `${list.join('/')}@${duration}s`)
      .join('  ');
    return coupled || resolutions;
  }
  if (durations.length > 0) {
    return `${resolutions} · ${durations[0]}-${durations[durations.length - 1]}s`;
  }
  return resolutions || '—';
}

/**
 * Snap the parameters onto what the model offers.
 *
 * The runtime snaps them again when it runs, so a value the model does not
 * accept would be changed behind the user's back. The page does it at the
 * moment a parameter changes, so what is shown is what will be generated.
 *
 * A model may only offer a resolution for particular durations, so the
 * resolution follows the duration.
 */
export function fitParamsToCaps(params, caps = {}) {
  const allowed = (value, options) => {
    if (!options?.length) return value;
    if (value == null) return value;
    if (options.includes(value)) return value;
    return options[0];
  };
  const duration = params?.duration == null ? null : String(params.duration);
  const resolutionOptions =
    caps.resolutionByDuration?.[String(duration)] ?? caps.resolutions;
  return {
    ...params,
    ratio: allowed(params?.ratio, caps.ratios),
    duration: allowed(duration, caps.durations?.map(String)),
    resolution: allowed(params?.resolution, resolutionOptions),
  };
}

/**
 * Where a floating overlay goes so that it stays inside the window.
 *
 * The rule is written once because it used to be written five times, and one
 * of those copies had no lower bound: a panel taller than the window was
 * pushed above the top edge, so the capability list opened with its title
 * — the part that says what the panel is — off screen.
 *
 * `anchor` is where the overlay wants to sit (the left and the top it
 * would take), `size` is how big it turned out to be, `viewport` is the
 * window. The result is always inside the window, with a margin.
 */
export function placeOverlay(anchor, size, viewport) {
  const margin = 8;
  const clamp = (value, limit) => Math.min(Math.max(value, margin), Math.max(margin, limit));
  return {
    left: clamp(anchor.left, viewport.width - size.width - margin),
    top: clamp(anchor.top, viewport.height - size.height - margin),
  };
}
