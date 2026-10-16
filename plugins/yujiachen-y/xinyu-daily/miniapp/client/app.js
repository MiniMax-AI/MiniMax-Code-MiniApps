// 心屿 Client：游戏化外观与交互。所有数据读写只走 Node 服务的 /api/*。

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, reduceMotion() ? 0 : ms));
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const NO_BLIP = /[\s，。！？、…～：；「」,.!?~（）()]/;

// ---------- copy ----------
const MOODS = { 1: '很糟', 2: '低落', 3: '平稳', 4: '不错', 5: '很棒' };
const MOUTH = {
  1: 'M13 28.5 Q20 23.5 27 28.5',
  2: 'M14 27.5 Q20 25.2 26 27.5',
  3: 'M14.5 26.5 H25.5',
  4: 'M13.5 25 Q20 30 26.5 25',
  5: 'M13 24 Q20 33 27 24 Z',
};
const MASCOT_MOUTH = {
  1: 'M43 64 Q50 59 57 64',
  2: 'M44 63 Q50 61 56 63',
  3: 'M44.5 62 H55.5',
  4: 'M43.5 60 Q50 66 56.5 60',
  5: 'M43 59.5 Q50 69 57 59.5 Z',
};
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const CN_NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const PRESET = ['米饭套餐', '牛肉面', '麻辣烫', '轻食沙拉', '饺子', '汉堡'];
const QUIZ_KEYS = ['dawn', 'ocean', 'forest', 'spark'];
const STYLE_META = {
  dawn: { name: '晨光型', a: '#ffcf5c', b: '#ff9f43' },
  ocean: { name: '深海型', a: '#4fb0f0', b: '#2a78c8' },
  forest: { name: '森林型', a: '#66c46b', b: '#2a9d8f' },
  spark: { name: '星火型', a: '#ff7a59', b: '#ff5d8f' },
};
const REACTS = ['原来是', '嗯嗯，', '好有意思，', '我懂了，', '哇，'];
const ISLAND_ITEMS = [
  { key: 'flowers', need: 1, name: '一片小花' },
  { key: 'tree', need: 3, name: '一棵树' },
  { key: 'house', need: 5, name: '一间小屋' },
  { key: 'lighthouse', need: 7, name: '一座灯塔' },
  { key: 'windmill', need: 9, name: '一架风车' },
  { key: 'rainbow', need: 12, name: '一道彩虹' },
];
const IDLE_LINES = [
  '今天也辛苦啦，记得喝水哦。',
  '我在岛上晒太阳，你也歇一会儿吧。',
  '要不要去「粉碎机」解决一个小纠结？',
  '小确幸罐子里，今天放了几颗星星？',
  '偷偷告诉你：戳戳天上的东西，会有惊喜。',
  '你今天的样子，我都记下啦。',
];
const POKE_LINES = ['嘿嘿，好痒～', '你戳我干嘛呀', '我在呢！', '再戳我就要飘走啦', '摸摸头～', '今天也要开心呀', '诶嘿！'];
const WAKE_LINES = ['唔……我没睡！我在想事情！', '啊！被你发现了……', '嘿嘿，刚才做了个好梦。'];
const COMFORT_LINES = ['抱抱你，今天辛苦了。', '不开心的时候，就在岛上歇一会儿吧。', '我会一直在这里陪着你。'];
const WISH_LINES = ['愿望收到啦，我替你保管好。', '流星说：这个愿望它记住了。', '嘘——说出来就不灵了。'];
const POSTCARDS = [
  '远方的朋友说：今天的晚霞很好看，分你一半。',
  '有人托热气球带话：你比自己想象的更厉害。',
  '明信片上写着：记得按时吃饭，别总凑合。',
  '一张来自海边的明信片：浪花说它想你了。',
  '明信片上画着一只猫，旁边写着：今天适合发呆。',
  '风把这句话吹了过来：慢慢来，也会到达的。',
  '明信片背面写着：今天也被谁悄悄喜欢着。',
  '一张来自山顶的明信片：站高一点，烦恼就小一点。',
];
const MS_LINES = {
  3: '三天了！小火苗已经稳稳地烧起来啦。',
  7: '整整一周！你已经养成了一个温柔的小习惯。',
  14: '两周了，小屿每天都很期待见到你。',
  21: '二十一天，听说这是一个习惯真正扎根的时间。',
  30: '一个月！这座小岛记住了你的每一天。',
};
const BURST_COLORS = ['#ff7a59', '#ffc24b', '#ffe066', '#5fc46b', '#4fb0f0', '#2fb5a5', '#ff7f9e'];
const STAR_COLORS = ['#ffd166', '#ff9f80', '#8fd8c9', '#ffb3c6', '#9fd4ff', '#ffe08a'];
const TAPES = ['#ffd166', '#a0e7e5', '#ffaebc', '#b4f8c8', '#ffc9a8'];
const MILESTONES = [3, 7, 14, 21, 30, 50, 100, 200, 365];
const WEATHER = ['sunny', 'breeze', 'rain', 'snow', 'rainbow'];
const SEASON = ['spring', 'summer', 'autumn', 'winter'];
const PROPS = ['beach', 'tent', 'lamp', 'sofa', 'cafe'];
const ABOUT_REACT = {
  weather: ['看，小岛出太阳啦！', '小岛吹起了微风～', '小岛下起了小雨，我去撑把伞。', '小岛开始飘雪了！我围上了围巾。', '小岛上空挂起了彩虹！'],
  season: ['岛上的小树开花啦！', '岛上的小树绿油油的！', '岛上的小树换上了秋天的颜色！', '岛上的小树戴上了雪帽子！'],
  weekend: ['我在岛上撑了把遮阳伞！', '我在岛上搭了个小帐篷！', '岛上亮起了一盏路灯！', '我给岛上搬了张小沙发！', '岛上开了一家迷你咖啡馆！'],
};
const PROP_LINES = {
  beach: '在遮阳伞下吹吹风，真舒服～',
  tent: '今晚就在帐篷里数星星！',
  lamp: '路灯亮着，回家的路就不黑了。',
  sofa: '小猫占了我的沙发……算了，让给它。',
  cafe: '请你喝一杯，不加糖。',
};
const TREE_LINES = {
  spring: '花瓣落了一地，好香呀。',
  summer: '掉下来几个小果子！',
  autumn: '叶子沙沙地落下来了。',
  winter: '树上的雪抖下来啦！',
};
const SEASON_FALL = {
  spring: ['#ffc2d1', '#ff9fb8', '#ffe3ea'],
  summer: ['#ff6b5e', '#5fc46b', '#ffd166'],
  autumn: ['#f4a259', '#e8873a', '#ffd08a'],
  winter: ['#ffffff', '#e8f4ff', '#cfe8ff'],
};

// ---------- secrets / quests / regions ----------
const SECRETS = [
  { id: 'poke', name: '戳戳小屿', hint: '小屿看起来软软的，好想戳一下。', desc: '原来小屿很怕痒。' },
  { id: 'backflip', name: '后空翻', hint: '飞快地连戳两下，会发生什么？', desc: '小屿表演了后空翻！' },
  { id: 'dizzy', name: '转晕啦', hint: '一直戳、一直戳、一直戳……', desc: '小屿被戳得晕乎乎。' },
  { id: 'wake', name: '叫醒瞌睡虫', hint: '安静地待一会儿，小屿可能会打瞌睡。', desc: '把打瞌睡的小屿叫醒了。' },
  { id: 'sun', name: '太阳墨镜', hint: '白天的太阳，好像很怕晒。', desc: '太阳戴上了墨镜。' },
  { id: 'moon', name: '月亮眨眼', hint: '夜里的月亮，其实是在装睡。', desc: '月亮对你眨了眨眼。' },
  { id: 'cloud', name: '捏捏云朵', hint: '天上的云，捏起来是什么手感？', desc: '云朵被捏出了一阵小雨。' },
  { id: 'tree', name: '摇一摇树', hint: '岛上长出树以后，去摇一摇。', desc: '树上掉下来好多东西。' },
  { id: 'house', name: '小屋的灯', hint: '小屋的窗户，能不能开灯？', desc: '小屋暖暖地亮了。' },
  { id: 'flower', name: '摸摸小花', hint: '花开了以后，去摸摸它们。', desc: '小花开心地蹦了一下。' },
  { id: 'lighthouse', name: '灯塔的问候', hint: '灯塔也想和你打个招呼。', desc: '灯塔闪了一下光。' },
  { id: 'windmill', name: '风车加速', hint: '风车还能转得更快吗？', desc: '风车呼呼地转起来了。' },
  { id: 'prop', name: '周末摆件', hint: '告诉小屿理想的周末，岛上会多出点什么。', desc: '和岛上的摆件玩了一会儿。' },
  { id: 'meteor', name: '流星许愿', hint: '夜空里，偶尔有东西一闪而过。', desc: '对着流星许了一个愿。' },
  { id: 'balloon', name: '远方来信', hint: '白天偶尔会有访客从天上飘过。', desc: '收到了热气球的明信片。' },
  { id: 'jar', name: '罐子里的回忆', hint: '小确幸罐子，好像可以摇一摇。', desc: '从罐子里翻出了一段回忆。' },
  { id: 'lever', name: '亲手拉杆', hint: '老虎机旁边，有一根小把手。', desc: '亲手拉动了老虎机。' },
  { id: 'shiny', name: '闪光的卡', hint: '据说极少数灵感卡会闪闪发光。', desc: '抽到了一张闪卡！' },
  { id: 'cake', name: '生日蛋糕', hint: '只在一年里特别的那一天出现。', desc: '吹灭了生日蜡烛。' },
];
const BULLY_LINES = [
  '哼！算你厉害……<br>这枚贝壳归你了！',
  '什么？！这都被你<br>找到了？拿去拿去！',
  '可恶！本岛霸的秘密……<br>贝壳给你，别声张！',
  '哼哼，运气不错嘛。<br>下一个你可找不到！',
  '本岛霸横行这么多年……<br>今天栽在你手里了！',
];
const SECRET_MAP = Object.fromEntries(SECRETS.map((x) => [x.id, x]));
const REGIONS = {
  today: ['初醒之岛', '一切开始的地方'],
  journal: ['回忆小屋', '这里收着你走过的每一天'],
  decide: ['命运游乐场', '把纠结交给一点点运气'],
  explore: ['未知之境', '关于你，还有很多没被发现'],
};
const QUESTS = [
  { id: 'card', icon: 'cards', title: '翻开今日灵感卡', sub: '先陪小屿聊三句' },
  { id: 'mood', icon: 'heart', title: '贴一张心情贴纸', sub: '今天是哪一张？' },
  { id: 'joy', icon: 'star5', title: '往罐子里放颗星星', sub: '记一件小确幸' },
  { id: 'secret', icon: 'shell', title: '找到一个小秘密', sub: '戳戳岛上的东西' },
];
const HINT_POS = { poke: [322, 112], tree: [240, 108], house: [386, 122], flower: [444, 182], lighthouse: [476, 94], windmill: [178, 102], prop: [374, 158], cake: [200, 174] };
const BULLY = '<svg viewBox="0 0 80 64" aria-hidden="true"><path d="M14 30 C4 26 2 14 10 8 C12 16 16 18 22 18 Z" fill="#ff7a59"/><path d="M66 30 C76 26 78 14 70 8 C68 16 64 18 58 18 Z" fill="#ff7a59"/><path d="M10 8 C6 4 8 0 13 2 C12 5 12 6 13 8 Z" fill="#ff7a59"/><path d="M70 8 C74 4 72 0 67 2 C68 5 68 6 67 8 Z" fill="#ff7a59"/><path d="M18 52 l-8 8 M24 55 l-5 8 M62 52 l8 8 M56 55 l5 8" stroke="#e0583a" stroke-width="3.4" stroke-linecap="round"/><ellipse cx="40" cy="42" rx="25" ry="17" fill="#ff8a66"/><ellipse cx="40" cy="46" rx="18" ry="9" fill="#ffb59a" opacity=".55"/><path d="M33 26 V18 M47 26 V18" stroke="#e0583a" stroke-width="3" stroke-linecap="round"/><circle cx="33" cy="16" r="5" fill="#fff"/><circle cx="47" cy="16" r="5" fill="#fff"/><circle cx="34" cy="17" r="2.4" fill="#3f342c"/><circle cx="46" cy="17" r="2.4" fill="#3f342c"/><path d="M27 10 L38 13 M53 10 L42 13" stroke="#3f342c" stroke-width="2.6" stroke-linecap="round"/><path d="M34 44 Q40 40 46 44" fill="none" stroke="#3f342c" stroke-width="2.4" stroke-linecap="round"/><path d="M28 30 L31 23 L35 28 L40 21 L45 28 L49 23 L52 30 Z" fill="#ffd166" stroke="#e3a024" stroke-width="1.4" stroke-linejoin="round"/></svg>';

// ---------- icons ----------
const S = 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"';
const sv = (body, vb = '0 0 24 24') => `<svg viewBox="${vb}" aria-hidden="true">${body}</svg>`;
const ICON = {
  island: sv(`<path d="M3.5 13.5h17c-1 3.6-4.2 5.8-8.5 6.6-4.3-.8-7.5-3-8.5-6.6Z" ${S}/><path d="M12 13.5V6.2M12 6.2c1.4-2.2 4-2.8 6-1.6-2 .4-4 1.1-6 1.6Zm0 0C10.6 4 8 3.4 6 4.6c2 .4 4 1.1 6 1.6Z" ${S}/>`),
  book: sv(`<path d="M12 6.5C10 5 7.2 4.6 4 5v13c3.2-.4 6 0 8 1.5 2-1.5 4.8-1.9 8-1.5V5c-3.2-.4-6 0-8 1.5Zm0 0v13" ${S}/>`),
  dice: sv(`<rect x="4" y="4" width="16" height="16" rx="4.5" ${S}/><circle cx="8.7" cy="8.7" r="1.5" fill="currentColor"/><circle cx="15.3" cy="15.3" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="15.3" cy="8.7" r="1.5" fill="currentColor"/><circle cx="8.7" cy="15.3" r="1.5" fill="currentColor"/>`),
  compass: sv(`<circle cx="12" cy="12" r="8.6" ${S}/><path d="m15.6 8.4-2.3 4.9-4.9 2.3 2.3-4.9Z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>`),
  gear: sv(`<circle cx="12" cy="12" r="3" ${S}/><path d="M12 2.8v2.4M12 18.8v2.4M4.2 7.5l2.1 1.2M17.7 15.3l2.1 1.2M4.2 16.5l2.1-1.2M17.7 8.7l2.1-1.2" ${S}/><circle cx="12" cy="12" r="7" ${S}/>`),
  xmark: sv(`<path d="m7 7 10 10M17 7 7 17" ${S}/>`),
  chevL: sv(`<path d="m14.5 6-6 6 6 6" ${S}/>`),
  chevR: sv(`<path d="m9.5 6 6 6-6 6" ${S}/>`),
  check: sv(`<path d="m5.5 12.5 4.2 4.2 8.8-9.4" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>`),
  exclaim: sv(`<path d="M12 6.5v7" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/><circle cx="12" cy="17.5" r="1.6" fill="currentColor"/>`),
  star5: sv(`<path d="m12 3.2 2.7 5.5 6 .9-4.35 4.2 1 6L12 17l-5.4 2.8 1-6L3.3 9.6l6-.9Z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>`),
  flame: sv(`<path d="M12 3c.6 3-1.6 4.6-1.6 4.6S9 6.4 9.2 4.8C6.6 6.8 5.5 9.6 5.5 12.4a6.5 6.5 0 0 0 13 0C18.5 8.2 15.2 5.4 12 3Z" fill="currentColor"/><path d="M12 12.5c.4 1.6-.8 2.4-.8 2.4s-.7-.6-.6-1.4c-1.3 1-1.8 2.4-1.8 3.4a3.2 3.2 0 0 0 6.4 0c0-2-1.6-3.6-3.2-4.4Z" fill="#ffe08a"/>`),
  heart: sv(`<path d="M12 20s-7.5-4.6-7.5-10.1A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20Z" fill="currentColor"/>`),
  stamp: sv(`<rect x="4" y="5" width="16" height="15" rx="3.5" fill="currentColor"/><path d="M8 3v4M16 3v4" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="m8.5 13 2.4 2.4 4.6-5" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`),
  cards: sv(`<rect x="7" y="3.5" width="12" height="16" rx="2.8" fill="currentColor" opacity=".45" transform="rotate(10 13 11.5)"/><rect x="5" y="4.5" width="12" height="16" rx="2.8" fill="currentColor"/>`),
  bubble: sv(`<path d="M5 5.5h14a1.6 1.6 0 0 1 1.6 1.6v8a1.6 1.6 0 0 1-1.6 1.6h-7.4L7 20v-3.3H5a1.6 1.6 0 0 1-1.6-1.6v-8A1.6 1.6 0 0 1 5 5.5Z" ${S}/>`),
  target: sv(`<circle cx="12" cy="12" r="8" ${S}/><circle cx="12" cy="12" r="3.6" ${S}/>`),
  leaf: sv(`<path d="M5 19c0-8 5-13 14-14 0 9-5 14-12 14H5Zm0 0 7-7" ${S}/>`),
  star: (on) => sv(`<path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8L12 3.6Z" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`),
  trash: sv(`<path d="M5 7h14M10 7V5.2h4V7m-7.2 0 .8 11.6a1.6 1.6 0 0 0 1.6 1.4h5.6a1.6 1.6 0 0 0 1.6-1.4L17.2 7" ${S}/>`),
  soundOn: sv(`<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4Z" ${S}/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.6 7.6 0 0 1 0 11" ${S}/>`),
  soundOff: sv(`<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4Z" ${S}/><path d="m16 9.5 5 5m0-5-5 5" ${S}/>`),
  shell: sv(`<path d="M12 4 C6 4 3 9 3.5 14 L5 18 H19 L20.5 14 C21 9 18 4 12 4Z" fill="currentColor"/><path d="M12 5.5 V17.5 M8 6.8 L9.6 17.5 M16 6.8 L14.4 17.5 M5 10.5 L7.4 17.5 M19 10.5 L16.6 17.5" stroke="#fff" stroke-width="1.2" stroke-linecap="round" opacity=".55"/><rect x="9" y="17.5" width="6" height="3" rx="1.2" fill="currentColor"/>`),
  question: sv(`<path d="M9.2 9.2a2.9 2.9 0 1 1 4.3 2.5c-.9.5-1.5 1.1-1.5 2.1v.4" ${S}/><circle cx="12" cy="17.6" r="1.3" fill="currentColor"/>`),
};
const FLOWER =
  '<svg viewBox="0 0 72 72" aria-hidden="true"><g fill="currentColor" opacity=".9"><ellipse cx="36" cy="18" rx="9" ry="13"/><ellipse cx="36" cy="46" rx="9" ry="13"/><ellipse cx="22" cy="32" rx="13" ry="9"/><ellipse cx="50" cy="32" rx="13" ry="9"/></g><circle cx="36" cy="32" r="7" fill="#ffe066"/></svg>';
const BALLOON_SVG =
  '<svg viewBox="0 0 40 56" aria-hidden="true"><path d="M20 2C8 2 2 11 2 19c0 10 10 16 13 22h10c3-6 13-12 13-22C38 11 32 2 20 2Z" fill="#ff7a59"/><path d="M20 2c-6 4-8 11-8 17 0 10 3 16 4 22h8c1-6 4-12 4-22 0-6-2-13-8-17Z" fill="#ffd166"/><path d="M20 2c-2 6-2.5 12-2.5 17 0 10 1.5 16 1.8 22h1.4c.3-6 1.8-12 1.8-22 0-5-.5-11-2.5-17Z" fill="#ff7a59"/><path d="M15 41l1 5M25 41l-1 5" stroke="#8a6a55" stroke-width="1.2"/><rect x="14.5" y="46" width="11" height="8" rx="2" fill="#a8734f"/><path d="M15 49h10" stroke="#8a5a3f" stroke-width="1"/></svg>';

// ---------- sound (WebAudio 合成，无外部资源) ----------
const sound = {
  ctx: null,
  master: null,
  unlocked: false,
  on: localStorage.getItem('xinyu.sound') !== 'off',
  ensure() {
    if (!this.on || !this.unlocked) return null;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.2;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
      return this.ctx;
    } catch {
      return null;
    }
  },
  tone(freq, { dur = 0.12, type = 'sine', vol = 0.4, when = 0, slide = 0 } = {}) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.03);
  },
  noise({ dur = 0.25, vol = 0.25, from = 800, to = 2600, when = 0, q = 0.8 } = {}) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  },
};
const arp = (freqs, gap, opts) => freqs.forEach((f, i) => sound.tone(f, { ...opts, when: i * gap }));
const sfx = {
  blip: (k = 1) => sound.tone(500 + Math.random() * 240, { dur: 0.05, type: 'triangle', vol: 0.16 * k }),
  tap: () => sound.tone(700, { dur: 0.05, type: 'triangle', vol: 0.18 }),
  pop: () => sound.tone(420, { dur: 0.11, vol: 0.42, slide: 520 }),
  boing: () => sound.tone(230, { dur: 0.26, vol: 0.38, slide: 360 }),
  soft: () => sound.tone(320, { dur: 0.14, vol: 0.3, slide: -90 }),
  tick: () => sound.tone(1500, { dur: 0.022, type: 'square', vol: 0.05 }),
  thunk: () => sound.tone(150, { dur: 0.18, vol: 0.55, slide: -60 }),
  whoosh: () => sound.noise({ dur: 0.36, vol: 0.22, from: 500, to: 2800 }),
  page: () => sound.noise({ dur: 0.3, vol: 0.16, from: 2200, to: 700, q: 0.6 }),
  shake: () => {
    for (let i = 0; i < 5; i++) sound.noise({ dur: 0.06, vol: 0.18, from: 3000, to: 3600, when: i * 0.08, q: 4 });
  },
  charge: () => sound.tone(260, { dur: 0.6, type: 'triangle', vol: 0.18, slide: 640 }),
  chime: () => arp([1318.5, 1975.5], 0.09, { dur: 0.5, type: 'triangle', vol: 0.2 }),
  sparkle: () => arp([1046.5, 1318.5, 1568, 2093], 0.06, { dur: 0.35, type: 'triangle', vol: 0.16 }),
  fanfare: () => arp([523.25, 659.25, 783.99, 1046.5, 1318.5], 0.09, { dur: 0.3, type: 'triangle', vol: 0.22 }),
  bully: () => {
    arp([783.99, 987.77, 1174.66, 1567.98], 0.075, { dur: 0.22, type: 'triangle', vol: 0.22 });
    sound.tone(1975.5, { dur: 0.45, type: 'sine', vol: 0.14, when: 0.32 });
  },
  discover: () => {
    [523.25, 659.25, 783.99].forEach((f) => sound.tone(f, { dur: 1.3, type: 'sine', vol: 0.08 }));
    sound.tone(1046.5, { dur: 1.4, type: 'triangle', vol: 0.07, when: 0.28 });
  },
};

// ---------- small render helpers ----------
function face(v, cls = '') {
  const m = MOUTH[v] ?? MOUTH[3];
  const closed = m.endsWith('Z');
  return `<svg class="face ${cls}" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17.5" style="fill:var(--mood-${v})" stroke="#fff" stroke-width="3"/><ellipse cx="14" cy="17" rx="2" ry="2.6" style="fill:var(--face-ink)"/><ellipse cx="26" cy="17" rx="2" ry="2.6" style="fill:var(--face-ink)"/><ellipse cx="10.5" cy="23" rx="2.6" ry="1.6" fill="#ff7f99" opacity=".5"/><ellipse cx="29.5" cy="23" rx="2.6" ry="1.6" fill="#ff7f99" opacity=".5"/><path d="${m}" style="fill:${closed ? 'var(--face-ink)' : 'none'};stroke:var(--face-ink)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function spiral(cx, cy) {
  return `<path d="M${cx} ${cy} m0 -1 a1 1 0 1 1 -1 1 a2 2 0 1 1 2 2 a3 3 0 1 1 -3 -3 a4 4 0 1 1 4 4" fill="none" stroke="#3f342c" stroke-width="1.8" stroke-linecap="round"/>`;
}

function mascotSvg(o = {}) {
  const mood = o.mood || 4;
  const mouth = o.sleep ? 'M47 63 Q50 66.5 53 63 Q50 60 47 63 Z' : o.dizzy ? 'M42 62 q4 -4 8 0 t8 0' : MASCOT_MOUTH[mood] ?? MASCOT_MOUTH[4];
  const closed = mouth.endsWith('Z');
  const eyes = o.sleep
    ? '<path d="M35.5 52 Q40 56 44.5 52" fill="none" stroke="#3f342c" stroke-width="2.6" stroke-linecap="round"/><path d="M55.5 52 Q60 56 64.5 52" fill="none" stroke="#3f342c" stroke-width="2.6" stroke-linecap="round"/>'
    : o.dizzy
      ? `${spiral(40, 52)}${spiral(60, 52)}`
      : '<g class="m-look"><g class="m-eyes"><ellipse cx="40" cy="52" rx="3.6" ry="4.6" fill="#3f342c"/><ellipse cx="60" cy="52" rx="3.6" ry="4.6" fill="#3f342c"/><circle cx="41.3" cy="50.2" r="1.4" fill="#fff"/><circle cx="61.3" cy="50.2" r="1.4" fill="#fff"/></g></g>';
  const sprout = o.hat
    ? ''
    : '<g class="m-sprout"><path d="M50 27V19" stroke="#3f9b6a" stroke-width="2.6" stroke-linecap="round"/><path d="M50 20 C52 13 59 10 65 12 C62 18 56 21 50 20 Z" fill="#5fd38f"/><path d="M50 22 C47 17 42 15 37 17 C40 22 45 23 50 22 Z" fill="#7fe0a5"/></g>';
  const hat =
    o.hat === 'party'
      ? '<g class="m-hat" transform="rotate(12 50 30)"><path d="M50 2 L62 30 L38 30 Z" fill="#ff7a59"/><path d="M42.5 23 L57.5 23 M45.5 15 L54.5 15" stroke="#ffe066" stroke-width="3" stroke-linecap="round"/><circle cx="50" cy="3" r="4" fill="#ffe066"/></g>'
      : '';
  const glasses = o.glasses
    ? '<g class="m-glasses"><rect x="31" y="46" width="17" height="11" rx="4.5" fill="#262a2c"/><rect x="52" y="46" width="17" height="11" rx="4.5" fill="#262a2c"/><path d="M48 50.5h4" stroke="#262a2c" stroke-width="2.6"/><path d="M34 49h5" stroke="#fff" stroke-width="1.8" stroke-linecap="round" opacity=".7"/></g>'
    : '';
  const scarf = o.scarf
    ? '<g class="m-scarf"><path d="M20 66 C38 73 62 73 80 66 L80 73 C62 80 38 80 20 73 Z" fill="#ff7a59"/><path d="M64 72 l3 13 l7 -2 l-3 -12 Z" fill="#e0583a"/></g>'
    : '';
  const umbrella = o.umbrella
    ? '<g class="m-umbrella"><path d="M86 34 V82" stroke="#8a6a55" stroke-width="2.6" stroke-linecap="round"/><path d="M60 36 Q86 2 112 36 Q105 30 99 36 Q92 30 86 36 Q79 30 73 36 Q66 30 60 36 Z" fill="#4fb0f0"/><path d="M86 9 Q78 20 73 36 Q79 30 86 36 Z" fill="#fff" opacity=".85"/></g>'
    : '';
  return `<svg class="mascot-svg" viewBox="0 0 100 92" aria-hidden="true">
    <ellipse class="m-shadow" cx="50" cy="86" rx="24" ry="4"/>${umbrella}
    <g class="m-body">${sprout}
      <path class="m-cloud" d="M24 76 C12 76 6 68 8 59 C10 51 17 46 25 47 C26 35 37 26 50 26 C63 26 73 35 74 47 C83 46 92 52 92 62 C92 70 86 76 78 76 Z"/>
      <path d="M20 70 C30 74 70 74 82 70" fill="none" stroke="#e3ecf0" stroke-width="3" stroke-linecap="round" opacity=".8"/>
      ${eyes}${glasses}
      <ellipse cx="31" cy="60" rx="5" ry="3" fill="#ff9db0" opacity=".65"/><ellipse cx="69" cy="60" rx="5" ry="3" fill="#ff9db0" opacity=".65"/>
      <path d="${mouth}" fill="${closed ? '#3f342c' : 'none'}" stroke="#3f342c" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
      ${scarf}${hat}
    </g></svg>`;
}

function starPath(cx, cy, r) {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.48 : r;
    d += `${i ? 'L' : 'M'}${(cx + Math.cos(a) * rr).toFixed(1)} ${(cy + Math.sin(a) * rr).toFixed(1)}`;
  }
  return `${d}Z`;
}

function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function prettyDate(s, withWeek = false) {
  const d = parseDate(s);
  return `${d.getMonth() + 1}月${d.getDate()}日${withWeek ? ` 星期${WEEK[d.getDay()]}` : ''}`;
}
function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function randInt(n) {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % n;
}
function shuffled(n) {
  const a = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const pick = (list) => list[randInt(list.length)];

/** 重新播放一个一次性动画 class；ms 给定时按时间移除，否则等自身 animationend。 */
function replay(el, cls, ms = 0) {
  if (!el) return;
  el.classList.remove(cls);
  el.getBoundingClientRect();
  el.classList.add(cls);
  if (ms) {
    setTimeout(() => el.classList.remove(cls), reduceMotion() ? 0 : ms);
    return;
  }
  const done = (e) => {
    if (e.target !== el) return;
    el.classList.remove(cls);
    el.removeEventListener('animationend', done);
  };
  el.addEventListener('animationend', done);
}

function countUp(el, to, dur = 900) {
  if (!el || !Number.isFinite(to)) return;
  const dec = Number.isInteger(to) ? 0 : 1;
  if (reduceMotion()) {
    el.textContent = to.toFixed(dec);
    return;
  }
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    el.textContent = (to * (1 - (1 - p) ** 3)).toFixed(dec);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- state ----------
let state = null;
let tab = localStorage.getItem('xinyu.tab') || 'today';
let selectedMood = null;
let editingCheckin = false;
let flipPending = false;
let calCursor = null;
let pickerOptions = [];
let picking = false;
let wheelIndex = 0;
let wheelWinner = null;
let lastAnswer = null;
let sceneKey = '';
let sceneParts = null;
let knownUnlocked = null;
let knownJoyIds = null;
let levelPct = 0;
let bubbleShown = '';
let bubbleTimer = 0;
let sayTimer = 0;
let moonTimer = 0;
let lastActive = Date.now();
let lookX = -1;
let lookY = -1;
let lookRaf = 0;
let pokes = [];
let questPrev = null;
let introRunning = false;
const anyOverlay = () => $('#talk').open || $('#modal').open || $('#intro').open;
const flag = (k) => !!state?.flags?.[k];
/** 一次性引导标记存到服务端，换端口或换窗口也不会重复播放。 */
function setFlag(k, value) {
  if (!state) return;
  const v = value ?? new Date().toISOString();
  if (value !== undefined ? state.flags?.[k] === v : flag(k)) return;
  state.flags = { ...(state.flags || {}), [k]: v };
  void api('POST', '/api/flags', value !== undefined ? { key: k, value: v } : { key: k }).catch(() => {});
}
const mascotState = { sleeping: false, dizzy: false, cool: false, wokeAt: Date.now() };

const isBirthday = () => state?.birth?.untilBirthday === 0;
const answeredCount = () => {
  const ids = new Set(state.about.questions.map((q) => q.id));
  return Object.keys(state.about.answers).filter((k) => ids.has(k)).length;
};
const unlockedCount = () => ISLAND_ITEMS.filter((it) => answeredCount() >= it.need).length;
const isShiny = (c) => c.energy >= 90 || hashStr(`${c.date}|${c.keyword}`) % 8 === 0;

// ---------- api ----------
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* 非 JSON 响应 */
  }
  if (!res.ok) {
    throw new Error(data?.message || (res.status === 401 ? '页面凭证已过期，请点击刷新' : `请求失败（${res.status}）`));
  }
  return data;
}

async function act(method, path, body) {
  try {
    const data = await api(method, path, body);
    if (data?.state) {
      state = data.state;
      render();
    }
    return { ok: true, result: data?.result };
  } catch (error) {
    toast(error.message, 'err');
    return { ok: false, error };
  }
}

let firstLoad = true;
async function load(silent = false) {
  if (!silent) {
    $('#loading').hidden = false;
    $('#load-error').hidden = true;
  }
  try {
    state = await api('GET', '/api/state');
    $('#loading').hidden = true;
    $('#load-error').hidden = true;
    render();
    if (firstLoad) {
      firstLoad = false;
      onFirstLoad();
    }
  } catch {
    $('#loading').hidden = true;
    if (!state) {
      $('#load-error').hidden = false;
      $$('.screen').forEach((p) => (p.hidden = true));
    }
  }
}

function connectEvents() {
  if (!('EventSource' in window)) return;
  const es = new EventSource('/api/events');
  es.addEventListener('changed', (e) => {
    try {
      const { version } = JSON.parse(e.data);
      if (!state || version !== state.version) void load(true);
    } catch {
      /* ignore */
    }
  });
}

// ---------- scene / theme ----------
function scenePref() {
  return localStorage.getItem('xinyu.scene') || 'auto';
}
function sceneName() {
  const p = scenePref();
  if (p === 'day' || p === 'night') return p;
  const h = new Date().getHours();
  if (h >= 5 && h < 8) return 'dawn';
  if (h >= 8 && h < 17) return 'day';
  if (h >= 17 && h < 19) return 'dusk';
  return 'night';
}
function applyScene() {
  const s = sceneName();
  document.documentElement.dataset.scene = s;
  document.documentElement.dataset.theme = s === 'night' ? 'dark' : 'light';
}

// ---------- feedback: toast / burst / fly ----------
let toastTimer;
function toast(msg, kind = 'ok') {
  const el = $('#toast');
  const icon = kind === 'err' ? ICON.exclaim : kind === 'gift' ? ICON.star5 : ICON.check;
  el.className = `toast ${kind}`;
  el.innerHTML = `<span class="toast-ic">${icon}</span><span>${esc(msg)}</span>`;
  el.setAttribute('role', kind === 'err' ? 'alert' : 'status');
  try {
    if (el.matches(':popover-open')) el.hidePopover();
    el.showPopover();
  } catch {
    /* popover 不可用时仍按普通元素显示 */
  }
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => {
      try {
        if (!el.classList.contains('show')) el.hidePopover();
      } catch {
        /* ignore */
      }
    }, 300);
  }, 2400);
}

/** 彩色纸屑。target 可以是元素或 DOMRect；对话框打开时画在对话框里。 */
function burst(target, n = 26, colors = BURST_COLORS) {
  if (reduceMotion() || !target) return;
  const r = target.getBoundingClientRect ? target.getBoundingClientRect() : target;
  const host = document.querySelector('dialog[open]') || document.body;
  const layer = document.createElement('div');
  layer.className = 'burst';
  layer.setAttribute('aria-hidden', 'true');
  let x = r.left + r.width / 2;
  let y = r.top + Math.min(r.height / 2, 220);
  if (host !== document.body) {
    const hr = host.getBoundingClientRect();
    x -= hr.left;
    y -= hr.top;
    layer.style.position = 'absolute';
  }
  layer.style.left = `${x}px`;
  layer.style.top = `${y}px`;
  for (let i = 0; i < n; i++) {
    const s = document.createElement('i');
    const a = (Math.PI * 2 * i) / n + Math.random() * 0.4;
    const d = 70 + Math.random() * 130;
    s.style.setProperty('--dx', `${Math.cos(a) * d}px`);
    s.style.setProperty('--dy', `${Math.sin(a) * d}px`);
    s.style.background = colors[i % colors.length];
    s.style.animationDelay = `${Math.random() * 90}ms`;
    s.className = i % 4 === 0 ? 'star' : i % 3 === 0 ? 'round' : '';
    layer.append(s);
  }
  host.append(layer);
  setTimeout(() => layer.remove(), 1400);
}

/** 把一个小图形从 from 抛物线飞到 target。 */
function flyTo(html, from, target, { size = 56, onDone } = {}) {
  if (reduceMotion() || !from || !target) {
    onDone?.();
    return;
  }
  const to = target.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'flyer';
  el.innerHTML = html;
  el.setAttribute('aria-hidden', 'true');
  const fx = from.left + from.width / 2;
  const fy = from.top + from.height / 2;
  Object.assign(el.style, { left: `${fx - size / 2}px`, top: `${fy - size / 2}px`, width: `${size}px`, height: `${size}px` });
  document.body.append(el);
  const dx = to.left + to.width / 2 - fx;
  const dy = to.top + to.height / 2 - fy;
  const anim = el.animate(
    [
      { transform: 'translate(0, 0) scale(1) rotate(0deg)' },
      { transform: `translate(${dx * 0.45}px, ${Math.min(dy * 0.45, 0) - 90}px) scale(1.2) rotate(-25deg)`, offset: 0.45 },
      { transform: `translate(${dx}px, ${dy}px) scale(.35) rotate(15deg)`, opacity: 0.85 },
    ],
    { duration: 780, easing: 'cubic-bezier(.45,0,.4,1)' },
  );
  anim.onfinish = () => {
    el.remove();
    onDone?.();
  };
}

function plusOne(target, text = '+1') {
  if (reduceMotion() || !target) return;
  const r = target.getBoundingClientRect();
  const el = document.createElement('span');
  el.className = 'plus-one';
  el.textContent = text;
  el.setAttribute('aria-hidden', 'true');
  el.style.left = `${r.left + r.width / 2 - 12}px`;
  el.style.top = `${r.top - 6}px`;
  document.body.append(el);
  setTimeout(() => el.remove(), 1300);
}

/** 在小岛舞台里飘一个小东西（爱心、雨滴等）。 */
function stageFloat(target, html, cls, dx = 0) {
  const st = $('#stage');
  if (!st || reduceMotion() || !target) return;
  const sr = st.getBoundingClientRect();
  const r = target.getBoundingClientRect ? target.getBoundingClientRect() : target;
  const el = document.createElement('span');
  el.className = cls;
  el.innerHTML = html;
  el.setAttribute('aria-hidden', 'true');
  el.style.left = `${r.left + r.width / 2 - sr.left + dx}px`;
  el.style.top = `${r.top - sr.top}px`;
  st.append(el);
  setTimeout(() => el.remove(), 1600);
}
const floatHeart = (el, dx = 0) => stageFloat(el, ICON.heart, 'float-heart', dx);

function rainFrom(el) {
  const st = $('#stage');
  if (!st || reduceMotion()) return;
  const sr = st.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  for (let i = 0; i < 9; i++) {
    const d = document.createElement('i');
    d.className = 'drop';
    d.setAttribute('aria-hidden', 'true');
    d.style.left = `${r.left - sr.left + r.width * (0.15 + Math.random() * 0.7)}px`;
    d.style.top = `${r.bottom - sr.top - 6}px`;
    d.style.animationDelay = `${Math.random() * 380}ms`;
    st.append(d);
    setTimeout(() => d.remove(), 1500);
  }
}

// ---------- modal ----------
const modal = { token: 0, onCancel: null, opener: null };
function openModal({ title, render: draw, actions = [], onCancel, cls = '' }) {
  const dlg = $('#modal');
  modal.token++;
  modal.onCancel = onCancel || null;
  if (!dlg.open) modal.opener = document.activeElement;
  dlg.className = `modal ${cls}`;
  $('#modal-title').textContent = title;
  const body = $('#modal-body');
  body.innerHTML = '';
  draw?.(body);
  const box = $('#modal-actions');
  box.innerHTML = actions.map((a, i) => `<button type="button" class="gbtn ${a.kind || ''}" data-a="${i}">${esc(a.label)}</button>`).join('');
  $$('[data-a]', box).forEach((b) => (b.onclick = () => actions[Number(b.dataset.a)].onClick()));
  if (!dlg.open) dlg.showModal();
  requestAnimationFrame(() => dlg.classList.add('open'));
}
function closeModal() {
  const dlg = $('#modal');
  if (!dlg.open) return Promise.resolve();
  dlg.classList.remove('open');
  const tk = modal.token;
  return new Promise((res) =>
    setTimeout(
      () => {
        if (tk === modal.token) {
          dlg.close();
          if (modal.opener?.isConnected) modal.opener.focus?.();
        }
        res();
      },
      reduceMotion() ? 0 : 220,
    ),
  );
}
function cancelModal() {
  if (modal.onCancel) modal.onCancel();
  else void closeModal();
}
function confirmModal(title, message, okLabel = '确认') {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      void closeModal().then(() => resolve(v));
    };
    openModal({
      title,
      render: (b) => (b.innerHTML = `<p class="modal-text">${esc(message)}</p>`),
      actions: [
        { label: '取消', kind: 'ghost', onClick: () => finish(false) },
        { label: okLabel, kind: 'danger', onClick: () => finish(true) },
      ],
      onCancel: () => finish(false),
    });
  });
}

function celebrateStreak(n) {
  sfx.fanfare();
  openModal({
    title: `连续打卡 ${n} 天！`,
    cls: 'celebrate',
    render: (b) =>
      (b.innerHTML = `<div class="medal-wrap"><div class="medal-rays" aria-hidden="true"></div><div class="medal-big"><span>${n}</span><small>天</small></div></div>
        <p class="modal-text">${esc(MS_LINES[n] ?? '小火苗越烧越旺，你真的很棒。')}</p>`),
    actions: [{ label: '太棒啦', kind: 'primary', onClick: () => void closeModal() }],
  });
  setTimeout(() => burst($('#modal .medal-big'), 44), reduceMotion() ? 0 : 280);
}

function openPostcard() {
  sfx.chime();
  openModal({
    title: '热气球捎来一张明信片',
    cls: 'postcard-modal',
    render: (b) =>
      (b.innerHTML = `<div class="postcard"><div class="pc-inner"><span class="pc-stamp">${ICON.island}</span>
        <p class="pc-msg">${esc(pick(POSTCARDS))}</p><p class="pc-from">${prettyDate(state.today)} · 来自路过的热气球</p></div></div>`),
    actions: [{ label: '收下啦', kind: 'primary', onClick: () => void closeModal() }],
  });
}

// ---------- talk (game dialog) ----------
const talk = { token: 0, opener: null };
let typeTimer = 0;
let typing = null;
function openTalk() {
  const dlg = $('#talk');
  talk.token++;
  if (mascotState.sleeping) {
    mascotState.sleeping = false;
    mascotState.wokeAt = Date.now();
    updateMascot();
  }
  if (!dlg.open) {
    talk.opener = document.activeElement;
    dlg.showModal();
  }
  requestAnimationFrame(() => dlg.classList.add('open'));
}
function closeTalk() {
  const dlg = $('#talk');
  clearInterval(typeTimer);
  typing = null;
  if (!dlg.open) return Promise.resolve();
  dlg.classList.remove('open');
  const tk = talk.token;
  return new Promise((res) =>
    setTimeout(
      () => {
        if (tk === talk.token) {
          dlg.close();
          if (talk.opener?.isConnected) talk.opener.focus?.();
          playPendingPops();
          refreshBubble();
        }
        res();
      },
      reduceMotion() ? 0 : 320,
    ),
  );
}
function typewrite(el, text, done) {
  clearInterval(typeTimer);
  const chars = [...text];
  el.setAttribute('aria-label', text);
  const finish = () => {
    clearInterval(typeTimer);
    typing = null;
    el.onclick = null;
    el.textContent = text;
    done();
  };
  if (reduceMotion() || !chars.length) {
    el.textContent = text;
    done();
    return;
  }
  el.textContent = '';
  let i = 0;
  typing = { finish };
  el.onclick = finish;
  typeTimer = setInterval(() => {
    i++;
    el.textContent = chars.slice(0, i).join('');
    if (i % 2 === 1 && !NO_BLIP.test(chars[i - 1])) sfx.blip();
    if (i >= chars.length) finish();
  }, 32);
}
function talkStep({ progress = '', dots = null, react = '', text, options = [], selected = -1, onPick, foot = [], mood = 4, cols }) {
  const portrait = $('#talk-portrait');
  portrait.innerHTML = mascotSvg({ mood, glasses: mascotState.cool, hat: isBirthday() ? 'party' : '' });
  replay(portrait, 'hop');
  $('#talk-progress').innerHTML = `${dots ? dots.map((d) => `<i class="pd ${d}"></i>`).join('') : ''}<span>${esc(progress)}</span>`;
  const re = $('#talk-react');
  re.textContent = react;
  re.hidden = !react;
  const opts = $('#talk-options');
  delete opts.dataset.busy;
  opts.classList.remove('show');
  opts.classList.toggle('two', cols === 2 || (cols !== 1 && options.length > 1 && options.every((o) => [...o].length <= 7)));
  opts.innerHTML = options
    .map(
      (o, i) =>
        `<button type="button" class="opt${i === selected ? ' picked' : ''}" data-i="${i}" style="--d:${i * 55}ms">${i < 9 ? `<kbd aria-hidden="true">${i + 1}</kbd>` : ''}<span>${esc(o)}</span></button>`,
    )
    .join('');
  $$('.opt', opts).forEach((b) => {
    b.onclick = () => {
      if (opts.dataset.busy) return;
      opts.dataset.busy = '1';
      sfx.pop();
      $$('.opt', opts).forEach((x) => x.classList.toggle('picked', x === b));
      void Promise.resolve(onPick?.(Number(b.dataset.i), b));
    };
  });
  const ft = $('#talk-foot');
  ft.innerHTML = foot.map((f, i) => `<button type="button" class="text-btn ${f.kind || ''}" data-f="${i}">${esc(f.label)}</button>`).join('');
  $$('[data-f]', ft).forEach((b) => (b.onclick = () => foot[Number(b.dataset.f)].onClick()));
  typewrite($('#talk-q'), text, () => {
    opts.classList.add('show');
    $('.opt', opts)?.focus({ preventScroll: true });
  });
}

function nextUnanswered(afterId, skipped) {
  const qs = state.about.questions;
  const a = state.about.answers;
  const start = afterId ? qs.findIndex((q) => q.id === afterId) + 1 : 0;
  for (let k = 0; k < qs.length; k++) {
    const q = qs[(start + k) % qs.length];
    if (a[q.id] == null && !skipped.has(q.id)) return q.id;
  }
  return null;
}

function aboutTalk(singleId) {
  const qs = state.about.questions;
  const skipped = new Set();
  const first = singleId || nextUnanswered(null, skipped);
  if (!first) return;
  openTalk();
  step(first, singleId ? '这条想改一改吗？' : '我想多了解你一点，可以吗？');

  function step(id, react) {
    const q = qs.find((x) => x.id === id);
    const ans = state.about.answers;
    talkStep({
      progress: `了解你 ${answeredCount()}/${qs.length}`,
      react,
      text: q.q,
      options: q.options,
      selected: ans[id] ?? -1,
      onPick: async (i) => {
        const before = unlockedCount();
        const [r] = await Promise.all([act('PUT', '/api/about', { id, choice: i }), wait(280)]);
        if (!r.ok) return step(id, '好像没记下来，再选一次？');
        const after = unlockedCount();
        const item = after > before ? ISLAND_ITEMS[after - 1] : null;
        const special = ABOUT_REACT[id]?.[i];
        if (singleId) {
          await closeTalk();
          toast(special || '小屿记下了新的回答');
          return;
        }
        const reactText = item ? `哇！岛上出现了${item.name}！` : special || `${pick(REACTS)}「${q.options[i]}」，记下啦。`;
        const next = nextUnanswered(id, skipped);
        if (!next) return finish(reactText);
        step(next, reactText);
      },
      foot: singleId
        ? [
            ...(ans[id] != null
              ? [
                  {
                    label: '清除这条回答',
                    kind: 'danger',
                    onClick: async () => {
                      const r = await act('PUT', '/api/about', { id, choice: null });
                      if (r.ok) void closeTalk();
                    },
                  },
                ]
              : []),
            { label: '关闭', onClick: () => void closeTalk() },
          ]
        : [
            {
              label: '跳过这题',
              onClick: () => {
                skipped.add(id);
                const nx = nextUnanswered(id, skipped);
                if (!nx) finish('没关系，下次再聊。');
                else step(nx, '好，那换一个问题～');
              },
            },
            { label: '先聊到这', onClick: () => void closeTalk() },
          ],
    });
  }
  function finish(react) {
    const n = answeredCount();
    const all = n >= qs.length;
    talkStep({
      progress: `了解你 ${n}/${qs.length}`,
      react,
      text: all ? '我已经很了解你啦！之后的每一张灵感卡都会参考这些回答。' : '今天就聊到这里吧，剩下的问题随时来找我。',
      options: ['好的'],
      mood: 5,
      onPick: () => void closeTalk(),
    });
  }
}

function dailyTalk() {
  if (!state.profile.birthday) return openSettings();
  if (state.todayCard) return;
  const qs = state.dailyQuestions;
  const answers = {};
  let i = 0;
  openTalk();
  step('翻卡之前，先陪我聊三句～');

  function dots() {
    return qs.map((_, k) => (k < i ? 'done' : k === i ? 'cur' : ''));
  }
  function step(react) {
    const q = qs[i];
    talkStep({
      progress: `今日三问 ${i + 1}/${qs.length}`,
      dots: dots(),
      react,
      text: q.q,
      options: q.options,
      selected: answers[q.id] ?? -1,
      mood: 5,
      onPick: async (k) => {
        answers[q.id] = k;
        await wait(260);
        advance(`「${q.options[k]}」，好的！`);
      },
      foot: [
        ...(i > 0
          ? [
              {
                label: '上一个',
                onClick: () => {
                  i--;
                  step('');
                },
              },
            ]
          : []),
        {
          label: '跳过这题',
          onClick: () => {
            answers[q.id] = null;
            advance('跳过也没关系～');
          },
        },
      ],
    });
  }
  function advance(react) {
    if (i < qs.length - 1) {
      i++;
      step(react);
    } else void finish();
  }
  async function finish() {
    talkStep({ progress: '洗牌中…', dots: qs.map(() => 'done'), text: '好啦，我们一起翻开今天的卡片吧！', options: [], mood: 5 });
    flipPending = true;
    try {
      const [data] = await Promise.all([api('POST', '/api/card/draw', { answers }), wait(1100)]);
      state = data.state;
      render();
    } catch (error) {
      flipPending = false;
      toast(error.message, 'err');
      step('出了点小问题，再试一次？');
      return;
    }
    await closeTalk();
    void startFlip();
  }
}

function quizTalk() {
  const qs = state.quizQuestions;
  const orders = qs.map(() => shuffled(4));
  const picks = [];
  let i = 0;
  openTalk();
  step('用 8 个小场景，看看你是哪种能量风格～');

  function step(react = '') {
    const q = qs[i];
    const ord = orders[i];
    talkStep({
      progress: `小测 ${i + 1}/${qs.length}`,
      react,
      text: q.q,
      options: ord.map((k) => q.options[k]),
      selected: picks[i] ? ord.indexOf(QUIZ_KEYS.indexOf(picks[i])) : -1,
      cols: 1,
      onPick: async (j) => {
        picks[i] = QUIZ_KEYS[ord[j]];
        await wait(240);
        if (i < qs.length - 1) {
          i++;
          step();
        } else void submit();
      },
      foot: [
        ...(i > 0
          ? [
              {
                label: '上一题',
                onClick: () => {
                  i--;
                  step();
                },
              },
            ]
          : []),
        { label: '退出', onClick: () => void closeTalk() },
      ],
    });
  }
  async function submit() {
    talkStep({ text: '让我想想你是哪一种……', options: [] });
    const [r] = await Promise.all([act('POST', '/api/quiz', { picks: picks.slice() }), wait(900)]);
    if (!r.ok) return step();
    const d = state.quiz.detail;
    sfx.fanfare();
    talkStep({
      react: '结果出来啦！',
      text: `你是「${d.name}」。${d.summary}`,
      options: ['看看完整结果'],
      mood: 5,
      onPick: async () => {
        await closeTalk();
        const hero = $('#quiz-body .style-hero');
        hero?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
        setTimeout(() => burst(hero, 30, [STYLE_META[state.quiz.style].a, STYLE_META[state.quiz.style].b, '#ffe066']), 350);
      },
    });
  }
}

// ---------- tabs ----------
function setTab(next, animate = false) {
  const changed = next !== tab;
  tab = next;
  localStorage.setItem('xinyu.tab', tab);
  $$('.dock [role="tab"]').forEach((t) => {
    const on = t.dataset.tab === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    if (on && animate && changed) replay($('i', t), 'hop', 650);
  });
  $$('.screen').forEach((p) => {
    const on = !!state && p.id === `panel-${tab}`;
    p.hidden = !on;
    if (on && animate && changed && !reduceMotion()) {
      p.classList.remove('entering');
      p.getBoundingClientRect();
      p.classList.add('entering');
    }
  });
  if (animate && changed) {
    $(`#tab-${tab} .dock-new`)?.remove();
    const rk = `region.${tab}`;
    if (state && !flag(rk) && REGIONS[tab]) {
      setFlag(rk);
      const [rn, rs] = REGIONS[tab];
      setTimeout(() => showBanner({ kicker: '— 发现新区域 —', name: rn, sub: rs }), reduceMotion() ? 0 : 260);
    }
    window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
    if (tab === 'journal') animateJournal();
  }
}

// ---------- render ----------
function render() {
  if (!state) return;
  setTab(tab);
  renderHud();
  renderScene();
  renderQuests();
  renderPass();
  renderCheckin();
  renderJar();
  renderJoysToday();
  renderJournal();
  renderBookHistory();
  renderAbout();
  renderFlower();
  renderQuiz();
}

function greeting() {
  if (isBirthday()) return '生日快乐';
  const h = new Date().getHours();
  return h < 5 ? '夜深了' : h < 8 ? '早安' : h < 11 ? '上午好' : h < 13 ? '中午好' : h < 17 ? '下午好' : h < 19 ? '傍晚好' : '晚上好';
}
function dayLine() {
  return ['周末最后一天，好好休息', '新的一周，慢慢来', '', '一周过半啦', '', '周五啦，周末就在眼前', '周末愉快'][parseDate(state.today).getDay()];
}

function renderHud() {
  const name = state.profile.nickname;
  $('#hud-hello').textContent = `${greeting()}${name ? `，${name}` : ''}`;
  const dl = dayLine();
  $('#hud-date').textContent = `${prettyDate(state.today, true)}${dl ? ` · ${dl}` : ''}`;
  const pill = $('#streak-pill');
  const n = state.streak;
  pill.className = `streak-badge lv${n >= 7 ? 3 : n >= 3 ? 2 : 1}${n ? '' : ' cold'}`;
  pill.innerHTML = `<span class="flame">${ICON.flame}</span><strong>${n}</strong><span>天</span>`;
  pill.setAttribute('aria-label', `连续打卡 ${n} 天`);
  const pending = !state.profile.birthday || !state.todayCard || !state.checkins[state.today];
  $('#tab-today .dock-dot').hidden = !pending;
  renderSeed();
}

function renderSoundBtn() {
  const b = $('#sound-btn');
  b.innerHTML = sound.on ? ICON.soundOn : ICON.soundOff;
  b.setAttribute('aria-pressed', String(sound.on));
  b.setAttribute('aria-label', sound.on ? '关闭音效' : '打开音效');
  b.classList.toggle('muted', !sound.on);
}

// ---------- island scene ----------
function weatherKind() {
  const a = state.about.answers;
  const w = WEATHER[a.weather];
  const s = SEASON[a.season];
  if (w === 'sunny') return sceneName() === 'night' ? 'none' : 'sunny';
  if (w === 'rain' || w === 'snow' || w === 'rainbow') return w;
  if (w === 'breeze') return s === 'spring' ? 'petals' : s === 'autumn' ? 'leaves' : s === 'winter' ? 'snow' : 'breeze';
  if (s === 'spring') return 'petals';
  if (s === 'autumn') return 'leaves';
  if (s === 'winter') return 'snow';
  return 'none';
}

function sceneContext() {
  const a = state.about.answers;
  return {
    scene: sceneName(),
    unlocked: unlockedCount(),
    mood: state.checkins[state.today]?.mood ?? 0,
    weather: weatherKind(),
    season: SEASON[a.season] ?? '',
    prop: PROPS[a.weekend] ?? '',
    bday: isBirthday(),
  };
}

function cloud(delay, y, s) {
  return `<g class="cloud-drift" style="animation-delay:${delay}s"><g transform="translate(0 ${y}) scale(${s})"><g class="cloud egg" data-egg="cloud"><ellipse cx="0" cy="0" rx="34" ry="13"/><ellipse cx="-20" cy="4" rx="20" ry="10"/><ellipse cx="22" cy="4" rx="22" ry="10"/><ellipse cx="2" cy="-9" rx="18" ry="12"/></g></g></g>`;
}

function celestial(scene) {
  if (scene === 'night') {
    const stars = [[160, 34], [210, 86], [250, 40], [300, 70], [345, 26], [400, 70], [450, 34], [560, 120], [24, 132], [585, 26], [520, 70], [370, 110]];
    return `<g class="stars">${stars.map(([x, y], i) => `<circle class="tw" cx="${x}" cy="${y}" r="${i % 3 ? 1.6 : 2.4}" style="animation-delay:${(i * 0.37).toFixed(2)}s"/>`).join('')}</g>
      <g class="moon egg" data-egg="moon">
        <g transform="translate(-424 0)">
        <circle cx="512" cy="62" r="42" fill="#fff6d0" opacity=".1"/><circle cx="512" cy="62" r="33" fill="#fff6d0" opacity=".14"/>
        <circle cx="512" cy="62" r="25" fill="#fff3c4"/>
        <circle cx="500" cy="50" r="4.5" fill="#f2e2a8"/><circle cx="526" cy="74" r="3.4" fill="#f2e2a8"/><circle cx="527" cy="50" r="2.4" fill="#f2e2a8"/>
        <g class="mf-sleep"><path d="M499 63 q4 3.4 8 0 M517 63 q4 3.4 8 0" fill="none" stroke="#b8975a" stroke-width="2" stroke-linecap="round"/></g>
        <g class="mf-wink"><path d="M499 63 q4 3.4 8 0" fill="none" stroke="#b8975a" stroke-width="2" stroke-linecap="round"/><circle cx="521" cy="62" r="2.6" fill="#8a6a3a"/><circle cx="522" cy="61" r=".9" fill="#fff"/></g>
        <path d="M508 70 q4 3.4 8 0" fill="none" stroke="#b8975a" stroke-width="2" stroke-linecap="round"/>
        <ellipse cx="497" cy="69" rx="3" ry="2" fill="#ffb3a1" opacity=".6"/><ellipse cx="527" cy="69" rx="3" ry="2" fill="#ffb3a1" opacity=".6"/>
        </g>
      </g>`;
  }
  const [x, y, c] = { dawn: [104, 112, '#ffb59a'], day: [88, 62, '#ffcf4d'], dusk: [112, 120, '#ff9a5a'] }[scene] ?? [88, 62, '#ffcf4d'];
  const rays = Array.from({ length: 12 }, (_, i) => `<rect x="${x - 2}" y="${y - 44}" width="4" height="11" rx="2" fill="${c}" transform="rotate(${i * 30} ${x} ${y})"/>`).join('');
  return `<g class="sun egg" data-egg="sun">
      <circle cx="${x}" cy="${y}" r="52" fill="${c}" opacity=".14"/><g class="sun-rays">${rays}</g>
      <circle cx="${x}" cy="${y}" r="27" fill="${c}"/><circle cx="${x - 8}" cy="${y - 9}" r="7" fill="#fff" opacity=".35"/>
      <g class="sun-face"><circle cx="${x - 8}" cy="${y - 2}" r="2.4" fill="#8a5a1a"/><circle cx="${x + 8}" cy="${y - 2}" r="2.4" fill="#8a5a1a"/><path d="M${x - 6} ${y + 6} q6 5 12 0" fill="none" stroke="#8a5a1a" stroke-width="2.2" stroke-linecap="round"/></g>
      <g class="sun-glasses"><rect x="${x - 17}" y="${y - 8}" width="15" height="10" rx="4" fill="#262a2c"/><rect x="${x + 2}" y="${y - 8}" width="15" height="10" rx="4" fill="#262a2c"/><path d="M${x - 2} ${y - 4}h4" stroke="#262a2c" stroke-width="2.4"/><path d="M${x - 14} ${y - 5}h4" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".7"/></g>
    </g>`;
}

function rainbowArcs(cx, cy, r0, width, opacity) {
  return ['#ff6b6b', '#ffa94d', '#ffe066', '#69db7c', '#4dabf7']
    .map((c, i) => {
      const r = r0 - i * width;
      return `<path d="M${cx - r} ${cy} A ${r} ${r * 0.85} 0 0 1 ${cx + r} ${cy}" fill="none" stroke="${c}" stroke-width="${width}" opacity="${opacity}"/>`;
    })
    .join('');
}

function birds() {
  const flap = (dur) =>
    `<animate attributeName="d" values="M-7 0 Q-3.5 -5 0 0 Q3.5 -5 7 0;M-7 -1 Q-3.5 2 0 0 Q3.5 2 7 -1;M-7 0 Q-3.5 -5 0 0 Q3.5 -5 7 0" dur="${dur}s" repeatCount="indefinite"/>`;
  const bird = (path, dur, begin, flapDur, scale) =>
    `<g class="bird"><animateMotion path="${path}" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/><g transform="scale(${scale})"><path d="M-7 0 Q-3.5 -5 0 0 Q3.5 -5 7 0">${flap(flapDur)}</path></g></g>`;
  return bird('M-30 96 C 140 70 330 120 640 64', 34, -4, 0.55, 1) + bird('M-60 112 C 120 88 320 134 660 82', 38, -12, 0.62, 0.8);
}

function skySvg(c) {
  let s = '<svg class="sky-svg" viewBox="0 0 600 300" aria-hidden="true">';
  if (c.weather === 'rainbow') s += `<g class="sky-rainbow">${rainbowArcs(470, 250, 150, 7, 0.55)}</g>`;
  s += celestial(c.scene);
  s += `<g class="clouds">${cloud(-8, 70, 1)}${cloud(-32, 38, 0.7)}${cloud(-52, 120, 0.85)}</g>`;
  if (!reduceMotion() && c.scene !== 'night') s += birds();
  return `${s}</svg>`;
}

function fireflies() {
  const paths = [
    'M170 170 c 20 -24 52 -14 40 8 s -44 22 -40 -8',
    'M420 160 c -18 -20 -46 -8 -36 10 s 40 18 36 -10',
    'M300 132 c 30 -10 40 20 10 26 s -36 -16 -10 -26',
    'M120 190 c 10 -20 36 -20 30 0 s -30 14 -30 0',
    'M480 192 c -10 -18 -30 -16 -26 2 s 26 14 26 -2',
    'M250 116 c 16 -12 36 2 22 14 s -32 0 -22 -14',
  ];
  return paths
    .map(
      (p, i) =>
        `<g class="ff"><animateMotion path="${p}" dur="${6 + i}s" begin="-${(i * 1.3).toFixed(1)}s" repeatCount="indefinite"/><circle r="6" fill="#fff3a0" opacity=".25"/><circle r="2" fill="#fff8c8"/><animate attributeName="opacity" values="0;1;.4;1;0" dur="${3 + (i % 3)}s" begin="-${i}s" repeatCount="indefinite"/></g>`,
    )
    .join('');
}

function butterflies() {
  const b = (path, dur, begin, color) =>
    `<g class="bfly"><animateMotion path="${path}" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/><g><path d="M0 0 C-7 -9 -11 -1 -1 1 Z" fill="${color}"/><path d="M0 0 C7 -9 11 -1 1 1 Z" fill="${color}"/><path d="M0 0 C-5 6 -8 1 -1 1 Z" fill="${color}" opacity=".8"/><path d="M0 0 C5 6 8 1 1 1 Z" fill="${color}" opacity=".8"/><animateTransform attributeName="transform" type="scale" values="1 1;.25 1;1 1" dur=".32s" repeatCount="indefinite"/></g></g>`;
  return b('M392 172 C 412 146 448 156 432 180 S 388 196 392 172', 9, -2, '#ffb648') + b('M286 186 C 268 166 300 154 312 172 S 296 202 286 186', 11, -6, '#ff8fab');
}

function propSvg(prop, night, pop) {
  const cls = `prop egg${pop ? ' pop-in' : ''}`;
  if (prop === 'beach') {
    return `<g class="${cls}" data-egg="prop"><path d="M346 212 V168" stroke="#8a6a55" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M320 174 Q346 146 372 174 Z" fill="#ff7a59"/><path d="M346 152 Q339 160 336 174 L346 174 Z" fill="#fff8e7"/><path d="M346 152 Q356 160 358 174 L346 174 Z" fill="#fff8e7" opacity=".0"/><path d="M346 152 Q362 158 366 172 L358 174 Z" fill="#fff8e7"/>
      <rect x="350" y="203" width="24" height="9" rx="2" fill="#4fb0f0" transform="rotate(-8 362 207)"/><path d="M352 207 h20" stroke="#fff" stroke-width="2" transform="rotate(-8 362 207)"/></g>`;
  }
  if (prop === 'tent') {
    return `<g class="${cls}" data-egg="prop"><path d="M318 212 L341 174 L364 212 Z" fill="#ffb648" stroke="#e3961f" stroke-width="2" stroke-linejoin="round"/><path d="M341 212 L341 188 L351 212 Z" fill="#c9771a"/><path d="M341 174 V164 l9 3.5 -9 3.5" fill="#ff7f9e" stroke="#8a6a55" stroke-width="1.4"/>${night ? '<circle cx="345" cy="204" r="9" fill="#ffe9a0" opacity=".35"/>' : ''}</g>`;
  }
  if (prop === 'lamp') {
    return `<g class="${cls}" data-egg="prop">${night ? '<circle cx="344" cy="176" r="22" fill="#ffe9a0" opacity=".22" class="lamp-glow"/>' : ''}<path d="M344 212 V174" stroke="#4a5a63" stroke-width="3" stroke-linecap="round"/><path d="M335 174 h18 l-3 -9 h-12 Z" fill="#4a5a63"/><circle cx="344" cy="176" r="4.5" fill="${night ? '#ffe9a0' : '#fff6d0'}"/><rect x="339" y="208" width="10" height="5" rx="1.5" fill="#4a5a63"/></g>`;
  }
  if (prop === 'sofa') {
    return `<g class="${cls}" data-egg="prop"><rect x="322" y="183" width="44" height="15" rx="7" fill="#ff7a59"/><rect x="320" y="194" width="48" height="13" rx="5" fill="#ff9472"/><rect x="315" y="190" width="10" height="19" rx="5" fill="#e9663f"/><rect x="363" y="190" width="10" height="19" rx="5" fill="#e9663f"/><path d="M325 209 v3 M363 209 v3" stroke="#8a5a3f" stroke-width="2.4" stroke-linecap="round"/>
      <g class="cat"><ellipse cx="350" cy="190" rx="9" ry="5" fill="#5a4a42"/><circle cx="341" cy="187" r="4.5" fill="#5a4a42"/><path d="M338 184 l1 -4 l2.6 3 M342 183 l2 -3.6 l1 4" fill="#5a4a42"/><path d="M359 190 q5 -1 4 -6" fill="none" stroke="#5a4a42" stroke-width="2.4" stroke-linecap="round"/><path d="M339.5 187.5 q1 1 2 0" fill="none" stroke="#fff" stroke-width=".9" stroke-linecap="round"/></g></g>`;
  }
  if (prop === 'cafe') {
    return `<g class="${cls}" data-egg="prop"><rect x="328" y="195" width="32" height="5" rx="2.5" fill="#a8734f"/><rect x="342" y="200" width="4" height="12" fill="#8a5a3f"/><path d="M336 212 h16" stroke="#8a5a3f" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M337 185 h11 v6 a4.5 4.5 0 0 1 -4.5 4.5 h-2 a4.5 4.5 0 0 1 -4.5 -4.5 Z" fill="#fff"/><path d="M348 187 a3 3 0 0 1 0 5.5" fill="none" stroke="#fff" stroke-width="1.8"/>
      <path class="steam" d="M340 182 q-3 -4 0 -8 q3 -4 0 -8" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".8"/><path class="steam s2" d="M345 182 q-3 -4 0 -8 q3 -4 0 -8" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".8"/>
      <rect x="364" y="192" width="13" height="19" rx="2" fill="#3f4a46"/><path d="M367 197 h7 M367 201 h5 M367 205 h6" stroke="#fff" stroke-width="1.2" opacity=".8"/></g>`;
  }
  return '';
}

function treeSvg(cls, season) {
  const [c1, c2, c3] = {
    spring: ['#7fd08a', '#68c27a', '#bdf0c4'],
    summer: ['#4cc38a', '#3fae79', '#7fe0a5'],
    autumn: ['#f4a259', '#e8873a', '#ffd08a'],
    winter: ['#5aa58a', '#4b9078', '#9fd6bf'],
  }[season || 'summer'];
  let extra = '';
  if (season === 'spring') extra = [[200, 124], [218, 132], [190, 146], [228, 148], [206, 142], [214, 118]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.2" fill="#ffc2d1"/><circle cx="${x}" cy="${y}" r="1.2" fill="#fff"/>`).join('');
  if (season === 'summer') extra = [[198, 140], [222, 128], [214, 152]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.6" fill="#ff6b5e"/><circle cx="${x - 1}" cy="${y - 1.2}" r="1" fill="#fff" opacity=".7"/>`).join('');
  if (season === 'winter') extra = '<path d="M186 130 q24 -26 48 0 q-6 -4 -12 -2 q-6 -6 -12 -1 q-6 -5 -12 0 q-6 -3 -12 3 Z" fill="#fff"/><path d="M176 146 q14 -14 28 0 q-14 -5 -28 0 Z M216 146 q14 -14 28 0 q-14 -5 -28 0 Z" fill="#fff"/>';
  return `<g class="${cls}" data-egg="tree"><rect x="205" y="148" width="10" height="42" rx="4" fill="#a8734f"/><g class="canopy"><circle cx="210" cy="136" r="26" fill="${c1}"/><circle cx="191" cy="150" r="17" fill="${c2}"/><circle cx="229" cy="150" r="17" fill="${c2}"/><circle cx="203" cy="128" r="9" fill="${c3}" opacity=".8"/>${extra}</g></g>`;
}

function isleSvg(c, fresh, { popProp }) {
  const has = (k) => c.unlocked >= ISLAND_ITEMS.findIndex((i) => i.key === k) + 1;
  const cls = (k) => `item egg it-${k}${fresh.has(k) ? ' pending' : ''}`;
  const night = c.scene === 'night';
  const names = ISLAND_ITEMS.filter((it) => has(it.key)).map((it) => it.name);
  let s = `<svg class="isle-svg" viewBox="0 0 600 300" role="img" aria-label="心屿小岛${names.length ? `：岛上有${names.join('、')}` : '：一座刚刚出现的小岛'}">`;
  if (has('rainbow')) s += `<g class="${cls('rainbow')}" data-egg="rainbow">${rainbowArcs(300, 196, 170, 8, 0.8)}</g>`;
  s += '<g class="pebbles"><ellipse class="peb" cx="140" cy="258" rx="12" ry="7"/><ellipse class="peb p2" cx="470" cy="250" rx="9" ry="6"/><ellipse class="peb p3" cx="420" cy="284" rx="6" ry="4"/></g>';
  s += `<path class="rock" d="M108 196 C130 238 190 266 250 276 C290 296 330 296 360 278 C420 266 470 236 492 196 Z"/>
    <path class="rock-2" d="M150 214 C200 244 250 254 300 260 C360 256 410 240 452 212 C420 228 360 240 300 242 C240 240 190 230 150 214 Z"/>
    <path class="rock-2" d="M270 272 L300 298 L326 276 Z"/>
    <ellipse class="grass-edge" cx="300" cy="196" rx="194" ry="33"/>
    <ellipse class="grass" cx="300" cy="190" rx="190" ry="30"/>
    <ellipse class="grass-hi" cx="282" cy="184" rx="148" ry="17"/>`;
  if (c.season === 'winter') s += '<ellipse cx="238" cy="203" rx="42" ry="7" fill="#fff" opacity=".85"/><ellipse cx="430" cy="185" rx="34" ry="6" fill="#fff" opacity=".75"/><ellipse cx="150" cy="190" rx="18" ry="4" fill="#fff" opacity=".7"/>';
  if (c.season === 'autumn') s += [[150, 196, '#f4a259'], [262, 210, '#e8873a'], [312, 214, '#ffd08a'], [452, 200, '#f4a259'], [400, 212, '#e8873a']].map(([x, y, col]) => `<ellipse cx="${x}" cy="${y}" rx="4" ry="2.2" fill="${col}" transform="rotate(${(x * 7) % 60 - 30} ${x} ${y})"/>`).join('');
  if (has('windmill')) {
    s += `<g class="${cls('windmill')}" data-egg="windmill"><path d="M140 194 L146 142 L154 142 L160 194 Z" fill="#f6e7cf" stroke="#c9a77f" stroke-width="2"/><rect x="146" y="176" width="8" height="18" rx="3" fill="#b07a5a"/>
      <g class="blades">${[0, 90, 180, 270].map((a) => `<path d="M150 140 L144 106 L156 108 Z" fill="#fffaf0" stroke="#c9a77f" stroke-width="1.6" transform="rotate(${a} 150 140)"/>`).join('')}<circle cx="150" cy="140" r="4" fill="#c9a77f"/></g></g>`;
  }
  if (has('tree')) s += treeSvg(cls('tree'), c.season);
  if (has('house')) {
    s += `<g class="${cls('house')}${night ? ' lights-on' : ''}" data-egg="house"><rect x="358" y="130" width="8" height="16" fill="#c97b6b"/>${c.season === 'winter' ? '' : ''}<rect x="320" y="150" width="50" height="38" rx="4" fill="#fff4e0" stroke="#e8cfae" stroke-width="2"/><path d="M313 154 L345 126 L377 154 Z" fill="#ff7a6a" stroke="#e85d55" stroke-width="2" stroke-linejoin="round"/>${c.season === 'winter' ? '<path d="M318 150 L345 127 L372 150 L366 150 L345 133 L324 150 Z" fill="#fff"/>' : ''}<rect x="339" y="166" width="13" height="22" rx="5" fill="#b07a5a"/><circle cx="349" cy="178" r="1.2" fill="#ffe08a"/><rect class="window" x="325" y="160" width="10" height="10" rx="2"/><path d="M330 160 v10 M325 165 h10" stroke="#e8cfae" stroke-width="1.2"/></g>`;
  }
  if (has('lighthouse')) {
    s += `<g class="${cls('lighthouse')}" data-egg="lighthouse">${night ? '<path class="beam" d="M455 114 L600 84 L600 146 Z" fill="#fff1a8"/>' : '<path class="beam beam-day" d="M455 114 L600 84 L600 146 Z" fill="#fff8c8"/>'}<path d="M445 194 L449 120 L461 120 L465 194 Z" fill="#fffaf0" stroke="#e0d2c0" stroke-width="2"/><path d="M447.6 166 L462.4 166 L463.2 178 L446.8 178 Z" fill="#ff6b6b"/><path d="M448.6 138 L461.4 138 L462 150 L448 150 Z" fill="#ff6b6b"/><rect class="lh-lamp" x="446" y="108" width="18" height="12" rx="2" fill="${night ? '#ffe066' : '#bfe3ff'}"/><path d="M443 108 L455 97 L467 108 Z" fill="#ff6b6b"/></g>`;
  }
  if (c.mood) {
    s += `<g class="flag"><path d="M402 194 V154" stroke="#8a6a55" stroke-width="3" stroke-linecap="round"/><path class="flag-cloth" d="M403 155 C412 152 420 160 430 157 L430 173 C420 176 412 168 403 171 Z" style="fill:var(--mood-${c.mood})" stroke="#fff" stroke-width="1.6"/></g>`;
  }
  if (c.prop) s += propSvg(c.prop, night, popProp);
  if (c.bday) {
    s += `<g class="cake egg" data-egg="cake"><rect x="168" y="198" width="28" height="13" rx="3" fill="#fff4e0"/><path d="M168 202 q4.7 5 9.3 0 q4.7 5 9.3 0 q4.7 5 9.4 0 V198 h-28 Z" fill="#ff8fab"/><rect x="180.5" y="187" width="3" height="11" rx="1" fill="#4fb0f0"/><ellipse class="candle-flame" cx="182" cy="183.5" rx="2.6" ry="4" fill="#ffc24b"/></g>`;
  }
  if (has('flowers')) {
    const fl = [[384, 200, '#ff6b8b'], [400, 207, '#ffb648'], [416, 199, '#ff9f80'], [432, 208, '#ff6b8b'], [282, 208, '#ffe066'], [298, 212, '#4fb0f0']];
    s += `<g class="${cls('flowers')}">${fl.map(([x, y, col]) => `<g class="flower egg" data-egg="flower"><path d="M${x} ${y} v-10" stroke="#3fae79" stroke-width="2" stroke-linecap="round"/><circle cx="${x}" cy="${y - 12}" r="4.6" fill="${col}"/><circle cx="${x}" cy="${y - 12}" r="1.7" fill="#fff6c8"/></g>`).join('')}</g>`;
  }
  if (!reduceMotion()) {
    if (night) s += fireflies();
    else if (has('flowers')) s += butterflies();
  }
  return `${s}</svg>`;
}

function weatherHtml(kind) {
  if (reduceMotion() || !kind || kind === 'none' || kind === 'rainbow') return '';
  const cfg = {
    rain: { n: 36, dur: [0.6, 0.95] },
    snow: { n: 30, dur: [5, 9] },
    breeze: { n: 9, dur: [6, 10] },
    petals: { n: 14, dur: [7, 12] },
    leaves: { n: 12, dur: [6, 10] },
    sunny: { n: 9, dur: [2.4, 4] },
  }[kind];
  if (!cfg) return '';
  let h = `<div class="weather w-${kind}" aria-hidden="true">`;
  for (let i = 0; i < cfg.n; i++) {
    const dur = cfg.dur[0] + Math.random() * (cfg.dur[1] - cfg.dur[0]);
    h += `<i style="--x:${(Math.random() * 100).toFixed(1)}%;--y:${(Math.random() * 70).toFixed(1)}%;--s:${(0.6 + Math.random() * 0.7).toFixed(2)};--sway:${(Math.random() * 40 - 20).toFixed(0)}px;animation-duration:${dur.toFixed(2)}s;animation-delay:${(-Math.random() * dur).toFixed(2)}s"></i>`;
  }
  return `${h}</div>`;
}

function mascotOpts() {
  const a = state.about.answers;
  const w = WEATHER[a.weather];
  return {
    mood: state.checkins[state.today]?.mood ?? 4,
    sleep: mascotState.sleeping,
    dizzy: mascotState.dizzy,
    glasses: mascotState.cool && !mascotState.sleeping,
    hat: isBirthday() ? 'party' : '',
    umbrella: w === 'rain',
    scarf: w === 'snow' || SEASON[a.season] === 'winter',
  };
}
function updateMascot() {
  const m = $('#mascot');
  if (!m || !state) return;
  m.innerHTML = `${mascotSvg(mascotOpts())}<span class="zzz" aria-hidden="true"><i>Z</i><i>z</i><i>z</i></span>`;
  m.classList.toggle('sleeping', mascotState.sleeping);
  m.setAttribute('aria-label', mascotState.sleeping ? '小屿睡着了，戳一下叫醒它' : '戳一戳小屿');
}

function renderScene() {
  const c = sceneContext();
  const key = JSON.stringify(c);
  const box = $('#scene');
  if (key !== sceneKey) {
    const prev = sceneParts;
    sceneKey = key;
    sceneParts = c;
    const fresh = new Set();
    if (knownUnlocked !== null && c.unlocked > knownUnlocked) ISLAND_ITEMS.slice(knownUnlocked, c.unlocked).forEach((it) => fresh.add(it.key));
    knownUnlocked = c.unlocked;
    const popProp = !!(prev && prev.prop !== c.prop && c.prop);
    const cool = !!$('#stage')?.classList.contains('cool');
    box.innerHTML = `<div class="stage${cool ? ' cool' : ''}" id="stage">
        ${skySvg(c)}
        ${weatherHtml(c.weather)}
        <div class="isle-layer"><div class="isle-bob">
          ${isleSvg(c, fresh, { popProp })}
          <button class="mascot" type="button" id="mascot"></button>
          <div class="hints" id="hints" aria-hidden="true"></div>
        </div></div>
      </div>
      <div class="bubble" id="bubble"><p id="bubble-text"></p><button class="bubble-cta" type="button" id="bubble-cta"></button></div>
      <div class="level" id="level"><span class="lv-badge"></span><div class="lv-main"><div class="lv-bar" role="progressbar" aria-label="小屿对你的了解" aria-valuemin="0"><span></span></div><p class="lv-hint"></p></div></div>`;
    updateMascot();
    $('#mascot').onclick = onMascotPoke;
    $('#bubble-cta').onclick = () => doMascotAct($('#bubble-cta').dataset.act);
    bubbleShown = '';
    if (fresh.size && !$('#talk').open) playPendingPops();
  }
  refreshBubble();
  renderLevel(c);
  renderHints();
}

function renderLevel(c) {
  const lv = $('#level');
  if (!lv) return;
  const n = answeredCount();
  const total = state.about.questions.length;
  const next = ISLAND_ITEMS.find((it) => n < it.need);
  $('.lv-badge', lv).textContent = `Lv.${1 + c.unlocked}`;
  const bar = $('.lv-bar', lv);
  bar.setAttribute('aria-valuemax', String(total));
  bar.setAttribute('aria-valuenow', String(n));
  const fill = $('span', bar);
  const pct = (n / total) * 100;
  if (!fill.style.width) {
    fill.style.width = `${levelPct}%`;
    requestAnimationFrame(() => requestAnimationFrame(() => (fill.style.width = `${pct}%`)));
  } else fill.style.width = `${pct}%`;
  levelPct = pct;
  $('.lv-hint', lv).textContent = next ? `了解你 ${n}/${total} · 再聊 ${next.need - n} 题解锁${next.name}` : '小岛已经完全长好啦';
}

function bubbleLine() {
  const total = state.about.questions.length;
  const n = answeredCount();
  const next = ISLAND_ITEMS.find((it) => n < it.need);
  const mood = state.checkins[state.today]?.mood;
  let text = '';
  let cta = null;
  let act = 'hop';
  if (!state.profile.birthday) {
    text = '你好呀，我是小屿！先告诉我你的生日吧。';
    cta = '设置生日';
    act = 'settings';
  } else if (!state.todayCard) {
    text = '今天的卡片还扣着呢，先陪我聊三句，再一起翻开它？';
    cta = '抽今日卡';
    act = 'daily';
  } else if (n < total) {
    text = next ? `我还想多了解你一点。再聊 ${next.need - n} 个问题，岛上会出现${next.name}！` : '我还想多了解你一点。';
    cta = '陪小屿聊聊';
    act = 'about';
  } else if (!mood) {
    text = '今天是什么心情？在下面贴一张心情贴纸吧。';
    cta = '去贴贴纸';
    act = 'mood';
  } else {
    const h = pickHint();
    text = h ? `悄悄告诉你：${h.hint}` : IDLE_LINES[hashStr(state.today) % IDLE_LINES.length];
  }
  if (mood && mood <= 2) text = `${COMFORT_LINES[hashStr(state.today) % COMFORT_LINES.length]}${cta ? '想聊聊天也可以哦。' : ''}`;
  if (isBirthday()) text = '生日快乐！今天岛上为你准备了蛋糕，戳戳看～';
  if (mascotState.sleeping) text = '呼……呼……（小屿睡着了，戳戳它）';
  return { text, cta, act };
}

function typeBubble(text) {
  const el = $('#bubble-text');
  if (!el) return;
  clearInterval(bubbleTimer);
  const chars = [...text];
  if (reduceMotion()) {
    el.textContent = text;
    return;
  }
  let i = 0;
  el.textContent = '';
  bubbleTimer = setInterval(() => {
    i++;
    el.textContent = chars.slice(0, i).join('');
    if (i % 3 === 1 && !NO_BLIP.test(chars[i - 1])) sfx.blip(0.6);
    if (i >= chars.length) clearInterval(bubbleTimer);
  }, 26);
}

function refreshBubble() {
  if (!state || !$('#bubble')) return;
  const line = bubbleLine();
  const cta = $('#bubble-cta');
  cta.hidden = !line.cta;
  cta.textContent = line.cta ?? '';
  cta.dataset.act = line.act;
  $('#bubble').classList.toggle('sleepy', mascotState.sleeping);
  if (sayTimer) return;
  if (line.text !== bubbleShown) {
    bubbleShown = line.text;
    typeBubble(line.text);
  }
}

function say(text, ms = 4000) {
  if (!$('#bubble-text') || !text) return;
  clearTimeout(sayTimer);
  sayTimer = setTimeout(() => {
    sayTimer = 0;
    refreshBubble();
  }, ms);
  bubbleShown = text;
  typeBubble(text);
  $('#bubble').classList.toggle('sleepy', mascotState.sleeping);
  replay($('#bubble'), 'pulse');
}

function doMascotAct(kind) {
  sfx.tap();
  if (kind === 'settings') openSettings();
  else if (kind === 'daily') dailyTalk();
  else if (kind === 'about') aboutTalk();
  else if (kind === 'mood') {
    const panel = $('#mood-panel');
    panel.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
    replay(panel, 'flash');
    setTimeout(() => $('.sticker')?.focus({ preventScroll: true }), 400);
  } else onMascotPoke();
}

function onMascotPoke() {
  const m = $('#mascot');
  if (!m) return;
  if (mascotState.sleeping) {
    mascotState.sleeping = false;
    mascotState.wokeAt = Date.now();
    updateMascot();
    replay(m, 'startle');
    sfx.boing();
    say(pick(WAKE_LINES), 3500);
    void found('wake', m);
    return;
  }
  if (mascotState.dizzy) return;
  const now = Date.now();
  pokes = pokes.filter((t) => now - t < 2500);
  pokes.push(now);
  if (pokes.length >= 6) {
    pokes = [];
    mascotState.dizzy = true;
    updateMascot();
    replay(m, 'dizzy-spin');
    sfx.boing();
    say('别、别戳啦……我晕了～', 3000);
    void found('dizzy', m);
    setTimeout(() => {
      mascotState.dizzy = false;
      updateMascot();
    }, 2600);
    return;
  }
  if (pokes.length >= 2 && now - pokes[pokes.length - 2] < 330) {
    replay(m, 'backflip');
    sfx.whoosh();
    say('看我后空翻！', 2500);
    void found('backflip', m);
    return;
  }
  replay(m, 'jump');
  sfx.boing();
  floatHeart(m, -12);
  setTimeout(() => floatHeart(m, 14), 160);
  say(pick(POKE_LINES), 3000);
  void found('poke', m);
}

function playPendingPops() {
  const st = $('#stage');
  if (!st) return;
  const items = $$('#stage .item.pending');
  if (!items.length) return;
  const sr = st.getBoundingClientRect();
  items.forEach((el, i) => {
    const r = el.getBoundingClientRect();
    const key = [...el.classList].find((c) => c.startsWith('it-'))?.slice(3);
    const name = ISLAND_ITEMS.find((it) => it.key === key)?.name ?? '';
    setTimeout(
      () => {
        el.classList.remove('pending');
        el.classList.add('pop-in');
        sfx.fanfare();
        if (reduceMotion() || !sr.width) return;
        const tag = document.createElement('span');
        tag.className = 'new-tag';
        tag.textContent = `新！${name}`;
        tag.setAttribute('aria-hidden', 'true');
        tag.style.left = `${((r.left + r.width / 2 - sr.left) / sr.width) * 100}%`;
        tag.style.top = `${((r.top - sr.top) / sr.height) * 100}%`;
        st.append(tag);
        setTimeout(() => tag.remove(), 3700);
        burst(r, 20);
      },
      reduceMotion() ? 0 : 250 + i * 420,
    );
  });
}

const EGGS = {
  sun() {
    const st = $('#stage');
    const on = !st.classList.contains('cool');
    st.classList.toggle('cool', on);
    mascotState.cool = on;
    updateMascot();
    sfx.pop();
    say(on ? '太阳好晒！我们一起戴上墨镜～' : '摘下墨镜，眯一下眼睛。', 3200);
  },
  moon(el) {
    const st = $('#stage');
    st.classList.add('moon-wink');
    sfx.sparkle();
    burst(el, 14, ['#fff3c4', '#ffe9a0', '#ffffff']);
    say('嘘——月亮在偷偷看你呢。', 3200);
    clearTimeout(moonTimer);
    moonTimer = setTimeout(() => $('#stage')?.classList.remove('moon-wink'), 2600);
  },
  cloud(el) {
    replay(el, 'squish');
    sfx.soft();
    rainFrom(el);
  },
  tree(el) {
    replay(el, 'shake');
    sfx.shake();
    const s = sceneParts?.season || 'summer';
    burst(el, 14, SEASON_FALL[s]);
    say(TREE_LINES[s], 2800);
  },
  windmill(el) {
    replay(el, 'turbo', 2200);
    sfx.whoosh();
    say('呼呼呼——风车转起来啦！', 2600);
  },
  lighthouse(el) {
    replay(el, 'flash', 1100);
    sfx.chime();
    say('灯塔在给远方的船打招呼。', 2800);
  },
  house(el) {
    const on = el.classList.toggle('lights-on');
    sfx.tap();
    say(on ? '开灯啦，屋里暖暖的。' : '关灯，嘘——', 2400);
  },
  flower(el) {
    replay(el, 'boing');
    sfx.pop();
    floatHeart(el);
  },
  rainbow(el) {
    sfx.sparkle();
    burst(el, 22);
    say('彩虹出现的时候，记得许个愿。', 2800);
  },
  prop(el) {
    replay(el, 'boing');
    sfx.pop();
    say(PROP_LINES[sceneParts?.prop] ?? '', 2800);
  },
  cake(el) {
    if (el.classList.contains('blown')) {
      el.classList.remove('blown');
      sfx.tap();
      return;
    }
    el.classList.add('blown');
    sfx.whoosh();
    burst(el, 34);
    say('呼——生日快乐！愿望一定会实现。', 3600);
  },
};

function onSceneClick(e) {
  const egg = e.target.closest?.('.egg');
  if (!egg || !$('#scene').contains(egg)) return;
  EGGS[egg.dataset.egg]?.(egg);
  if (SECRET_MAP[egg.dataset.egg]) void found(egg.dataset.egg, egg);
}

// ---------- ambient: meteors / balloons / idle sleep / eyes ----------
let ambientTimer = 0;
function scheduleAmbient(first = false) {
  clearTimeout(ambientTimer);
  ambientTimer = setTimeout(
    () => {
      spawnAmbient();
      scheduleAmbient();
    },
    first ? 6000 : 16000 + Math.random() * 22000,
  );
}
function spawnAmbient() {
  if (!state || document.hidden || tab !== 'today' || reduceMotion() || anyOverlay()) return;
  const st = $('#stage');
  if (!st) return;
  if (sceneName() === 'night') spawnMeteor(st);
  else if (!$('.balloon', st)) spawnBalloon(st);
}
function spawnMeteor(st) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'meteor';
  b.setAttribute('aria-label', '流星，点一下许个愿');
  b.style.left = `${58 + Math.random() * 34}%`;
  b.style.top = `${3 + Math.random() * 16}%`;
  b.innerHTML = '<span></span>';
  b.onclick = () => {
    if (b.dataset.done) return;
    b.dataset.done = '1';
    b.classList.add('caught');
    sfx.sparkle();
    burst(b, 26, ['#fff3c4', '#ffe9a0', '#ffffff', '#9fd4ff']);
    say(pick(WISH_LINES), 3200);
    toast('许愿成功', 'gift');
    void found('meteor', b);
    setTimeout(() => b.remove(), 450);
  };
  st.append(b);
  setTimeout(() => b.remove(), 3200);
}
function spawnBalloon(st) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'balloon';
  b.setAttribute('aria-label', '热气球飘过，点一下看看它带来了什么');
  b.style.top = `${2 + Math.random() * 12}%`;
  b.innerHTML = BALLOON_SVG;
  b.onclick = () => {
    if (b.dataset.done) return;
    b.dataset.done = '1';
    b.style.left = getComputedStyle(b).left;
    b.classList.add('lifted');
    sfx.pop();
    void found('balloon', b);
    setTimeout(() => {
      b.remove();
      openPostcard();
    }, 650);
  };
  st.append(b);
  setTimeout(() => b.isConnected && !b.dataset.done && b.remove(), 40000);
}

function idleTick() {
  if (!state || tab !== 'today' || document.hidden || mascotState.sleeping || mascotState.dizzy) return;
  if (anyOverlay() || !$('#mascot')) return;
  const h = new Date().getHours();
  const late = h >= 23 || h < 5;
  const idle = Date.now() - lastActive > 40000;
  if (idle || (late && Date.now() - mascotState.wokeAt > 45000)) {
    mascotState.sleeping = true;
    updateMascot();
    clearTimeout(sayTimer);
    sayTimer = 0;
    refreshBubble();
  }
}

function updateLook() {
  lookRaf = 0;
  if (lookX < 0) return;
  $$('.mascot-svg').forEach((svg) => {
    const r = svg.getBoundingClientRect();
    if (!r.width || r.bottom < 0 || r.top > window.innerHeight) return;
    const dx = lookX - (r.left + r.width * 0.5);
    const dy = lookY - (r.top + r.height * 0.56);
    const d = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, d / 260);
    svg.style.setProperty('--ex', `${((dx / d) * 2.8 * k).toFixed(2)}px`);
    svg.style.setProperty('--ey', `${((dy / d) * 2.2 * k).toFixed(2)}px`);
  });
  const st = $('#stage');
  if (st && tab === 'today') {
    const r = st.getBoundingClientRect();
    const inside = lookY > r.top - 80 && lookY < r.bottom + 80;
    const px = inside ? Math.max(-1, Math.min(1, (lookX - (r.left + r.width / 2)) / (r.width / 2))) : 0;
    const py = inside ? Math.max(-1, Math.min(1, (lookY - (r.top + r.height / 2)) / (r.height / 2))) : 0;
    st.style.setProperty('--px', px.toFixed(3));
    st.style.setProperty('--py', py.toFixed(3));
  }
}

// ---------- card ----------
function cardBack(extra = '') {
  const rays = Array.from({ length: 12 }, (_, i) => `<rect x="38.5" y="9" width="3" height="9" rx="1.5" fill="currentColor" transform="rotate(${i * 30} 40 40)"/>`).join('');
  return `<div class="gback ${extra}" aria-hidden="true"><div class="gback-inner"><svg viewBox="0 0 80 80" class="gback-emblem"><circle cx="40" cy="40" r="35" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2 4"/><g class="emblem-rays">${rays}</g><circle cx="40" cy="40" r="13" fill="currentColor"/><path d="M33 43 q7 6 14 0" fill="none" stroke="#1b5e60" stroke-width="2.4" stroke-linecap="round"/><circle cx="35" cy="37" r="1.8" fill="#1b5e60"/><circle cx="45" cy="37" r="1.8" fill="#1b5e60"/></svg><span class="gback-title">心屿</span></div></div>`;
}

function decoSvg(seed) {
  let h = hashStr(seed);
  const rnd = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    return (h >>> 0) / 4294967296;
  };
  let s = '<svg class="art-deco" viewBox="0 0 300 160" preserveAspectRatio="xMidYMid slice" aria-hidden="true">';
  for (let i = 0; i < 6; i++) s += `<circle cx="${(rnd() * 300).toFixed(0)}" cy="${(rnd() * 160).toFixed(0)}" r="${(8 + rnd() * 40).toFixed(0)}" fill="#fff" opacity="${(0.05 + rnd() * 0.1).toFixed(2)}"/>`;
  for (let i = 0; i < 7; i++) {
    const x = rnd() * 300;
    const y = rnd() * 160;
    const r = 3 + rnd() * 5;
    s += i % 2
      ? `<path d="${starPath(x, y, r)}" fill="#fff" opacity="${(0.35 + rnd() * 0.4).toFixed(2)}"/>`
      : `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(r * 0.45).toFixed(1)}" fill="#fff" opacity="${(0.4 + rnd() * 0.4).toFixed(2)}"/>`;
  }
  return `${s}</svg>`;
}

function cardFront(c) {
  const lines = [];
  if (c.echo) lines.push(['bubble', c.echo]);
  if (c.focusLine) lines.push(['target', c.focusLine]);
  if (c.careLine) lines.push(['leaf', c.careLine]);
  const basis = c.basis ? `由你的生日、${c.basis.daily} 个今日回答和 ${c.basis.about} 条「关于你」生成` : '由你的生日生成';
  const [, mm, dd] = c.date.split('-');
  const shiny = isShiny(c);
  return `<article class="gcard${shiny ? ' shiny' : ''}" style="--c:${esc(c.color.hex)}" aria-label="今日灵感卡：${esc(c.keyword)}${shiny ? '（闪卡）' : ''}">
    <div class="gcard-inner">
      <div class="gloss" aria-hidden="true"></div>
      <div class="gcard-art">
        ${decoSvg(c.date + c.keyword)}
        <div class="art-top"><span class="art-chip">今日灵感 · ${mm}.${dd}</span>${shiny ? '<span class="art-chip shiny-chip">闪卡</span>' : ''}
          <button class="fav-btn" type="button" aria-pressed="${!!c.favorite}" aria-label="${c.favorite ? '取消收藏' : '收藏这张卡'}">${ICON.star(c.favorite)}</button></div>
        <p class="art-label">今日关键词</p>
        <p class="art-kw">${esc(c.keyword)}</p>
        <div class="orb" role="img" aria-label="今日能量 ${c.energy}"><span class="orb-num" data-to="${c.energy}">${c.energy}</span><span class="orb-label">能量</span></div>
      </div>
      <p class="gcard-msg">${esc(c.message)}</p>
      <ul class="stats">${c.dims
        .map(
          (d, r) =>
            `<li><span class="stat-name">${esc(d.label)}</span><span class="pips" role="img" aria-label="${esc(d.label)} ${d.value} / 5">${[1, 2, 3, 4, 5]
              .map((k) => `<i class="${k <= d.value ? 'on' : ''}" style="--k:${k};--row:${r}"></i>`)
              .join('')}</span><span class="stat-val">${d.value}</span></li>`,
        )
        .join('')}</ul>
      <div class="gems">
        <div class="gem"><span class="gem-dot" style="background:${esc(c.color.hex)}"></span><span><small>今日色彩</small>${esc(c.color.name)}</span></div>
        <div class="gem"><span class="gem-num">${c.number}</span><span><small>今日数字</small>${CN_NUM[c.number] ?? c.number}</span></div>
      </div>
      ${lines.length ? `<ul class="gcard-lines">${lines.map(([ic, t]) => `<li><span class="line-ic">${ICON[ic]}</span><span>${esc(t)}</span></li>`).join('')}</ul>` : ''}
      <div class="dos">
        <div><span class="tag-pill ok">适合</span><ul>${c.suits.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>
        <div><span class="tag-pill hold">先放放</span><ul>${c.pauses.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>
      </div>
      <p class="gcard-foot">${basis}</p>
    </div>
  </article>`;
}

function bindCard(root, c) {
  const card = $('.gcard', root);
  const fav = $('.fav-btn', root);
  if (fav) {
    fav.onclick = async () => {
      const r = await act('POST', `/api/card/${c.date}/favorite`);
      if (r.ok) {
        const btn = $('#pass .fav-btn');
        replay(btn, 'bump', 520);
        if (r.result) {
          sfx.sparkle();
          burst(btn, 16, ['#ffe066', '#ffc24b', '#ffffff']);
          toast('已收进卡牌收藏册', 'gift');
        } else {
          sfx.soft();
          toast('已取消收藏');
        }
      }
    };
  }
  if (!card || reduceMotion()) return;
  card.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const r = card.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    card.style.setProperty('--rx', `${(0.5 - py) * 8}deg`);
    card.style.setProperty('--ry', `${(px - 0.5) * 10}deg`);
    card.style.setProperty('--gx', `${px * 100}%`);
    card.style.setProperty('--gy', `${py * 100}%`);
    card.classList.add('tilting');
  });
  card.addEventListener('pointerleave', () => {
    card.style.setProperty('--rx', '0deg');
    card.style.setProperty('--ry', '0deg');
    card.classList.remove('tilting');
  });
}

function renderPass() {
  const box = $('#pass');
  const c = state.todayCard;
  $('#card-sub').textContent = `已收集 ${state.cardCount} 张`;
  if (!state.profile.birthday) {
    box.innerHTML = `<div class="deck-wrap"><div class="deck locked">${cardBack('d3')}${cardBack('d2')}${cardBack('d1')}</div>
      <p class="deck-text">先告诉小屿你的生日，才能抽出只属于你的卡。</p>
      <button class="gbtn primary big" type="button" id="deck-bday">设置生日</button></div>`;
    $('#deck-bday').onclick = openSettings;
    return;
  }
  if (!c) {
    box.innerHTML = `<div class="deck-wrap"><button class="deck" type="button" id="deck" aria-label="抽一张今日灵感卡">${cardBack('d3')}${cardBack('d2')}${cardBack('d1')}</button>
      <p class="deck-text">回答小屿的三个小问题，你的选择会和生日一起决定今天这张卡。偶尔还会抽到闪卡哦。</p>
      <button class="gbtn primary big" type="button" id="draw-btn">抽一张</button></div>`;
    $('#draw-btn').onclick = dailyTalk;
    $('#deck').onclick = dailyTalk;
    return;
  }
  if (flipPending) {
    if ($('.flipper', box)?.dataset.date === c.date) return;
    box.innerHTML = `<div class="flip-stage"><div class="flipper" data-date="${esc(c.date)}"><div class="face back-face" inert>${cardBack('solo')}</div><div class="face front-face">${cardFront(c)}</div></div></div>`;
    $('.orb-num', box).textContent = '0';
    bindCard(box, c);
    return;
  }
  box.innerHTML = cardFront(c);
  bindCard(box, c);
}

async function startFlip() {
  const box = $('#pass');
  const flipper = $('.flipper', box);
  if (!flipper) {
    flipPending = false;
    renderPass();
    return;
  }
  const c = state.todayCard;
  const shiny = c ? isShiny(c) : false;
  box.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
  await wait(420);
  flipper.classList.add('charging');
  sfx.charge();
  await wait(700);
  flipper.classList.remove('charging');
  flipper.classList.add('flipped');
  sfx.whoosh();
  await wait(560);
  const card = $('.gcard', box);
  card?.classList.add('animate');
  burst(card, shiny ? 52 : 30);
  if (shiny) {
    sfx.sparkle();
    toast('哇！抽到了一张闪卡', 'gift');
    setTimeout(() => void found('shiny', $('#pass .gcard')), reduceMotion() ? 0 : 1700);
  } else sfx.chime();
  const num = $('.orb-num', box);
  if (num) countUp(num, Number(num.dataset.to), 1000);
  await wait(1100);
  flipPending = false;
}

// ---------- mood stickers ----------
function renderCheckin() {
  const box = $('#checkin-body');
  const today = state.checkins[state.today];
  if (today && !editingCheckin) {
    box.innerHTML = `<div class="stuck"><div class="stuck-sticker">${face(today.mood)}<span class="tape" aria-hidden="true"></span></div>
      <div class="grow"><p class="stuck-title">今天是「${MOODS[today.mood]}」</p><p class="stuck-note">${today.note ? esc(today.note) : '没有写备注'}</p></div>
      <button class="gbtn sm ghost" type="button" id="checkin-edit">换一张</button></div>`;
    $('#checkin-edit').onclick = () => {
      editingCheckin = true;
      selectedMood = today.mood;
      renderCheckin();
      $('#mood-note').value = today.note || '';
    };
    return;
  }
  const prevNote = $('#mood-note')?.value ?? '';
  const tilts = [-7, 4, -3, 6, -5];
  box.innerHTML = `
    <div class="stickers${selectedMood ? ' has-sel' : ''}" role="radiogroup" aria-label="选择心情贴纸">
      ${[5, 4, 3, 2, 1]
        .map(
          (v, i) =>
            `<button type="button" class="sticker" role="radio" data-v="${v}" aria-checked="${selectedMood === v}" tabindex="${selectedMood === v || (!selectedMood && v === 5) ? 0 : -1}" style="--tilt:${tilts[i]}deg">${face(v)}<span>${MOODS[v]}</span></button>`,
        )
        .join('')}
    </div>
    <form class="input-row" id="checkin-form">
      <label class="sr-only" for="mood-note">一句话备注</label>
      <input class="field" id="mood-note" maxlength="140" placeholder="一句话说说为什么（可不填）" autocomplete="off" />
      ${editingCheckin ? '<button class="gbtn ghost" type="button" id="checkin-cancel">取消</button>' : ''}
      <button class="gbtn primary" type="submit" id="checkin-submit" ${selectedMood ? '' : 'disabled'}>贴上</button>
    </form>`;
  $('#mood-note').value = prevNote;
  const group = $('.stickers', box);
  const radios = $$('.sticker', box);
  const select = (v, focus) => {
    selectedMood = v;
    group.classList.add('has-sel');
    radios.forEach((b) => {
      const on = Number(b.dataset.v) === v;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on) {
        replay(b, 'boing', 650);
        if (focus) b.focus();
      }
    });
    sound.tone(300 + v * 90, { dur: 0.16, vol: 0.32, slide: 240 });
    $('#checkin-submit').disabled = false;
  };
  radios.forEach((b, idx) => {
    b.onclick = () => select(Number(b.dataset.v), false);
    b.onkeydown = (e) => {
      const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const nb = radios[(idx + d + radios.length) % radios.length];
      select(Number(nb.dataset.v), true);
    };
  });
  if (editingCheckin) {
    $('#checkin-cancel').onclick = () => {
      editingCheckin = false;
      selectedMood = null;
      renderCheckin();
    };
  }
  $('#checkin-form').onsubmit = async (e) => {
    e.preventDefault();
    if (!selectedMood) return;
    const mood = selectedMood;
    const note = $('#mood-note').value;
    const wasEditing = editingCheckin;
    const from = $('.sticker[aria-checked="true"] .face', box)?.getBoundingClientRect();
    const prevStreak = state.streak;
    editingCheckin = false;
    const r = await act('POST', '/api/checkin', { mood, note });
    if (!r.ok) {
      editingCheckin = wasEditing;
      renderCheckin();
      $('#mood-note').value = note;
      return;
    }
    selectedMood = null;
    sfx.pop();
    if (wasEditing) {
      toast('换好新贴纸啦');
      burst($('.stuck-sticker'), 14);
      return;
    }
    toast('贴好啦，今天也辛苦了');
    const pill = $('#streak-pill');
    flyTo(face(mood), from, pill, {
      onDone: () => {
        replay(pill, 'bump', 520);
        plusOne(pill, state.streak > prevStreak ? '+1' : '✓');
        burst(pill, 12, ['#ff9a3d', '#ffc24b', '#ff7a59']);
        sfx.chime();
        maybeMilestone();
      },
    });
  };
}

function maybeMilestone() {
  const n = state.streak;
  if (!MILESTONES.includes(n)) return;
  if (state.flags?.[`ms.${n}`] === state.today) return;
  setFlag(`ms.${n}`, state.today);
  setTimeout(() => celebrateStreak(n), reduceMotion() ? 0 : 450);
}

// ---------- joy jar ----------
const JAR_BODY = 'M26 36 C20 36 17 41 17 47 V118 C17 128 25 134 35 134 H85 C95 134 103 128 103 118 V47 C103 41 100 36 94 36 Z';
function renderJar() {
  const jar = $('#jar');
  if (!knownJoyIds) knownJoyIds = new Set(state.joys.map((j) => j.id));
  const shown = state.joys.slice(0, 25).reverse();
  let stars = '';
  shown.forEach((j, i) => {
    const h = hashStr(j.id);
    const row = Math.floor(i / 5);
    const col = i % 5;
    const x = 28 + col * 14 + (row % 2 ? 6 : 0) + ((h % 7) - 3);
    const y = 121 - row * 12 + (((h >> 3) % 5) - 2);
    const isNew = !knownJoyIds.has(j.id);
    stars += `<g transform="translate(${x} ${y}) rotate(${(h % 70) - 35})"><path class="jstar${isNew ? ' new' : ''}" d="${starPath(0, 0, 7.5)}" fill="${STAR_COLORS[h % STAR_COLORS.length]}" stroke="rgb(0 0 0 / 14%)" stroke-width="1" stroke-linejoin="round"/></g>`;
  });
  knownJoyIds = new Set(state.joys.map((j) => j.id));
  jar.innerHTML = `<svg viewBox="0 0 120 140" aria-hidden="true">
    <defs><clipPath id="jarClip"><path d="${JAR_BODY}"/></clipPath></defs>
    <path class="glass-back" d="${JAR_BODY}"/>
    <g clip-path="url(#jarClip)">${stars}</g>
    <path class="glass" d="${JAR_BODY}"/>
    <path class="shine" d="M28 54 V104"/><path class="shine sm" d="M28 112 V116"/>
    <rect class="jar-label" x="38" y="44" width="44" height="17" rx="4"/><text class="jar-label-text" x="60" y="56.5" text-anchor="middle">小确幸</text>
    <rect x="20" y="24" width="80" height="14" rx="5" fill="#ff7a59"/><rect x="25" y="17" width="70" height="9" rx="4.5" fill="#ff9a7d"/><path d="M30 31 h60" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-dasharray="1 5" opacity=".7"/>
  </svg>`;
  const total = state.joyCount ?? state.joys.length;
  $('#jar-count').innerHTML = total ? `罐子里有 <strong>${total}</strong> 颗星星` : '罐子还空着';
}

function shakeJar() {
  const jar = $('#jar');
  replay(jar, 'shaking', 700);
  sfx.shake();
  void found('jar', jar);
  if (!state.joys.length) {
    $('#jar-memory').innerHTML = '<p class="memory empty-mem">罐子还空着，先放一颗星星进去吧。</p>';
    return;
  }
  setTimeout(
    () => {
      const older = state.joys.filter((j) => j.date !== state.today);
      const pool = older.length ? older : state.joys;
      const j = pool[randInt(pool.length)];
      $('#jar-memory').innerHTML = `<div class="memory"><p class="mem-k">${j.date === state.today ? '今天放进去的' : `还记得吗？${prettyDate(j.date)}`}</p><p class="mem-t">${esc(j.text)}</p></div>`;
      burst(jar, 12, STAR_COLORS);
      sfx.sparkle();
    },
    reduceMotion() ? 0 : 650,
  );
}

function slip(j, withDate) {
  const h = hashStr(j.id);
  return `<li class="slip" style="--r:${((h % 7) - 3) * 0.8}deg;--tape:${TAPES[h % TAPES.length]}"><span class="slip-text">${esc(j.text)}</span>${withDate ? `<span class="slip-date">${prettyDate(j.date)}</span>` : ''}<button class="slip-del" type="button" data-joy="${esc(j.id)}" aria-label="删除：${esc(j.text)}">${ICON.xmark}</button></li>`;
}
function bindJoyDeletes(root) {
  $$('[data-joy]', root).forEach((b) => {
    b.onclick = async () => {
      if (await confirmModal('拿出这颗星星？', '删除后无法恢复。', '删除')) {
        const r = await act('DELETE', `/api/joys/${b.dataset.joy}`);
        if (r.ok) toast('已删除');
      }
    };
  });
}
function renderJoysToday() {
  const list = $('#joy-today');
  const todays = state.joys.filter((j) => j.date === state.today);
  $('#joy-sub').textContent = todays.length ? `今天放进了 ${todays.length} 颗` : '让你嘴角上扬的小事';
  list.innerHTML = todays.map((j) => slip(j, false)).join('');
  bindJoyDeletes(list);
}

// ---------- journal ----------
function renderJournal() {
  const ck = state.checkins;
  const now = parseDate(state.today);
  if (!calCursor) calCursor = { y: now.getFullYear(), m: now.getMonth() };
  const prefix = state.today.slice(0, 7);
  const monthVals = Object.entries(ck).filter(([d]) => d.startsWith(prefix)).map(([, v]) => v.mood);
  const avg = monthVals.length ? Math.round((monthVals.reduce((a, b) => a + b, 0) / monthVals.length) * 10) / 10 : 0;
  $('#kpis').innerHTML = [
    ['flame', '#ff8a3d', '连续打卡', state.streak, '天'],
    ['stamp', '#4fb0f0', '本月打卡', monthVals.length, '天'],
    ['heart', '#ff6f8e', '本月心情', avg || null, avg ? MOODS[Math.round(avg)] : ''],
    ['cards', '#2fb5a5', '收集卡牌', state.cardCount, '张'],
  ]
    .map(
      ([ic, c, k, v, u]) =>
        `<div class="badge" style="--bc:${c}"><span class="medal">${ICON[ic]}</span><div><p class="badge-k">${k}</p><p class="badge-v">${v == null ? '—' : `<span class="num" data-to="${v}">${Number.isInteger(v) ? v : v.toFixed(1)}</span>`}<small>${u}</small></p></div></div>`,
    )
    .join('');

  renderCalendar();
  renderTrend();

  const recs = Object.entries(ck).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 60);
  const rl = $('#records');
  rl.innerHTML = recs.length
    ? recs
        .map(
          ([d, v]) =>
            `<li>${face(v.mood, 'mini')}<div class="rec-main"><p class="rec-title">${MOODS[v.mood]}<span class="rec-date">${prettyDate(d)}</span></p>${v.note ? `<p class="rec-sub">${esc(v.note)}</p>` : ''}</div>
          <button class="round-btn sm ghost" type="button" data-ck="${d}" aria-label="删除 ${prettyDate(d)} 的打卡">${ICON.trash}</button></li>`,
        )
        .join('')
    : '<li class="empty">还没有打卡记录。回小岛贴第一张心情贴纸吧。</li>';
  $$('[data-ck]', rl).forEach((b) => {
    b.onclick = async () => {
      if (await confirmModal('撕掉这张贴纸？', `将删除 ${prettyDate(b.dataset.ck)} 的心情记录。`, '删除')) {
        const r = await act('DELETE', `/api/checkin/${b.dataset.ck}`);
        if (r.ok) toast('已删除');
      }
    };
  });

  $('#fav-count').textContent = state.favorites.length ? `${state.favorites.length} 张` : '';
  $('#favorites').innerHTML = state.favorites.length
    ? `<div class="fav-scroll">${state.favorites
        .map(
          (c) =>
            `<article class="mini-card${isShiny(c) ? ' shiny' : ''}" style="--c:${esc(c.color.hex)}" aria-label="${prettyDate(c.date)} 灵感卡：${esc(c.keyword)}"><p class="mini-date">${prettyDate(c.date)}</p><p class="mini-kw">${esc(c.keyword)}</p><p class="mini-msg">${esc(c.message)}</p></article>`,
        )
        .join('')}</div>`
    : '<p class="empty">喜欢的灵感卡点右上角的星星，就会收进这里。</p>';

  $('#joy-count').textContent = state.joys.length ? `共 ${state.joyCount ?? state.joys.length} 颗` : '';
  const wall = $('#joy-wall');
  wall.innerHTML = state.joys.length ? state.joys.map((j) => slip(j, true)).join('') : '<li class="empty">星星会慢慢在这里贴成一面墙。</li>';
  bindJoyDeletes(wall);
}

function renderCalendar() {
  const { y, m } = calCursor;
  $('#cal-month').textContent = `${y}年${m + 1}月`;
  const days = new Date(y, m + 1, 0).getDate();
  const lead = (new Date(y, m, 1).getDay() + 6) % 7;
  let html = '<div class="cal" role="list" aria-label="心情月历">';
  html += ['一', '二', '三', '四', '五', '六', '日'].map((w) => `<div class="wd" aria-hidden="true">${w}</div>`).join('');
  for (let i = 0; i < lead; i++) html += '<div aria-hidden="true"></div>';
  for (let d = 1; d <= days; d++) {
    const key = fmtDate(new Date(y, m, d));
    const v = state.checkins[key];
    const isToday = key === state.today;
    const label = `${m + 1}月${d}日：${v ? MOODS[v.mood] : '未打卡'}${isToday ? '（今天）' : ''}`;
    if (isToday && !v) {
      html += `<div class="day today" role="listitem"><button class="day-add" type="button" id="cal-today" aria-label="今天还没贴，去贴一张">+</button></div>`;
      continue;
    }
    html += `<div class="day${v ? ' has' : ''}${isToday ? ' today' : ''}${key > state.today ? ' future' : ''}" role="listitem" title="${esc(label)}${v?.note ? `｜${esc(v.note)}` : ''}">
      ${v ? face(v.mood) : `<span aria-hidden="true">${d}</span>`}<span class="sr-only">${esc(label)}</span></div>`;
  }
  html += '</div>';
  $('#calendar').innerHTML = html;
  $('#cal-today')?.addEventListener('click', () => {
    setTab('today', true);
    setTimeout(() => doMascotAct('mood'), reduceMotion() ? 0 : 350);
  });
  const now = parseDate(state.today);
  $('#cal-next').disabled = y > now.getFullYear() || (y === now.getFullYear() && m >= now.getMonth());
  $('#legend').innerHTML = [5, 4, 3, 2, 1].map((v) => `<span>${face(v, 'tiny')}${MOODS[v]}</span>`).join('');
}

function smoothPath(pts) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

function renderTrend() {
  const end = parseDate(state.today);
  const pts = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    const key = fmtDate(d);
    pts.push({ key, i: 29 - i, v: state.checkins[key]?.mood ?? null });
  }
  const W = 600;
  const H = 200;
  const L = 34;
  const R = 14;
  const T = 18;
  const B = 28;
  const x = (i) => L + (i / 29) * (W - L - R);
  const yv = (v) => T + ((5 - v) / 4) * (H - T - B);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="近 30 天心情曲线"><defs><linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--teal);stop-opacity:.32"/><stop offset="1" style="stop-color:var(--teal);stop-opacity:0"/></linearGradient></defs>`;
  for (let v = 1; v <= 5; v++) svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${yv(v)}" y2="${yv(v)}"/>`;
  [1, 3, 5].forEach((v) => (svg += `<text class="axis" x="${L - 8}" y="${yv(v) + 3}" text-anchor="end">${MOODS[v]}</text>`));
  [0, 7, 14, 21, 29].forEach((i) => {
    const d = parseDate(pts[i].key);
    svg += `<text class="axis" x="${x(i)}" y="${H - 8}" text-anchor="middle">${d.getMonth() + 1}/${d.getDate()}</text>`;
  });
  const segs = [];
  let seg = [];
  pts.forEach((p) => {
    if (p.v) seg.push([x(p.i), yv(p.v)]);
    else if (seg.length) {
      segs.push(seg);
      seg = [];
    }
  });
  if (seg.length) segs.push(seg);
  segs.forEach((sg) => {
    if (sg.length < 2) return;
    const d = smoothPath(sg);
    svg += `<path class="area" d="${d} L${sg[sg.length - 1][0]},${H - B} L${sg[0][0]},${H - B} Z"/><path class="line" d="${d}"/>`;
  });
  pts.filter((p) => p.v).forEach((p) => {
    svg += `<g transform="translate(${x(p.i) - 9} ${yv(p.v) - 9}) scale(.45)">${face(p.v).replace('<svg ', '<svg width="40" height="40" ')}</g>`;
  });
  svg += '</svg>';
  const vals = pts.filter((p) => p.v);
  let head = '<p class="trend-sub">近 30 天还没有打卡，曲线会随着贴纸慢慢长出来。</p>';
  if (vals.length) {
    const avg = vals.reduce((s, p) => s + p.v, 0) / vals.length;
    const good = vals.filter((p) => p.v >= 4).length;
    head = `<div class="trend-head"><p class="trend-value">${avg.toFixed(1)}<small>${MOODS[Math.round(avg)]}</small></p><p class="trend-sub">平均心情 · 打卡 ${vals.length} 天，其中 ${good} 天心情不错</p></div>`;
  }
  $('#trend').innerHTML = `${head}<div class="chart">${svg}</div>`;
}

function animateJournal() {
  if (reduceMotion()) return;
  $$('#kpis .num[data-to]').forEach((el) => countUp(el, Number(el.dataset.to)));
  $$('#trend .line').forEach((p) => {
    const len = p.getTotalLength();
    p.style.transition = 'none';
    p.style.strokeDasharray = `${len}`;
    p.style.strokeDashoffset = `${len}`;
    p.getBoundingClientRect();
    p.style.transition = 'stroke-dashoffset 1.3s cubic-bezier(.22,1,.36,1)';
    p.style.strokeDashoffset = '0';
  });
}

// ---------- slot machine ----------
const ROW = 44;
const CENTER = 66;
function renderChips(win = -1) {
  const ul = $('#picker-chips');
  ul.innerHTML = pickerOptions.length
    ? pickerOptions
        .map(
          (o, i) =>
            `<li class="tag${i === win ? ' win' : ''}"><span>${esc(o)}</span><button class="tag-x" type="button" data-opt="${i}" aria-label="移除选项：${esc(o)}" ${picking ? 'disabled' : ''}>${ICON.xmark}</button></li>`,
        )
        .join('')
    : '<li class="empty">还没有选项，至少需要两个。</li>';
  $$('[data-opt]', ul).forEach((b) => {
    b.onclick = () => {
      pickerOptions.splice(Number(b.dataset.opt), 1);
      sfx.soft();
      resetPick();
    };
  });
  $('#picker-go').disabled = picking || pickerOptions.length < 2;
  $('#lever').disabled = picking || pickerOptions.length < 2;
  $('#picker-clear').disabled = picking || !pickerOptions.length;
}
function resetPick() {
  wheelIndex = 0;
  wheelWinner = null;
  $('#picker-result').innerHTML = '';
  renderChips();
  renderWheel();
}
function renderWheel() {
  const w = $('#wheel');
  if (pickerOptions.length < 2) {
    w.innerHTML = '<div class="reel-band" aria-hidden="true"></div><p class="reel-empty">放入至少两个选项</p>';
    return;
  }
  if (wheelIndex >= pickerOptions.length) wheelIndex = 0;
  w.innerHTML = `<div class="reel-band" aria-hidden="true"></div><ul class="reel-list" aria-hidden="true" style="transform:translateY(${CENTER - wheelIndex * ROW}px)">${pickerOptions
    .map((o, i) => `<li class="${i === wheelWinner ? 'win' : ''}">${esc(o)}</li>`)
    .join('')}</ul>`;
}
function tween(list, from, to, dur, ease, lastIdxRef) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      const y = from + (to - from) * ease(t);
      list.style.transform = `translateY(${y.toFixed(1)}px)`;
      const idx = Math.round((CENTER - y) / ROW);
      if (idx !== lastIdxRef.v) {
        lastIdxRef.v = idx;
        sfx.tick();
      }
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
}
async function runPicker() {
  const n = pickerOptions.length;
  if (picking || n < 2) return;
  const winner = randInt(n);
  picking = true;
  wheelWinner = null;
  renderChips();
  $('#picker-result').innerHTML = '';
  const slot = $('#slot');
  slot.classList.add('spinning');
  replay($('#lever'), 'pulled', 800);
  sfx.thunk();
  const loops = Math.max(5, Math.ceil(18 / n) + 1);
  const items = [];
  for (let k = 0; k <= loops; k++) items.push(...pickerOptions);
  const target = (loops - 1) * n + winner;
  const w = $('#wheel');
  const y0 = CENTER - wheelIndex * ROW;
  const y1 = CENTER - target * ROW;
  w.innerHTML = `<div class="reel-band" aria-hidden="true"></div><ul class="reel-list" aria-hidden="true" style="transform:translateY(${y0}px)">${items.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>`;
  const list = $('.reel-list', w);
  if (!reduceMotion()) {
    const ref = { v: wheelIndex };
    await wait(260);
    await tween(list, y0, y1 - 16, 2600, (t) => 1 - (1 - t) ** 3, ref);
    await tween(list, y1 - 16, y1, 420, (t) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2, ref);
  }
  sfx.thunk();
  slot.classList.remove('spinning');
  slot.classList.add('won');
  setTimeout(() => slot.classList.remove('won'), 1600);
  wheelIndex = winner;
  wheelWinner = winner;
  picking = false;
  renderWheel();
  renderChips(winner);
  $('#picker-result').innerHTML = `<div class="win-banner"><p>就决定是</p><strong>${esc(pickerOptions[winner])}</strong><p class="win-hint">如果结果出来那一刻你有点失望，也许你心里更想要另一个。</p></div>`;
  burst($('#slot'), 26);
  sfx.fanfare();
}

// ---------- answer book ----------
function renderBook(animate = false) {
  const box = $('#book-stage');
  const a = lastAnswer;
  box.innerHTML = `<div class="book${a && !animate ? ' open' : ''}">
    <div class="book-page"><p class="book-q">${a ? `关于「${esc(a.question)}」` : '默念一个问题'}</p><p class="book-a">${a ? esc(a.answer) : '然后翻开这本书'}</p>${a?.dup ? '<p class="book-note">今天问过啦，答案没有变哦</p>' : ''}</div>
    <div class="book-cover"><div class="cover-front"><span class="cover-star">${ICON.star5}</span><span class="cover-title">答案之书</span><span class="cover-sub">THE BOOK OF ANSWERS</span></div><div class="cover-back"></div></div>
  </div>`;
  if (animate && a) {
    const book = $('.book', box);
    book.classList.add('tremble');
    sfx.shake();
    setTimeout(
      () => {
        book.classList.remove('tremble');
        void nextFrame().then(() => {
          book.classList.add('open', 'fresh');
          sfx.page();
          setTimeout(
            () => {
              burst($('.book-page', box), 16, ['#ffe066', '#ffc24b', '#ff9f80', '#ffffff']);
              sfx.chime();
            },
            reduceMotion() ? 0 : 900,
          );
        });
      },
      reduceMotion() ? 0 : 420,
    );
  }
}
function renderBookHistory() {
  const ul = $('#book-history');
  ul.innerHTML = state.answers.length
    ? state.answers.map((a) => `<li><div class="rec-main"><p class="rec-sub">${prettyDate(a.date)} · ${esc(a.question)}</p><p class="rec-title">${esc(a.answer)}</p></div></li>`).join('')
    : '<li class="empty">翻过的页会留在这里。</li>';
  $('#book-clear').disabled = !state.answers.length;
}

// ---------- explore ----------
function renderAbout() {
  const { questions, answers } = state.about;
  const n = answeredCount();
  const next = ISLAND_ITEMS.find((it) => n < it.need);
  $('#about-head').innerHTML = `<div class="about-mascot" aria-hidden="true">${mascotSvg({ mood: 5 })}</div>
    <div class="grow"><p class="about-title">小屿已经知道 <strong>${n}</strong> / ${questions.length} 件关于你的事</p>
      <div class="lv-bar" role="progressbar" aria-label="了解进度" aria-valuemin="0" aria-valuemax="${questions.length}" aria-valuenow="${n}"><span style="width:${(n / questions.length) * 100}%"></span></div>
      <p class="about-sub">${next ? `再聊 ${next.need - n} 题，小岛会出现${next.name}` : '你的小岛已经完全长好啦'} · 天气、季节和周末的回答还会改变小岛的样子</p></div>
    ${n < questions.length ? '<button class="gbtn primary" type="button" id="about-continue">继续聊</button>' : ''}`;
  $('#about-continue')?.addEventListener('click', () => aboutTalk());
  const list = $('#about-list');
  list.innerHTML = questions
    .map((q) => {
      const a = answers[q.id];
      return `<li><button class="entry${a == null ? ' blank' : ''}" type="button" data-q="${esc(q.id)}"><span class="entry-ic">${a == null ? ICON.question : ICON.check}</span><span class="entry-q">${esc(q.q)}</span><span class="entry-a">${a == null ? '还没告诉小屿' : esc(q.options[a])}</span><span class="entry-chev">${ICON.chevR}</span></button></li>`;
    })
    .join('');
  $$('[data-q]', list).forEach((b) => (b.onclick = () => aboutTalk(b.dataset.q)));
}

function renderFlower() {
  const box = $('#flower-body');
  const b = state.birth;
  if (!b) {
    box.innerHTML = '<p class="muted">每个月都有一朵属于它的生日花。填写生日后，这里会长出你的那一朵。</p><div class="btn-row"><button class="gbtn primary" type="button" id="flower-set">设置生日</button></div>';
    $('#flower-set').onclick = openSettings;
    return;
  }
  const until = b.untilBirthday === 0 ? '就是今天' : `${b.untilBirthday} 天`;
  box.innerHTML = `<div class="flower-hero"><button class="flower-icon" type="button" id="flower-icon" aria-label="摸摸${esc(b.flower)}">${FLOWER}</button><div><p class="hero-kicker">${b.month}月生日花</p><p class="hero-name">${esc(b.flower)}</p><p class="hero-sub">花语 · ${esc(b.words)}</p></div></div>
    <p class="flower-sketch">${esc(b.sketch)}</p>
    ${b.untilBirthday === 0 ? '<p class="win-banner small">生日快乐！今天的灵感卡也是给你的小礼物。</p>' : ''}
    <dl class="facts">
      <div><dt>出生季节</dt><dd>${esc(b.season)}天</dd></div>
      <div><dt>来到地球</dt><dd>${b.daysLived.toLocaleString('zh-CN')} 天</dd></div>
      <div><dt>距下次生日</dt><dd>${until}</dd></div>
    </dl>`;
  $('#flower-icon').onclick = (e) => {
    replay(e.currentTarget, 'boing', 650);
    burst(e.currentTarget, 18, ['#ffc2d1', '#ff9fb8', '#ffe3ea', '#ffe066']);
    sfx.sparkle();
  };
}

function styleArt(key) {
  if (key === 'dawn') {
    return `<svg class="style-art art-dawn" viewBox="0 0 80 80" aria-hidden="true"><g class="sa-rays">${Array.from({ length: 10 }, (_, i) => `<rect x="38" y="4" width="4" height="12" rx="2" fill="#fff" opacity=".85" transform="rotate(${i * 36} 40 40)"/>`).join('')}</g><circle cx="40" cy="40" r="16" fill="#fff"/></svg>`;
  }
  if (key === 'ocean') {
    return '<svg class="style-art art-ocean" viewBox="0 0 80 80" aria-hidden="true"><g class="sa-wave"><path d="M-40 42 q10 -8 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 v40 h-120 z" fill="#fff" opacity=".9"/></g><g class="sa-wave w2"><path d="M-40 54 q10 -8 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 v40 h-120 z" fill="#fff" opacity=".5"/></g></svg>';
  }
  if (key === 'forest') {
    return '<svg class="style-art art-forest" viewBox="0 0 80 80" aria-hidden="true"><g class="sa-leaf"><path d="M40 72 C18 52 20 24 40 8 C60 24 62 52 40 72 Z" fill="#fff" opacity=".9"/><path d="M40 70 V20 M40 40 l-10 -8 M40 52 l10 -9" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity=".55"/></g></svg>';
  }
  return `<svg class="style-art art-spark" viewBox="0 0 80 80" aria-hidden="true">${[[40, 36, 15], [16, 18, 6], [64, 60, 8], [20, 62, 5], [62, 16, 5]].map(([x, y, r], i) => `<path class="sa-star" style="animation-delay:${i * 0.3}s" d="${starPath(x, y, r)}" fill="#fff"/>`).join('')}</svg>`;
}

function renderQuiz() {
  const box = $('#quiz-body');
  const res = state.quiz;
  if (res?.detail) {
    const d = res.detail;
    const meta = STYLE_META[res.style] ?? STYLE_META.dawn;
    const total = Object.values(res.scores).reduce((a, b) => a + b, 0) || 1;
    box.innerHTML = `<div class="style-hero" style="--a:${meta.a};--b:${meta.b}"><div><p class="hero-kicker">你的能量风格</p><p class="hero-name">${esc(d.name)}</p><span class="hero-tag">${esc(d.tag)}</span></div>${styleArt(res.style)}</div>
      <p class="style-summary">${esc(d.summary)}</p>
      <ul class="bullets">${d.strengths.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
      <dl class="kv"><div><dt>充电方式</dt><dd>${esc(d.recharge)}</dd></div><div><dt>小提醒</dt><dd>${esc(d.tip)}</dd></div></dl>
      <ul class="scores" aria-label="各风格得分">${QUIZ_KEYS.map((k) => `<li><span>${STYLE_META[k].name}</span><span class="score-bar"><span style="width:${(res.scores[k] / total) * 100}%;background:${STYLE_META[k].a}"></span></span><span>${res.scores[k]}</span></li>`).join('')}</ul>
      <div class="btn-row"><button class="gbtn" type="button" id="quiz-start">重新测试</button></div>`;
  } else {
    box.innerHTML = `<p class="muted">每个人补充能量的方式都不一样。陪小屿回答 8 个日常小场景，看看你更像哪一种。</p>
      <ul class="style-chips">${QUIZ_KEYS.map((k) => `<li style="--a:${STYLE_META[k].a};--b:${STYLE_META[k].b}">${STYLE_META[k].name}</li>`).join('')}</ul>
      <div class="btn-row"><button class="gbtn primary" type="button" id="quiz-start">开始小测</button></div>`;
  }
  $('#quiz-start').onclick = quizTalk;
}

// ---------- settings ----------
function birthdayPicker(prefix, value, labelledBy) {
  const [vy, vm, vd] = (value || '').split('-').map(Number);
  const nowY = new Date().getFullYear();
  const opt = (v, label, sel) => `<option value="${v}" ${sel ? 'selected' : ''}>${label}</option>`;
  let years = opt('', '年', !vy);
  for (let y = nowY; y >= 1900; y--) years += opt(y, `${y}年`, y === vy);
  let months = opt('', '月', !vm);
  for (let m = 1; m <= 12; m++) months += opt(m, `${m}月`, m === vm);
  let days = opt('', '日', !vd);
  for (let d = 1; d <= 31; d++) days += opt(d, `${d}日`, d === vd);
  return `<div class="bday" role="group" aria-labelledby="${labelledBy}">
    <select class="field" id="${prefix}-y" aria-label="出生年份">${years}</select>
    <select class="field" id="${prefix}-m" aria-label="出生月份">${months}</select>
    <select class="field" id="${prefix}-d" aria-label="出生日">${days}</select></div>`;
}
function readBirthday(prefix) {
  const y = $(`#${prefix}-y`).value;
  const m = $(`#${prefix}-m`).value;
  const d = $(`#${prefix}-d`).value;
  if (!y && !m && !d) return '';
  if (!y || !m || !d) return null;
  const dt = new Date(Number(y), Number(m) - 1, Number(d));
  if (dt.getMonth() !== Number(m) - 1) return null;
  return fmtDate(dt);
}

function segmented(label, id, options, current, onPick) {
  const html = `<div class="field-group"><span class="field-label" id="${id}-label">${label}</span>
    <div class="segmented" role="radiogroup" aria-labelledby="${id}-label">${options
      .map(([v, l]) => `<button type="button" role="radio" data-seg="${id}" data-v="${v}" aria-checked="${current === v}">${l}</button>`)
      .join('')}</div></div>`;
  return { html, bind: (root) => $$(`[data-seg="${id}"]`, root).forEach((b) => (b.onclick = () => {
    $$(`[data-seg="${id}"]`, root).forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    onPick(b.dataset.v);
  })) };
}

function setSound(on) {
  sound.on = on;
  localStorage.setItem('xinyu.sound', on ? 'on' : 'off');
  renderSoundBtn();
  if (on) sfx.chime();
}

function openSettings() {
  const save = async () => {
    const nickname = $('#set-nickname').value;
    const birthday = readBirthday('setb');
    if (birthday === null) {
      $('#settings-error').textContent = '生日请选择完整且有效的年、月、日';
      return;
    }
    try {
      const hadBirthday = !!state.profile.birthday;
      const data = await api('PUT', '/api/profile', { nickname, birthday });
      state = data.state;
      render();
      await closeModal();
      toast(!hadBirthday && birthday ? '生日已保存，可以抽今日卡啦' : '设置已保存');
    } catch (error) {
      $('#settings-error').textContent = error.message;
    }
  };
  const sceneSeg = segmented('小岛的天空', 'scene', [['auto', '跟随时间'], ['day', '白天'], ['night', '夜晚']], scenePref(), (v) => {
    localStorage.setItem('xinyu.scene', v);
    applyScene();
    sceneKey = '';
    render();
  });
  const soundSeg = segmented('音效', 'sound', [['on', '开'], ['off', '关']], sound.on ? 'on' : 'off', (v) => setSound(v === 'on'));
  openModal({
    title: '设置',
    render: (b) => {
      b.innerHTML = `<form id="settings-form" class="settings">
        <div class="field-group"><label class="field-label" for="set-nickname">小屿该怎么称呼你</label>
          <input class="field" id="set-nickname" maxlength="20" placeholder="昵称（可不填）" autocomplete="off" /></div>
        <div class="field-group"><span class="field-label" id="setb-label">生日</span>${birthdayPicker('setb', state?.profile.birthday ?? '', 'setb-label')}
          <p class="field-help">用于生成专属灵感卡和生日花画像</p></div>
        ${sceneSeg.html}${soundSeg.html}
        <p class="field-error" id="settings-error" role="alert"></p>
        <button class="text-btn" type="button" id="replay-intro">重看开场动画</button>
        <button class="text-btn danger" type="button" id="reset-all">清空所有数据</button>
      </form>`;
      $('#set-nickname', b).value = state?.profile.nickname ?? '';
      sceneSeg.bind(b);
      soundSeg.bind(b);
      $('#settings-form', b).onsubmit = (e) => {
        e.preventDefault();
        void save();
      };
      $('#replay-intro', b).onclick = async () => {
        await closeModal();
        void playIntro();
      };
      $('#reset-all', b).onclick = async () => {
        await closeModal();
        if (await confirmModal('清空所有数据？', '将删除心情贴纸、灵感卡、小确幸、答案之书、小屿的笔记和测试结果，且无法恢复。', '全部清空')) {
          lastAnswer = null;
          knownUnlocked = null;
          knownJoyIds = null;
          sceneKey = '';
          const r = await act('POST', '/api/reset');
          if (r.ok) {
            renderBook();
            $('#jar-memory').innerHTML = '';
            toast('数据已清空');
          }
        }
      };
    },
    actions: [
      { label: '取消', kind: 'ghost', onClick: () => void closeModal() },
      { label: '保存', kind: 'primary', onClick: () => void save() },
    ],
  });
  setTimeout(() => $('#set-nickname')?.focus(), 50);
}

// ---------- secrets: 岛霸横横 ----------
function secretCount() {
  return Object.keys(state?.secrets || {}).filter((k) => SECRET_MAP[k]).length;
}
function secretAvailable(id) {
  const u = unlockedCount();
  const night = sceneName() === 'night';
  const rule = {
    tree: u >= 2,
    house: u >= 3,
    lighthouse: u >= 4,
    windmill: u >= 5,
    flower: u >= 1,
    prop: state.about.answers.weekend != null,
    cake: isBirthday(),
    moon: night,
    meteor: night,
    sun: !night,
    balloon: !night,
  }[id];
  return rule ?? true;
}
function undiscovered() {
  return SECRETS.filter((x) => !state.secrets?.[x.id] && secretAvailable(x.id));
}
function pickHint() {
  const list = undiscovered();
  return list.length ? list[hashStr(state.today + list.length) % list.length] : null;
}

async function found(id, anchor) {
  const sec = SECRET_MAP[id];
  if (!state || !sec || state.secrets?.[id]) return;
  const r = anchor?.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor;
  state.secrets = { ...(state.secrets || {}), [id]: new Date().toISOString() };
  setTimeout(
    () => {
      bullyPop(r);
      sfx.bully();
    },
    reduceMotion() ? 0 : 380,
  );
  try {
    const data = await api('POST', '/api/secrets', { id });
    state = data.state;
  } catch {
    return;
  }
  renderHud();
  renderQuests();
  renderHints();
  refreshBubble();
  const n = secretCount();
  setTimeout(() => toast(`发现秘密「${sec.name}」 ${n}/${SECRETS.length}`, 'gift'), reduceMotion() ? 0 : 1500);
}

function bullyPop(r) {
  if (!r) return;
  const el = document.createElement('div');
  el.className = 'bully';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<div class="bully-sprite">${BULLY}</div><p class="bully-say">${pick(BULLY_LINES)}</p>`;
  const x = Math.min(window.innerWidth - 130, Math.max(60, r.left + r.width / 2));
  const y = Math.max(140, r.top + Math.min(r.height, 120) * 0.3);
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  document.body.append(el);
  setTimeout(
    () => {
      flyTo(`<span class="fly-shell">${ICON.shell}</span>`, { left: x - 12, top: y - 44, width: 24, height: 24 }, $('#seed-btn'), {
        size: 28,
        onDone: () => {
          replay($('#seed-btn'), 'bump', 520);
          sfx.pop();
        },
      });
    },
    reduceMotion() ? 0 : 1300,
  );
  setTimeout(() => el.remove(), reduceMotion() ? 1800 : 2350);
}

function renderSeed() {
  const b = $('#seed-btn');
  if (!b || !state) return;
  const n = secretCount();
  b.innerHTML = `<span class="seed-ic">${ICON.shell}</span><strong>${n}</strong><span>/${SECRETS.length}</span>`;
  b.setAttribute('aria-label', `小岛秘密图鉴：已找到 ${n} / ${SECRETS.length}`);
}

function openLog() {
  sfx.page();
  const n = secretCount();
  openModal({
    title: '小岛秘密图鉴',
    cls: 'log-modal',
    render: (b) => {
      b.innerHTML = `<div class="log-head"><p>已找到 <strong>${n}</strong> / ${SECRETS.length} 个秘密</p>
        <div class="lv-bar" role="progressbar" aria-label="秘密收集进度" aria-valuemin="0" aria-valuemax="${SECRETS.length}" aria-valuenow="${n}"><span style="width:${(n / SECRETS.length) * 100}%"></span></div>
        <p class="log-tip">每找到一个，岛霸横横就得乖乖交出一枚贝壳。</p></div>
        <ul class="log-grid">${SECRETS.map((x) => {
          const f = !!state.secrets?.[x.id];
          return `<li class="log-item${f ? ' found' : ''}"><span class="log-ic" aria-hidden="true">${f ? BULLY : '?'}</span><span class="log-txt"><span class="log-name">${f ? esc(x.name) : '？？？'}</span><span class="log-desc">${esc(f ? x.desc : x.hint)}</span></span></li>`;
        }).join('')}</ul>`;
    },
    actions: [{ label: '继续探索', kind: 'primary', onClick: () => void closeModal() }],
  });
}

function renderHints() {
  const box = $('#hints');
  if (!box || !state) return;
  const sc = sceneName();
  const pos = { ...HINT_POS };
  if (sc === 'night') pos.moon = [120, 32];
  else {
    const [x, y] = { dawn: [104, 112], day: [88, 62], dusk: [112, 120] }[sc] ?? [88, 62];
    pos.sun = [x + 30, y - 30];
  }
  const list = undiscovered().filter((x) => pos[x.id]).slice(0, 2);
  box.innerHTML = list
    .map((x, i) => `<i class="hint" style="left:${((pos[x.id][0] / 600) * 100).toFixed(2)}%;top:${((pos[x.id][1] / 300) * 100).toFixed(2)}%;animation-delay:${i * 0.9}s"></i>`)
    .join('');
}

// ---------- 今日旅程 ----------
function questDone(id) {
  if (id === 'card') return !!state.todayCard;
  if (id === 'mood') return !!state.checkins[state.today];
  if (id === 'joy') return state.joys.some((j) => j.date === state.today);
  return Object.values(state.secrets || {}).some((at) => fmtDate(new Date(at)) === state.today);
}

function renderQuests() {
  const box = $('#quest-list');
  if (!box || !state) return;
  const done = new Set(QUESTS.filter((q) => questDone(q.id)).map((q) => q.id));
  const fresh = questPrev ? [...done].filter((id) => !questPrev.has(id)) : [];
  $('#quest-count').textContent = `${done.size}/${QUESTS.length}`;
  $('#quest-bar span').style.width = `${(done.size / QUESTS.length) * 100}%`;
  box.innerHTML = QUESTS.map((q) => {
    const d = done.has(q.id);
    return `<li><button type="button" class="quest${d ? ' done' : ''}${fresh.includes(q.id) ? ' just' : ''}" data-quest="${q.id}" aria-label="${q.title}${d ? '（已完成）' : ''}">
      <span class="q-ic">${ICON[q.icon]}</span><span class="q-txt"><span class="q-t">${q.title}</span><span class="q-s">${d ? '已完成' : q.sub}</span></span>
      <span class="q-stamp" aria-hidden="true">${ICON.check}</span></button></li>`;
  }).join('');
  $$('[data-quest]', box).forEach((b) => (b.onclick = () => questGo(b.dataset.quest)));
  if (fresh.length) {
    sfx.chime();
    fresh.forEach((id) => setTimeout(() => burst($(`[data-quest="${id}"] .q-stamp`, box), 14), reduceMotion() ? 0 : 300));
  }
  if (fresh.length && done.size === QUESTS.length) {
    if (state.flags?.questsDay !== state.today) {
      setFlag('questsDay', state.today);
      setTimeout(
        () => {
          showBanner({ kicker: '— 今日旅程 —', name: '全部完成', sub: '明天见，小岛会一直在这里等你' });
          sfx.fanfare();
          burst($('#quests'), 44);
          say('今天的旅程全部完成啦，你真棒！', 5000);
        },
        reduceMotion() ? 0 : 1800,
      );
    }
  }
  questPrev = done;
}

function questGo(id) {
  const smooth = reduceMotion() ? 'auto' : 'smooth';
  if (id === 'card') {
    if (!state.profile.birthday) return openSettings();
    if (!state.todayCard) return dailyTalk();
    $('#pass').scrollIntoView({ behavior: smooth, block: 'center' });
    return;
  }
  if (id === 'mood') return doMascotAct('mood');
  if (id === 'joy') {
    const form = $('#joy-form');
    form.scrollIntoView({ behavior: smooth, block: 'center' });
    replay(form.closest('.panel'), 'flash');
    setTimeout(() => $('#joy-input').focus({ preventScroll: true }), 400);
    return;
  }
  sfx.tap();
  $('#scene').scrollIntoView({ behavior: smooth, block: 'center' });
  const h = pickHint();
  say(h ? `悄悄告诉你：${h.hint}` : '岛上能找的秘密都被你找到啦！', 5200);
  replay($('#hints'), 'boost', 2400);
}

// ---------- 区域横幅（像进入新地区时浮现的地名） ----------
let bannerTimer = 0;
function showBanner({ kicker = '', name, sub = '' }, ms = 3600) {
  const el = $('#banner');
  el.innerHTML = `<p class="bn-kicker">${esc(kicker)}</p><p class="bn-name"><span>${esc(name)}</span></p><p class="bn-sub">${esc(sub)}</p>`;
  el.style.setProperty('--dur', `${ms}ms`);
  el.classList.remove('show');
  el.getBoundingClientRect();
  el.classList.add('show');
  sfx.discover();
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.classList.remove('show'), reduceMotion() ? 2200 : ms);
}

function markDockNew() {
  $$('.dock [role="tab"]').forEach((t) => {
    const k = t.dataset.tab;
    if (k === tab) {
      setFlag(`region.${k}`);
      return;
    }
    if (flag(`region.${k}`) || $('.dock-new', t)) return;
    const b = document.createElement('b');
    b.className = 'dock-new';
    b.setAttribute('aria-hidden', 'true');
    t.append(b);
  });
}

// ---------- 开场：睁开眼睛 ----------
function typeInto(el, text, speed = 60) {
  return new Promise((res) => {
    const chars = [...text];
    if (reduceMotion()) {
      el.textContent = text;
      res();
      return;
    }
    let i = 0;
    el.textContent = '';
    const t = setInterval(() => {
      i++;
      el.textContent = chars.slice(0, i).join('');
      if (!NO_BLIP.test(chars[i - 1] ?? '')) sfx.blip(0.5);
      if (i >= chars.length) {
        clearInterval(t);
        res();
      }
    }, speed);
  });
}

async function playIntro() {
  if (introRunning || !state) return;
  introRunning = true;
  const dlg = $('#intro');
  const line = $('#intro-line');
  const tap = $('#intro-tap');
  let phase = 'lines';
  let skipped = false;
  let go;
  const tapped = new Promise((r) => (go = r));
  const skip = () => {
    skipped = true;
    go();
  };
  dlg.className = 'intro';
  line.textContent = '';
  tap.hidden = true;
  setTab('today');
  window.scrollTo({ top: 0 });
  document.body.classList.remove('waking');
  document.body.classList.add('pre-wake');
  dlg.showModal();
  dlg.oncancel = (e) => {
    e.preventDefault();
    skip();
  };
  $('#intro-skip').onclick = (e) => {
    e.stopPropagation();
    skip();
  };
  tap.onclick = (e) => {
    e.stopPropagation();
    go();
  };
  dlg.onclick = () => {
    if (phase === 'tap') go();
    else phase = 'fast';
  };
  for (const t of ['……', '……醒醒。', '你终于醒啦。', '睁开眼睛吧。']) {
    if (skipped || phase === 'fast') break;
    await typeInto(line, t, 75);
    await wait(700);
  }
  if (!skipped) {
    line.textContent = '睁开眼睛吧。';
    phase = 'tap';
    tap.hidden = false;
    tap.focus();
    await tapped;
  }
  phase = 'done';
  sfx.whoosh();
  dlg.classList.add('opening');
  if (skipped) dlg.classList.add('fast');
  document.body.classList.add('waking');
  requestAnimationFrame(() => document.body.classList.remove('pre-wake'));
  await wait(skipped ? 600 : 2600);
  dlg.close();
  setTimeout(() => document.body.classList.remove('waking'), reduceMotion() ? 0 : 900);
  localStorage.setItem('xinyu.awoke', '1');
  setFlag('awoke');
  setFlag('lastDay', state.today);
  setFlag('region.today');
  introRunning = false;
  if (skipped) return;
  showBanner({ kicker: '— 第一天 —', name: '心屿', sub: '初醒之岛' }, 3800);
  await wait(3600);
  introTalk();
}

function introTalk() {
  const steps = [
    { text: '你醒啦！我是小屿，这座小岛的守岛人。', options: ['你好呀，小屿'] },
    { react: '嘿嘿～', text: '这里是心屿，一座会跟着你慢慢长大的小岛。你告诉我的每件事，都会让它多长出一点东西。', options: ['听起来好有意思'] },
    { react: '还有哦——', text: `岛上住着一只横行霸道的螃蟹，叫岛霸横横。它把 ${SECRETS.length} 个小秘密藏了起来，你每找到一个，它就得乖乖交出一枚贝壳。`, options: ['我要全部找到！', '能给点提示吗？'] },
    { text: '今天的旅程写在小岛下面，跟着它走就好。我们出发吧！', options: ['出发！'] },
  ];
  let i = 0;
  const end = async () => {
    await closeTalk();
    spotlightQuests();
  };
  const next = (react) => {
    const st = steps[i];
    talkStep({
      progress: '初次见面',
      react: react ?? st.react ?? '',
      text: st.text,
      options: st.options,
      mood: 5,
      cols: 1,
      onPick: async (k) => {
        await wait(220);
        const hinted = i === 2 && k === 1;
        i++;
        if (i < steps.length) next(hinted ? '比如……先戳戳我试试？' : undefined);
        else await end();
      },
      foot: [{ label: '跳过', onClick: () => void end() }],
    });
  };
  openTalk();
  next();
}

function spotlightQuests() {
  const q = $('#quests');
  if (!q) return;
  q.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
  replay(q, 'spot', 3300);
  replay($('#hints'), 'boost', 3300);
}

// ---------- first load extras ----------
function onFirstLoad() {
  markDockNew();
  if (!flag('awoke')) {
    void playIntro();
    return;
  }
  localStorage.setItem('xinyu.awoke', '1');
  document.body.classList.remove('pre-wake');
  const last = state.flags?.lastDay;
  setFlag('lastDay', state.today);
  if (last !== state.today) {
    setTimeout(() => showBanner({ kicker: '— 新的一天 —', name: '心屿', sub: prettyDate(state.today, true) }), reduceMotion() ? 0 : 600);
  }
  if (!isBirthday()) return;
  if (state.flags?.bdayDay === state.today) return;
  setFlag('bdayDay', state.today);
  setTimeout(
    () => {
      burst($('#stage'), 50);
      say('生日快乐！今天整座小岛都在为你庆祝！', 5000);
    },
    reduceMotion() ? 0 : 900,
  );
}

// ---------- wire up ----------
function init() {
  applyScene();
  if (!localStorage.getItem('xinyu.awoke')) document.body.classList.add('pre-wake');
  setInterval(() => {
    const before = document.documentElement.dataset.scene;
    applyScene();
    if (state && before !== document.documentElement.dataset.scene) {
      sceneKey = '';
      renderScene();
    }
  }, 60000);
  $$('[data-icon]').forEach((el) => (el.innerHTML = ICON[el.dataset.icon]));
  renderSoundBtn();

  const unlockAudio = () => {
    sound.unlocked = true;
    sound.ensure();
  };
  window.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });
  window.addEventListener('keydown', unlockAudio, { once: true, capture: true });
  const markActive = () => (lastActive = Date.now());
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) => window.addEventListener(ev, markActive, { passive: true }));
  window.addEventListener(
    'pointermove',
    (e) => {
      lastActive = Date.now();
      if (reduceMotion()) return;
      lookX = e.clientX;
      lookY = e.clientY;
      if (!lookRaf) lookRaf = requestAnimationFrame(updateLook);
    },
    { passive: true },
  );
  document.addEventListener('click', (e) => {
    if (e.target.closest?.('.gbtn, .round-btn, .entry, .text-btn, .dock [role="tab"], .segmented button')) sfx.tap();
  });
  setInterval(idleTick, 4000);
  scheduleAmbient(true);

  const tabs = $$('.dock [role="tab"]');
  tabs.forEach((t, idx) => {
    t.onclick = () => setTab(t.dataset.tab, true);
    t.onkeydown = (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const nt = tabs[(idx + d + tabs.length) % tabs.length];
      setTab(nt.dataset.tab, true);
      nt.focus();
    };
  });
  if (!tabs.some((t) => t.dataset.tab === tab)) tab = 'today';
  setTab(tab);

  $('#retry-load').onclick = () => load();
  $('#open-settings').onclick = openSettings;
  $('#seed-btn').onclick = openLog;
  $('#sound-btn').onclick = () => {
    setSound(!sound.on);
    toast(sound.on ? '音效已打开' : '音效已关闭');
  };
  $('#streak-pill').onclick = () => {
    if (!state) return;
    const n = state.streak;
    const pill = $('#streak-pill');
    replay(pill, 'bump', 520);
    burst($('.flame', pill), 12, ['#ff9a3d', '#ffc24b', '#ff7a59']);
    sfx.pop();
    toast(n ? `已经连续打卡 ${n} 天，小火苗越烧越旺！` : '今天贴一张心情贴纸，点燃小火苗吧。', n ? 'ok' : 'gift');
  };
  $('#scene').addEventListener('click', onSceneClick);

  const talkDlg = $('#talk');
  $('#talk-close').onclick = () => void closeTalk();
  talkDlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    void closeTalk();
  });
  talkDlg.addEventListener('keydown', (e) => {
    if (/^[1-9]$/.test(e.key) && $('#talk-options').classList.contains('show')) {
      const b = $(`#talk-options .opt[data-i="${Number(e.key) - 1}"]`);
      if (b) {
        e.preventDefault();
        b.click();
      }
    } else if ((e.key === 'Enter' || e.key === ' ') && typing) {
      e.preventDefault();
      typing.finish();
    }
  });
  const modalDlg = $('#modal');
  $('#modal-x').onclick = cancelModal;
  modalDlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    cancelModal();
  });
  modalDlg.addEventListener('click', (e) => {
    if (e.target !== modalDlg) return;
    const r = modalDlg.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) cancelModal();
  });

  $('#jar').onclick = shakeJar;
  $('#joy-form').onsubmit = async (e) => {
    e.preventDefault();
    const input = $('#joy-input');
    const text = input.value.trim();
    if (!text) {
      replay(input, 'nudge', 420);
      return;
    }
    const from = input.getBoundingClientRect();
    const r = await act('POST', '/api/joys', { text });
    if (r.ok) {
      input.value = '';
      sfx.pop();
      toast('又攒下一颗星星');
      flyTo(sv(`<path d="${starPath(12, 12, 10)}" fill="#ffd166" stroke="#e3a024" stroke-width="1.4" stroke-linejoin="round"/>`), from, $('#jar'), {
        size: 34,
        onDone: () => {
          replay($('#jar'), 'bump', 520);
          sfx.chime();
        },
      });
    }
  };

  $('#cal-prev').onclick = () => {
    calCursor.m--;
    if (calCursor.m < 0) {
      calCursor.m = 11;
      calCursor.y--;
    }
    renderCalendar();
  };
  $('#cal-next').onclick = () => {
    calCursor.m++;
    if (calCursor.m > 11) {
      calCursor.m = 0;
      calCursor.y++;
    }
    renderCalendar();
  };

  $('#picker-form').onsubmit = (e) => {
    e.preventDefault();
    const input = $('#picker-input');
    const v = input.value.trim();
    if (!v || picking) {
      if (!v) replay(input, 'nudge', 420);
      return;
    }
    if (pickerOptions.length >= 12) return toast('最多 12 个选项', 'err');
    if (pickerOptions.includes(v)) return toast('这个选项已经有了', 'err');
    pickerOptions.push(v);
    input.value = '';
    sfx.pop();
    resetPick();
  };
  $('#picker-preset').onclick = () => {
    if (picking) return;
    pickerOptions = PRESET.slice();
    resetPick();
  };
  $('#picker-clear').onclick = () => {
    pickerOptions = [];
    resetPick();
  };
  $('#picker-go').onclick = runPicker;
  $('#lever').onclick = () => {
    if (!picking && pickerOptions.length >= 2) void found('lever', $('#lever'));
    void runPicker();
  };
  resetPick();

  renderBook();
  $('#book-form').onsubmit = async (e) => {
    e.preventDefault();
    const input = $('#book-input');
    const question = input.value.trim();
    if (!question) {
      replay(input, 'nudge', 420);
      return toast('先写下你的问题', 'err');
    }
    const dup = !!state?.answers.some((a) => a.date === state.today && a.question === question);
    const btn = e.submitter;
    if (btn) btn.disabled = true;
    const r = await act('POST', '/api/answers', { question });
    if (btn) btn.disabled = false;
    if (r.ok && r.result) {
      lastAnswer = { ...r.result, dup };
      input.value = '';
      renderBook(true);
    }
  };
  $('#book-clear').onclick = async () => {
    if (await confirmModal('清空答案之书？', '将删除全部翻页记录。', '清空')) {
      lastAnswer = null;
      renderBook();
      const r = await act('DELETE', '/api/answers');
      if (r.ok) toast('已清空');
    }
  };

  void load();
  connectEvents();
}

init();
