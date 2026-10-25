// The workflows that are ready to use.
//
// A template is a **skeleton**: the steps, the lines between them, the
// prompts and the parameters — and nothing of what a run leaves behind. A
// template that carried results and uploaded material would hand the next
// person a canvas full of somebody else's files, so the skeleton keeps the
// steps and drops the现场.
//
// A template is a list of **actions**, the same actions the Agent asks for
// and the page performs. So a template is applied by performing them, and
// the rules that place a node, carry a line or refuse one are the same rules
// either way.
//
// The nodes a template creates are named by their order: `@1` is the first
// node the template makes, `@2` the second, and the lines point at those
// names. The real ids are handed out when the template is applied, so the
// same template can be applied twice on one canvas.
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The templates that ship with the MiniApp. */
export const BUILTIN_TEMPLATES = [
  {
    id: 'product-to-ad',
    title: '产品图 → 广告片',
    description: '先出一张产品图，再把它当首帧做成一条广告片。',
    group: '从文字出发',
    actions: [
      {
        type: 'add_node',
        args: {
          type: 'text',
          title: '产品文案',
          prompt: '一副高端头戴式耳机的产品广告图：哑光黑金属头梁搭配深棕色皮质耳罩，悬浮在深色渐变背景正中央，柔和的轮廓光从左后方勾出边缘，干净利落的棚拍质感，高端商业广告摄影，主体居中，四周留白充足',
        },
      },
      {
        type: 'add_node',
        args: {
          type: 'image',
          title: '产品图',
          mode: 'text2image',
          ratio: '16:9',
          resolution: '1K',
        },
      },
      { type: 'connect', args: { from: '@1', to: '@2' } },
      {
        type: 'add_node',
        args: {
          type: 'video',
          title: '广告片',
          mode: 'imagekey2video',
          prompt: '以参考图为第一帧：镜头缓缓向前推进并微微环绕，主体极轻微地转动，轮廓光缓慢扫过边缘，背景光晕轻轻呼吸，主体结构、材质与配色始终保持不变，高端商业广告质感',
          ratio: '16:9',
          resolution: '768P',
          duration: 6,
        },
      },
      { type: 'connect', args: { from: '@2', to: '@3' } },
    ],
  },
  {
    id: 'ecommerce-main',
    title: '电商主图',
    description: '先让提示词增强按「电商主图」的格式写好，再出一张 1:1 主图。',
    group: '从文字出发',
    actions: [
      {
        type: 'add_node',
        args: {
          type: 'text',
          title: '主图提示词',
          mode: 'prompt',
          templateId: 'ecommerce-main',
          prompt: '一副高端头戴式耳机，白色纯净背景，柔和顶光，主体居中，金属与皮质细节清晰',
        },
      },
      {
        type: 'add_node',
        args: {
          type: 'image',
          title: '主图',
          mode: 'text2image',
          ratio: '1:1',
          resolution: '1K',
        },
      },
      { type: 'connect', args: { from: '@1', to: '@2' } },
    ],
  },
  {
    id: 'short-video',
    title: '分镜 → 短片',
    description: '按「短视频分镜」的格式写好提示词，再出一条带分镜的短视频。',
    group: '从文字出发',
    actions: [
      {
        type: 'add_node',
        args: {
          type: 'text',
          title: '分镜提示词',
          mode: 'prompt',
          templateId: 'short-video',
          prompt: '一只粉色小章鱼戴着贝雷帽趴在画布前画画，镜头缓缓推进，环境安静',
        },
      },
      {
        type: 'add_node',
        args: {
          type: 'video',
          title: '短片',
          mode: 'text2video',
          ratio: '16:9',
          resolution: '768P',
          duration: 6,
        },
      },
      { type: 'connect', args: { from: '@1', to: '@2' } },
    ],
  },
  {
    id: 'batch-pictures',
    title: '批量出图',
    description: '一次出四张，四个版本并排放在画布上。',
    group: '从文字出发',
    actions: [
      {
        type: 'add_node',
        args: {
          type: 'text',
          title: '画面描述',
          prompt: '一只粉色小章鱼戴着贝雷帽，趴在画布前画画',
        },
      },
      {
        type: 'add_node',
        args: {
          type: 'image',
          title: '四张图',
          mode: 'text2image',
          ratio: '1:1',
          resolution: '1K',
          count: 4,
        },
      },
      { type: 'connect', args: { from: '@1', to: '@2' } },
    ],
  },
  {
    id: 'restyle-picture',
    title: '图生图：换个样子',
    description: '放一张原图进去，让模型在它的基础上重画。',
    group: '从素材出发',
    actions: [
      {
        type: 'add_node',
        args: {
          type: 'input',
          title: '原图',
          kind: 'image',
        },
      },
      {
        type: 'add_node',
        args: {
          type: 'image',
          title: '换个样子',
          mode: 'image2image',
          prompt: '保持主体不变，换成水彩手绘的质感，背景干净',
          ratio: '1:1',
          resolution: '1K',
        },
      },
      { type: 'connect', args: { from: '@1', to: '@2' } },
    ],
  },
  {
    id: 'image-mimic',
    title: '图片模仿',
    description: '放一张图进去，先把它的提示词反推出来，再照着重新生成一张。',
    group: '从素材出发',
    actions: [
      {
        type: 'add_node',
        args: {
          type: 'input',
          title: '参考图',
          kind: 'image',
        },
      },
      {
        type: 'add_node',
        args: {
          type: 'text',
          title: '反推提示词',
          mode: 'describe',
          prompt: '写出一段能复刻这张图的提示词：画面主体、动作与表情、镜头与构图、光线与色彩、材质与风格',
        },
      },
      { type: 'connect', args: { from: '@1', to: '@2' } },
      {
        type: 'add_node',
        args: {
          type: 'image',
          title: '复刻',
          mode: 'text2image',
          ratio: '1:1',
          resolution: '1K',
        },
      },
      { type: 'connect', args: { from: '@2', to: '@3' } },
    ],
  },
  {
    id: 'video-mimic',
    title: '视频模仿',
    description: '放一段视频进去，先把它的提示词反推出来，再照着重新生成一条。',
    group: '从素材出发',
    actions: [
      {
        type: 'add_node',
        args: {
          type: 'input',
          title: '参考视频',
          kind: 'video',
        },
      },
      {
        type: 'add_node',
        args: {
          type: 'text',
          title: '反推提示词',
          mode: 'video2text',
          prompt: '写出能复刻这条视频的提示词：镜头顺序与运镜、主体动作、环境与光线、节奏与时长',
        },
      },
      { type: 'connect', args: { from: '@1', to: '@2' } },
      {
        type: 'add_node',
        args: {
          type: 'video',
          title: '复刻',
          mode: 'text2video',
          ratio: '16:9',
          resolution: '768P',
          duration: 6,
        },
      },
      { type: 'connect', args: { from: '@2', to: '@3' } },
    ],
  },
  {
    id: 'video-to-prompt',
    title: '视频 → 提示词',
    description: '把一段视频读回来，写出能复刻它的提示词。',
    group: '读回提示词',
    actions: [
      {
        type: 'add_node',
        args: {
          type: 'input',
          title: '参考视频',
          kind: 'video',
        },
      },
      {
        type: 'add_node',
        args: {
          type: 'text',
          title: '还原提示词',
          mode: 'video2text',
        },
      },
      { type: 'connect', args: { from: '@1', to: '@2' } },
    ],
  },
  {
    id: 'h3-t2va',
    title: 'H3 · 文生视频',
    description: '让提示词增强按 H3 的 T2VA 结构写好，再出一条视频。',
    group: 'H3',
    actions: [
      {
        type: 'add_node',
        args: {
          type: 'text',
          title: 'H3 提示词',
          mode: 'prompt',
          templateId: 'h3-t2va',
          prompt: '一只粉色小章鱼戴着贝雷帽趴在画布前画画，镜头缓缓推进，环境安静',
        },
      },
      {
        type: 'add_node',
        args: {
          type: 'video',
          title: '成片',
          mode: 'text2video',
          model: 'MiniMax-H3',
          ratio: '16:9',
          resolution: '768P',
          duration: 6,
        },
      },
      { type: 'connect', args: { from: '@1', to: '@2' } },
    ],
  },
  {
    id: 'h3-i2va',
    title: 'H3 · 首帧图生视频',
    description: '一张图当首帧，提示词按 H3 的 I2VA 结构写。',
    group: 'H3',
    actions: [
      {
        type: 'add_node',
        args: {
          type: 'input',
          title: '首帧图',
          kind: 'image',
        },
      },
      {
        type: 'add_node',
        args: {
          type: 'text',
          title: 'H3 提示词',
          mode: 'prompt',
          templateId: 'h3-i2va',
          prompt: '参考图里的主体缓缓转动，镜头轻轻向前推进，背景光晕缓慢流动',
        },
      },
      {
        type: 'add_node',
        args: {
          type: 'video',
          title: '成片',
          mode: 'imagekey2video',
          model: 'MiniMax-H3',
          ratio: '16:9',
          resolution: '768P',
          duration: 6,
        },
      },
      { type: 'connect', args: { from: '@1', to: '@3' } },
      { type: 'connect', args: { from: '@2', to: '@3' } },
    ],
  },
  {
    id: 'h3-fl2va',
    title: 'H3 · 首尾帧图生视频',
    description: '首帧和尾帧各一张，提示词按 H3 的 FL2VA 结构写。',
    group: 'H3',
    actions: [
      {
        type: 'add_node',
        args: {
          type: 'input',
          title: '首帧图',
          kind: 'image',
        },
      },
      {
        type: 'add_node',
        args: {
          type: 'input',
          title: '尾帧图',
          kind: 'image',
        },
      },
      {
        type: 'add_node',
        args: {
          type: 'text',
          title: 'H3 提示词',
          mode: 'prompt',
          templateId: 'h3-fl2va',
          prompt: '从首帧到尾帧，主体缓缓转身，镜头横向平移，光线由冷转暖',
        },
      },
      {
        type: 'add_node',
        args: {
          type: 'video',
          title: '成片',
          mode: 'imagefl2video',
          model: 'MiniMax-H3',
          ratio: '16:9',
          resolution: '768P',
          duration: 6,
        },
      },
      { type: 'connect', args: { from: '@1', to: '@4' } },
      { type: 'connect', args: { from: '@2', to: '@4' } },
      { type: 'connect', args: { from: '@3', to: '@4' } },
    ],
  },
  {
    id: 'h3-l2va',
    title: 'H3 · 末帧图生视频',
    description: '一张图当尾帧，提示词按 H3 的 L2VA 结构写。',
    group: 'H3',
    actions: [
      {
        type: 'add_node',
        args: {
          type: 'input',
          title: '尾帧图',
          kind: 'image',
        },
      },
      {
        type: 'add_node',
        args: {
          type: 'text',
          title: 'H3 提示词',
          mode: 'prompt',
          templateId: 'h3-l2va',
          prompt: '镜头缓缓拉远，主体在画面中央停住，背景渐渐暗下来',
        },
      },
      {
        type: 'add_node',
        args: {
          type: 'video',
          title: '成片',
          mode: 'imageend2video',
          model: 'MiniMax-H3',
          ratio: '16:9',
          resolution: '768P',
          duration: 6,
        },
      },
      { type: 'connect', args: { from: '@1', to: '@3' } },
      { type: 'connect', args: { from: '@2', to: '@3' } },
    ],
  },
  {
    id: 'h3-reference',
    title: 'H3 · 全参考图生视频',
    description: '把图当参考交给 H3，提示词按它的全参考格式写。',
    group: 'H3',
    actions: [
      {
        type: 'add_node',
        args: {
          type: 'input',
          title: '参考图',
          kind: 'image',
        },
      },
      {
        type: 'add_node',
        args: {
          type: 'text',
          title: 'H3 提示词',
          mode: 'prompt',
          templateId: 'h3-reference',
          prompt: '参考图里的主体在原地做一个轻微的动作，镜头保持不动',
        },
      },
      {
        type: 'add_node',
        args: {
          type: 'video',
          title: '成片',
          mode: 'image2video',
          model: 'MiniMax-H3',
          ratio: '16:9',
          resolution: '768P',
          duration: 6,
        },
      },
      { type: 'connect', args: { from: '@1', to: '@3' } },
      { type: 'connect', args: { from: '@2', to: '@3' } },
    ],
  },
];

/**
 * The templates a machine carries of its own.
 *
 * They live under the runtime's own data directory, not in the package: a
 * template is the user's own, and it survives a new version of the MiniApp.
 */
export function templatesDir(dataDir) {
  return join(dataDir, 'templates');
}

/**
 * Keep a template of the user's own.
 *
 * It lives under the runtime's own data directory, not in the package: a
 * template is the user's own, and it survives a new version of the MiniApp.
 */
export async function saveTemplate(dataDir, template) {
  const dir = templatesDir(dataDir);
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${template.id}.json`);
  await writeFile(file, `${JSON.stringify(template, null, 2)}\n`, 'utf8');
  return file;
}

/** The built-in templates and the user's own, one list. */
export async function readTemplates(dataDir) {  const own = [];
  try {
    for (const entry of await readdir(templatesDir(dataDir))) {
      if (!entry.endsWith('.json')) continue;
      try {
        const parsed = JSON.parse(await readFile(join(templatesDir(dataDir), entry), 'utf8'));
        if (!parsed?.id || !Array.isArray(parsed.actions)) continue;
        own.push({ ...parsed, own: true });
      } catch {
        // A template that cannot be read is one that is not there.
      }
    }
  } catch {
    // No folder yet: there are no templates of the user's own.
  }
  return [...BUILTIN_TEMPLATES.map((item) => ({ ...item, own: false })), ...own];
}

/**
 * Take a template of the user's own away.
 *
 * The id is the name of the file under the template folder, so it is judged as
 * a plain name: a request cannot walk out of the folder it belongs to, and it
 * cannot take a built-in template away either — those are not in this folder.
 */
export async function removeTemplate(dataDir, id) {
  const name = String(id ?? '').trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(name) || name === '.' || name === '..') return false;
  const file = join(templatesDir(dataDir), `${name}.json`);
  try {
    await stat(file);
  } catch {
    return false;
  }
  try {
    await rm(file, { force: true });
    return true;
  } catch {
    return false;
  }
}
