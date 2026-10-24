// Actions: how the Agent asks the canvas to change.
//
// The page is the only writer of a canvas: it holds the document in memory and
// saves it, and the store refuses a write that is based on an older version.
// An action that comes from the Agent is therefore never written to the stored
// document behind the page's back — it is applied by the page, and by the
// runtime only while no page holds the canvas.
//
// Every rule here is pure, so the page and the runtime apply the same one:
// what a node looks like, what a run takes with it, and where a result lands.
//
// The kinds of data come from the node table in `forms.mjs`, never from a
// second list written down here.

import { CREATABLE_TYPES, DATA_KINDS, kindLabel, kindOf, modeLabelOf, modeOf, modesFor, modesOf, pathOf, roleOf, runModeOf, slotsOf } from './forms.mjs';
import { batchCount, fitParamsToCaps, framePorts, assignPorts, directLines, planBatchPlacement, portKey, pushAside, takenPorts, upstreamNodes } from './tools.mjs';

/** The actions an Agent may ask for. */
export const ACTION_TYPES = ['add_node', 'connect', 'remove_node', 'update_node', 'run'];

/** How many nodes one canvas may hold. */
export const MAX_NODES = 300;

/** How many connections one canvas may hold. */
export const MAX_CONNECTIONS = 1000;

/** The longest prompt a node may carry. */
const MAX_PROMPT = 20000;

const IDLE_OUTPUT = {
  status: 'idle',
  text: '',
  media: [],
  error: '',
  posterUrl: '',
  durationMs: 0,
  width: 0,
  height: 0,
  missing: false,
  updatedAt: '',
};

/** A fresh id, when the caller has no rule of its own. */
function fallbackId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * The materials a prompt names.
 *
 * A mention points at a node. The material behind it is a reference of the
 * node that names it, and the name it gets in the prompt is its place in the
 * request — so the two have to be the same picture.
 */
export function mentionedMaterials(canvas, node) {
  const segments = node?.metadata?.segments ?? [];
  const out = [];
  for (const segment of segments) {
    if (segment?.type !== 'mention') continue;
    const source = (canvas?.nodes ?? []).find((item) => item.id === segment.nodeId);
    if (!source) continue;
    const media = source.metadata?.output?.media ?? [];
    if (media.length === 0) continue;
    const kind = media[0]?.kind ?? 'image';
    if (out.some((item) => item.id === source.id)) continue;
    out.push({
      id: source.id,
      kind,
      title: source.title,
      media,
      node: source,
    });
  }
  return out;
}

/**
 * The nodes a node feeds.
 */
function childrenOf(canvas, nodeId) {
  const out = [];
  for (const conn of canvas?.connections ?? []) {
    if (conn.fromNodeId !== nodeId) continue;
    const child = (canvas?.nodes ?? []).find((item) => item.id === conn.toNodeId);
    if (child) out.push(child);
  }
  return out;
}

/**
 * Does this node already have that material?
 *
 * The chain above it counts: an input three hops up still reaches the node.
 */
function hasMaterial(canvas, node, materialId) {
  if (node?.id === materialId) return true;
  return upstreamNodes(canvas, node?.id).some((item) => item.id === materialId);
}

/**
 * The holder of a material: an input node that carries it.
 *
 * The material may come from anywhere on the canvas, and the node that
 * generates from it needs it as an input of its own. A holder keeps the flow
 * independent of where the material came from, and it is an input node, so
 * the chain never runs it again.
 */
function holderOf(canvas, material) {
  // A holder is its own holder: once the prompt names the holder, the rule
  // must not make a second one for it.
  if (material.node?.type === 'input' && material.node?.metadata?.materialFrom) {
    return material.node;
  }
  return (canvas?.nodes ?? []).find((node) => (
    node.type === 'input'
    && node.metadata?.materialFrom === material.id
  )) ?? null;
}

/**
 * Wire the material a prompt names into the nodes that need it.
 *
 * A mention says "this prompt is about that material". The node that writes
 * the prompt looks at it, and the node that generates from the prompt has to
 * receive it as an input of its own — otherwise the prompt names a picture
 * the request never sends. So the material is wired in: an input node holds
 * it, and a line carries it to every node that takes that kind and does not
 * have it yet.
 *
 * The rule is pure, so the page and the runtime read the same one, and it
 * says nothing when there is nothing to do.
 */
export function syncMentions(canvas, nodeId, context = {}) {
  const doc = canvas ?? { nodes: [], connections: [] };
  const nodes = [...(doc.nodes ?? [])];
  const connections = [...(doc.connections ?? [])];
  const ctx = { idFor: fallbackId, ...context };
  const index = nodes.findIndex((item) => item.id === nodeId);
  if (index < 0) return { canvas: doc, added: [], connected: [] };
  const source = nodes[index];

  const added = [];
  const connected = [];
  // The materials the prompt names, and the node that holds each one.
  const materials = mentionedMaterials(doc, source);
  if (materials.length === 0) return { canvas: doc, added, connected };

  const mentionRewrite = new Map();

  for (const material of materials) {
    // The nodes that want this material: the one that names it (when its own
    // mode takes this kind) and the ones it feeds.
    const targets = [];
    if ((takenPorts(source) ?? []).some((port) => port.kind === material.kind)) {
      targets.push(source);
    }
    for (const child of childrenOf(doc, source.id)) {
      if ((takenPorts(child) ?? []).some((port) => port.kind === material.kind)) {
        targets.push(child);
      }
    }
    const wanted = targets.filter((target) => !hasMaterial(doc, target, material.id));
    if (wanted.length === 0) continue;

    // The holder: one per material, so the same picture is not copied twice.
    let holder = holderOf(doc, material);
    if (!holder) {
      if (nodes.length >= MAX_NODES) continue;
      const id = String(ctx.idFor('n'));
      const size = ctx.sizes?.input ?? { width: 300, height: 300, title: '输入' };
      holder = {
        id,
        type: 'input',
        title: material.title,
        position: {
          x: Math.round((source.position?.x ?? 120) - 340),
          y: Math.round(source.position?.y ?? 120),
        },
        width: Math.round(size.width ?? 300),
        height: Math.round(size.height ?? 300),
        metadata: {
          templateId: 'custom',
          templateVars: {},
          segments: [],
          prompt: '',
          mentions: [],
          model: null,
          ratio: null,
          resolution: null,
          duration: null,
          voice: null,
          emotion: null,
          sessionId: null,
          // What the card holds: an input node holds what the user put in it.
          kind: material.kind,
          mode: null,
          templateText: '',
          // The node the material came from, so the holder is found again
          // instead of a second one being made for the same picture.
          materialFrom: material.id,
          output: { ...IDLE_OUTPUT, status: 'success', media: material.media },
        },
      };
      nodes.push(holder);
      added.push(holder);
    }

    for (const target of wanted) {
      if (connections.length >= MAX_CONNECTIONS) break;
      if (connections.some((conn) => conn.fromNodeId === holder.id && conn.toNodeId === target.id)) continue;
      const port = planPort({ ...doc, nodes, connections }, target, material.kind, '');
      if (!port.ok) continue;
      // The line says which port it fills. A mode that takes the kind once
      // has that port, and the line has to say so.
      const kindPorts = (takenPorts(target) ?? []).filter((item) => item.kind === material.kind);
      const role = port.role || (kindPorts.length === 1 ? kindPorts[0].role : '');
      connections.push({
        id: String(ctx.idFor('c')),
        fromNodeId: holder.id,
        toNodeId: target.id,
        kind: material.kind,
        role,
      });
      connected.push({ from: holder.id, to: target.id, kind: material.kind, role });
    }
    // The node that names the material now has it as an input of its own, so
    // the prompt has to name that one: the number in the prompt is the place
    // the picture has in the request.
    const namesIt = targets.some((target) => target.id === source.id);
    const holdsIt = connections.some((conn) => (
      conn.fromNodeId === holder.id && conn.toNodeId === source.id
    ));
    if (namesIt && holdsIt) mentionRewrite.set(material.id, holder.id);
  }

  if (mentionRewrite.size > 0) {
    const at = nodes.findIndex((item) => item.id === source.id);
    const node = nodes[at];
    const segments = (node.metadata?.segments ?? []).map((segment) => (
      segment?.type === 'mention' && mentionRewrite.has(segment.nodeId)
        ? { ...segment, nodeId: mentionRewrite.get(segment.nodeId) }
        : segment
    ));
    nodes[at] = {
      ...node,
      metadata: {
        ...node.metadata,
        segments,
        mentions: segments
          .filter((segment) => segment.type === 'mention')
          .map((segment) => ({ nodeId: segment.nodeId, kind: segment.kind })),
      },
    };
  }

  return {
    canvas: { ...doc, nodes, connections },
    added,
    connected,
  };
}

/** Whether a path leads from one node to another. */
export function reaches(canvas, fromId, targetId) {
  const connections = canvas?.connections ?? [];
  const stack = [fromId];
  const seen = new Set();
  while (stack.length) {
    const current = stack.pop();
    if (current === targetId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const conn of connections) {
      if (conn.fromNodeId === current) stack.push(conn.toNodeId);
    }
  }
  return false;
}

/** The model a new generating node starts with. */
function pickModel(context, type) {
  const models = context.modelsByType?.[type] ?? [];
  if (models.length) return models[0].id ?? models[0] ?? null;
  return context.defaultModelKey ?? null;
}

// ---------------------------------------------------------------- the contract
//
// A node's mode says what it takes, and the ports on its card are exactly that.
// So a line only has somewhere to land when the node takes the kind the line
// carries. Two changes have to obey this, and they are written down here once:
//
//   - a line comes in: the node moves to a mode that takes it (and everything
//     already connected), or the line is refused with a reason;
//   - the mode changes: a line the new mode does not take has nowhere to land,
//     so it goes, and the caller is told which ones went.
//
// The page and the runtime both apply these rules, so a change made by the
// Agent lands in the same shape as one made by hand.

/**
 * The kind a line carries.
 *
 * The kind travels with the source, not with the line: a line drawn before the
 * source changed what it holds still carries what the source holds now.
 */
export function lineKind(canvas, conn) {
  const source = (canvas?.nodes ?? []).find((node) => node.id === conn?.fromNodeId);
  return source ? kindOf(source) : (conn?.kind ?? '');
}

/**
 * The ports a node takes right now: the inputs of the mode it is in.
 *
 * A port is a kind and, when the mode takes the same kind twice, the role
 * that says which one it is. 图生视频·首尾帧 takes two pictures — one for each
 * end of the clip — and the role is what tells the two lines apart.
 */
export { assignPorts, directLines, portKey, takenPorts } from './tools.mjs';

/**
 * The port a line lands on.
 *
 * Most modes take a kind once, and the line lands on that slot however many
 * lines of that kind arrive. A mode that takes the same kind twice has a port
 * for each: there the role says which port the line belongs to, and a port
 * that is already filled refuses the line.
 */
export function planPort(canvas, node, kind, role = '') {
  const ports = takenPorts(node).filter((port) => port.kind === kind);
  if (ports.length < 2) return { ok: true, role: '', reason: '' };
  const filled = assignPorts(canvas, node);
  const wanted = ports.find((port) => port.role === role)
    ?? ports.find((port) => !filled.get(portKey(port)));
  if (!wanted) return { ok: false, role: '', reason: '这个口已经接上了。' };
  return { ok: true, role: wanted.role, reason: '' };
}

/**
 * The port each line into a node fills, by the line's id.
 *
 * The mode decides how many ports there are, so when the mode changes the
 * lines are handed to the new ports and each one says which port it is on.
 */
export function stampPortRoles(canvas, node) {
  const assigned = assignPorts(canvas, node);
  const roles = new Map();
  for (const [key, line] of assigned) {
    if (!line) continue;
    const [, ...rest] = key.split(':');
    roles.set(line.connectionId, rest.join(':'));
  }
  return roles;
}

/**
 * The kinds that reach a node through the chain above it.
 *
 * The chain is the flow: material handed to a node is handed further down, so
 * a kind that is two hops up still reaches this node. The card says the same
 * thing — the slot strip reads the chain too — so the mode and the strip never
 * disagree about what this node has.
 */
export function upstreamKinds(canvas, node) {
  const kinds = new Set();
  for (const source of upstreamNodes(canvas, node?.id)) {
    if (roleOf(source) === 'group') continue;
    kinds.add(kindOf(source));
  }
  return [...kinds];
}

/**
 * The mode a node must be in to take one more kind of material.
 *
 * The node moves to the first mode that takes the new kind *and* everything
 * already connected, so a line is never dropped behind the user's back. When no
 * mode takes it, the line is refused and the reason says which mode would.
 */
export function planIncoming(canvas, node, kind) {
  const modes = modesOf(node);
  const current = modeOf(node);
  if (!kind) return { modeId: current, error: '', changed: false };
  // A node that is not generated has no modes to move to: it takes the kind
  // it shows — a result node takes what the generation handed it — and
  // nothing else.
  if (!modes.length) {
    const shown = slotsOf(node).inputs.map((slot) => slot.kind);
    if (shown.includes(kind)) return { modeId: current, error: '', changed: false };
    return {
      modeId: current,
      error: `这个节点不接${kindLabel(kind)}。`,
      changed: false,
    };
  }
  // A mode takes a kind when it declares a port for it.
  const takes = (mode) => (mode.ports ?? []).some((port) => port.kind === kind);
  const currentMode = modes.find((mode) => mode.id === current);
  if (currentMode && takes(currentMode)) {
    // The mode already takes this kind. The port the line lands on is the
    // role's business, and a port that is already filled refuses the line.
    const port = planPort(canvas, node, kind);
    if (!port.ok) return { modeId: current, error: port.reason, changed: false };
    return { modeId: current, error: '', changed: false };
  }
  const wanted = [...new Set([...upstreamKinds(canvas, node), kind])].sort();
  const next = modes.find((mode) => (
    takes(mode) && wanted.every((need) => (mode.ports ?? []).some((port) => port.kind === need))
  ));
  if (!next) {
    const takers = modes
      .filter(takes)
      .map((mode) => mode.label);
    return {
      modeId: current,
      error: takers.length
        ? `这个节点现在不接${kindLabel(kind)}。切到「${takers[0]}」就能接。`
        : `这个节点不接${kindLabel(kind)}。`,
      changed: false,
    };
  }
  return { modeId: next.id, error: '', changed: next.id !== current };
}

/**
 * The lines that have nowhere to land when a node changes its mode.
 *
 * The ports are the mode's inputs, so a line whose kind the new mode does not
 * take cannot land on the card any more.
 */
export function linesDroppedByMode(canvas, node, modeId) {
  const mode = modesOf(node).find((item) => item.id === modeId);
  if (!mode) return [];
  return (canvas?.connections ?? []).filter((conn) => (
    conn.toNodeId === node?.id
    && !(mode.ports ?? []).some((port) => port.kind === lineKind(canvas, conn))
  ));
}

/**
 * Put the node on another model.
 *
 * The options follow the model: a value the model does not offer is snapped
 * onto one it does, and a mode the model cannot run is left for one it can —
 * the lines that mode cannot take go with it. The rule lives here, so the
 * page, the Agent and the runtime all do the same thing.
 */
export function applyModel(canvas, node, modelKey, context = {}) {
  const capsFor = typeof context.capsFor === 'function' ? context.capsFor : () => null;
  const next = { ...node, metadata: { ...node.metadata, model: modelKey } };
  const caps = capsFor(next);
  const from = modeOf(next);
  if (!caps) return { node: next, dropped: [], mode: { from, to: from } };
  // The values the model does not offer are snapped onto ones it does.
  Object.assign(next.metadata, fitParamsToCaps(next.metadata, caps));
  // And a mode the model cannot run is left for one it can.
  const available = modesFor(next, caps);
  if (available.length && !available.some((mode) => mode.id === from)) {
    const to = available[0].id;
    const dropped = linesDroppedByMode(canvas, next, to);
    next.metadata.mode = to;
    return { node: next, dropped, mode: { from, to } };
  }
  return { node: next, dropped: [], mode: { from, to: from } };
}

/**
 * The template a prompt node expands its sentence with.
 *
 * The page and the Agent make a prompt node the same way: it names one of the
 * templates the palette offers, and the text of that template is what the
 * expansion follows. A node that names none takes the first one, so it is
 * useful before anything is typed — and a node the Agent made is as useful as
 * one the user made.
 *
 * The text of the template follows the name, unless a text of its own comes
 * with it.
 */
export function promptTemplateFor({
  mode = '',
  templateId = '',
  templateText,
  templates = [],
} = {}) {
  const list = Array.isArray(templates) ? templates : [];
  const wanted = String(templateId ?? '').trim();
  const own = templateText === undefined ? null : String(templateText);
  if (mode !== 'prompt') {
    return { templateId: wanted || 'custom', templateText: own ?? '' };
  }
  const found = list.find((item) => item.id === wanted);
  if (found) return { templateId: found.id, templateText: own ?? String(found.text ?? '') };
  if (wanted) return { templateId: wanted, templateText: own ?? '' };
  const first = list[0];
  if (first) return { templateId: first.id, templateText: own ?? String(first.text ?? '') };
  return { templateId: 'custom', templateText: own ?? '' };
}

/**
 * Apply one action to a canvas document.
 *
 * The document is not changed in place: the caller decides when to write it.
 * The result says what happened, so the caller can report it to whoever asked.
 */
export function applyAction(canvas, action, context = {}) {
  const doc = canvas ?? { nodes: [], connections: [] };
  const nodes = [...(doc.nodes ?? [])];
  const connections = [...(doc.connections ?? [])];
  const ctx = {
    sizes: {},
    modelsByType: {},
    defaultModelKey: null,
    idFor: fallbackId,
    ...context,
  };
  const args = action?.args ?? {};

  if (action?.type === 'add_node') {
    const type = String(args.type ?? 'image');
    if (!CREATABLE_TYPES.includes(type)) {
      return {
        canvas: doc,
        error: `没有这种节点：${type}（可以加的是：${CREATABLE_TYPES.join('、')}）`,
      };
    }
    const id = String(args.id ?? ctx.idFor('n'));
    const existing = nodes.find((node) => node.id === id);
    if (existing) {
      // The same action twice is not a second node.
      if (existing.type !== type) {
        return { canvas: doc, error: `这个画布上已经有 ${id} 了` };
      }
      return { canvas: doc, info: { id, type, added: false } };
    }
    if (nodes.length >= MAX_NODES) {
      return { canvas: doc, error: `一张画布最多 ${MAX_NODES} 个节点` };
    }
    const size = ctx.sizes[type] ?? { width: 300, height: 300, title: '节点' };
    const prompt = String(args.prompt ?? '').slice(0, MAX_PROMPT);
    const mode = args.mode ? String(args.mode) : null;
    // The template the prompt node expands its sentence with. The Agent names
    // the same template the page would pick, so the two ways of making a
    // prompt node end up the same.
    const template = promptTemplateFor({
      mode: mode ?? '',
      templateId: args.templateId,
      templateText: args.templateText,
      templates: ctx.promptTemplates,
    });
    const node = {
      id,
      type,
      title: String(args.title ?? size.title ?? '节点').slice(0, 80),
      position: {
        x: Math.round(Number(args.x ?? 80) || 0),
        y: Math.round(Number(args.y ?? 80) || 0),
      },
      width: Math.round(Number(args.width ?? size.width ?? 300)),
      height: Math.round(Number(args.height ?? size.height ?? 300)),
      metadata: {
        templateId: template.templateId,
        templateVars: {},
        segments: prompt ? [{ type: 'text', text: prompt }] : [],
        prompt,
        mentions: [],
        // Only a generating node picks a model: an input node holds something
        // and a result node shows something.
        model: roleOf({ type }) === 'generate' ? pickModel(ctx, type) : null,
        ratio: null,
        resolution: null,
        duration: null,
        voice: null,
        emotion: null,
        sessionId: null,
        // What the card holds: an input node holds what the user put in it, a
        // result node holds what the generation produced, and a generating node
        // holds nothing but its own settings.
        kind: type === 'input'
          ? (DATA_KINDS.includes(args.kind) ? args.kind : 'text')
          : kindOf({ type }),
        // The way the node makes its data: a text node writes text or expands
        // a sentence into a prompt, an audio node speaks or makes music.
        mode,
        templateText: template.templateText,
        output: { ...IDLE_OUTPUT },
      },
    };
    nodes.push(node);
    return {
      canvas: { ...doc, nodes },
      node,
      info: { id, type, title: node.title, added: true },
    };
  }

  if (action?.type === 'connect') {
    const from = nodes.find((node) => node.id === args.from);
    const to = nodes.find((node) => node.id === args.to);
    if (!from || !to) {
      return { canvas: doc, error: '连线的一端不在这个画布上' };
    }
    if (from.id === to.id) {
      return { canvas: doc, error: '节点不能连到自己' };
    }
    const kind = kindOf(from);
    if (connections.some((conn) => conn.fromNodeId === from.id && conn.toNodeId === to.id)) {
      // The same action twice is not a second line.
      return { canvas: doc, info: { from: from.id, to: to.id, kind, added: false } };
    }
    if (connections.length >= MAX_CONNECTIONS) {
      return { canvas: doc, error: `一张画布最多 ${MAX_CONNECTIONS} 条连线` };
    }
    // A line that closes a loop would let a run feed itself.
    if (reaches(doc, to.id, from.id)) {
      return { canvas: doc, error: '这样连会形成一个环' };
    }
    // The ports are the mode's inputs, so a line whose kind the target does not
    // take has nowhere to land. The target moves to a mode that takes it, or
    // the line is refused with a reason.
    const plan = planIncoming(doc, to, kind);
    if (plan.error) {
      return { canvas: doc, error: plan.error };
    }
    if (plan.changed) {
      const index = nodes.findIndex((node) => node.id === to.id);
      nodes[index] = { ...to, metadata: { ...to.metadata, mode: plan.modeId } };
    }
    // The port the line lands on. A mode that takes the same kind twice has a
    // port for each, and the line says which one it is.
    const target = nodes.find((node) => node.id === to.id) ?? to;
    const port = planPort(doc, target, kind, String(args.role ?? ''));
    if (!port.ok) {
      return { canvas: doc, error: port.reason };
    }
    const connection = {
      id: String(args.id ?? ctx.idFor('c')),
      fromNodeId: from.id,
      toNodeId: to.id,
      // The kind travels with the line, so the line is drawn on the port it
      // belongs to instead of in the middle of the card.
      kind,
      role: port.role,
    };
    connections.push(connection);
    // A material the source's prompt names has to reach the node it now
    // feeds, and the new target may be missing a material its own prompt
    // names. The rule is the same one the page uses, so a line drawn by hand
    // and a line the Agent asks for wire the material the same way.
    const wired = syncMentions({ ...doc, nodes, connections }, from.id, ctx);
    const wiredTarget = syncMentions(wired.canvas, to.id, ctx);
    return {
      canvas: wiredTarget.canvas,
      connection,
      info: {
        id: connection.id,
        from: from.id,
        to: to.id,
        kind,
        added: true,
        // The mode the target had to move into, so the caller can say so.
        mode: plan.changed ? plan.modeId : '',
        // The material the prompt names, wired in with the line.
        addedNodes: wiredTarget.added.length + wired.added.length,
        connectedLines: wiredTarget.connected.length + wired.connected.length,
      },
    };
  }

  if (action?.type === 'remove_node') {
    const id = String(args.id ?? '');
    if (!nodes.some((node) => node.id === id)) {
      // The same action twice is not a second removal.
      return { canvas: doc, info: { id, removed: false } };
    }
    return {
      canvas: {
        ...doc,
        nodes: nodes.filter((node) => node.id !== id),
        connections: connections.filter(
          (conn) => conn.fromNodeId !== id && conn.toNodeId !== id,
        ),
      },
      info: { id, removed: true },
    };
  }

  if (action?.type === 'update_node') {
    const index = nodes.findIndex((node) => node.id === args.id);
    if (index < 0) {
      return { canvas: doc, error: '这个画布上没有这个节点' };
    }
    const node = nodes[index];
    let next = { ...node, metadata: { ...node.metadata } };
    if (args.title !== undefined) next.title = String(args.title).slice(0, 80);
    if (args.prompt !== undefined) {
      const text = String(args.prompt).slice(0, MAX_PROMPT);
      next.metadata.prompt = text;
      // The prompt is shown as one text segment: the Agent writes plain text.
      next.metadata.segments = text ? [{ type: 'text', text }] : [];
      next.metadata.mentions = [];
    }
    if (args.model !== undefined) next.metadata.model = args.model ? String(args.model) : null;
    if (args.ratio !== undefined) next.metadata.ratio = args.ratio ? String(args.ratio) : null;
    if (args.resolution !== undefined) {
      next.metadata.resolution = args.resolution ? String(args.resolution) : null;
    }
    if (args.duration !== undefined) {
      const duration = Number(args.duration);
      next.metadata.duration = Number.isFinite(duration) ? duration : null;
    }
    if (args.count !== undefined) {
      const count = Number(args.count);
      next.metadata.count = Number.isFinite(count) ? Math.max(1, Math.min(8, Math.round(count))) : 1;
    }
    if (args.voice !== undefined) next.metadata.voice = args.voice ? String(args.voice) : null;
    if (args.emotion !== undefined) next.metadata.emotion = args.emotion ? String(args.emotion) : null;
    if (args.templateId !== undefined || args.templateText !== undefined) {
      // The template the prompt node expands its sentence with. Naming
      // another one brings that one's text with it.
      const template = promptTemplateFor({
        mode: next.metadata.mode ?? '',
        templateId: args.templateId ?? next.metadata.templateId,
        templateText: args.templateText,
        templates: ctx.promptTemplates,
      });
      next.metadata.templateId = template.templateId;
      next.metadata.templateText = template.templateText;
    }
    let dropped = [];
    let modeChanged = null;
    if (args.mode !== undefined) {
      // The mode is a choice the card offers; a mode the node does not have
      // is not set on it.
      const modes = modesOf(next);
      if (modes.some((mode) => mode.id === args.mode)) {
        next.metadata.mode = String(args.mode);
        // The model belongs to the mode: a music run uses the music model.
        const models = ctx.modelsByType?.[runModeOf(next)] ?? [];
        if (models.length && !models.includes(next.metadata.model)) {
          next.metadata.model = models[0];
        }
        // The ports are the mode's inputs, so a line the new mode does not take
        // has nowhere to land: it goes, and the caller is told which ones.
        dropped = linesDroppedByMode(doc, next, args.mode);
        for (let i = connections.length - 1; i >= 0; i -= 1) {
          if (dropped.includes(connections[i])) connections.splice(i, 1);
        }
      }
    }
    if (args.model !== undefined) {
      // The model decides the options: the values it does not offer are
      // snapped onto ones it does, and a mode it cannot run is left for one it
      // can. The same rule the page's model drop-down uses.
      const result = applyModel(doc, next, args.model ? String(args.model) : null, ctx);
      next = result.node;
      dropped = dropped.concat(result.dropped);
      for (let i = connections.length - 1; i >= 0; i -= 1) {
        if (result.dropped.includes(connections[i])) connections.splice(i, 1);
      }
      if (result.mode.from !== result.mode.to) modeChanged = result.mode;
    }
    // The lines are handed to the ports of the mode the node is in now, so
    // each one says which port it is on. A mode that takes the same kind
    // twice — 图生视频·首尾帧 — has a port for each, and the line has to say
    // which one it fills.
    const kept = connections.filter((conn) => !dropped.includes(conn));
    const roles = stampPortRoles({ ...doc, connections: kept }, next);
    for (const conn of kept) {
      if (conn.toNodeId !== next.id) continue;
      if (!roles.has(conn.id)) continue;
      conn.role = roles.get(conn.id);
    }
    // The kind is not among them: it is what the node *is*, so it is fixed
    // when the node is created. Changing it later would throw away whatever
    // was already put in.
    nodes[index] = next;
    // The new mode may take a material the prompt names, and the node may
    // not have it yet.
    const wired = syncMentions({ ...doc, nodes, connections }, next.id, ctx);
    return {
      canvas: wired.canvas,
      node: next,
      info: {
        id: next.id,
        dropped: dropped.map((conn) => conn.id),
        mode: modeChanged ? { from: modeChanged.from, to: modeChanged.to } : null,
        // The material the prompt names, wired in with the change.
        addedNodes: wired.added.length,
        connectedLines: wired.connected.length,
      },
    };
  }

  return { canvas: doc, error: `不认识的指令：${action?.type ?? ''}` };
}

/**
 * The text a node holds, or produced.
 *
 * An input node's text is what was typed into it; anything else's is what it
 * generated.
 */
export function textOfSource(source) {
  if (!source) return '';
  if (roleOf(source) === 'input') {
    return String(source.metadata?.output?.text || source.metadata?.prompt || '').trim();
  }
  return String(source.metadata?.output?.text ?? '').trim();
}

/**
 * The text a node gets from upstream.
 *
 * A line of text that lands on the node hands its text over: the node's text
 * box shows that text and stops being the user's to type in. The text comes
 * from the source that carries it, so a text input, a text result and a text
 * node that has run all count.
 *
 * The newest line wins, because that is the one the user just drew.
 */
export function inheritedTextFor(canvas, node) {
  const connections = canvas?.connections ?? [];
  for (let i = connections.length - 1; i >= 0; i -= 1) {
    const conn = connections[i];
    if (conn.toNodeId !== node?.id) continue;
    const source = (canvas?.nodes ?? []).find((item) => item.id === conn.fromNodeId);
    if (!source || kindOf(source) !== 'text') continue;
    const text = textOfSource(source);
    if (text) return { text, title: source.title, id: source.id };
  }
  return null;
}

/**
 * The sentence a prompt node expands.
 *
 * The sentence is what the user wrote; the template is the shape the expanded
 * prompt has to take.
 */
export function enhancePrompt(node, sentence) {
  const template = String(node?.metadata?.templateText ?? '').trim();
  const line = String(sentence ?? node?.metadata?.prompt ?? '').trim();
  return [
    '你是一个提示词工程师。把下面这句话扩写成一条可以直接用于生成的提示词。',
    template ? `必须遵守的模板：${template}` : '',
    line ? `原始需求：${line}` : '',
    '只输出扩写后的提示词本身，不要解释，不要加引号。',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * What a run of this node takes with it.
 *
 * The chain above the node is the reference: every ancestor contributes its
 * material, so an input three hops up still reaches the node. The rule is
 * pure, so the page and the runtime send the same thing to the provider.
 */
export function runSpecFor(canvas, node, context = {}) {
  if (!node) return { error: '这个画布上没有这个节点' };
  // The text that landed on the node's text box is the prompt now: the box
  // shows it and cannot be typed in, so the run sends that text.
  const inherited = inheritedTextFor(canvas, node);
  const references = upstreamNodes(canvas, node.id)
    .filter((source) => source.type !== 'group')
    // The source that handed the text over is not a reference any more: its
    // text is the prompt, and a text source carries no material to lose.
    .filter((source) => source.id !== inherited?.id)
    .map((source) => {
      const role = roleOf(source);
      return {
        id: source.id,
        title: source.title,
        // What the data is, not what the card is called: a music node hands on
        // audio, and a prompt node hands on text.
        kind: kindOf(source),
        role,
        // The text of an input node is the prompt material; the text of
        // anything else is what it generated.
        text: role === 'input'
          ? (source.metadata?.output?.text || source.metadata?.prompt || '')
          : String(source.metadata?.output?.text ?? ''),
        media: source.metadata?.output?.media ?? [],
      };
    });
  // A material the prompt names is a reference too, even when it is not
  // above the node: the `@` says "this prompt is about that picture", and
  // the picture has to be there for the prompt to mean anything.
  for (const material of mentionedMaterials(canvas, node)) {
    if (references.some((item) => item.id === material.id)) continue;
    references.push({
      id: material.id,
      title: material.title,
      kind: material.kind,
      role: roleOf(material.node),
      text: String(material.node?.metadata?.output?.text ?? ''),
      media: material.media,
    });
  }
  // The prompt mode runs on the text model, and what it sends is the expanded
  // prompt rather than the sentence the user typed.
  const isPromptMode = modeOf(node) === 'prompt';
  // The node's own prompt stays in the node — it comes back when the upstream
  // line is gone — but it is not sent this time: the text box shows the
  // upstream text, so the run sends the upstream text.
  const takenOver = Boolean(inherited);
  return {
    nodeId: node.id,
    mode: runModeOf(node),
    // The mode the node is in, not the way it runs: some modes need the
    // runtime to read the material first (a video has to be understood before
    // a prompt can be written from it).
    nodeMode: modeOf(node),
    // Which request the provider is asked for. The three video requests are
    // different requests, not one request with different parameters, so the
    // runtime assembles the body from this and not from the model alone.
    path: pathOf(node),
    // The pictures that are plugged straight into this node, and the port
    // each one fills. A frame request wants the two lines on the card — the
    // first frame and the last frame — and not everything above it.
    frames: framePorts(canvas, node),
    segments: isPromptMode || takenOver ? [] : (node.metadata?.segments ?? []),
    prompt: isPromptMode
      ? enhancePrompt(node, inherited?.text)
      : (inherited?.text || node.metadata?.prompt || ''),
    mentions: isPromptMode || takenOver ? [] : (node.metadata?.mentions ?? []),
    params: {
      ratio: node.metadata?.ratio ?? null,
      resolution: node.metadata?.resolution ?? null,
      duration: node.metadata?.duration ?? null,
      voice: node.metadata?.voice ?? null,
      emotion: node.metadata?.emotion ?? null,
    },
    modelKey: node.metadata?.model ?? null,
    sessionId: node.metadata?.sessionId ?? null,
    // How many assets this run asks for.
    count: batchCount(node.type, node.metadata?.count),
    references,
    // The whole chain is one run: the caller may fill in the steps above.
    chain: context.chain !== false,
  };
}

/** The result nodes a generating node produced. */
function resultNodesOf(canvas, node) {
  const ids = new Set();
  for (const conn of canvas?.connections ?? []) {
    if (conn.fromNodeId !== node.id) continue;
    const target = (canvas?.nodes ?? []).find((item) => item.id === conn.toNodeId);
    if (target && target.type === 'result') ids.add(target.id);
  }
  return (canvas?.nodes ?? []).filter((item) => ids.has(item.id));
}

/** The generating node this node feeds, if there is one. */
function downstreamGeneratingNode(canvas, node) {
  for (const conn of canvas?.connections ?? []) {
    if (conn.fromNodeId !== node.id) continue;
    const target = (canvas?.nodes ?? []).find((item) => item.id === conn.toNodeId);
    if (target && roleOf(target) === 'generate') return target;
  }
  return null;
}

/**
 * The result of a run becomes its own node.
 *
 * The node is placed to the right of the generating one, or in the middle when
 * the generating one feeds another generating node — then the chain reads
 * 生成 → 结果 → 生成, and the result is what the next node reads.
 *
 * A batch of results is one node per asset, in one row, so the versions can be
 * compared next to each other.
 */
export function materializeResults(canvas, node, task, context = {}) {
  if (!node) return { canvas, error: '没有可放结果的节点' };
  const ctx = {
    sizes: {},
    idFor: fallbackId,
    now: () => new Date().toISOString(),
    ...context,
  };
  const doc = canvas ?? { nodes: [], connections: [] };
  const nodes = [...(doc.nodes ?? [])];
  const connections = [...(doc.connections ?? [])];
  const media = task?.media ?? [];

  // The result is applied once: a second run of the same task does not add a
  // second copy.
  const already = nodes.find(
    (item) => item.metadata?.sourceTaskId && item.metadata.sourceTaskId === task?.id,
  );
  if (already) return { canvas: doc, results: [already], info: { added: false } };

  // The prompt mode writes text, so its result is a text result.
  const kind = media[0]?.kind ?? (node.type === 'text' ? 'text' : 'image');
  const size = ctx.sizes.result ?? { width: 300, height: 300 };

  // A second run replaces the results of the first one instead of adding more:
  // otherwise the downstream node would read the same step twice.
  const previous = resultNodesOf(doc, node);
  const carried = connections.filter((conn) => previous.some((item) => item.id === conn.fromNodeId));
  if (previous.length) {
    const gone = new Set(previous.map((item) => item.id));
    for (let i = connections.length - 1; i >= 0; i -= 1) {
      const conn = connections[i];
      if (gone.has(conn.fromNodeId) || gone.has(conn.toNodeId)) connections.splice(i, 1);
    }
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      if (gone.has(nodes[i].id)) nodes.splice(i, 1);
    }
  }

  const downstream = downstreamGeneratingNode(doc, node);
  const makeResult = (options) => ({
    id: options.id,
    type: 'result',
    title: options.title,
    position: { x: options.x, y: options.y },
    width: size.width,
    height: size.height,
    metadata: {
      templateId: 'custom',
      templateVars: {},
      segments: [],
      prompt: '',
      mentions: [],
      model: null,
      ratio: null,
      resolution: null,
      duration: null,
      voice: null,
      emotion: null,
      sessionId: null,
      kind: options.kind,
      templateText: '',
      sourceNodeId: node.id,
      sourceTaskId: task?.id ?? '',
      output: {
        ...IDLE_OUTPUT,
        status: 'success',
        text: options.text,
        media: options.media,
        updatedAt: ctx.now(),
      },
    },
  });

  if (media.length > 1) {
    // The results sit in a row next to the node, and the distance between them
    // is the card's own size: two result cards that are a few pixels apart
    // cover each other.
    const placed = planBatchPlacement({
      count: media.length,
      originX: node.position.x + node.width + 60,
      originY: node.position.y + 40,
      cardWidth: size.width,
      cardHeight: size.height,
      perRow: media.length,
    });
    const created = media.map((item, index) => {
      const result = makeResult({
        id: ctx.idFor('n'),
        title: `${node.title} · 结果 ${index + 1}`,
        x: placed.cells[index].x,
        y: placed.cells[index].y,
        kind: item.kind || kind,
        text: index === 0 ? task?.text || '' : '',
        media: [item],
      });
      nodes.push(result);
      connections.push({
        id: ctx.idFor('c'),
        fromNodeId: node.id,
        toNodeId: result.id,
        kind: result.metadata.kind,
      });
      return result;
    });
    const first = created[0];
    // The node that reads the results reads the first one, and it moves past
    // the whole row so the row stays visible.
    if (downstream) {
      const last = created[created.length - 1];
      downstream.position.x = last.position.x + size.width + 60;
      for (let i = connections.length - 1; i >= 0; i -= 1) {
        const conn = connections[i];
        if (conn.fromNodeId === node.id && conn.toNodeId === downstream.id) connections.splice(i, 1);
      }
      connections.push({
        id: ctx.idFor('c'),
        fromNodeId: first.id,
        toNodeId: downstream.id,
        kind: first.metadata.kind,
      });
    }
    // The links the replaced results carried move to the first new one.
    const seen = new Set();
    for (const conn of carried) {
      if (conn.toNodeId === downstream?.id) continue;
      if (seen.has(conn.toNodeId)) continue;
      seen.add(conn.toNodeId);
      connections.push({
        id: ctx.idFor('c'),
        fromNodeId: first.id,
        toNodeId: conn.toNodeId,
        kind: conn.kind ?? first.metadata.kind,
      });
    }
    // The cards never cover each other: a result that lands on another card
    // pushes it aside. Two branches of one node are side by side, and the
    // result of the first one would sit on top of the second one.
    const apart = pushAside({ nodes, connections }, created.map((item) => item.id));
    return {
      canvas: { ...doc, nodes: apart.nodes, connections: apart.connections },
      results: created,
      info: { added: true, count: created.length },
    };
  }

  let x = node.position.x + node.width + 80;
  if (downstream) {
    const wanted = downstream.position.x - (size.width + 60);
    if (wanted >= node.position.x + node.width + 24) {
      x = wanted;
    } else {
      // No room between the two: the downstream node moves right so the chain
      // reads left to right instead of the result sitting on top.
      const shift = node.position.x + node.width + 24 + size.width + 60 - downstream.position.x;
      if (shift > 0) downstream.position.x += shift;
      x = downstream.position.x - size.width - 60;
    }
  }

  const result = makeResult({
    id: ctx.idFor('n'),
    title: `${node.title} · 结果`,
    x,
    y: node.position.y + 40,
    kind,
    text: task?.text || '',
    media,
  });
  nodes.push(result);
  connections.push({
    id: ctx.idFor('c'),
    fromNodeId: node.id,
    toNodeId: result.id,
    kind: result.metadata.kind,
  });
  // What the node fed now reads from the result, so the chain carries the data
  // through the result node.
  if (downstream) {
    for (let i = connections.length - 1; i >= 0; i -= 1) {
      const conn = connections[i];
      if (conn.fromNodeId === node.id && conn.toNodeId === downstream.id) connections.splice(i, 1);
    }
    connections.push({
      id: ctx.idFor('c'),
      fromNodeId: result.id,
      toNodeId: downstream.id,
      kind: result.metadata.kind,
    });
  }
  // The links the replaced result carried move to the new one.
  for (const conn of carried) {
    if (conn.toNodeId === downstream?.id) continue;
    connections.push({
      id: ctx.idFor('c'),
      fromNodeId: result.id,
      toNodeId: conn.toNodeId,
      kind: conn.kind ?? result.metadata.kind,
    });
  }
  // The cards never cover each other: a result that lands on another card
  // pushes it aside. Two branches of one node are side by side, and the
  // result of the first one would sit on top of the second one.
  const apart = pushAside({ nodes, connections }, [result.id]);
  return {
    canvas: { ...doc, nodes: apart.nodes, connections: apart.connections },
    results: [result],
    info: { added: true, count: 1 },
  };
}
