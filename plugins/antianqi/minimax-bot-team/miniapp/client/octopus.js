// Octopus avatars built from the MiniMax Code brand mark (header-symbol.svg).
// Every Bot shares the silhouette; palettes and faces tell them apart.

const SVG_NS = 'http://www.w3.org/2000/svg';
export const OCTOPUS_PATH =
  'M26.1139 4.97856C27.0309 5.3238 27.9237 4.03738 26.646 3.1182C24.6317 1.66905 23.1936 2.46289 22.4987 3.03243C22.4723 3.05442 21.7246 2.46069 21.2277 2.15283C19.6422 1.16987 17.8984 0.470588 16.0578 0.178119C15.3585 0.0681688 14.6526 0.0131941 13.9467 0V0.00879121C13.0364 -0.00880087 12.1238 0.048375 11.2244 0.189112C9.3838 0.479381 7.63998 1.17867 6.0545 2.16383C5.55532 2.47389 4.80986 3.06542 4.78347 3.04343C4.08858 2.47169 2.64823 1.67784 0.636135 3.12919C-0.64149 4.04837 0.251308 5.337 1.1683 4.98956C1.79941 4.75206 2.60645 4.16712 3.20898 4.64431C1.53113 6.70258 0.526185 9.31941 0.526185 12.1693C0.526185 15.0192 1.46076 17.4491 3.03086 19.47L2.77797 19.6658C1.22987 20.8686 0.957189 23.083 2.16664 24.6201C3.3739 26.155 5.6103 26.4255 7.1562 25.2271L8.87582 23.8922C9.06274 23.7471 9.28264 23.7075 9.48495 23.7493C9.51134 23.7559 9.53773 23.7625 9.56412 23.7691C9.85439 23.8615 10.0853 24.1253 10.0853 24.475C10.0853 26.4189 11.6708 27.9934 13.6301 28H13.6477C15.607 27.9934 17.1947 26.4189 17.1925 24.475C17.1925 24.1319 17.4146 23.8725 17.6961 23.7757C17.7334 23.7669 17.7708 23.7559 17.8082 23.7471C18.0039 23.7119 18.2172 23.7537 18.3997 23.8945L20.1194 25.2292C21.6653 26.4299 23.9017 26.1572 25.1089 24.6245C26.3184 23.0874 26.0457 20.873 24.4976 19.6701L24.2491 19.4744C25.0539 18.4365 25.6917 17.2666 26.1227 16C26.1315 15.9736 26.1403 15.9472 26.1491 15.9208C26.1886 15.8021 26.2282 15.6811 26.2634 15.5602C26.281 15.5008 26.2964 15.4414 26.314 15.3821C26.3382 15.2919 26.3646 15.2018 26.3887 15.1116C26.4151 15.0104 26.4371 14.9093 26.4613 14.8081C26.4723 14.7576 26.4855 14.707 26.4965 14.6542C26.668 13.8494 26.7604 13.0159 26.7604 12.1605C26.7604 9.31061 25.7554 6.69159 24.0776 4.63551C24.6801 4.15613 25.4872 4.74107 26.1183 4.98076L26.1139 4.97856Z';
const VIEWBOX = '-0.6 -0.6 28.5 29.2';

/** id → [deep, mid, light] gradient stops and the text ink (light, dark theme). Names: `panels.palette.<id>`. */
export const PALETTES = {
  ocean: { stops: ['#1F5FFF', '#3A8DFF', '#9BEBFF'], ink: ['#1F5FFF', '#5C93FF'] },
  sky: { stops: ['#0A86D9', '#27BFF2', '#B9F4FF'], ink: ['#0A86D9', '#3CC4F2'] },
  teal: { stops: ['#00968F', '#1DCFBE', '#BDFFF3'], ink: ['#00968F', '#2BD3C2'] },
  green: { stops: ['#0E9450', '#2DCC76', '#CCFFDB'], ink: ['#0E9450', '#3BD583'] },
  lime: { stops: ['#5E9E06', '#9AD62B', '#F1FFC6'], ink: ['#5E9E06', '#A3DB3D'] },
  yellow: { stops: ['#E08E00', '#FFBE2E', '#FFF2BD'], ink: ['#C97F00', '#FFC23F'] },
  orange: { stops: ['#EC5E08', '#FF9440', '#FFE2C6'], ink: ['#E25A08', '#FF9A4D'] },
  red: { stops: ['#DE2639', '#FF5A63', '#FFD3D6'], ink: ['#DE2639', '#FF6B73'] },
  pink: { stops: ['#D23286', '#FF6DB3', '#FFD8EE'], ink: ['#D23286', '#FF7DBD'] },
  violet: { stops: ['#683CDE', '#9874FF', '#E5DBFF'], ink: ['#683CDE', '#A385FF'] },
  indigo: { stops: ['#3439D2', '#626EFF', '#D5D9FF'], ink: ['#3439D2', '#7D87FF'] },
  graphite: { stops: ['#2B2F36', '#59616E', '#CDD3DC'], ink: ['#4A515C', '#A9B1BD'] },
};
export const PALETTE_IDS = Object.keys(PALETTES);

/**
 * Bot looks: one rendered image each, served from /bot/skins/<id>.png. The palette next to each
 * is that Bot's text color. Names live in strings-panels.js as `panels.skin.<id>`.
 */
export const SKINS = {
  fuzzy: 'ocean',
  bubble: 'ocean',
  glass: 'pink',
  gold: 'yellow',
  jade: 'green',
  plush: 'violet',
  waffle: 'orange',
  pixel: 'sky',
  smiley: 'yellow',
  toys: 'red',
  moon: 'graphite',
};
export const SKIN_IDS = Object.keys(SKINS);
export const skinUrl = (skin) => `/bot/skins/${SKINS[skin] ? skin : 'bubble'}.png`;

/** Face ids; display names live in strings-panels.js as `panels.face.<id>`. */
export const FACE_IDS = ['none', 'dots', 'happy', 'wink', 'sleepy', 'shades'];

const paletteOf = (color) => PALETTES[color] ?? PALETTES.ocean;

/** Text color for a Bot name or mention, following the current theme. */
export const inkOf = (color) => `var(--ink-${PALETTES[color] ? color : 'ocean'})`;

/** CSS variables and shared gradients, injected once. */
export function installOctopusDefs() {
  if (document.getElementById('octopus-defs')) return;
  const style = document.createElement('style');
  style.textContent = [
    ':root, [data-theme="light"] {',
    ...PALETTE_IDS.map((id) => `  --ink-${id}: ${PALETTES[id].ink[0]};`),
    '}',
    '[data-theme="dark"] {',
    ...PALETTE_IDS.map((id) => `  --ink-${id}: ${PALETTES[id].ink[1]};`),
    '}',
  ].join('\n');
  document.head.append(style);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.id = 'octopus-defs';
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  const defs = PALETTE_IDS.map((id) => {
    const [deep, mid, light] = PALETTES[id].stops;
    return (
      `<linearGradient id="oc-${id}" x1="0.78" y1="0.02" x2="0.22" y2="1">` +
      `<stop offset="0" stop-color="${deep}"/><stop offset="0.55" stop-color="${mid}"/><stop offset="1" stop-color="${light}"/>` +
      `</linearGradient>`
    );
  });
  svg.innerHTML =
    `<defs>${defs.join('')}` +
    '<radialGradient id="oc-glow" cx="0.28" cy="0.86" r="0.6">' +
    '<stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>' +
    '</radialGradient>' +
    '<radialGradient id="oc-shine" cx="0.62" cy="0.12" r="0.42">' +
    '<stop offset="0" stop-color="#fff" stop-opacity="0.28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>' +
    '</radialGradient></defs>';
  document.body.prepend(svg);
}

function faceMarkup(face, deep) {
  const stroke = 'stroke="#fff" stroke-width="1.35" stroke-linecap="round" fill="none"';
  const eye = (x) =>
    `<ellipse cx="${x}" cy="11.4" rx="1.75" ry="2.25" fill="#fff"/><circle cx="${x + 0.25}" cy="11.1" r="0.95" fill="${deep}"/>`;
  const arcUp = (x) => `<path d="M${x - 1.7} 12.2 Q${x} 9.7 ${x + 1.7} 12.2" ${stroke}/>`;
  const arcDown = (x) => `<path d="M${x - 1.6} 11.2 Q${x} 12.9 ${x + 1.6} 11.2" ${stroke}/>`;
  const smile = `<path d="M12.25 15.4 Q13.64 16.7 15.03 15.4" ${stroke} stroke-width="1.15"/>`;
  switch (face) {
    case 'dots':
      return eye(9.5) + eye(17.4) + smile;
    case 'happy':
      return arcUp(9.5) + arcUp(17.8) + smile;
    case 'wink':
      return eye(9.5) + arcUp(17.8) + smile;
    case 'sleepy':
      return arcDown(9.5) + arcDown(17.8) + `<ellipse cx="13.64" cy="15.8" rx="0.8" ry="0.65" fill="#fff" opacity="0.9"/>`;
    case 'shades':
      return (
        '<g fill="#14161a" opacity="0.9">' +
        '<rect x="6.4" y="9.2" width="6.3" height="4.2" rx="1.6"/><rect x="14.6" y="9.2" width="6.3" height="4.2" rx="1.6"/>' +
        '<rect x="12.4" y="10.2" width="2.5" height="0.9" rx="0.45"/></g>' +
        '<path d="M7.6 10.4 L9.2 10.4" stroke="#fff" stroke-width="0.8" stroke-linecap="round" opacity="0.7"/>' +
        '<path d="M15.8 10.4 L17.4 10.4" stroke="#fff" stroke-width="0.8" stroke-linecap="round" opacity="0.7"/>' +
        smile
      );
    default:
      return '';
  }
}

/** Bare octopus SVG markup in a palette and face. */
export function octopusMarkup(color, face = 'none', { ring = false } = {}) {
  const id = PALETTES[color] ? color : 'ocean';
  const deep = paletteOf(id).stops[0];
  const ringAttr = ring
    ? ' stroke="var(--ring, var(--surface))" stroke-width="2.4" paint-order="stroke" stroke-linejoin="round"'
    : '';
  return (
    `<svg viewBox="${VIEWBOX}" xmlns="${SVG_NS}" aria-hidden="true" focusable="false">` +
    `<path d="${OCTOPUS_PATH}" fill="url(#oc-${id})"${ringAttr}/>` +
    `<path d="${OCTOPUS_PATH}" fill="url(#oc-glow)"/>` +
    `<path d="${OCTOPUS_PATH}" fill="url(#oc-shine)"/>` +
    `<g class="oc-face">${faceMarkup(face, deep)}</g>` +
    `</svg>`
  );
}

/**
 * A Bot mark: octopus plus optional state badge.
 * @param {{ color?: string, face?: string, isMain?: boolean } | undefined} bot
 * @param {{ size?: number, state?: 'idle' | 'working' | 'alert', star?: boolean, label?: string }} [options]
 */
/**
 * Where a Bot's custom image loads from: a stored file name (served by /api/avatars) or, while
 * the user is still choosing one, a data URL. `undefined` means the built-in octopus.
 */
export function avatarUrl(avatar) {
  if (typeof avatar !== 'string' || !avatar) return undefined;
  if (avatar.startsWith('data:image/')) return avatar;
  return /^[a-zA-Z0-9_-]+\.(png|jpe?g|webp|gif)$/.test(avatar) ? `/api/avatars/${avatar}` : undefined;
}

/** The Bot's face: its uploaded image, else its look, else (a Bot from an old page) its octopus. */
function markMarkup(bot, opts) {
  const url = avatarUrl(bot?.avatar);
  const img = document.createElement('img');
  img.alt = '';
  img.draggable = false;
  if (url) {
    img.className = `oc-img${opts?.ring ? ' ring' : ''}`;
    img.src = url;
    return img.outerHTML;
  }
  if (!bot?.skin || !SKINS[bot.skin]) return octopusMarkup(bot?.color ?? 'graphite', bot?.face ?? 'none', opts);
  img.className = `oc-skin${opts?.ring ? ' ring' : ''}`;
  img.src = skinUrl(bot.skin);
  return img.outerHTML;
}

export function botMark(bot, options = {}) {
  const size = options.size ?? 28;
  const el = document.createElement('span');
  el.className = 'oc';
  el.dataset.state = options.state ?? 'idle';
  el.style.setProperty('--oc-size', `${size}px`);
  if (options.label) {
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', options.label);
  } else el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<span class="oc-body">${markMarkup(bot)}</span>`;
  if (options.state === 'alert') {
    el.insertAdjacentHTML('beforeend', '<span class="oc-badge oc-badge-alert">?</span>');
  } else if (options.star && bot?.isMain) {
    el.insertAdjacentHTML(
      'beforeend',
      '<span class="oc-badge oc-badge-star"><svg viewBox="0 0 24 24"><path d="M12 2.8l2.75 5.8 6.35.8-4.66 4.38 1.2 6.3L12 17.02 6.36 20.1l1.2-6.3L2.9 9.4l6.35-.8z" fill="currentColor"/></svg></span>',
    );
  }
  return el;
}

/** Up to three member octopuses stacked into one group mark. */
export function groupMark(members, size = 36) {
  const el = document.createElement('span');
  el.className = 'oc-group';
  el.style.setProperty('--oc-size', `${size}px`);
  el.setAttribute('aria-hidden', 'true');
  const list = members.slice(0, 3);
  const layouts = {
    0: [],
    1: [[0.08, 0.08, 0.84]],
    2: [
      [0, 0, 0.66],
      [0.36, 0.34, 0.64],
    ],
    3: [
      [0.2, 0, 0.6],
      [0, 0.44, 0.54],
      [0.46, 0.44, 0.54],
    ],
  };
  const slots = layouts[list.length];
  list.forEach((bot, index) => {
    const [x, y, s] = slots[index];
    const piece = document.createElement('span');
    piece.className = 'oc-piece';
    piece.style.cssText = `left:${x * size}px;top:${y * size}px;width:${s * size}px;height:${s * size}px;z-index:${3 - index}`;
    piece.innerHTML = markMarkup(bot, { ring: list.length > 1 });
    el.append(piece);
  });
  if (!list.length) el.classList.add('oc-group-empty');
  return el;
}
