// The node forms: one table for what every card is.
//
// The page and the runtime read this same table, so a node's role, the kind of
// data it holds or produces, and whether it can be created from the menu are
// never written down twice.
//
// Three ideas are kept apart on purpose:
//
//   role  what the card is for: input, generate, result, group
//   kind  the data that travels: text, image, video, audio
//   mode  how the node makes that data, and therefore what it needs
//
// A mode says what the node takes, so the ports on the left of the card are
// the mode's inputs: pick 文生图 and the card waits for a text, pick 图生图
// and it waits for a picture as well. A mode is a choice on the card, so it
// never gets a row in the add menu — the menu lists the kinds.

/** The kinds of data that travel on a line, and that a node can hold. */
export const DATA_KINDS = ['text', 'image', 'video', 'audio'];

/**
 * The Chinese name of every kind.
 *
 * The kind names live here, with the kind table, so the page, the runtime and
 * the shared action layer say "图片" for the same thing instead of each keeping
 * its own list.
 */
export const KIND_LABELS = {
  text: '文本',
  image: '图片',
  video: '视频',
  audio: '音频',
};

/** The name of a kind, in Chinese. */
export function kindLabel(kind) {
  return KIND_LABELS[kind] ?? kind ?? '';
}

/**
 * Every node form.
 *
 *   label     the name the page shows
 *   role      what the card is for
 *   kind      the data it produces; null when it produces none
 *   creatable whether the menu offers it
 *
 * The key order is the order the menu offers the forms in.
 */
export const NODE_FORMS = {
  input: { label: '输入', role: 'input', kind: null, creatable: true },
  text: { label: '文本', role: 'generate', kind: 'text', creatable: true },
  image: { label: '图片', role: 'generate', kind: 'image', creatable: true },
  video: { label: '视频', role: 'generate', kind: 'video', creatable: true },
  audio: { label: '音频', role: 'generate', kind: 'audio', creatable: true },
  group: { label: '分组', role: 'group', kind: null, creatable: true },
  // A result node is not offered: it appears by itself when a generation
  // finishes.
  result: { label: '结果', role: 'result', kind: null, creatable: false },
};

/**
 * The modes of each generating node.
 *
 * A mode names a way of making the node's data, and its `ports` say what it
 * takes to do it. The card's ports are those inputs, so the card always says
 * what it is waiting for.
 *
 * The order matters: the first mode whose inputs cover what is connected is
 * the mode a node lands in, so the plain one comes first.
 *
 * `needs` says what the mode is *about*: 视频续写 is about a video, so only a
 * model that takes video references can run it. The other kinds it accepts are
 * optional extras, and their ports follow the model.
 *
 * A port may carry a role. A mode that takes the same kind twice — 图生视频·首尾帧
 * takes two pictures, one for each end of the clip — says which is which, and
 * the role is what tells the two lines apart on the card and in the request.
 */
export const NODE_MODES = {
  text: [
    { id: 'generate', label: '文本生成', ports: [{ kind: 'text' }] },
    { id: 'prompt', label: '提示词增强', ports: [{ kind: 'text' }] },
    { id: 'describe', label: '图生文', ports: [{ kind: 'image' }], needs: ['image'], reads: 'image' },
    // The video is read by the provider's video understanding, not by the text
    // model: the text model never sees a video, so the runtime asks the
    // provider what the video shows and the Agent writes the prompt from it.
    { id: 'video2text', label: '视频生文', ports: [{ kind: 'video' }], needs: ['video'], reads: 'video' },
  ],
  image: [
    { id: 'text2image', label: '文生图', ports: [{ kind: 'text' }] },
    // 图生图 and 图文生图 were one request to the provider all along: a prompt
    // plus reference images. The text is the card's text box now, so it has no
    // port of its own — the two modes only ever drew the same card, and one
    // mode is enough.
    { id: 'image2image', label: '图生图', ports: [{ kind: 'text' }, { kind: 'image' }], needs: ['image'] },
  ],
  video: [
    { id: 'text2video', label: '文生视频', ports: [{ kind: 'text' }] },
    // A picture becomes a video in three different ways, and the provider has
    // three different requests for them:
    //   首帧   the picture is the first frame — the frame decides the shape
    //   首尾帧 two pictures, one at each end of the clip
    //   参考   a set of references, and the ratio decides the shape
    // The two reference requests differ in one thing: whether an audio
    // reference goes with them. That is what the mode says, so the card
    // never shows a control the request ignores.
    { id: 'imagekey2video', label: '图生视频·首帧', ports: [{ kind: 'text' }, { kind: 'image', role: 'first', label: '首帧' }], needs: ['image'], path: 'keyframe' },
    { id: 'imagefl2video', label: '图生视频·首尾帧', ports: [{ kind: 'text' }, { kind: 'image', role: 'first', label: '首帧' }, { kind: 'image', role: 'last', label: '尾帧' }], needs: ['image'], path: 'firstLast' },
    { id: 'imageend2video', label: '图生视频·末帧', ports: [{ kind: 'text' }, { kind: 'image', role: 'last', label: '末帧' }], needs: ['image'], path: 'lastFrame' },
    { id: 'image2video', label: '图生视频·参考', ports: [{ kind: 'text' }, { kind: 'image' }], needs: ['image'], path: 'collection' },
    { id: 'image2videoaudio', label: '图生视频·参考+音频', ports: [{ kind: 'text' }, { kind: 'image' }, { kind: 'audio' }], needs: ['image'], path: 'collectionAudio' },
    { id: 'video2video', label: '视频续写', ports: [{ kind: 'text' }, { kind: 'video' }], needs: ['video'], path: 'collection' },
    { id: 'video2videoaudio', label: '视频续写+音频', ports: [{ kind: 'text' }, { kind: 'video' }, { kind: 'audio' }], needs: ['video'], path: 'collectionAudio' },
  ],
  audio: [
    { id: 'speech', label: '文生音频', ports: [{ kind: 'text' }] },
    { id: 'music', label: '文生音乐', ports: [{ kind: 'text' }] },
  ],
};

/**
 * The modes that were two and are one now.
 *
 * The text is the card's text box, so a mode that only added a text input
 * added nothing. A canvas that still names the old mode keeps its card and
 * lands on the mode that is left.
 */
const LEGACY_MODES = {
  textimage2image: 'image2image',
  textimage2video: 'image2video',
  // The first+last frame mode was named after the last frame, and the last
  // frame mode has taken that name for itself: the old id lands on the mode
  // it meant.
  imagelast2video: 'imagefl2video',
};

/**
 * The kinds of node the menu offers.
 *
 * A kind is a role and the data it moves: an input node holds one kind of
 * material and a generating node makes one. The menu lists the kinds, so what
 * it offers is exactly what the board can show. A mode is a choice on the
 * card, so it never gets a row of its own.
 */
export const NODE_KINDS = [
  { role: 'input', kind: 'text', label: '输入 · 文本', type: 'input' },
  { role: 'input', kind: 'image', label: '输入 · 图片', type: 'input' },
  { role: 'input', kind: 'video', label: '输入 · 视频', type: 'input' },
  { role: 'input', kind: 'audio', label: '输入 · 音频', type: 'input' },
  { role: 'generate', kind: 'text', label: '生成 · 文本', type: 'text' },
  { role: 'generate', kind: 'image', label: '生成 · 图片', type: 'image' },
  { role: 'generate', kind: 'video', label: '生成 · 视频', type: 'video' },
  { role: 'generate', kind: 'audio', label: '生成 · 音频', type: 'audio' },
  { role: 'group', kind: null, label: '分组', type: 'group' },
];

/** Every node type. */
export const NODE_TYPES = Object.keys(NODE_FORMS);

/** The types the menu offers. */
export const CREATABLE_TYPES = NODE_TYPES.filter((type) => NODE_FORMS[type].creatable);

/** The role of every node type. */
export const NODE_ROLES = Object.fromEntries(
  NODE_TYPES.map((type) => [type, NODE_FORMS[type].role]),
);

/** The role a node plays. */
export function roleOf(node) {
  return NODE_FORMS[node?.type]?.role ?? 'generate';
}

/** The modes a node can be in. */
export function modesOf(node) {
  return NODE_MODES[node?.type] ?? [];
}

/**
 * The mode a node should be in now.
 *
 * A canvas from before the merge names a mode that is one of the two now: it
 * lands on the mode that is left.
 */
export function currentModeId(modeId) {
  return LEGACY_MODES[modeId] ?? modeId;
}

/** The mode a node is in. */
export function modeOf(node) {
  const modes = modesOf(node);
  if (!modes.length) return '';
  const wanted = currentModeId(node?.metadata?.mode);
  return modes.some((mode) => mode.id === wanted) ? wanted : modes[0].id;
}

/** The mode record a node is in. */
export function modeRecordOf(node) {
  const modes = modesOf(node);
  if (!modes.length) return null;
  return modes.find((mode) => mode.id === modeOf(node)) ?? modes[0];
}

/** The name of a mode, by its id. */
export function modeLabelOf(node, modeId) {
  return modesOf(node).find((mode) => mode.id === modeId)?.label ?? '';
}

/**
 * The mode with this id, whichever node it belongs to.
 *
 * A mode id says what a node does, so the runtime can look the mode up without
 * knowing what kind of node it is on.
 */
export function modeRecordById(modeId) {
  for (const modes of Object.values(NODE_MODES)) {
    const found = modes.find((mode) => mode.id === modeId);
    if (found) return found;
  }
  return null;
}

/**
 * The material the runtime has to read before the Agent writes.
 *
 * The text model never sees a video, so a mode that turns a video into text
 * has to ask the provider what the video shows first. The mode table says so,
 * so the page and the runtime read the same rule.
 */
export function materialToRead(modeId) {
  return modeRecordById(modeId)?.reads ?? '';
}

/**
 * The way the node makes its data.
 *
 * An audio node in the music mode runs the music model, and every other node
 * runs the path its own type names.
 */
export function runModeOf(node) {
  if (node?.type === 'audio') return modeOf(node) === 'music' ? 'music' : 'audio';
  return node?.type ?? 'image';
}

/**
 * The inputs a node takes, by the mode it is in.
 *
 * Every input has a kind and, when the mode takes the same kind twice, a role
 * that says which one it is. This is what the ports on the card are: pick a
 * mode and the card waits for exactly that.
 */
export function inputsOf(node) {
  const mode = modeRecordOf(node);
  if (mode) {
    return (mode.ports ?? []).map((port) => ({
      kind: port.kind,
      role: port.role ?? '',
      label: port.label ?? '',
    }));
  }
  const form = NODE_FORMS[node?.type];
  if (!form) return [];
  return (form.accepts ?? []).map((kind) => ({ kind, role: '', label: '' }));
}

/**
 * The kinds a node takes, by the mode it is in.
 *
 * The kinds of the inputs, without the roles: the modes that take a kind twice
 * still take it once as a kind.
 */
export function acceptsOf(node) {
  return [...new Set(inputsOf(node).map((input) => input.kind))];
}

/**
 * The way the provider is asked for this node's data.
 *
 * The three video requests are different requests, not one request with
 * different parameters: the keyframe path takes one picture, the first+last
 * path takes two, and the collection path takes a set of references. The mode
 * says which one, and the model says whether it can run it at all.
 */
export function pathOf(node) {
  return modeRecordOf(node)?.path ?? '';
}

/**
 * The mode that fits what is connected.
 *
 * The mode says what the node takes, so it is the one whose inputs the
 * connected material covers. The first mode that covers them wins, so the plain
 * one comes first; a node with nothing connected lands in the first mode.
 */
export function modeForKinds(type, kinds = []) {
  const modes = NODE_MODES[type] ?? [];
  if (!modes.length) return '';
  const wanted = [...new Set(kinds)].sort();
  const found = modes.find((mode) => {
    const takes = mode.ports ?? [];
    return wanted.every((kind) => takes.some((port) => port.kind === kind));
  });
  return (found ?? modes[0]).id;
}

/**
 * The kind of data a node holds or produces.
 *
 * An input node holds the kind the user chose for it, a result node holds
 * what the generation produced, and a generating node produces what its form
 * says. An audio node makes audio whether it speaks or makes music: the
 * difference is the model, not the data.
 */
export function kindOf(node) {
  const form = NODE_FORMS[node?.type];
  if (!form) return 'text';
  if (node.type === 'input') {
    const media = node.metadata?.output?.media ?? [];
    return media[0]?.kind ?? node.metadata?.kind ?? 'text';
  }
  if (node.type === 'result') return node.metadata?.kind ?? 'image';
  return form.kind ?? 'text';
}

/**
 * The tools a card shows under itself.
 *
 * A result card shows the tools of what it holds, and a generating card shows
 * none, because it has nothing to transform yet.
 *
 * A card holding a video shows none either: the finished clip is a
 * deliverable, not a working material, and a dozen buttons under it are
 * noise. The video tools stay in the runtime, so the Agent can still call
 * them.
 */
export function cardTools(node, tools = []) {
  if (roleOf(node) !== 'result') return [];
  const kind = kindOf(node);
  if (kind === 'video') return [];
  return tools.filter((tool) => tool?.kind === kind);
}

/**
 * The chrome a card carries under its material.
 *
 * The footer is the toolbar, so a card with no tools has no footer either:
 * an empty strip with a border would still read like a toolbar that lost
 * its buttons.
 */
export function cardChrome(node, tools = []) {
  const list = cardTools(node, tools);
  return { tools: list, hasFooter: list.length > 0 };
}

/**
 * The slots a node declares: what may be plugged into it, and what it hands
 * on.
 *
 * The ports on the card's edge and the chips in the strip are two drawings of
 * this one declaration.
 */
export function slotsOf(node) {
  const role = roleOf(node);
  const kind = kindOf(node);
  if (role === 'group') return { inputs: [], outputs: [] };
  if (role === 'input') return { inputs: [], outputs: [{ kind }] };
  if (role === 'result') return { inputs: [{ kind, role: '', label: '' }], outputs: [{ kind }] };
  return {
    inputs: inputsOf(node),
    outputs: [{ kind }],
  };
}

/**
 * The name of an aspect ratio, with the way it lies.
 *
 * A ratio like 16:9 does not tell everyone at a glance that it is a wide
 * frame, so the menu says which way it points. The value stays the ratio the
 * provider takes — only the label grows.
 */
export function ratioLabel(ratio) {  const text = String(ratio ?? '').trim();
  if (!text) return '';
  if (text === 'adaptive') return '自适应';
  const [wide, tall] = text.split(':').map((part) => Number(part));
  if (!Number.isFinite(wide) || !Number.isFinite(tall)) return text;
  if (wide > tall) return `${text} 横屏`;
  if (wide < tall) return `${text} 竖屏`;
  return `${text} 方形`;
}

/**
 * The ratios a node may be given, for the request it makes.
 *
 * The two keyframe requests follow the frame: the provider ignores the ratio
 * there, so the card must not offer one. A text-to-video run needs a concrete
 * shape, and a reference collection may follow the frame instead.
 */
export function ratioOptionsFor(node, caps) {
  const ratios = caps?.ratios ?? [];
  if (!ratios.length) return [];
  const path = pathOf(node);
  if (path === 'keyframe' || path === 'firstLast') return [];
  if (path === 'collection') return ratios;
  // A text-to-video run needs a concrete shape: `adaptive` has no frame to
  // follow.
  if (node?.type === 'video') return ratios.filter((ratio) => ratio !== 'adaptive');
  return ratios;
}

/**
 * Whether the node has a text box on its card.
 *
 * A generating node writes text, so it has one; a text input node holds text,
 * so it has one too. A node that holds material has none: the text that goes
 * with the material is another node's job.
 */
export function hasTextBox(node) {
  const role = roleOf(node);
  if (role === 'generate') return true;
  if (role === 'input') return kindOf(node) === 'text';
  return false;
}

/**
 * The kinds that get a port on the card's edge.
 *
 * A node with a text box takes its text in the text box, so the text has no
 * port of its own — one thing, one place. The line lands on the box instead.
 */
export function portKinds(node) {
  return [...new Set(portList(node).map((port) => port.kind))];
}

/**
 * The kinds a model can take as reference.
 *
 * The limits say how many of each the provider accepts, so a kind it cannot
 * take at all has no port: the card must not offer something the run refuses.
 */
export function referenceKinds(caps) {
  const kinds = [];
  if ((caps?.maxImages ?? 0) > 0) kinds.push('image');
  if ((caps?.maxVideos ?? 0) > 0) kinds.push('video');
  if ((caps?.maxAudios ?? 0) > 0) kinds.push('audio');
  return kinds;
}

/**
 * The modes a model can run.
 *
 * A mode is about one kind of input: 视频续写 needs a video, and only the
 * model that takes video references can run it.
 *
 * A mode also says which request it makes, and a model only runs the requests
 * it has: the reference collection is H3's alone, and the first+last frame
 * request is not Hailuo's.
 */
export function modesFor(node, caps) {
  const kinds = referenceKinds(caps);
  const paths = caps?.paths ?? null;
  return modesOf(node).filter((mode) => {
    if ((mode.needs ?? []).some((kind) => !kinds.includes(kind))) return false;
    if (mode.path && paths && !paths.includes(mode.path)) return false;
    return true;
  });
}

/**
 * The ports that get a dot on the card's edge.
 *
 * The mode says what the node takes and the model says what it can take: the
 * port is what both of them allow. A mode that takes the same kind twice has
 * two ports, and the role is what tells them apart.
 */
export function portList(node, caps = null) {
  const kinds = caps ? referenceKinds(caps) : null;
  return inputsOf(node).filter((port) => {
    if (port.kind === 'text' && hasTextBox(node)) return false;
    if (!kinds) return true;
    return kinds.includes(port.kind);
  });
}

/**
 * The kinds that get a port, for a model.
 *
 * The mode says what the node takes and the model says what it can take: the
 * port is what both of them allow.
 */
export function portKindsFor(node, caps) {
  return [...new Set(portList(node, caps).map((port) => port.kind))];
}

/**
 * The input slots the card shows in its strip.
 *
 * The strip reads the same rule the ports are drawn from, so the card never
 * says two different things about the same input: a node with a text box takes
 * its text in the text box, and a kind the model cannot take is not an input
 * either.
 */
export function stripInputs(node, caps = null) {
  const kinds = caps ? referenceKinds(caps) : null;
  return slotsOf(node).inputs.filter((slot) => {
    if (slot.kind === 'text' && hasTextBox(node)) return false;
    // A node that is not generated — an input or a result — has no model to
    // narrow it, so its slots stay.
    if (!modesOf(node).length) return true;
    // Without the model's limits there is nothing to narrow it by.
    return kinds ? kinds.includes(slot.kind) : true;
  });
}
