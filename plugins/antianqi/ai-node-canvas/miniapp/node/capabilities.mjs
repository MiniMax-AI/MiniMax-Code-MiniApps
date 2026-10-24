// Capability surface for the AI Node Canvas MiniApp.
//
// The image numbers are taken from the live connector schemas rather than
// guessed: the aspect-ratio and resolution enums come from
// `connector__matrix__generate_image`, the video rules come from
// `connector__matrix__submit_video_generation` (which encodes per-model
// restrictions with conditional branches).
//
// The palette below is the single source the page renders from, the way the
// reference implementation serves everything from one `/api/palette` call.

// The node forms: the type, the role it plays and the kind of data it holds
// or produces all come from one table, so the page and the runtime never
// answer the same question twice.
import { CREATABLE_TYPES, DATA_KINDS, KIND_LABELS, NODE_FORMS, NODE_ROLES, NODE_TYPES } from '../client/forms.mjs';

export { CREATABLE_TYPES, DATA_KINDS, NODE_FORMS, NODE_ROLES, NODE_TYPES };

export const MODES = ['image', 'video', 'audio', 'music', 'text'];

// The kinds an input node holds and a result node shows. They are the same
// four kinds that travel on a line, so nothing on the board speaks a kind
// the others do not know.
export const RESULT_KINDS = new Set(DATA_KINDS);
export const INPUT_KINDS = new Set(DATA_KINDS);

// The image, audio and music modes are produced by the connector with one
// dedicated model each. The page has to show that model instead of the
// Agent's text models, the way the video mode shows the video models.
const IMAGE_MODELS = [
  {
    id: 'matrix-image',
    label: 'Matrix 文生图',
    note: '1K/2K/4K，6 种画幅；支持图生图（最多 9 张参考图）',
    ratios: ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'],
    resolutions: ['1K', '2K', '4K'],
    maxImages: 9,
    maxVideos: 0,
    maxAudios: 0,
  },
];

const AUDIO_MODELS = [
  {
    id: 'matrix-tts',
    label: 'Matrix 语音合成',
    note: '音色 + 情绪，输出 mp3',
    maxImages: 0,
    maxVideos: 0,
    maxAudios: 0,
  },
];

const MUSIC_MODELS = [
  {
    id: 'matrix-music',
    label: 'Matrix 音乐生成',
    note: '最多 5 首/次，可给歌词；mp3/wav',
    maxImages: 0,
    maxVideos: 0,
    maxAudios: 0,
  },
];

const IMAGE_LIMITS = {
  ratios: IMAGE_MODELS[0].ratios,
  resolutions: IMAGE_MODELS[0].resolutions,
  durations: [],
  maxImages: IMAGE_MODELS[0].maxImages,
  maxVideos: 0,
  maxAudios: 0,
  supportsEmotion: false,
  supportsSyncAudio: false,
  supportsDuration: false,
  supportsContinue: false,
  supportsVoice: false,
  supportsMentionImages: true,
  models: IMAGE_MODELS,
};

const VIDEO_MODELS = [
  {
    id: 'MiniMax-H3',
    label: 'MiniMax-H3',
    note: '质量优先，走账户余额；支持首/尾帧与多模态参考；成片自带同步音轨；出片通常要 15-30 分钟',
    // The provider's ratio list. `adaptive` follows the first frame, so it is
    // the last one: a text-to-video run needs a concrete ratio, and that is
    // the one the provider defaults to.
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'],
    // The requests the provider has for a picture:
    //   keyframe         the picture is the first frame
    //   firstLast        two pictures, one at each end
    //   lastFrame        one picture, and it is the last frame
    //   collection       a set of references
    //   collectionAudio  the same set, plus an audio reference
    // H3 is the only model with the collections, and the only one that can
    // read a video or an audio as a reference.
    paths: ['keyframe', 'firstLast', 'lastFrame', 'collection', 'collectionAudio'],
    resolutions: ['768P', '2K'],
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    // The reference collections: up to nine pictures, three videos and three
    // audios, and twelve items in all.
    maxImages: 9,
    maxVideos: 3,
    maxAudios: 3,
    supportsFirstFrame: true,
    supportsLastFrame: true,
    supportsReferences: true,
    // The connector renders a synchronized native audio track for this model.
    nativeAudio: true,
    // The provider takes the reference collections twelve items in all.
    maxReferenceItems: 12,
    credits: 'account',
  },
  {
    id: 'MiniMax-H3-Max',
    label: 'MiniMax-H3-Max',
    note: '快速版，约 20 秒出片，走账户余额；仅支持首/尾帧，不支持多模态参考；成片静音，要人声请用 H3',
    // The H3 family takes a ratio. The request decides whether it means
    // anything: a text-to-video run needs a concrete one, and the two
    // keyframe requests follow the frame instead.
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'],
    // No collection: this model has no reference sets, so it cannot run the
    // 图生视频·参考 mode, and it is not a candidate for 视频续写 either.
    paths: ['keyframe', 'firstLast', 'lastFrame'],
    resolutions: ['480P', '768P'],
    durations: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    // One picture, and it is the first frame: there is no reference
    // collection, so there is no second one either.
    maxImages: 1,
    maxVideos: 0,
    maxAudios: 0,
    supportsFirstFrame: true,
    supportsLastFrame: true,
    supportsReferences: false,
    // H3-Max is silent: the reference implementation switches to H3 when a
    // picture is asked to carry a voice.
    nativeAudio: false,
    credits: 'account',
  },
  {
    id: 'MiniMax-Hailuo-2.3',
    label: 'MiniMax-Hailuo-2.3',
    note: '走 Token Plan 计费；成片无声，要配音需另接语音合成；仅支持首帧',
    // No ratio either: it is not an H3 family model.
    ratios: [],
    // The first frame only. The provider has no ending frame for this model
    // and no reference set either.
    paths: ['keyframe'],
    resolutions: ['768P', '1080P'],
    durations: [6, 10],
    // The connector only pairs 1080P with 6 seconds; 768P takes 6 or 10.
    resolutionByDuration: { 6: ['768P', '1080P'], 10: ['768P'] },
    // One picture, and it is the first frame.
    maxImages: 1,
    maxVideos: 0,
    maxAudios: 0,
    supportsFirstFrame: true,
    supportsLastFrame: false,
    supportsReferences: false,
    nativeAudio: false,
    credits: 'token-plan',
  },
];

const VIDEO_LIMITS = {
  ratios: VIDEO_MODELS[0].ratios,
  paths: VIDEO_MODELS[0].paths,
  resolutions: VIDEO_MODELS[0].resolutions,
  durations: VIDEO_MODELS[0].durations,
  maxImages: VIDEO_MODELS[0].maxImages,
  maxVideos: VIDEO_MODELS[0].maxVideos,
  maxAudios: VIDEO_MODELS[0].maxAudios,
  supportsEmotion: false,
  supportsSyncAudio: false,
  supportsDuration: true,
  supportsContinue: true,
  supportsVoice: false,
  supportsMentionImages: true,
  models: VIDEO_MODELS,
};

// The emotion enum the connector actually accepts. The page shows a Chinese
// label, but the value that reaches the provider is the English enum.
const AUDIO_EMOTIONS = [
  { value: 'happy', label: '开心' },
  { value: 'sad', label: '悲伤' },
  { value: 'angry', label: '愤怒' },
  { value: 'fearful', label: '恐惧' },
  { value: 'disgusted', label: '厌恶' },
  { value: 'surprised', label: '惊讶' },
  { value: 'neutral', label: '中性' },
];

// The voice catalogue is live data: the Node service reads it from the
// connector at runtime, so no list is hard-coded here.
export const DEFAULT_VOICE_ID = 'male-qn-qingse';

const AUDIO_LIMITS = {
  ratios: [],
  resolutions: [],
  durations: [],
  maxImages: 0,
  maxVideos: 0,
  maxAudios: 0,
  supportsEmotion: true,
  supportsSyncAudio: true,
  supportsDuration: false,
  supportsContinue: false,
  supportsVoice: true,
  supportsMentionImages: false,
  emotions: AUDIO_EMOTIONS,
  models: AUDIO_MODELS,
};

const MUSIC_LIMITS = {
  ratios: [],
  resolutions: [],
  // The music tool takes a prompt and nothing else: it has no duration field,
  // so offering one on the card would be a control that changes nothing.
  durations: [],
  maxImages: 0,
  maxVideos: 0,
  maxAudios: 0,
  supportsEmotion: false,
  supportsSyncAudio: false,
  supportsDuration: false,
  supportsContinue: false,
  supportsVoice: false,
  supportsMentionImages: false,
  models: MUSIC_MODELS,
};

const TEXT_LIMITS = {
  ratios: [],
  resolutions: [],
  durations: [],
  // A text node may look at an upstream image (the mention menu offers it),
  // so the limit must allow the same references the image mode takes.
  maxImages: 9,
  // One video: the 视频生文 mode reads the video with the provider's video
  // understanding before the Agent writes the prompt from it. A video can only
  // land on a text node in that mode, so one is the most it ever carries.
  maxVideos: 1,
  maxAudios: 0,
  supportsEmotion: false,
  supportsSyncAudio: false,
  supportsDuration: false,
  supportsContinue: false,
  supportsVoice: false,
  supportsMentionImages: true,
};

// Global cap on how many references a single generation may carry.
export const MAX_REFERENCES = 10;

export const CAPABILITIES = {
  image: IMAGE_LIMITS,
  video: VIDEO_LIMITS,
  audio: AUDIO_LIMITS,
  music: MUSIC_LIMITS,
  text: TEXT_LIMITS,
};

// Default node size per type, mirroring the reference implementation.
// The image/video cards are deliberately tall: the preview, the composer and
// the parameter row have to fit without the card growing a scrollbar.
export const NODE_SIZE = {
  image: { width: 320, height: 420 },
  video: { width: 340, height: 380 },
  audio: { width: 320, height: 250 },
  // The text card holds a prompt and, in the prompt mode, the template picker
  // as well, so it is taller than a bare text card.
  text: { width: 340, height: 340 },
  group: { width: 480, height: 360 },
  // The input card holds a prompt and whatever was uploaded, so it is a
  // little taller than a bare text card.
  input: { width: 320, height: 300 },
  // The result card only shows the asset, so it starts out as a media card
  // and is resized to the asset's own ratio once the asset is known.
  result: { width: 320, height: 420 },
};

// The input kinds a generating node takes, from what its model accepts.
//
// The text input is always there — the prompt is what goes in. A media
// input only appears when the model can actually use it, so an image node
// with a text model does not offer a video slot it could never fill.
//
// The names of the kinds live in `client/forms.mjs`, with the kind table
// itself, so the page, the runtime and the shared action layer all say the
// same thing about the same kind.
export const INPUT_KIND_LABEL = KIND_LABELS;

// The generation modes are not here: they live in `client/forms.mjs`, where
// the card reads them from. A mode is a choice on the card, and the inputs it
// needs are the card's ports, so the name of a mode is written down once.

// The templates the prompt node offers. Each one is a shape the enhanced
// prompt has to take; the node also accepts a template of its own.
//
// The H3 ones follow MiniMax's own prompt-writing guides (the Base format and
// the Full-Reference format), so the enhanced prompt comes out in the shape
// the video model reads best. The structure is English and the dialogue keeps
// its own language, which is what the guides ask for.
export const PROMPT_TEMPLATES = [
  {
    id: 'ecommerce-main',
    label: '电商主图',
    text: '产品主体 + 材质与细节 + 场景与光线 + 构图与视角 + 画质描述，输出一张商业主图的提示词',
  },
  {
    id: 'short-video',
    label: '短视频分镜',
    text: '逐镜给出：时间码 + 景别 + 运镜 + 人物动作 + 环境与情绪 + 音效',
  },
  {
    id: 'portrait',
    label: '人物写真',
    text: '人物外貌 + 服装 + 姿态与表情 + 光线 + 背景 + 镜头与画质',
  },
  {
    id: 'product-texture',
    label: '产品质感',
    text: '产品名称 + 材质与结构 + 使用场景 + 光影 + 微距细节特写 + 背景',
  },
  {
    id: 'social-cover',
    label: '社媒封面',
    text: '主标题 + 视觉主体 + 配色 + 留白与排版 + 平台尺寸',
  },
  // The MiniMax H3 shapes, one per generation mode, taken from the provider's
  // own prompt-writing guides. The Basic format serves the four base tasks
  // (T2VA / I2VA / FL2VA / L2VA) and the full-reference format serves the
  // reference tasks, and each template carries the alignment line its task
  // needs — that line names the picture and the timestamp, so it cannot be
  // written once for all of them.
  {
    id: 'h3-t2va',
    label: 'H3 T2VA 文生视频',
    text: '按 MiniMax H3 的 T2VA（文生视频）结构输出，只写这三段：integrated_multimodal_description（画面时间线：视觉风格、初始构图、主体外观与位置、环境与光线、动作与变化、[Shot N] 镜头切换、运镜、说话人与对白、场景内同步声）；overall_soundscape（全程的环境音、动作声与非语言人声，不重复对白和音乐）；non_diegetic_music（只有观众听得见的配乐，写乐器、速度、节奏与动态变化，不用抽象情绪词）。三段各写各的，不互相重复。没有参考帧，所以第一段要同时写清初始状态和随时间的变化。镜头用 [Shot 1] 开头（第一镜不带时间戳），后续 [Shot 2] At 00:03.500，切点时间严格递增且落在时长内；运镜写成"运动类型 + 幅度 + 速度"的自然句，例如 the camera pushes in with small amplitude at slow speed；说话人用 (S1)、(S2)，对白用 <d>[语言] 台词</d>，画外音写 says in an off-screen voiceover，跨切用 <scenetrans>，被截断用 <cutoff>；屏幕上的文字用英文双引号原样保留。结构用英文写，台词保留原语言。',
  },
  {
    id: 'h3-i2va',
    label: 'H3 I2VA 首帧图生',
    text: '按 MiniMax H3 的 I2VA（图生视频，首帧）结构输出。最终提示词的第一行是图片对齐说明，由运行时补上：它写的是 @图片1，也就是这次请求里那张首帧的编号，和参考素材块里的标签一致；你不要自己写这一行。你写下面这三段：integrated_multimodal_description（画面时间线：风格、主体、构图与场景锚点先照着 @图片1 写，再写接下来的动作与变化；人物身份、服装、颜色、关键物件与空间关系保持一致）；overall_soundscape（环境音、动作声与非语言人声，不重复对白和音乐）；non_diegetic_music（只有观众听得见的配乐，写乐器、速度与节奏）。镜头用 [Shot 1] 开头，后续 [Shot N] At MM:SS.mmm；运镜写成"运动类型 + 幅度 + 速度"的自然句，例如 the camera pushes in with small amplitude at slow speed；说话人用 (S1)，对白用 <d>[语言] 台词</d>，主体说话时写成 <Subject N> (Sx)。结构用英文写，台词保留原语言。',
  },
  {
    id: 'h3-fl2va',
    label: 'H3 FL2VA 首尾帧图生',
    text: '按 MiniMax H3 的 FL2VA（图生视频，首帧 + 尾帧）结构输出。最终提示词的第一行是图片对齐说明，由运行时补上：@图片1 是首帧、@图片2 是尾帧，编号和参考素材块里的标签一致；你不要自己写这一行。你写下面这三段：integrated_multimodal_description（画面时间线：不要重复两张静态图的描述，要写清楚中间的可见变化路径——主体怎么动、姿态怎么变、物件怎么被操作、构图怎么演进、场景或光线怎么过渡；单个连续镜头通常最清楚）；overall_soundscape（环境音、动作声与非语言人声）；non_diegetic_music（只有观众听得见的配乐，写乐器、速度与节奏）。最后一镜必须落在尾帧上。结构用英文写，台词保留原语言。',
  },
  {
    id: 'h3-l2va',
    label: 'H3 L2VA 末帧图生',
    text: '按 MiniMax H3 的 L2VA（图生视频，末帧）结构输出。最终提示词的第一行是图片对齐说明，由运行时补上：@图片1 是末帧，编号和参考素材块里的标签一致；你不要自己写这一行。你写下面这三段：integrated_multimodal_description（画面时间线：先写一个与末帧相容的合理起始状态，再写清楚动作、物件状态、构图与光线如何逐步收敛到 @图片1；单个连续镜头通常最清楚）；overall_soundscape（环境音、动作声与非语言人声）；non_diegetic_music（只有观众听得见的配乐，写乐器、速度与节奏）。结构用英文写，台词保留原语言。',
  },
  {
    id: 'h3-reference',
    label: 'H3 全参考六段',
    text: '按 MiniMax H3 的全参考格式输出六段，顺序固定。参考素材用运行时给的编号点名（@图片N / @视频N / @音频N，和参考素材块里的标签一致，一条提示词里只这一套编号；<Subject N> 是提示词里自己定的可复用主体）：subject_definitions（逐条定义 <Subject N> 可复用内容、@图片N 帧锚点、@视频N 整片来源、@音频N 音频信号，每条一行）；summary（一段短摘要，以 [reference generation] / [keyframe completion] / [video editing] / [video continuation] / [audio reuse] / [audio reference] 之一开头，多个用 + 连接）；retention_analysis（每条参考一行，视觉用 fully_preserved / partially_preserved / attribute_transfer / weak_reference，音频用 fully_copy / partially_copy / reference / weak_reference）；detailed_description（按播放顺序写镜头，参考标签在它真正生效的地方出现；镜头用 [Shot 1] 开头，后续 [Shot N] At MM:SS.mmm；对白用 <d>[语言] 台词</d>，主体说话时写成 <Subject N> (Sx)；屏幕文字用英文双引号原样保留）；overall_soundscape；non_diegetic_music。结构用英文写，台词保留原语言。',
  },
  {
    id: 'custom',
    label: '自定义',
    text: '',
  },
];

// What each kind of node can receive from an upstream node.
//
// The upstream offers something (text, an image, a video, an audio or a
// style preset) and the downstream says what it accepts. The pairs are the
// same ones the provider itself supports: an image can be the reference of
// an image or a video, a video only feeds a video, an audio only feeds a
// video, and text feeds every generating node.
export const UPSTREAM_ACCEPTS = {
  text: ['text', 'image', 'video', 'audio', 'music'],
  image: ['image', 'video'],
  video: ['video'],
  audio: ['video'],
  style: ['text', 'image', 'video', 'audio', 'music'],
};

// The generating node types a connection can offer, per upstream kind.
export function downstreamTypesFor(upstreamKind) {
  const accepted = UPSTREAM_ACCEPTS[upstreamKind];
  if (!accepted) return [];
  return accepted.filter((mode) => MODES.includes(mode));
}

// Category templates for the style node. A template renders into a comma
// separated phrase that is prepended to every downstream prompt.
export const TEMPLATES = [
  {
    id: 'custom',
    label: '自定义（不套模板）',
    desc: '直接写你自己的风格描述',
    fields: [],
  },
  {
    id: 'product-main',
    label: '商品主图',
    desc: '干净底、主体突出、真实光线的电商主图',
    fields: [
      { key: 'market', label: '目标市场', default: '国内' },
      { key: 'background', label: '背景', default: '纯白无杂物' },
      { key: 'light', label: '光线', default: '柔和自然光' },
      { key: 'layout', label: '构图', default: '主体居中' },
    ],
  },
  {
    id: 'detail-page',
    label: 'S+ 详情',
    desc: '竖版长图卖点排版风格',
    fields: [
      { key: 'market', label: '目标市场', default: '国内' },
      { key: 'brand', label: '品牌调性', default: '简约高级' },
      { key: 'tone', label: '文案语气', default: '克制专业' },
    ],
  },
  {
    id: 'social-cover',
    label: '社媒封面',
    desc: '高对比、有视觉冲击力的封面',
    fields: [
      { key: 'platform', label: '平台', default: '抖音' },
      { key: 'mood', label: '情绪', default: '强烈' },
      { key: 'accent', label: '主色', default: '高饱和' },
    ],
  },
  {
    id: 'portrait',
    label: '人像写真',
    desc: '自然光人像，真实肤质',
    fields: [
      { key: 'scene', label: '场景', default: '室内自然光' },
      { key: 'lens', label: '镜头感', default: '50mm 标准' },
      { key: 'mood', label: '氛围', default: '自然松弛' },
    ],
  },
];

export function renderTemplate(template, values) {
  if (!template || template.id === 'custom') return '';
  return (template.fields ?? [])
    .map((field) => (values?.[field.key] != null ? String(values[field.key]) : field.default ?? ''))
    .map((value) => value.trim())
    .filter(Boolean)
    .join('，');
}

// The matrix provider's tools. The Host grants them per
// `hostConnectorAccess` in miniapp.json, and the panel lists them so the user
// can see which one is missing.
//
// `drives` says whether a feature of this MiniApp runs through the tool. The
// provider offers more tools than the app uses, and the panel says so instead
// of letting the list imply they all work here.
export const CONNECTOR_TOOLS = [
  { tool: 'connector__matrix__generate_image', mode: 'image', label: '文生图 / 图生图', status: 'ready', drives: true },
  { tool: 'connector__matrix__submit_video_generation', mode: 'video', label: '提交视频生成', status: 'ready', drives: true },
  { tool: 'connector__matrix__query_video_generation', mode: 'video', label: '查询视频任务', status: 'ready', drives: true },
  { tool: 'connector__matrix__synthesize_speech', mode: 'audio', label: '语音合成', status: 'ready', drives: true },
  { tool: 'connector__matrix__batch_text_to_audio', mode: 'audio', label: '批量语音合成', status: 'ready', drives: false },
  { tool: 'connector__matrix__get_voice_list', mode: 'audio', label: '音色列表', status: 'ready', drives: true },
  { tool: 'connector__matrix__listen_audio', mode: 'audio', label: '语音转写', status: 'ready', drives: false },
  { tool: 'connector__matrix__batch_text_to_music', mode: 'music', label: '音乐生成', status: 'ready', drives: true },
  { tool: 'connector__matrix__describe_images', mode: 'vision', label: '图像理解', status: 'ready', drives: true },
  { tool: 'connector__matrix__videos_understand', mode: 'vision', label: '视频理解', status: 'ready', drives: true },
  { tool: 'connector__matrix__audios_understand', mode: 'vision', label: '音频理解', status: 'ready', drives: false },
  { tool: 'connector__matrix__search_images', mode: 'image', label: '图片搜索', status: 'ready', drives: false },
  { tool: 'connector__matrix__reverse_image_search', mode: 'image', label: '以图搜图', status: 'ready', drives: false },
];

export function capabilitiesFor(mode) {
  return CAPABILITIES[mode] ?? CAPABILITIES.image;
}

// Resolve the effective limits for a mode, honouring a selected video model.
export function resolveLimits(mode, modelId) {
  const base = capabilitiesFor(mode);
  if (mode === 'video') {
    const model = base.models?.find((item) => item.id === modelId);
    if (model) {
      return {
        ...base,
        ratios: model.ratios,
        // The requests this model can be asked for. The mode says which one
        // the user wants; this says which ones exist for this model.
        paths: model.paths ?? base.paths ?? [],
        resolutions: model.resolutions,
        durations: model.durations,
        // Some models only allow a resolution for particular durations.
        resolutionByDuration: model.resolutionByDuration,
        maxImages: model.maxImages,
        maxVideos: model.maxVideos,
        maxAudios: model.maxAudios,
        // The per-model capabilities travel with the limits, so a consumer
        // never has to reach into `model` to know what the model supports.
        supportsFirstFrame: model.supportsFirstFrame,
        supportsLastFrame: model.supportsLastFrame,
        supportsReferences: model.supportsReferences,
        nativeAudio: model.nativeAudio,
        // The provider takes the reference collections twelve items in all.
        maxReferenceItems: model.maxReferenceItems ?? 0,
        model,
      };
    }
  }
  return base;
}

// The limits of a node type, or nothing when the type is not a generation
// mode.
//
// A prompt node rewrites text and takes no media: it is not a mode, so it
// has no reference limits. The page reads the same rule through the palette,
// so the two never disagree about what a card can take.
export function limitsForNodeType(type, modelId) {
  if (!MODES.includes(type)) return {};
  return resolveLimits(type, modelId);
}

// The resolutions a model offers for one duration. A model that does not
// couple the two returns its full list.
export function resolutionsForDuration(model, duration) {
  if (!model?.resolutionByDuration) return model?.resolutions ?? [];
  const key = String(duration ?? '');
  if (!key) return model.resolutions ?? [];
  return model.resolutionByDuration[key] ?? [];
}

// Snap a requested parameter onto a value the selected model actually offers.
export function fitParam(value, options, fallback) {
  if (!Array.isArray(options) || options.length === 0) return fallback ?? null;
  if (value === null || value === undefined) return fallback ?? options[0];
  const text = String(value);
  if (options.some((option) => String(option) === text)) return text;
  const lowered = text.toLowerCase();
  const match = options.find((option) => String(option).toLowerCase() === lowered);
  if (match !== undefined) return match;
  return fallback ?? options[0];
}

// Node tools: transformations applied to a node's own output.
//
// `status: 'ready'` tools can be executed; `pending` ones are shown but
// disabled and labelled 「（待接入）」 so the capability surface stays honest
// instead of silently hiding what is missing.
//
// `run: 'local'` tools are pure browser work (no model, no network).
// `run: 'agent'` tools create a child node whose prompt is the tool template
// and whose references include the source node, then run the Agent on it.
export const TOOLS = [
  {
    key: 'gridSplit',
    label: '宫格切分',
    desc: '把一张图切成 N×M 块，每块变成一个新节点',
    kind: 'image',
    status: 'ready',
    run: 'local',
    needs: 'image',
    produces: { node: 'image', artifact: '切分出的每一块图片' },
    requires: ['图片素材'],
    params: [
      { key: 'rows', label: '行', type: 'number', default: 3, min: 1, max: 8 },
      { key: 'cols', label: '列', type: 'number', default: 3, min: 1, max: 8 },
    ],
  },
  {
    key: 'crop',
    label: '剪裁',
    desc: '在图上拖出要保留的区域',
    kind: 'image',
    status: 'ready',
    run: 'local',
    needs: 'image',
    produces: { node: 'image', artifact: '剪裁后的图片' },
    requires: ['图片素材'],
    params: [],
  },
  {
    key: 'multiAngle',
    label: '多角度',
    desc: '基于这张图生成不同机位的版本',
    kind: 'image',
    status: 'ready',
    run: 'agent',
    needs: 'image',
    produces: { node: 'image', artifact: '新机位的图片' },
    requires: ['图片素材', '生成能力'],
    prompt: '以参考图中的主体为唯一依据，生成同一主体的其他机位版本，保持主体特征、材质与配色一致。',
    params: [
      {
        key: 'angles',
        label: '角度',
        type: 'multi',
        options: ['正面', '左前 45°', '右前 45°', '侧面', '背面', '俯视', '特写'],
        default: ['左前 45°', '右前 45°'],
      },
    ],
  },
  {
    key: 'lighting',
    label: '打光',
    desc: '给这张图换一种光线氛围',
    kind: 'image',
    status: 'ready',
    run: 'agent',
    needs: 'image',
    produces: { node: 'image', artifact: '换过光线的图片' },
    requires: ['图片素材', '生成能力'],
    prompt: '保持参考图的主体、构图与背景完全不变，只改变光线氛围与明暗层次。',
    params: [
      {
        key: 'style',
        label: '光线',
        type: 'select',
        options: ['自然光', '柔和棚拍', '硬光侧逆', '轮廓光', '伦勃朗光', '霓虹夜色'],
        default: '柔和棚拍',
      },
    ],
  },
  // The video-side tools follow the derivation pattern of the reference
  // product: a tool consumes an upstream asset and produces a new node.
  //
  //   produces  what the tool leaves behind (node kind + artifact)
  //   requires  what it needs before it can run
  //   pendingReason what is missing in this build — shown instead of a bare
  //             "not wired yet", so the panel says why.
  {
    key: 'deconstruct',
    label: '视频拆解',
    desc: '把视频拆成镜头脚本',
    kind: 'video',
    status: 'ready',
    run: 'understand',
    needs: 'video',
    produces: { node: 'text', artifact: '镜头脚本文本' },
    requires: ['视频素材 URL', '视频理解能力（connector__matrix__videos_understand）'],
    note: '走连接器的视频理解能力，直接产出结构化镜头表。素材会先由 Node 服务下载并上传，provider 才读得到。',
    prompt: '分析这个视频的镜头脚本：逐镜给出时间码、景别、运镜、主体动作与台词，输出为结构化镜头表。',
    params: [],
  },
  {
    key: 'viral',
    label: '爆款分析',
    desc: '分析视频的爆点结构',
    kind: 'video',
    status: 'ready',
    run: 'understand',
    needs: 'video',
    produces: { node: 'text', artifact: '爆点结构分析' },
    requires: ['视频素材 URL', '视频理解能力（connector__matrix__videos_understand）'],
    note: '走连接器的视频理解能力，直接产出结构化分析。素材会先由 Node 服务下载并上传，provider 才读得到。',
    prompt: '分析这个视频为什么会火：拆出开头钩子、情绪起伏、信息密度、节奏与可复用的结构模板，输出为可执行的改写建议。',
    params: [],
  },
  {
    key: 'frame',
    label: '抽帧',
    desc: '抽取首帧 / 尾帧',
    kind: 'video',
    status: 'ready',
    run: 'ffmpeg',
    needs: 'video',
    produces: { node: 'image', artifact: '抽取出的帧图片' },
    requires: ['视频素材', '本机 ffmpeg'],
    note: '本机 ffmpeg 解码取帧，产出一个图片节点。',
    params: [
      { key: 'position', label: '位置', type: 'select', options: ['首帧', '尾帧'], default: '首帧' },
    ],
  },
  {
    key: 'frameGrid',
    label: '宫格抽帧',
    desc: '按宫格抽取多帧',
    kind: 'video',
    status: 'ready',
    run: 'ffmpeg',
    needs: 'video',
    produces: { node: 'image', artifact: '拼成一张的宫格缩略图' },
    requires: ['视频素材', '本机 ffmpeg'],
    note: '本机 ffmpeg 均匀取帧拼成宫格，产出一张图片节点。',
    params: [
      { key: 'count', label: '格数', type: 'number', default: 9, min: 2, max: 25 },
    ],
  },
  {
    key: 'trim',
    label: '片段剪辑',
    desc: '裁出一段时间',
    kind: 'video',
    status: 'ready',
    run: 'ffmpeg',
    needs: 'video',
    produces: { node: 'video', artifact: '剪辑后的视频片段' },
    requires: ['视频素材', '本机 ffmpeg'],
    note: '本机 ffmpeg 截取时间段，产出一个视频节点。',
    params: [
      { key: 'start', label: '起点（秒）', type: 'number', default: 0, min: 0 },
      { key: 'end', label: '终点（秒）', type: 'number', default: 5, min: 0.2 },
    ],
  },
  {
    key: 'cropVideo',
    label: '视频剪裁',
    desc: '按画幅裁掉画面的一部分',
    kind: 'video',
    status: 'ready',
    run: 'ffmpeg',
    needs: 'video',
    produces: { node: 'video', artifact: '裁剪画幅后的视频' },
    requires: ['视频素材', '本机 ffmpeg'],
    note: '本机 ffmpeg 居中裁到目标画幅，产出一个视频节点。',
    params: [
      {
        key: 'target',
        label: '画幅',
        type: 'select',
        options: ['9:16', '16:9', '1:1', '4:3', '3:4'],
        default: '9:16',
      },
    ],
  },
  {
    key: 'autoSegment',
    label: '自动分段',
    desc: '按镜头切分视频',
    kind: 'video',
    status: 'ready',
    run: 'ffmpeg',
    needs: 'video',
    produces: { node: 'video', artifact: '切分出的多个视频片段' },
    requires: ['视频素材', '本机 ffmpeg'],
    note: '本机 ffmpeg 检测镜头切换点，产出多个视频节点。',
    params: [
      { key: 'threshold', label: '切分灵敏度', type: 'number', default: 0.3, min: 0.05, max: 0.9 },
    ],
  },
  {
    key: 'splitAv',
    label: '音画分离',
    desc: '分离视频与音轨',
    kind: 'video',
    status: 'ready',
    run: 'ffmpeg',
    needs: 'video',
    produces: { node: 'video', artifact: '分离出的无声视频与音轨' },
    requires: ['视频素材', '本机 ffmpeg'],
    note: '本机 ffmpeg 拆出无声视频与独立音轨，两个节点。',
    params: [],
  },
  {
    key: 'merge',
    label: '合并视频',
    desc: '把多个视频合成一个',
    kind: 'video',
    status: 'ready',
    run: 'ffmpeg',
    needs: 'video',
    produces: { node: 'video', artifact: '合并后的视频' },
    requires: ['至少两个上游视频节点', '本机 ffmpeg'],
    note: '本机 ffmpeg 按连接顺序拼接上游视频，产出一个视频节点。',
    params: [],
  },
  {
    key: 'eraseSubtitle',
    label: '字幕擦除',
    desc: '擦掉画面上的字幕条',
    kind: 'video',
    status: 'ready',
    run: 'ffmpeg',
    needs: 'video',
    produces: { node: 'video', artifact: '擦除字幕后的视频' },
    requires: ['视频素材', '本机 ffmpeg'],
    note: '本机 ffmpeg 把字幕那条横带用周边像素填掉。',
    params: [
      { key: 'position', label: '位置', type: 'select', options: ['底部', '顶部'], default: '底部' },
      { key: 'band', label: '带宽', type: 'number', default: 0.12, min: 0.04, max: 0.4 },
    ],
  },
  {
    key: 'removeWatermark',
    label: '视频去水印',
    desc: '擦掉画面上的角标 / 水印',
    kind: 'video',
    status: 'ready',
    run: 'ffmpeg',
    needs: 'video',
    produces: { node: 'video', artifact: '去水印后的视频' },
    requires: ['视频素材', '本机 ffmpeg'],
    note: '本机 ffmpeg 把指定矩形区域用周边像素填掉。',
    params: [
      { key: 'x', label: '左', type: 'number', default: 0, min: 0 },
      { key: 'y', label: '上', type: 'number', default: 0, min: 0 },
      { key: 'w', label: '宽', type: 'number', default: 200, min: 8 },
      { key: 'h', label: '高', type: 'number', default: 80, min: 8 },
    ],
  },
  {
    key: 'removeBg',
    label: '背景移除',
    desc: '把纯色背景抠成透明',
    kind: 'video',
    status: 'ready',
    run: 'ffmpeg',
    needs: 'video',
    produces: { node: 'video', artifact: '透明背景的视频' },
    requires: ['视频素材', '本机 ffmpeg'],
    note: '本机 ffmpeg 抠掉纯色背景，产出带透明通道的 webm。',
    params: [
      {
        key: 'color',
        label: '背景色',
        type: 'select',
        options: ['green', 'blue', 'cyan', 'red', 'white', 'black'],
        default: 'green',
      },
      { key: 'similarity', label: '容差', type: 'number', default: 0.22, min: 0.01, max: 1 },
    ],
  },
  {
    key: 'cutout',
    label: '智能抠图',
    desc: '把纯色背景抠成透明',
    kind: 'image',
    status: 'ready',
    run: 'ffmpeg',
    needs: 'image',
    produces: { node: 'image', artifact: '透明底的图片' },
    requires: ['图片素材', '本机 ffmpeg'],
    note: '本机 ffmpeg 按背景色抠图，适合白底 / 绿底棚拍图。',
    params: [
      {
        key: 'color',
        label: '背景色',
        type: 'select',
        options: ['white', 'green', 'blue', 'black'],
        default: 'white',
      },
      { key: 'similarity', label: '容差', type: 'number', default: 0.14, min: 0.01, max: 1 },
    ],
  },
  {
    key: 'enhance',
    label: '变清晰',
    desc: '放大 + 锐化 + 降噪',
    kind: 'image',
    status: 'ready',
    run: 'ffmpeg',
    needs: 'image',
    produces: { node: 'image', artifact: '放大锐化后的图片' },
    requires: ['图片素材', '本机 ffmpeg'],
    note: '本机 ffmpeg 用 Lanczos 放大后锐化降噪。',
    params: [
      { key: 'scale', label: '放大倍数', type: 'number', default: 2, min: 1, max: 4 },
      { key: 'sharp', label: '锐化强度', type: 'number', default: 1.4, min: 0, max: 5 },
    ],
  },
  {
    key: 'resize',
    label: '无损改尺寸',
    desc: '改尺寸不裁内容',
    kind: 'image',
    status: 'ready',
    run: 'ffmpeg',
    needs: 'image',
    produces: { node: 'image', artifact: '新尺寸的图片' },
    requires: ['图片素材', '本机 ffmpeg'],
    note: '本机 ffmpeg 缩放并补边，内容不会被裁掉。',
    params: [
      { key: 'width', label: '宽', type: 'number', default: 1080, min: 16, max: 8192 },
      { key: 'height', label: '高', type: 'number', default: 1080, min: 16, max: 8192 },
      { key: 'mode', label: '方式', type: 'select', options: ['fit', 'fill', 'stretch'], default: 'fit' },
    ],
  },
  {
    key: 'idPhoto',
    label: '证件照',
    desc: '按证件规格裁切铺底',
    kind: 'image',
    status: 'ready',
    run: 'ffmpeg',
    needs: 'image',
    produces: { node: 'image', artifact: '证件照' },
    requires: ['图片素材', '本机 ffmpeg'],
    note: '本机 ffmpeg 按证件尺寸裁切并铺白底。',
    params: [
      {
        key: 'preset',
        label: '规格',
        type: 'select',
        options: ['一寸', '小一寸', '大一寸', '二寸', '小二寸', '大二寸', '签证', '护照'],
        default: '一寸',
      },
    ],
  },
];

export function toolsFor(kind) {
  return TOOLS.filter((tool) => tool.kind === kind);
}

export function findTool(key) {
  return TOOLS.find((tool) => tool.key === key) ?? null;
}

// The palette below is the single source the page renders from.
export function palette() {
  return {
    nodeTypes: NODE_TYPES,
    // The node table itself, so the page renders the same forms the runtime
    // knows about.
    nodeForms: NODE_FORMS,
    dataKinds: DATA_KINDS,
    nodeRoles: NODE_ROLES,
    sizes: NODE_SIZE,
    modes: CAPABILITIES,
    // The limits of every model, already resolved. The page renders the
    // parameter row from this, so the rule that a model only offers a
    // resolution for some durations lives in one place: the runtime
    // enforces it, the page shows it.
    modesByModel: Object.fromEntries(
      MODES.map((mode) => [
        mode,
        Object.fromEntries(
          (CAPABILITIES[mode]?.models ?? []).map((model) => [model.id, resolveLimits(mode, model.id)]),
        ),
      ]),
    ),
    templates: TEMPLATES,
    connectorTools: CONNECTOR_TOOLS,
    tools: TOOLS,
    // What each kind of upstream can feed, so the page can offer the node
    // types that actually fit.
    upstreamAccepts: UPSTREAM_ACCEPTS,
    // The prompt templates the prompt node offers.
    promptTemplates: PROMPT_TEMPLATES,
    inputKindLabels: INPUT_KIND_LABEL,
  };
}
